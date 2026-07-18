import type * as THREE from 'three';

/** Parameters serialized by TT Toolbox's `TT Scaleable Proximity`. */
export interface ScaleableProximitySpec {
  distance: number;
  exactnessMinDistance: number;
  exactnessMaxDistance: number;
  minimumFrameDelay: number;
  maximumFrameDelay: number;
  initialFrameDelay: number;
  /** Source bit field: X=1, Y=2, Z=4. */
  axes: number;
  squaredDistance: boolean;
}

export type ProximityOutput = 'inRange' | 'outRange' | 'enterRange' | 'exitRange';

/** Distance after applying the source X/Y/Z bit mask. */
export function proximityDistance(
  a: Pick<THREE.Vector3, 'x' | 'y' | 'z'>,
  b: Pick<THREE.Vector3, 'x' | 'y' | 'z'>,
  axes: number,
): number {
  const dx = axes & 1 ? a.x - b.x : 0;
  const dy = axes & 2 ? a.y - b.y : 0;
  const dz = axes & 4 ? a.z - b.z : 0;
  return Math.hypot(dx, dy, dz);
}

/**
 * The plugin does not choose a random delay. Its x87 routine linearly
 * interpolates between the two frame delays over the exactness-distance
 * interval and converts the positive result to an integer toward zero.
 */
export function scaleableProximityFrameDelay(distance: number, spec: ScaleableProximitySpec): number {
  const current = spec.squaredDistance ? distance * distance : distance;
  const exactnessMin = spec.squaredDistance
    ? spec.exactnessMinDistance * spec.exactnessMinDistance
    : spec.exactnessMinDistance;
  const exactnessMax = spec.squaredDistance
    ? spec.exactnessMaxDistance * spec.exactnessMaxDistance
    : spec.exactnessMaxDistance;
  if (current <= exactnessMin) return spec.minimumFrameDelay;
  if (current >= exactnessMax) return spec.maximumFrameDelay;
  const t = (current - exactnessMin) / (exactnessMax - exactnessMin);
  return spec.minimumFrameDelay + Math.trunc(t * (spec.maximumFrameDelay - spec.minimumFrameDelay));
}

/** Fixed-tick state machine matching the shipped TT Toolbox runtime block. */
export class ScaleableProximity {
  private framesUntilCheck: number;
  private lastCheck: boolean | null = null;
  readonly spec: ScaleableProximitySpec;

  constructor(spec: ScaleableProximitySpec) {
    this.spec = spec;
    this.framesUntilCheck = spec.initialFrameDelay;
  }

  /** Restore the serialized local counter and the plugin's unknown state. */
  reset(): void {
    this.framesUntilCheck = this.spec.initialFrameDelay;
    this.lastCheck = null;
  }

  /** `In` resets Last Check to 2 but preserves the running local counter. */
  restartTransitionState(): void {
    this.lastCheck = null;
  }

  remainingFrames(): number {
    return this.framesUntilCheck;
  }

  updatePositions(
    a: Pick<THREE.Vector3, 'x' | 'y' | 'z'>,
    b: Pick<THREE.Vector3, 'x' | 'y' | 'z'>,
  ): ProximityOutput | null {
    return this.updateDistance(proximityDistance(a, b, this.spec.axes));
  }

  updateDistance(distance: number): ProximityOutput | null {
    this.framesUntilCheck--;
    if (this.framesUntilCheck > 0) return null;
    this.framesUntilCheck = scaleableProximityFrameDelay(distance, this.spec);

    const inside = distance < this.spec.distance;
    const output = this.lastCheck === null || this.lastCheck !== inside
      ? inside
        ? 'enterRange'
        : 'exitRange'
      : inside
        ? 'inRange'
        : 'outRange';
    this.lastCheck = inside;
    return output;
  }
}
