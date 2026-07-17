/**
 * The Ballance chase camera: fixed offset behind/above the ball, 90°-step
 * rotation (Shift+Left/Right), hold-Space overview lift, lagged follow.
 */
import * as THREE from 'three';
import {
  CAM_FOLLOW_SPEED,
  CAM_FOV,
  CAM_LIFT_TIME,
  CAM_NORMAL_Y,
  CAM_NORMAL_Z,
  CAM_ROTATE_TIME,
  CAM_SPACE_Y,
  CAM_SPACE_Z,
} from './constants.ts';
import type { InputState } from './input.ts';

export class CamRig {
  readonly camera: THREE.PerspectiveCamera;
  /** quantized orientation in 90° steps (radians) */
  private yawSteps = 0;
  private yawCurrent = 0;
  private yawTarget = 0;
  private rotateT = 1;
  private liftT = 0; // 0 = normal, 1 = lifted
  private followPos = new THREE.Vector3();
  private initialized = false;
  private prevLeft = false;
  private prevRight = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, aspect, 0.6, 4000);
  }

  /** Face the level's start direction (Virtools entities look along +Z LH = -Z RH). */
  resetTo(ballPos: THREE.Vector3, yawSteps = 0): void {
    this.yawSteps = yawSteps;
    this.yawCurrent = this.yawTarget = (yawSteps * Math.PI) / 2;
    this.rotateT = 1;
    this.followPos.copy(ballPos);
    this.initialized = true;
    this.update(0, ballPos, { forward: false, back: false, left: false, right: false, shift: false, space: false });
  }

  update(dt: number, ballPos: THREE.Vector3, input: InputState): void {
    if (!this.initialized) this.resetTo(ballPos);

    // rotation steps on Shift + Left/Right edge
    if (this.rotateT >= 1) {
      const leftEdge = input.shift && input.left && !this.prevLeft;
      const rightEdge = input.shift && input.right && !this.prevRight;
      if (leftEdge || rightEdge) {
        this.yawSteps += leftEdge ? 1 : -1;
        this.yawTarget = (this.yawSteps * Math.PI) / 2;
        this.rotateT = 0;
      }
    }
    this.prevLeft = input.shift && input.left;
    this.prevRight = input.shift && input.right;

    if (this.rotateT < 1) {
      this.rotateT = Math.min(1, this.rotateT + dt / CAM_ROTATE_TIME);
      const t = smooth(this.rotateT);
      this.yawCurrent = THREE.MathUtils.lerp(this.yawCurrent, this.yawTarget, t);
      if (this.rotateT >= 1) this.yawCurrent = this.yawTarget;
    }

    // overview lift while Space held
    const liftTarget = input.space ? 1 : 0;
    const liftRate = dt / CAM_LIFT_TIME;
    this.liftT = THREE.MathUtils.clamp(this.liftT + Math.sign(liftTarget - this.liftT) * liftRate, 0, 1);

    // lagged follow of the ball
    this.followPos.lerp(ballPos, this.initialized ? Math.min(1, CAM_FOLLOW_SPEED * dt * 66) : 1);

    const lift = smooth(this.liftT);
    const offsetY = THREE.MathUtils.lerp(CAM_NORMAL_Y, CAM_SPACE_Y, lift);
    const offsetZ = THREE.MathUtils.lerp(CAM_NORMAL_Z, CAM_SPACE_Z, lift);
    const sin = Math.sin(this.yawCurrent);
    const cos = Math.cos(this.yawCurrent);
    // camera sits behind the ball along its current view axis
    this.camera.position.set(
      this.followPos.x + sin * offsetZ,
      this.followPos.y + offsetY,
      this.followPos.z + cos * offsetZ,
    );
    this.camera.lookAt(this.followPos);
  }

  /** Horizontal push direction for the current camera orientation. */
  pushDirection(input: InputState, out = new THREE.Vector3()): THREE.Vector3 {
    out.set(0, 0, 0);
    if (input.shift) return out; // Shift is camera-only, no push
    const sin = Math.sin(this.yawCurrent);
    const cos = Math.cos(this.yawCurrent);
    const fwd = new THREE.Vector3(-sin, 0, -cos);
    const right = new THREE.Vector3(cos, 0, -sin);
    if (input.forward) out.add(fwd);
    if (input.back) out.sub(fwd);
    if (input.right) out.add(right);
    if (input.left) out.sub(right);
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }

  get yaw(): number {
    return this.yawCurrent;
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
