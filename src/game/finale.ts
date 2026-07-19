/**
 * Authored PE_Balloon finale visuals. The UFO path, timing, force/damping
 * values, hierarchy and arm animation are decoded directly from the original
 * prefab rather than duplicated as hand-authored browser data.
 */
import * as THREE from 'three';
import type {
  KeyedAnimationRec,
  NmoFile,
  ObjectAnimationRec,
  ParameterRec,
} from '../formats/ck2/types.ts';
import { vxMatrixToThree } from '../engine/convert.ts';
import type { Prefab, PrefabInstance } from './moduls/prefabs.ts';
import {
  buildVxTcbControls,
  evaluateVxTcbRotation,
  type VxTcbControl,
} from './vxTcbRotation.ts';

export interface UfoPathStep {
  position: THREE.Vector3;
  force: number;
  damping: number;
  waitSeconds: number;
  relativeToBall: boolean;
  startAnimation: boolean;
}

export interface UfoUpdate {
  carryBall: boolean;
  playAnimationSound: boolean;
  playFinalMusic: boolean;
  enteredHyperspace: boolean;
  complete: boolean;
  soundPitch: number;
}

const NO_UFO_UPDATE: UfoUpdate = {
  carryBall: false,
  playAnimationSound: false,
  playFinalMusic: false,
  enteredHyperspace: false,
  complete: false,
  soundPitch: 1,
};

/** Exact PE_Balloon.nmo/UFO sound-control inputs. */
export const UFO_SOUND_SOURCE = {
  nearDistance: 30,
  farDistance: 150,
  minimumSpeed: 0,
  maximumSpeed: 100,
} as const;

/** TT SpeedOMeter.Relative Speed followed by Calculator `a+1`. */
export function ufoSoundPitch(absoluteSpeed: number): number {
  const relative = THREE.MathUtils.clamp(
    (absoluteSpeed - UFO_SOUND_SOURCE.minimumSpeed) /
      (UFO_SOUND_SOURCE.maximumSpeed - UFO_SOUND_SOURCE.minimumSpeed),
    0,
    1,
  );
  return relative + 1;
}

/** Hide script-only helpers/UFO while retaining the authored physics hierarchy. */
export function prepareBalloonInstance(instance: PrefabInstance): THREE.Group {
  for (const [name, object] of instance.parts) {
    if (name.startsWith('PE_UFO_')) {
      object.visible = false;
      continue;
    }
    if (name === 'PE_Box_slide') {
      object.visible = false;
      continue;
    }
  }
  return instance.root;
}

export function decodeUfoPath(file: NmoFile): UfoPathStep[] {
  const table = file.byName.get('PE_UFO_Pos&Time')?.find((record) => record.kind === 'dataArray');
  if (!table || table.kind !== 'dataArray') return [];
  return table.rows.map((row) => ({
    position: parameterVector(file, Number(row[0])),
    force: Number(row[1]),
    damping: Number(row[2]),
    waitSeconds: parameterFloat(file, Number(row[3])) / 1000,
    relativeToBall: Number(row[4]) !== 0,
    startAnimation: parameterBool(file, Number(row[5])),
  }));
}

function parameter(file: NmoFile, index: number): ParameterRec | null {
  const record = file.objects[index];
  return record?.kind === 'parameter' ? record : null;
}

function parameterFloat(file: NmoFile, index: number): number {
  const value = parameter(file, index)?.valueBytes;
  return value && value.byteLength >= 4
    ? new DataView(value.buffer, value.byteOffset, value.byteLength).getFloat32(0, true)
    : 0;
}

function parameterBool(file: NmoFile, index: number): boolean {
  const value = parameter(file, index)?.valueBytes;
  return !!value && value.byteLength >= 4 && new DataView(value.buffer, value.byteOffset, value.byteLength).getUint32(0, true) !== 0;
}

function parameterVector(file: NmoFile, index: number): THREE.Vector3 {
  const value = parameter(file, index)?.valueBytes;
  if (!value || value.byteLength < 12) return new THREE.Vector3();
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  // Virtools left-handed position -> three.js right-handed position.
  return new THREE.Vector3(view.getFloat32(0, true), view.getFloat32(4, true), -view.getFloat32(8, true));
}

