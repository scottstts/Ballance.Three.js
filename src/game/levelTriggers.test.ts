import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { BehaviorRec, NmoFile, ParameterRec } from '../formats/ck2/types.ts';
import { LEVEL_TRIGGER_SOURCE, sphereContains } from './level.ts';
import { PICKUP_PROXIMITY_SOURCE } from './pickups.ts';

const PH_DIR = fileURLToPath(new URL('../../Ballance_bin/source1/Ballance/3D Entities/PH', import.meta.url));
const files = {
  checkpoint: `${PH_DIR}/PC_TwoFlames.nmo`,
  extraLife: `${PH_DIR}/P_Extra_Life.nmo`,
  extraPoint: `${PH_DIR}/P_Extra_Point.nmo`,
  finish: `${PH_DIR}/PE_Balloon.nmo`,
} as const;

function sourceFile(path: string): NmoFile {
  return parseNmo(readFileSync(path));
}

function behavior(file: NmoFile, name: string): BehaviorRec {
  const record = file.byName.get(name)?.find((candidate): candidate is BehaviorRec => candidate.kind === 'behavior');
  if (!record) throw new Error(`missing source behavior ${name}`);
  return record;
}

function children(file: NmoFile, parent: BehaviorRec, name: string): BehaviorRec[] {
  return parent.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .filter((candidate): candidate is BehaviorRec => candidate?.kind === 'behavior' && candidate.name === name);
}

function parameter(file: NmoFile, owner: BehaviorRec, name: string): ParameterRec {
  const found = owner.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .find((candidate): candidate is ParameterRec => candidate?.kind === 'parameter' && candidate.name === name);
  if (!found) throw new Error(`missing source parameter ${owner.name}/${name}`);
  let resolved = found;
  const seen = new Set([resolved.index]);
  while (resolved.sourceIndex >= 0 || resolved.sharedIndex >= 0) {
    const nextIndex = resolved.sourceIndex >= 0 ? resolved.sourceIndex : resolved.sharedIndex;
    const next = file.objects[nextIndex];
    if (next?.kind !== 'parameter' || seen.has(next.index)) break;
    seen.add(next.index);
    resolved = next;
  }
  return resolved;
}

function floatValue(record: ParameterRec): number {
  return new DataView(record.valueBytes.buffer, record.valueBytes.byteOffset, record.valueBytes.byteLength).getFloat32(
    0,
    true,
  );
}

function intValue(record: ParameterRec): number {
  return new DataView(record.valueBytes.buffer, record.valueBytes.byteOffset, record.valueBytes.byteLength).getInt32(
    0,
    true,
  );
}

function proximity(file: NmoFile, scriptName: string, distance: number): BehaviorRec {
  const candidates = children(file, behavior(file, scriptName), 'TT Scaleable Proximity');
  const found = candidates.find((candidate) => floatValue(parameter(file, candidate, 'Distance')) === distance);
  if (!found) throw new Error(`missing ${scriptName} proximity at distance ${distance}`);
  return found;
}

function expectAllAxisSphere(file: NmoFile, node: BehaviorRec): void {
  expect(intValue(parameter(file, node, 'Barycenter?'))).toBe(0);
  expect(intValue(parameter(file, node, 'Check Axis:'))).toBe(7);
  expect(intValue(parameter(file, node, 'Squared Distance?'))).toBe(1);
}

