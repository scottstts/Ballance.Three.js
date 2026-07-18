import { describe, expect, it } from 'vitest';
import {
  ivpAngularDampingFactor,
  ivpLinearDampingFactor,
  pointVelocity,
  relativePointSpeed,
  type RigidBodyMotion,
} from './physics.ts';

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

describe('source IVP damping law', () => {
  it('uses IVP explicit factors instead of Rapier implicit damping', () => {
    expect(ivpLinearDampingFactor(0.9)).toBeCloseTo(1 - 0.9 / 66, 12);
    expect(ivpLinearDampingFactor(1.5)).toBeCloseTo(1 - 1.5 / 66, 12);
    expect(ivpAngularDampingFactor(0.1)).toBeCloseTo(1 - 0.1 / 66, 12);
  });

  it('retains IVP exponential fallback branches', () => {
    expect(ivpLinearDampingFactor(20)).toBeCloseTo(Math.exp(-20 / 66), 12);
    expect(ivpAngularDampingFactor(40)).toBeCloseTo(Math.exp(-40 / 66), 12);
  });
});