export class UfoFinale {
  private readonly prefab: Prefab;
  private readonly instance: PrefabInstance;
  private readonly body: THREE.Object3D | null;
  private readonly top: THREE.Object3D | null;
  private readonly flash: THREE.Object3D | null;
  private readonly path: UfoPathStep[];
  private readonly initialPosition: THREE.Vector3;
  private readonly initialQuaternion: THREE.Quaternion;
  private readonly velocity = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly localBall = new THREE.Vector3();
  private readonly previousBodyPosition = new THREE.Vector3();
  private readonly spinAxis = new THREE.Vector3(0.05, 1, -0.05).normalize();
  private readonly tracks: {
    object: THREE.Object3D;
    track: ObjectAnimationRec;
    controls: VxTcbControl[];
  }[] = [];
  private phase: 'idle' | 'path' | 'hyperspace' | 'complete' = 'idle';
  private row = 0;
  private rowTime = 0;
  private animationTime = -1;
  private hyperspaceTime = 0;

  constructor(prefab: Prefab, instance: PrefabInstance) {
    this.prefab = prefab;
    this.instance = instance;
    this.body = instance.parts.get('PE_UFO_Body') ?? null;
    this.top = instance.parts.get('PE_UFO_Top') ?? null;
    this.flash = instance.parts.get('PE_UFO_Flash') ?? null;
    this.path = decodeUfoPath(prefab.file);
    this.initialPosition = parameterVector(prefab.file, 1318);
    this.initialQuaternion = this.body?.quaternion.clone() ?? new THREE.Quaternion();
    this.body?.traverse((object) => {
      object.visible = true;
    });
    if (this.body) this.body.visible = false;
    if (this.flash) this.flash.visible = false;
    this.buildAnimationTracks();
    this.buildLights();
  }

  get active(): boolean {
    return this.phase === 'path' || this.phase === 'hyperspace';
  }

  start(): void {
    if (!this.body || this.path.length === 0 || this.phase !== 'idle') return;
    this.phase = 'path';
    this.row = 0;
    this.rowTime = 0;
    this.animationTime = -1;
    this.velocity.set(0, 0, 0);
    this.body.position.copy(this.initialPosition);
    this.body.quaternion.copy(this.initialQuaternion);
    this.body.visible = true;
    this.applyArmAnimation(0);
    this.body.updateMatrix();
  }

  update(dt: number, ballWorldPosition: THREE.Vector3): UfoUpdate {
    if (!this.body || this.phase === 'idle' || this.phase === 'complete') return NO_UFO_UPDATE;
    if (this.phase === 'hyperspace') return this.updateHyperspace(dt);

    const step = this.path[this.row];
    this.target.copy(step.position);
    if (step.relativeToBall) {
      this.instance.root.updateWorldMatrix(true, false);
      this.localBall.copy(ballWorldPosition);
      this.instance.root.worldToLocal(this.localBall);
      this.target.add(this.localBall);
    }

    // TT Set Dynamic Position: per-tick spring toward the iterator target,
    // retaining the previous delta as damped velocity.
    this.previousBodyPosition.copy(this.body.position);
    this.velocity.multiplyScalar(step.damping);
    this.velocity.addScaledVector(this.target.clone().sub(this.body.position), step.force);
    this.body.position.add(this.velocity);
    const absoluteSpeed = this.body.position.distanceTo(this.previousBodyPosition) / dt;
    const soundPitch = ufoSoundPitch(absoluteSpeed);

    // Original Per Second value is 2.6179938 rad/s (150 degrees/s). A handedness
    // flip negates the angle; the top receives the graph's inverse angle.
    const angle = 2.6179938316345215 * dt;
    this.body.rotateOnAxis(this.spinAxis, -angle);
    this.top?.rotateOnAxis(Y_AXIS, angle);
    this.body.updateMatrix();
    this.top?.updateMatrix();

    if (this.animationTime >= 0) {
      this.animationTime = Math.min(1, this.animationTime + dt);
      this.applyArmAnimation(this.animationTime);
    }

    let playAnimationSound = false;
    let playFinalMusic = false;
    let enteredHyperspace = false;
    this.rowTime += dt;
    while (this.phase === 'path') {
      const row = this.path[this.row];
      if (this.rowTime < row.waitSeconds) break;
      this.rowTime -= row.waitSeconds;
      this.row++;
      if (this.row >= this.path.length) {
        this.beginHyperspace();
        enteredHyperspace = true;
        break;
      }
      const next = this.path[this.row];
      if (next.startAnimation && this.animationTime < 0) {
        this.animationTime = 0;
        playAnimationSound = true;
      }
      if (this.row === 11) playFinalMusic = true;
    }

    return {
      carryBall: this.row >= 7,
      playAnimationSound,
      playFinalMusic,
      enteredHyperspace,
      complete: false,
      soundPitch,
    };
  }

