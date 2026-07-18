import * as THREE from 'three';
import { vxMatrixToThree, vxPositionToThree } from '../engine/convert.ts';
import { decodeCk2dCurve, evalCurve, type CurveKey } from '../game/curve.ts';
import type {
  BehaviorRec,
  CameraRec,
  CKRecord,
  CurvePointRec,
  CurveRec,
  Entity3dRec,
  NmoFile,
  ParameterRec,
} from '../formats/ck2/types.ts';

export interface MenuCurvePoint {
  position: THREE.Vector3;
  incomingTangent: THREE.Vector3;
  outgoingTangent: THREE.Vector3;
}

export interface MenuCameraSource {
  points: MenuCurvePoint[];
  closed: boolean;
  durationSeconds: number;
  progression: CurveKey[];
  target: THREE.Vector3;
  fieldOfViewDegrees: number;
  aspectRatio: number;
  nearPlane: number;
  farPlane: number;
}

function namedRecord<T extends CKRecord>(
  file: NmoFile,
  name: string,
  guard: (record: CKRecord) => record is T,
): T {
  const record = file.byName.get(name)?.find(guard);
  if (!record) throw new Error(`missing MenuLevel.nmo record ${name}`);
  return record;
}

function isCurve(record: CKRecord): record is CurveRec {
  return typeof record === 'object' && record !== null && 'kind' in record && record.kind === 'curve';
}

function isCurvePoint(record: CKRecord): record is CurvePointRec {
  return typeof record === 'object' && record !== null && 'kind' in record && record.kind === 'curvePoint';
}

function isCamera(record: CKRecord): record is CameraRec {
  return (
    typeof record === 'object' &&
    record !== null &&
    'kind' in record &&
    record.kind === 'entity' &&
    'fieldOfView' in record
  );
}

function isEntity(record: CKRecord): record is Entity3dRec {
  return typeof record === 'object' && record !== null && 'kind' in record && record.kind === 'entity';
}

function isBehavior(record: CKRecord): record is BehaviorRec {
  return typeof record === 'object' && record !== null && 'kind' in record && record.kind === 'behavior';
}

function resolveParameter(file: NmoFile, parameter: ParameterRec): ParameterRec {
  let current = parameter;
  const seen = new Set<number>();
  while (!seen.has(current.index)) {
    seen.add(current.index);
    const nextIndex = current.sourceIndex >= 0 ? current.sourceIndex : current.sharedIndex;
    if (nextIndex < 0) break;
    const next = file.objects[nextIndex];
    if (next?.kind !== 'parameter') break;
    current = next;
  }
  return current;
}

function behaviorParameter(file: NmoFile, behavior: BehaviorRec, name: string): ParameterRec {
  const parameter = behavior.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .find((record): record is ParameterRec => record?.kind === 'parameter' && record.name === name);
  if (!parameter) throw new Error(`missing MenuLevel.nmo parameter ${behavior.name}/${name}`);
  return resolveParameter(file, parameter);
}

function floatValue(parameter: ParameterRec): number {
  if (parameter.valueBytes.byteLength < 4) throw new Error(`missing float value for ${parameter.name}`);
  return new DataView(
    parameter.valueBytes.buffer,
    parameter.valueBytes.byteOffset,
    parameter.valueBytes.byteLength,
  ).getFloat32(0, true);
}

function decodeAspectRatio(value: number): number {
  const height = value >>> 16;
  const width = value & 0xffff;
  return width > 0 && height > 0 ? width / height : 4 / 3;
}

/** Decode the target camera and Position On Curve inputs authored in MenuLevel.nmo. */
export function decodeMenuCameraSource(file: NmoFile): MenuCameraSource {
  const curve = namedRecord(file, 'I_MenuLevel_Curve', isCurve);
  const camera = namedRecord(file, 'Cam_MenuLevel', isCamera);
  const targetRecord = file.objects[camera.targetIndex];
  if (!isEntity(targetRecord)) throw new Error('missing MenuLevel.nmo target camera target');

  const tangentMatrix = new THREE.Matrix3().setFromMatrix4(vxMatrixToThree(curve.entity.worldMatrix));
  const points = curve.pointIndices.map((index) => {
    const point = file.objects[index];
    if (!isCurvePoint(point)) throw new Error(`missing MenuLevel.nmo curve point ${index}`);
    const tangent = (value: readonly [number, number, number]) =>
      new THREE.Vector3(value[0], value[1], -value[2]).applyMatrix3(tangentMatrix);
    return {
      position: vxPositionToThree(point.entity.worldMatrix),
      incomingTangent: tangent(point.incomingTangent),
      outgoingTangent: tangent(point.outgoingTangent),
    };
  });

  const progressionBehavior = namedRecord(file, 'Bezier Progression', isBehavior);
  const durationSeconds = floatValue(behaviorParameter(file, progressionBehavior, 'Duration')) / 1000;
  const progression = decodeCk2dCurve(
    behaviorParameter(file, progressionBehavior, 'Progression Curve').valueBytes,
  );
  if (progression.length < 2) throw new Error('missing MenuLevel.nmo camera progression curve');

  return {
    points,
    closed: !curve.open,
    durationSeconds,
    progression,
    target: vxPositionToThree(targetRecord.worldMatrix),
    fieldOfViewDegrees: THREE.MathUtils.radToDeg(camera.fieldOfView),
    aspectRatio: decodeAspectRatio(camera.aspectRatio),
    nearPlane: camera.nearPlane,
    farPlane: camera.farPlane,
  };
}

/** Evaluate CKCurve's closed cubic-Hermite control-point path. */
export function sampleMenuCameraPath(
  source: Pick<MenuCameraSource, 'points' | 'closed'>,
  progress: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const pointCount = source.points.length;
  const segmentCount = source.closed ? pointCount : pointCount - 1;
  if (segmentCount <= 0) throw new Error('menu camera curve needs at least two points');

  const normalized = source.closed
    ? ((progress % 1) + 1) % 1
    : THREE.MathUtils.clamp(progress, 0, 1);
  const scaled = normalized * segmentCount;
  const segment = Math.min(Math.floor(scaled), segmentCount - 1);
  const u = source.closed ? scaled - Math.floor(scaled) : segment === segmentCount - 1 && normalized === 1 ? 1 : scaled - segment;
  const current = source.points[segment];
  const next = source.points[(segment + 1) % pointCount];
  const u2 = u * u;
  const u3 = u2 * u;

  return out
    .set(0, 0, 0)
    .addScaledVector(current.position, 2 * u3 - 3 * u2 + 1)
    .addScaledVector(current.outgoingTangent, u3 - 2 * u2 + u)
    .addScaledVector(next.position, -2 * u3 + 3 * u2)
    .addScaledVector(next.incomingTangent, u3 - u2);
}

/** Evaluate the source Bezier Progression before placing the camera on the curve. */
export function menuCameraProgress(source: MenuCameraSource, elapsedSeconds: number): number {
  const phase = ((elapsedSeconds / source.durationSeconds) % 1 + 1) % 1;
  return evalCurve(source.progression, phase);
}