describe.skipIf(Object.values(files).some((path) => !existsSync(path)))('source-authored gameplay trigger spheres', () => {
  it('uses PC_TwoFlames big-flame centre and 6.5-unit checkpoint distance', () => {
    const file = sourceFile(files.checkpoint);
    const node = proximity(file, 'PC_TwoFlames_MF Script', LEVEL_TRIGGER_SOURCE.checkpointDistance);
    const targetParameter = parameter(file, node, 'ObjectB');
    const target = file.objects[targetParameter.valueObjectIndex];
    expect(target?.name).toBe('PC_TwoFlames_Flame_Big');
    if (target?.kind !== 'entity') throw new Error('missing checkpoint target entity');
    const sourceOffset = [
      target.worldMatrix[12],
      target.worldMatrix[13],
      -target.worldMatrix[14],
    ];
    LEVEL_TRIGGER_SOURCE.checkpointTargetOffset.forEach((value, index) => {
      expect(value).toBeCloseTo(sourceOffset[index] ?? Number.NaN, 7);
    });
    expectAllAxisSphere(file, node);
  });

  it('uses P_Extra_Life 4.5-unit collection distance', () => {
    const file = sourceFile(files.extraLife);
    const node = proximity(file, 'P_Extra_Life_MF Script', LEVEL_TRIGGER_SOURCE.extraLifeDistance);
    expect(file.objects[parameter(file, node, 'ObjectB').valueObjectIndex]?.name).toBe('P_Extra_Life_MF');
    expectAllAxisSphere(file, node);
  });

  it('matches the life show/hide and point behavior outer gates', () => {
    const life = sourceFile(files.extraLife);
    const lifeOuter = proximity(life, 'P_Extra_Life_MF Script', PICKUP_PROXIMITY_SOURCE.life.distance);
    expect(floatValue(parameter(life, lifeOuter, 'Exactness min. Distance'))).toBe(
      PICKUP_PROXIMITY_SOURCE.life.exactnessMinDistance,
    );
    expect(floatValue(parameter(life, lifeOuter, 'Exactness max. Distance'))).toBe(
      PICKUP_PROXIMITY_SOURCE.life.exactnessMaxDistance,
    );
    expect(intValue(parameter(life, lifeOuter, 'Minimum Framedelay'))).toBe(
      PICKUP_PROXIMITY_SOURCE.life.minimumFrameDelay,
    );
    expect(intValue(parameter(life, lifeOuter, 'Maximum Framedelay'))).toBe(
      PICKUP_PROXIMITY_SOURCE.life.maximumFrameDelay,
    );
    expect(intValue(parameter(life, lifeOuter, ''))).toBe(PICKUP_PROXIMITY_SOURCE.life.initialFrameDelay);
    expect(intValue(parameter(life, lifeOuter, 'Check Axis:'))).toBe(PICKUP_PROXIMITY_SOURCE.life.axes);
    expect(intValue(parameter(life, lifeOuter, 'Squared Distance?'))).toBe(1);

    const point = sourceFile(files.extraPoint);
    const pointOuter = proximity(point, 'P_Extra_Point_MF Script', PICKUP_PROXIMITY_SOURCE.point.distance);
    expect(floatValue(parameter(point, pointOuter, 'Exactness min. Distance'))).toBe(
      PICKUP_PROXIMITY_SOURCE.point.exactnessMinDistance,
    );
    expect(floatValue(parameter(point, pointOuter, 'Exactness max. Distance'))).toBe(
      PICKUP_PROXIMITY_SOURCE.point.exactnessMaxDistance,
    );
    expect(intValue(parameter(point, pointOuter, 'Minimum Framedelay'))).toBe(
      PICKUP_PROXIMITY_SOURCE.point.minimumFrameDelay,
    );
    expect(intValue(parameter(point, pointOuter, 'Maximum Framedelay'))).toBe(
      PICKUP_PROXIMITY_SOURCE.point.maximumFrameDelay,
    );
    expect(intValue(parameter(point, pointOuter, ''))).toBe(PICKUP_PROXIMITY_SOURCE.point.initialFrameDelay);
    expect(intValue(parameter(point, pointOuter, 'Check Axis:'))).toBe(PICKUP_PROXIMITY_SOURCE.point.axes);
    expect(intValue(parameter(point, pointOuter, 'Squared Distance?'))).toBe(1);
  });

  it('uses TT Extra 3-unit point activation distance', () => {
    const file = sourceFile(files.extraPoint);
    const ttExtra = children(file, behavior(file, 'P_Extra_Point_MF Script'), 'TT Extra')[0];
    if (!ttExtra) throw new Error('missing TT Extra');
    expect(LEVEL_TRIGGER_SOURCE.extraPointDistance).toBe(floatValue(parameter(file, ttExtra, 'Activationdistance')));
  });

  it('uses PE_Balloon Platform and 1-unit finish distance', () => {
    const file = sourceFile(files.finish);
    const node = proximity(file, 'PE_Balloon Script', LEVEL_TRIGGER_SOURCE.finishDistance);
    expect(file.objects[parameter(file, node, 'ObjectB').valueObjectIndex]?.name).toBe('PE_Balloon_Platform');
    expectAllAxisSphere(file, node);
  });

  it('keeps the source building block strict at the spherical boundary', () => {
    const origin = new THREE.Vector3();
    expect(sphereContains(origin, new THREE.Vector3(0.999, 0, 0), 1)).toBe(true);
    expect(sphereContains(origin, new THREE.Vector3(1, 0, 0), 1)).toBe(false);
    expect(sphereContains(origin, new THREE.Vector3(0.8, 0.8, 0), 1)).toBe(false);
  });
});

describe('source level pickup sector ownership', () => {
  for (let level = 1; level <= 12; level++) {
    it(`assigns every level ${level} pickup to exactly one Sector_NN group`, () => {
      const file = sourceFile(
        fileURLToPath(
          new URL(
            `../../Ballance_bin/source1/Ballance/3D Entities/Level/Level_${String(level).padStart(2, '0')}.NMO`,
            import.meta.url,
          ),
        ),
      );
      const sectors = file.groups.filter((group) => /^Sector_\d+$/.test(group.name));
      const pickups = file.entities.filter((entity) => /^P_Extra_(?:Life|Point)_\d+$/.test(entity.name));
      for (const pickup of pickups) {
        expect(
          sectors.filter((sector) => sector.memberIndices.includes(pickup.index)),
          `${pickup.name} sector ownership`,
        ).toHaveLength(1);
      }
    });
  }
});
