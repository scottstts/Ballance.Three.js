import { describe, expect, it } from 'vitest';
import { pointVelocity, relativePointSpeed, type RigidBodyMotion } from './physics.ts';

const stationary: RigidBodyMotion = {
  center: { x: 0, y: 0, z: 0 },
  linear: { x: 0, y: 0, z: 0 },
  angular: { x: 0, y: 0, z: 0 },
};

describe('pre-solver collision velocity', () => {
  it('adds angular cross radius to linear velocity', () => {
    const motion: RigidBodyMotion = {
      center: { x: 1, y: 2, z: 3 },
      linear: { x: 4, y: 5, z: 6 },
      angular: { x: 0, y: 2, z: 0 },
    };
    expect(pointVelocity(motion, { x: 4, y: 2, z: 5 })).toEqual({ x: 8, y: 5, z: 0 });
  });

  it('uses the magnitude of both bodies relative point velocities', () => {
    const first: RigidBodyMotion = {
      ...stationary,
      linear: { x: 3, y: 4, z: 0 },
    };
    const second: RigidBodyMotion = {
      ...stationary,
      linear: { x: 0, y: 0, z: 5 },
    };
    expect(relativePointSpeed(first, second, { x: 0, y: 0, z: 0 })).toBeCloseTo(Math.sqrt(50), 12);
  });
});
