/**
 * The Ballance chase camera, reproducing the original camera host: a ball-
 * follow target, the rotated rig slot behind it and the camera position all
 * smoothed with per-axis critically-damped springs (SmoothDamp), plus an
 * independently smoothed look target. 90°-step rotation (Shift+Left/Right)
 * eased by the original curve; hold-Space overview lift.
 */
import * as THREE from 'three';
import {
  CAM_FOV,
  CAM_LIFT_DOWN_TIME,
  CAM_LIFT_UP_TIME,
  CAM_LOOK_SMOOTH,
  CAM_NORMAL_Y,
  CAM_NORMAL_Z,
  CAM_POS_SMOOTH,
  CAM_ROTATE_TIME,
  CAM_SPACE_Y,
  CAM_SPACE_Z,
  CAM_TARGET_SMOOTH,
} from './constants.ts';
import { evalCurve } from './curve.ts';
import type { InputState } from './input.ts';

export type CamMode = 'follow' | 'lookOnly' | 'frozen';

/** original rotate easing (serialized animation curve) */
const ROTATE_CURVE: [number, number, number][] = [
  [0, 0.0067, 1.15],
  [0.497, 0.58, 1.05],
  [1, 1, 0.85],
];

/** Unity-style critically damped smoothing, one axis. */
function smoothDamp(current: number, target: number, vel: { v: number }, smoothTime: number, dt: number): number {
  const omega = 2 / Math.max(0.0001, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (vel.v + omega * change) * dt;
  vel.v = (vel.v - omega * temp) * exp;
  return target + (change + temp) * exp;
}

class SmoothedVec3 {
  value = new THREE.Vector3();
  private vx = { v: 0 };
  private vy = { v: 0 };
  private vz = { v: 0 };

  reset(to: THREE.Vector3): void {
    this.value.copy(to);
    this.vx.v = this.vy.v = this.vz.v = 0;
  }

  step(target: THREE.Vector3, times: [number, number, number], dt: number): void {
    if (dt <= 0) {
      this.value.copy(target);
      return;
    }
    this.value.set(
      smoothDamp(this.value.x, target.x, this.vx, times[0], dt),
      smoothDamp(this.value.y, target.y, this.vy, times[1], dt),
      smoothDamp(this.value.z, target.z, this.vz, times[2], dt),
    );
  }
}

export class CamRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CamMode = 'follow';
  private yawFrom = 0;
  private yawTarget = 0;
  private rotateT = 1;
  private liftT = 0; // 0 = normal, 1 = lifted
  private followTarget = new SmoothedVec3();
  private camPos = new SmoothedVec3();
  private lookTarget = new SmoothedVec3();
  private initialized = false;
  private prevLeft = false;
  private prevRight = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, aspect, 0.6, 4000);
  }

  private get yawCurrent(): number {
    if (this.rotateT >= 1) return this.yawTarget;
    const t = Math.min(1, Math.max(0, evalCurve(ROTATE_CURVE, this.rotateT)));
    return THREE.MathUtils.lerp(this.yawFrom, this.yawTarget, t);
  }

  /** Snap the rig to a position and view yaw (radians, 0 = looking along -Z). */
  resetTo(ballPos: THREE.Vector3, yaw = 0): void {
    this.yawFrom = this.yawTarget = yaw;
    this.rotateT = 1;
    this.mode = 'follow';
    this.followTarget.reset(ballPos);
    this.lookTarget.reset(ballPos);
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    this.camPos.reset(new THREE.Vector3(ballPos.x + sin * CAM_NORMAL_Z, ballPos.y + CAM_NORMAL_Y, ballPos.z + cos * CAM_NORMAL_Z));
    this.initialized = true;
    this.camera.position.copy(this.camPos.value);
    this.camera.lookAt(ballPos);
  }

  update(dt: number, ballPos: THREE.Vector3, input: InputState): void {
    if (!this.initialized) this.resetTo(ballPos);
    if (this.mode === 'frozen') return;

    // rotation steps on Shift + Left/Right edge
    if (this.rotateT >= 1) {
      const leftEdge = input.shift && input.left && !this.prevLeft;
      const rightEdge = input.shift && input.right && !this.prevRight;
      if (leftEdge || rightEdge) {
        this.yawFrom = this.yawTarget;
        this.yawTarget = this.yawFrom + (leftEdge ? Math.PI / 2 : -Math.PI / 2);
        this.rotateT = 0;
      }
    }
    this.prevLeft = input.shift && input.left;
    this.prevRight = input.shift && input.right;
    if (this.rotateT < 1) this.rotateT = Math.min(1, this.rotateT + dt / CAM_ROTATE_TIME);

    // look target always tracks the ball
    this.lookTarget.step(ballPos, CAM_LOOK_SMOOTH, dt);

    if (this.mode === 'follow') {
      // overview lift while Space held (original: 0.45s up, 1.66s down)
      const liftRate = dt / (input.space ? CAM_LIFT_UP_TIME : CAM_LIFT_DOWN_TIME);
      this.liftT = THREE.MathUtils.clamp(this.liftT + (input.space ? liftRate : -liftRate), 0, 1);

      this.followTarget.step(ballPos, CAM_TARGET_SMOOTH, dt);
      const lift = this.liftT * this.liftT * (3 - 2 * this.liftT);
      const offsetY = THREE.MathUtils.lerp(CAM_NORMAL_Y, CAM_SPACE_Y, lift);
      const offsetZ = THREE.MathUtils.lerp(CAM_NORMAL_Z, CAM_SPACE_Z, lift);
      const yaw = this.yawCurrent;
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const slot = new THREE.Vector3(
        this.followTarget.value.x + sin * offsetZ,
        this.followTarget.value.y + offsetY,
        this.followTarget.value.z + cos * offsetZ,
      );
      this.camPos.step(slot, CAM_POS_SMOOTH, dt);
      this.camera.position.copy(this.camPos.value);
    }
    this.camera.lookAt(this.lookTarget.value);
  }

  /** Horizontal push direction for the current camera orientation. */
  pushDirection(input: InputState, out = new THREE.Vector3()): THREE.Vector3 {
    out.set(0, 0, 0);
    if (input.shift) return out; // Shift is camera-only, no push
    const yaw = this.yawCurrent;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const fwd = new THREE.Vector3(-sin, 0, -cos);
    const right = new THREE.Vector3(cos, 0, -sin);
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
}
