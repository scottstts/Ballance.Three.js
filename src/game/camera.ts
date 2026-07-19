/**
 * The source-authored Ballance chase camera. Camera.nmo supplies the hierarchy
 * and projection; Gameplay.nmo runs two TT Set Dynamic Position controllers:
 * Cam_Target follows ActiveBall and InGameCam follows the rotated Cam_Pos slot.
 */
import * as THREE from 'three';
import {
  CAM_FAR,
  CAM_FOV,
  CAM_INITIAL_POSITION,
  CAM_NEAR,
  CAM_OVERVIEW_OFFSET,
  CAM_POSITION_DAMPING,
  CAM_POSITION_FORCE,
  CAM_POSITION_OVERVIEW_FORCE,
  CAM_ROTATE_TIME,
  CAM_SLOT_OFFSET,
  CAM_TARGET_DAMPING,
  CAM_TARGET_FORCE,
} from './constants.ts';
import { evalCurve } from './curve.ts';
import type { InputState } from './input.ts';

/** Gameplay.nmo's decoded two-key Cam Navigation progression curve. */
const ROTATE_CURVE: [number, number, number][] = [
  [0, 0, -0.045643847435712814],
  [1, 1, 1.1345752907327005],
];

export type AxisValues = readonly [number, number, number];

/**
 * Exact recurrence recovered statically from TT_Toolbox_RT.dll at 0x10004a80.
 * `previous` is the moved object's preceding position, not the followed
 * object's position; this damped displacement is what gives Ballance its lag.
 */
export class DynamicPosition {
  readonly value: THREE.Vector3;
  readonly force = new THREE.Vector3();
  readonly damping = new THREE.Vector3();
  readonly offset = new THREE.Vector3();
  private readonly previous = new THREE.Vector3();

  constructor(initial: THREE.Vector3, force: AxisValues, damping: AxisValues, offset: AxisValues = [0, 0, 0]) {
    this.value = initial.clone();
    this.previous.copy(initial);
    this.setParameters(force, damping, offset);
  }

  setParameters(force: AxisValues, damping: AxisValues, offset: AxisValues = [0, 0, 0]): void {
    this.force.fromArray(force);
    this.damping.fromArray(damping);
    this.offset.fromArray(offset);
  }

  /** Mirrors toggling the building block Off then On. */
  reinitialize(): void {
    this.previous.copy(this.value);
  }

  reset(position: THREE.Vector3): void {
    this.value.copy(position);
    this.previous.copy(position);
  }

  step(target: THREE.Vector3, dt: number): void {
    const x = this.value.x;
    const y = this.value.y;
    const z = this.value.z;
    this.value.set(
      x + (target.x - x - this.offset.x) * this.force.x * dt + (x - this.previous.x) * this.damping.x,
      y + (target.y - y - this.offset.y) * this.force.y * dt + (y - this.previous.y) * this.damping.y,
      z + (target.z - z - this.offset.z) * this.force.z * dt + (z - this.previous.z) * this.damping.z,
    );
    this.previous.set(x, y, z);
  }
}

