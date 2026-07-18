import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { BehaviorRec, NmoFile, ParameterRec } from '../formats/ck2/types.ts';
import { fallLifeOutcome } from './lives.ts';

const gameplayPath = fileURLToPath(
  new URL('../../Ballance_bin/source1/Ballance/3D Entities/Gameplay.nmo', import.meta.url),
);

function behavior(file: NmoFile, name: string): BehaviorRec {
  const record = file.byName.get(name)?.find((candidate): candidate is BehaviorRec => candidate.kind === 'behavior');
  if (!record) throw new Error(`missing source behavior ${name}`);
  return record;
}

function child(file: NmoFile, parent: BehaviorRec, name: string): BehaviorRec {
  const record = parent.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .find((candidate): candidate is BehaviorRec => candidate?.kind === 'behavior' && candidate.name === name);
  if (!record) throw new Error(`missing source child behavior ${parent.name}/${name}`);
  return record;
}

function parameters(file: NmoFile, owner: BehaviorRec): Map<string, ParameterRec> {
  return new Map(
    owner.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .filter((record): record is ParameterRec => record?.kind === 'parameter')
      .map((record) => [record.name, record]),
  );
}

function resolveParameter(file: NmoFile, record: ParameterRec | undefined): ParameterRec | undefined {
  let current = record;
  const seen = new Set<number>();
  while (current && !seen.has(current.index)) {
    seen.add(current.index);
    const nextIndex = current.sourceIndex >= 0 ? current.sourceIndex : current.sharedIndex;
    if (nextIndex < 0) return current;
    const next = file.objects[nextIndex];
    if (next?.kind !== 'parameter') return current;
    current = next;
  }
  return current;
}

function intValue(file: NmoFile, record: ParameterRec | undefined): number {
  const resolved = resolveParameter(file, record);
  if (!resolved || resolved.valueBytes.byteLength < 4) throw new Error('missing source integer value');
  return new DataView(
    resolved.valueBytes.buffer,
    resolved.valueBytes.byteOffset,
    resolved.valueBytes.byteLength,
  ).getInt32(
    0,
    true,
  );
}

describe('reserve-life semantics', () => {
  it('provides the permanent current ball after all three starting reserves are spent', () => {
    expect(fallLifeOutcome(3)).toEqual({ gameOver: false, lives: 2 });
    expect(fallLifeOutcome(2)).toEqual({ gameOver: false, lives: 1 });
    expect(fallLifeOutcome(1)).toEqual({ gameOver: false, lives: 0 });
    expect(fallLifeOutcome(0)).toEqual({ gameOver: true, lives: 0 });
  });

  it.skipIf(!existsSync(gameplayPath))('matches Deactivate Ball test-before-subtract wiring', () => {
    const file = parseNmo(readFileSync(gameplayPath));
    const deactivate = behavior(file, 'Deactivate Ball');
    const test = child(file, deactivate, 'Test');
    const subtract = child(file, deactivate, 'Op');
    const testParameters = parameters(file, test);
    const subtractParameters = parameters(file, subtract);
    const actLifes = file.byName.get('ActLifes')?.find((record) => record.kind === 'parameter');

    expect(actLifes?.kind).toBe('parameter');
    expect(testParameters.get('A')?.sourceIndex).toBe(actLifes?.index);
    expect(intValue(file, testParameters.get('B'))).toBe(0);
    expect(intValue(file, testParameters.get('Test'))).toBe(5);
    expect(subtractParameters.get('p1')?.sourceIndex).toBe(actLifes?.index);
    expect(intValue(file, subtractParameters.get('p2'))).toBe(1);
    expect(subtractParameters.get('res')?.destinationIndices).toContain(actLifes?.index);

    const falseIo = test.referenceLists.flat().map((index) => file.objects[index]).find((record) => record?.name === 'False');
    const gameOverIo = deactivate.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .find((record) => record?.name === 'Game Over');
    const falseToGameOver = deactivate.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .find(
        (record) =>
          record?.kind === 'behaviorLink' &&
          record.outputIndex === falseIo?.index &&
          record.inputIndex === gameOverIo?.index,
      );
    expect(falseToGameOver?.kind).toBe('behaviorLink');
  });
});
