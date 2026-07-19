import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { NmoFile, ParameterRec } from '../formats/ck2/types.ts';
import { GRAVITY_Y } from './constants.ts';
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

const GAME_DIR = fileURLToPath(new URL('../../Ballance_bin/source1/Ballance', import.meta.url));

describe.skipIf(!existsSync(GAME_DIR))('Set Physics Globals binary authority', () => {
  function resolve(file: NmoFile, parameter: ParameterRec): ParameterRec {
    let current = parameter;
    const seen = new Set([current.index]);
    for (let depth = 0; depth < 32; depth++) {
      const nextIndex = current.sourceIndex >= 0 ? current.sourceIndex : current.sharedIndex;
      if (nextIndex < 0 || seen.has(nextIndex)) break;
      const next = file.objects[nextIndex];
      if (next?.kind !== 'parameter') break;
      current = next;
      seen.add(nextIndex);
    }
    return current;
  }

  it('serializes gravity (0,-20,0) on every instance and only factors 0 and 2', () => {
    const factors = new Set<number>();
    let instances = 0;
    for (const relative of ['base.cmo', '3D Entities/Gameplay.nmo']) {
      const file = parseNmo(readFileSync(join(GAME_DIR, relative)));
      for (const record of file.objects) {
        if (record?.kind !== 'behavior' || record.name !== 'Set Physics Globals') continue;
        instances++;
        const parameters = record.referenceLists
          .flat()
          .map((index) => file.objects[index])
          .filter((entry): entry is ParameterRec => entry?.kind === 'parameter');
        const gravity = parameters.find((parameter) => parameter.name === 'Gravity');
        const factor = parameters.find((parameter) => parameter.name === 'Physic Time Factor');
        expect(gravity, `${relative}#${record.index} Gravity`).toBeDefined();
        expect(factor, `${relative}#${record.index} Physic Time Factor`).toBeDefined();
        if (!gravity || !factor) continue;
        const gravityBytes = resolve(file, gravity).valueBytes;
        const gravityView = new DataView(gravityBytes.buffer, gravityBytes.byteOffset);
        expect([
          gravityView.getFloat32(0, true),
          gravityView.getFloat32(4, true),
          gravityView.getFloat32(8, true),
        ]).toEqual([0, GRAVITY_Y, 0]);
        const factorBytes = resolve(file, factor).valueBytes;
        factors.add(new DataView(factorBytes.buffer, factorBytes.byteOffset).getFloat32(0, true));
      }
    }
    expect(instances).toBeGreaterThanOrEqual(12);
    // Freeze paths write 0; every gameplay resume path writes 2. The port's
    // 66 Hz step interprets these through the recovered physics_RT manager
    // semantics.
    expect([...factors].sort()).toEqual([0, 2]);
  });
});