export class CamRig {
  readonly camera: THREE.PerspectiveCamera;
  private navigationActive = true;
  private slotAttached = true;
  private overview = false;
  private yawFrom = 0;
  private yawTarget = 0;
  private rotateT = 1;
  private readonly followTarget = new DynamicPosition(
    new THREE.Vector3(),
    CAM_TARGET_FORCE,
    CAM_TARGET_DAMPING,
  );
  private readonly camPos = new DynamicPosition(
    new THREE.Vector3().fromArray(CAM_INITIAL_POSITION),
    CAM_POSITION_FORCE,
    CAM_POSITION_DAMPING,
  );
  private readonly slot = new THREE.Vector3();
  private prevLeft = false;
  private prevRight = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, aspect, CAM_NEAR, CAM_FAR);
    this.camera.position.copy(this.camPos.value);
    this.camera.lookAt(this.followTarget.value);
  }

  private get yawCurrent(): number {
    if (this.rotateT >= 1) return this.yawTarget;
    const t = Math.min(1, Math.max(0, evalCurve(ROTATE_CURVE, this.rotateT)));
    return THREE.MathUtils.lerp(this.yawFrom, this.yawTarget, t);
  }

  /**
   * New Ball's camera stamp: TT Restore IC on Cam_MF (hierarchy) collapses
   * the rig to its authored arrangement, then Set World Matrix teleports it
   * onto the reset frame. Runs at level start and on every respawn.
   */
  resetTo(ballPos: THREE.Vector3, yaw = 0): void {
    this.navigationActive = true;
    this.slotAttached = true;
    this.overview = false;
    this.yawFrom = this.yawTarget = yaw;
    this.rotateT = 1;
    this.followTarget.reset(ballPos);
    this.computeSlot();
    this.camPos.reset(this.slot);
    this.camera.position.copy(this.camPos.value);
    this.camera.lookAt(ballPos);
  }

  /** Gameplay.nmo toggles only the Cam_Target controller at Ball Off. */
  rebindTarget(): void {
    this.followTarget.reinitialize();
  }

  /** CamNav On/Off stops only the authored navigation composite. */
  setNavigationActive(active: boolean): void {
    this.navigationActive = active;
    if (!active) {
      this.prevLeft = false;
      this.prevRight = false;
    }
  }

  /** Gameplay_Events reparents Cam_Pos to null, preserving its world slot. */
  detachSlot(): void {
    if (!this.slotAttached) return;
    this.computeSlot();
    this.slotAttached = false;
  }

  setClippingPlanes(near: number, far: number): void {
    this.camera.near = near;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, ballPos: THREE.Vector3, input: InputState, invertRotation = false): void {
    if (this.navigationActive) {
      // rotation steps on Shift + Left/Right edge
      if (this.rotateT >= 1) {
        const leftEdge = input.shift && input.left && !this.prevLeft;
        const rightEdge = input.shift && input.right && !this.prevRight;
        if (leftEdge || rightEdge) {
          this.yawFrom = this.yawTarget;
          const direction = invertRotation ? -1 : 1;
          this.yawTarget = this.yawFrom + (leftEdge ? direction * Math.PI / 2 : -direction * Math.PI / 2);
          this.rotateT = 0;
        }
      }
      this.prevLeft = input.shift && input.left;
      this.prevRight = input.shift && input.right;
      if (this.rotateT < 1) this.rotateT = Math.min(1, this.rotateT + dt / CAM_ROTATE_TIME);
      this.overview = input.space;
    }

    this.followTarget.step(ballPos, dt);
    if (this.slotAttached) this.computeSlot();
    this.camPos.setParameters(
      this.overview ? CAM_POSITION_OVERVIEW_FORCE : CAM_POSITION_FORCE,
      CAM_POSITION_DAMPING,
      this.overview ? CAM_OVERVIEW_OFFSET : [0, 0, 0],
    );
    this.camPos.step(this.slot, dt);
    this.camera.position.copy(this.camPos.value);
    this.camera.lookAt(this.followTarget.value);
  }

  /** Horizontal push direction for the current camera orientation. */
  pushDirection(input: InputState, out = new THREE.Vector3()): THREE.Vector3 {
    out.set(0, 0, 0);
    if (input.shift) return out; // Shift is camera-only, no push
    const yaw = this.yawCurrent;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const fwd = new THREE.Vector3(-cos, 0, -sin);
    const right = new THREE.Vector3(sin, 0, -cos);
    // original: X and Z axis forces are independent, so diagonals push sqrt(2) harder
    if (input.forward) out.add(fwd);
    if (input.back) out.sub(fwd);
    if (input.right) out.add(right);
    if (input.left) out.sub(right);
    return out;
  }

  get yaw(): number {
    return this.yawCurrent;
  }

  get targetPosition(): THREE.Vector3 {
    return this.followTarget.value;
  }

  get slotPosition(): THREE.Vector3 {
    return this.slot;
  }

  get isSlotAttached(): boolean {
    return this.slotAttached;
  }

  private computeSlot(): void {
    const yaw = this.yawCurrent;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const x = CAM_SLOT_OFFSET[0];
    const z = CAM_SLOT_OFFSET[2];
    this.slot.set(
      this.followTarget.value.x + x * cos - z * sin,
      this.followTarget.value.y + CAM_SLOT_OFFSET[1],
      this.followTarget.value.z + x * sin + z * cos,
    );
  }
}
