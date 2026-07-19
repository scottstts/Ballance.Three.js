import * as THREE from 'three';
import { decodeCk2dCurve, evalCurve, type CurveKey } from '../game/curve.ts';
import type { BehaviorRec, NmoFile, ObjectAnimationRec, ParameterRec, VectorKey } from '../formats/ck2/types.ts';

export interface MenuStoneAnimationSource {
  track: ObjectAnimationRec;
  durationSeconds: number;
  progression: CurveKey[];
  loop: boolean;
}

function behavior(file: NmoFile, name: string): BehaviorRec {
  const record = file.byName
    .get(name)
    ?.find((candidate): candidate is BehaviorRec => candidate.kind === 'behavior');
  if (!record) throw new Error(`missing MenuLevel.nmo behavior ${name}`);
  return record;
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

function parameter(file: NmoFile, owner: BehaviorRec, name: string): ParameterRec {
  const record = owner.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .find((candidate): candidate is ParameterRec => candidate?.kind === 'parameter' && candidate.name === name);
  if (!record) throw new Error(`missing MenuLevel.nmo parameter ${owner.name}/${name}`);
  return resolveParameter(file, record);
}

function floatValue(record: ParameterRec): number {
  if (record.valueBytes.byteLength < 4) throw new Error(`missing float value for ${record.name}`);
  return new DataView(record.valueBytes.buffer, record.valueBytes.byteOffset, record.valueBytes.byteLength).getFloat32(
    0,
    true,
  );
}

function intValue(record: ParameterRec): number {
  if (record.valueBytes.byteLength < 4) throw new Error(`missing integer value for ${record.name}`);
  return new DataView(record.valueBytes.buffer, record.valueBytes.byteOffset, record.valueBytes.byteLength).getInt32(
    0,
    true,
  );
}

/** Decode Ball_Stone Script's Play Animation 3D Entity inputs. */
export function decodeMenuStoneAnimationSource(file: NmoFile): MenuStoneAnimationSource {
  const script = behavior(file, 'Ball_Stone Script');
  const animationParameter = parameter(file, script, 'Animation');
  const track = file.objects[animationParameter.valueObjectIndex];
  if (track?.kind !== 'objectAnimation') throw new Error('missing MenuLevel.nmo Record Anim track');

  const progression = decodeCk2dCurve(parameter(file, script, 'Progression Curve').valueBytes);
  if (progression.length < 2) throw new Error('missing MenuLevel.nmo stone-ball progression');
  return {
    track,
    durationSeconds: floatValue(parameter(file, script, 'Duration')) / 1000,
    progression,
    loop: intValue(parameter(file, script, 'Loop')) !== 0,
  };
}

function keyInterval<T extends { time: number }>(keys: readonly T[], time: number): readonly [T, T, number] | null {
  if (keys.length === 0) return null;
  if (time <= keys[0].time) return [keys[0], keys[0], 0];
  let low = 0;
  let high = keys.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (keys[middle].time < time) low = middle;
    else high = middle;
  }
  const a = keys[low];
  const b = keys[high];
  if (time >= b.time && high === keys.length - 1) return [b, b, 0];
  return [a, b, (time - a.time) / Math.max(1e-6, b.time - a.time)];
}

function interpolateVector(keys: readonly VectorKey[], time: number, out: THREE.Vector3): boolean {
  const interval = keyInterval(keys, time);
  if (!interval) return false;
  const [a, b, mix] = interval;
  out.set(
    THREE.MathUtils.lerp(a.value[0], b.value[0], mix),
    THREE.MathUtils.lerp(a.value[1], b.value[1], mix),
    THREE.MathUtils.lerp(a.value[2], b.value[2], mix),
  );
  return true;
}

const scratchPosition = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchQuaternionA = new THREE.Quaternion();
const scratchQuaternionB = new THREE.Quaternion();

function vxQuaternion(value: readonly [number, number, number, number], out: THREE.Quaternion): THREE.Quaternion {
  // S*R*S for the Z reflection maps the quaternion axial vector to (-x,-y,z).
  return out.set(-value[0], -value[1], value[2], value[3]).normalize();
}

/** Apply the source linear controllers at the graph-authored elapsed time. */
export function applyMenuStoneAnimation(
  source: MenuStoneAnimationSource,
  elapsedSeconds: number,
  object: THREE.Object3D,
): void {
  const rawPhase = elapsedSeconds / source.durationSeconds;
  const phase = source.loop ? ((rawPhase % 1) + 1) % 1 : THREE.MathUtils.clamp(rawPhase, 0, 1);
  const time = evalCurve(source.progression, phase) * source.track.length;

  if (interpolateVector(source.track.positionKeys, time, scratchPosition)) {
    object.position.set(scratchPosition.x, scratchPosition.y, -scratchPosition.z);
  }
  if (interpolateVector(source.track.scaleKeys, time, scratchScale)) object.scale.copy(scratchScale);
  const rotation = keyInterval(source.track.rotationKeys, time);
  if (rotation) {
    const [a, b, mix] = rotation;
    vxQuaternion(a.quaternion, scratchQuaternionA);
    vxQuaternion(b.quaternion, scratchQuaternionB);
    object.quaternion.copy(scratchQuaternionA).slerp(scratchQuaternionB, mix);
  }
  object.updateMatrix();
}
