import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { BehaviorRec, NmoFile, ParameterRec } from '../formats/ck2/types.ts';

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
        if (Math.abs(entity.worldMatrix[1]) > 1e-5 || Math.abs(entity.worldMatrix[4]) > 1e-5) rotated++;
      }
    }
    expect(rotated).toBeGreaterThan(0);
  });
});