  private beginHyperspace(): void {
    this.phase = 'hyperspace';
    this.hyperspaceTime = 0;
    if (this.body) this.body.visible = false;
    if (this.flash) {
      this.flash.position.set(-1000, 0, 0);
      this.flash.scale.setScalar(0.01);
      this.flash.visible = true;
      this.flash.updateMatrix();
    }
  }

  private updateHyperspace(dt: number): UfoUpdate {
    this.hyperspaceTime = Math.min(0.8, this.hyperspaceTime + dt);
    const t = this.hyperspaceTime / 0.8;
    const eased = t * t * (3 - 2 * t);
    const scale = THREE.MathUtils.lerp(0.01, 20, eased);
    if (this.flash) {
      this.flash.scale.setScalar(scale);
      this.flash.updateMatrix();
    }
    if (this.hyperspaceTime >= 0.8) {
      if (this.flash) this.flash.visible = false;
      this.phase = 'complete';
      return { ...NO_UFO_UPDATE, complete: true };
    }
    return { ...NO_UFO_UPDATE, carryBall: true };
  }

  private buildAnimationTracks(): void {
    const keyed = this.prefab.file.byName
      .get('UFO_Animation')
      ?.find((record): record is KeyedAnimationRec => record.kind === 'keyedAnimation');
    if (!keyed) return;
    for (const index of keyed.animationIndices) {
      const track = this.prefab.file.objects[index];
      if (track?.kind !== 'objectAnimation') continue;
      const entity = this.prefab.file.objects[track.entityIndex];
      const object = entity?.name ? this.instance.parts.get(entity.name) : null;
      if (object) {
        this.tracks.push({
          object,
          track,
          controls: buildVxTcbControls(track.rotationKeys),
        });
      }
    }
  }

  private applyArmAnimation(normalizedTime: number): void {
    for (const { object, track, controls } of this.tracks) {
      const time = normalizedTime * track.length;
      evaluateVxTcbRotation(track.rotationKeys, controls, time, object.quaternion);
      object.updateMatrix();
    }
  }

  private buildLights(): void {
    for (const record of this.prefab.file.objects) {
      if (record.kind !== 'light') continue;
      const parent = this.prefab.file.objects[record.entity.parentIndex];
      const parentObject = parent?.name ? this.instance.parts.get(parent.name) : this.body;
      if (!parentObject) continue;
      const world = vxMatrixToThree(record.entity.worldMatrix);
      const parentWorld = parent?.kind === 'entity' ? vxMatrixToThree(parent.worldMatrix) : new THREE.Matrix4();
      const local = parentWorld.invert().multiply(world);
      const position = new THREE.Vector3().setFromMatrixPosition(local);
      const color = new THREE.Color(record.color[0], record.color[1], record.color[2]);
      const light = new THREE.PointLight(color, Math.max(0.5, record.lightPower), record.range, 0);
      light.name = record.name;
      light.position.copy(position);
      parentObject.add(light);
    }
  }

  ballCarryPosition(out = new THREE.Vector3()): THREE.Vector3 {
    if (!this.body) return out;
    this.body.updateWorldMatrix(true, false);
    return this.body.getWorldPosition(out);
  }
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
