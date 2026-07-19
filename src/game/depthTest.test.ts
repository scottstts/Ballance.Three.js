import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { BehaviorRec, NmoFile, ParameterRec } from '../formats/ck2/types.ts';
import { DEPTH_TEST_GROUPS, DEPTH_TEST_OFFSET, sourceMaxDepth } from './moduls/manager.ts';

const gameDir = fileURLToPath(new URL('../../Ballance_bin/source1/Ballance', import.meta.url));
const gameplayPath = join(gameDir, '3D Entities/Gameplay.nmo');

function behavior(file: NmoFile, name: string): BehaviorRec {
  const found = file.byName.get(name)?.find((record): record is BehaviorRec => record.kind === 'behavior');
  if (!found) throw new Error(`missing source behavior ${name}`);
  return found;
}

function children(file: NmoFile, parent: BehaviorRec, name: string): BehaviorRec[] {
  return parent.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .filter((record): record is BehaviorRec => record?.kind === 'behavior' && record.name === name);
}

function resolve(file: NmoFile, parameter: ParameterRec): ParameterRec {
  let current = parameter;
  const seen = new Set([current.index]);
  while (current.sourceIndex >= 0 || current.sharedIndex >= 0) {
    const index = current.sourceIndex >= 0 ? current.sourceIndex : current.sharedIndex;
    if (seen.has(index)) break;
    const next = file.objects[index];
    if (next?.kind !== 'parameter') break;
    seen.add(index);
    current = next;
  }
  return current;
}

function parameter(file: NmoFile, owner: BehaviorRec, name: string): ParameterRec {
  const found = owner.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .find((record): record is ParameterRec => record?.kind === 'parameter' && record.name === name);
  if (!found) throw new Error(`missing source parameter ${owner.name}/${name}`);
  return resolve(file, found);
}

function intValue(parameter: ParameterRec): number {
  return new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset).getInt32(0, true);
}

function floatValue(parameter: ParameterRec): number {
  return new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset).getFloat32(0, true);
}

function stringValue(parameter: ParameterRec): string {
  return Buffer.from(parameter.valueBytes).toString('latin1').replace(/\0.*$/s, '');
}

describe.skipIf(!existsSync(gameplayPath))('source-authored depth-test volumes', () => {
  const gameplay = parseNmo(readFileSync(gameplayPath));

  it('discovers the authored DepthTestCubes group and minimum-depth graph', () => {
    const getMaxDepth = behavior(gameplay, 'get maxDepth');
    const groupName = children(gameplay, getMaxDepth, 'Op').find(
      (node) => stringValue(parameter(gameplay, node, 'p1')) === 'DepthTestCubes',
    );
    const test = children(gameplay, getMaxDepth, 'Test')[0];

    expect(groupName).toBeDefined();
    expect(intValue(parameter(gameplay, test, 'Test'))).toBe(3); // strict A < B
  });

  it('keeps the cleanup graph separate from the collision-trigger meshes', () => {
    const depthTest = behavior(gameplay, 'DepthTest');
    expect(children(gameplay, depthTest, 'Group Iterator')).toHaveLength(1);
    expect(children(gameplay, depthTest, 'Physicalize')).toHaveLength(1);
    expect(children(gameplay, depthTest, 'Hide')).toHaveLength(1);
    expect(children(gameplay, depthTest, 'Set Position')).toHaveLength(1);
    const offset = children(gameplay, depthTest, 'Op').find(
      (node) => parameter(gameplay, node, 'p2').valueBytes.byteLength >= 4 && floatValue(parameter(gameplay, node, 'p2')) === 200,
    );
    expect(offset).toBeDefined();
  });

  it('culls exactly the four Levelinit DepthTestGroups with the 200 offset', () => {
    const levelinit = parseNmo(readFileSync(join(gameDir, '3D Entities/Levelinit.nmo')));
    const groups = levelinit.byName.get('DepthTestGroups')?.find((record) => record.kind === 'dataArray');
    expect(groups?.kind).toBe('dataArray');
    if (groups?.kind !== 'dataArray') return;
    expect(groups.columns.map((column) => column.name)).toEqual(['Groupname']);
    expect(groups.rows.map((row) => row[0])).toEqual([...DEPTH_TEST_GROUPS]);
    expect(DEPTH_TEST_OFFSET).toBe(200);

    // get maxDepth seeds 0 and keeps the strict minimum of the cube minima.
    const shallow = new THREE.Box3(new THREE.Vector3(-1, 5, -1), new THREE.Vector3(1, 9, 1));
    const deep = new THREE.Box3(new THREE.Vector3(-1, -129.44, -1), new THREE.Vector3(1, 1, 1));
    expect(sourceMaxDepth([])).toBe(0);
    expect(sourceMaxDepth([shallow])).toBe(0);
    expect(sourceMaxDepth([shallow, deep])).toBe(-129.44);
  });

  it('retains every level mesh, including rotated source volumes', () => {
    let rotated = 0;
    for (let level = 1; level <= 12; level++) {
      const path = join(gameDir, '3D Entities/Level', `Level_${String(level).padStart(2, '0')}.NMO`);
      const file = parseNmo(readFileSync(path));
      const group = file.byName.get('DepthTestCubes')?.find((record) => record.kind === 'group');
      if (!group || group.kind !== 'group') throw new Error(`missing level ${level} DepthTestCubes`);
      expect(group.memberIndices.length).toBeGreaterThan(0);
      for (const index of group.memberIndices) {
        const entity = file.objects[index];
        expect(entity?.kind).toBe('entity');
        if (entity?.kind !== 'entity') continue;
        expect(file.objects[entity.meshIndex]?.kind).toBe('mesh');
        // Rotation shows in any off-diagonal element of the 3x3 basis
        // (rows 0..2 of the 4x4 row-major TRS). Level 1 and 2 each serialize a
        // 90-degree yaw on Quader03, which only touches [2]/[8].
        const m = entity.worldMatrix;
        const offDiagonal = [m[1], m[2], m[4], m[6], m[8], m[9]];
        if (offDiagonal.some((value) => Math.abs(value) > 1e-5)) rotated++;
      }
    }
    expect(rotated).toBeGreaterThan(0);
  });
});
