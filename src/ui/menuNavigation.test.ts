import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { BehaviorRec, NmoFile, ParameterRec } from '../formats/ck2/types.ts';
import { nextSourceMenuIndex, sourceMenuInitialIndex } from './menuNavigation.ts';

const menuPath = fileURLToPath(
  new URL('../../Ballance_bin/source1/Ballance/3D Entities/Menu.nmo', import.meta.url),
);

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

function keyValues(file: NmoFile, parent: BehaviorRec): number[] {
  return parent.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .filter((record): record is BehaviorRec => record?.kind === 'behavior')
    .filter((record) => record.name === 'Key Event' || record.name === 'Secure Key')
    .flatMap((record) =>
      record.referenceLists
        .flat()
        .map((index) => file.objects[index])
        .filter((parameter): parameter is ParameterRec => parameter?.kind === 'parameter' && parameter.name === 'Key Waited')
        .map((parameter) => {
          const value = resolve(file, parameter);
          return new DataView(value.valueBytes.buffer, value.valueBytes.byteOffset).getInt32(0, true);
        }),
    );
}

function rolloverColumn(file: NmoFile, name: string): number[] {
  const array = file.byName.get(name)?.find((record) => record.kind === 'dataArray');
  if (!array || array.kind !== 'dataArray') throw new Error(`missing source array ${name}`);
  return array.rows.map((row) => Number(row.at(-1)));
}

describe('source menu navigation helpers', () => {
  it('wraps and skips inactive rows', () => {
    expect(sourceMenuInitialIndex([false, true, false], 'first')).toBe(0);
    expect(sourceMenuInitialIndex([false, true, false], 'last')).toBe(2);
    expect(nextSourceMenuIndex([false, true, false], 0, 1)).toBe(2);
    expect(nextSourceMenuIndex([false, true, false], 2, 1)).toBe(0);
    expect(nextSourceMenuIndex([true, true], 0, 1)).toBe(-1);
  });
});

describe.skipIf(!existsSync(menuPath))('source-authored menu navigation state', () => {
  const menu = parseNmo(readFileSync(menuPath));

  it('retains the serialized initial rollover rows', () => {
    expect(rolloverColumn(menu, 'Menu_Main_ShowHide')).toEqual([1, 0, 0, 0, 0]);
    expect(rolloverColumn(menu, 'Menu_Start_ShowHide')).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(rolloverColumn(menu, 'Menu_Pause_ShowHide')).toEqual([0, 0, 0, 0, 1]);
    expect(rolloverColumn(menu, 'Menu_End_ShowHide')).toEqual([0, 0, 0, 0, 1]);
    expect(rolloverColumn(menu, 'Menu_Options_ShowHide')).toEqual([1, 0, 0, 0]);
    expect(rolloverColumn(menu, 'Menu_Opt_Gra_Keys')).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('uses the shipped up/down/return/escape scan codes', () => {
    const mainKeyboard = children(menu, behavior(menu, 'Main Menu'), 'Keyboard')[0];
    expect(keyValues(menu, mainKeyboard).sort((a, b) => a - b)).toEqual([1, 28, 200, 208]);
    expect(keyValues(menu, behavior(menu, 'Menu_YesNo')).sort((a, b) => a - b)).toEqual([1, 28, 203, 205]);
  });
});
