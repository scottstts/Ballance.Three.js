import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { BehaviorRec, NmoFile, ParameterRec } from '../formats/ck2/types.ts';
import { defaultTable } from './store.ts';
import {
  SCORE_COUNT_SPEED,
  SOURCE_DEFAULT_LAST_PLAYER,
  SOURCE_HIGHSCORE_NAME_MAX_LENGTH,
  highscoreQualifies,
  scoreCountStep,
} from './score.ts';

const basePath = fileURLToPath(new URL('../../Ballance_bin/source1/Ballance/base.cmo', import.meta.url));
const menuPath = fileURLToPath(
  new URL('../../Ballance_bin/source1/Ballance/3D Entities/Menu.nmo', import.meta.url),
);

function behavior(file: NmoFile, name: string): BehaviorRec {
  const found = file.byName.get(name)?.find((record): record is BehaviorRec => record.kind === 'behavior');
  if (!found) throw new Error(`missing source behavior ${name}`);
  return found;
}

function child(file: NmoFile, parent: BehaviorRec, name: string): BehaviorRec {
  const found = parent.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .find((record): record is BehaviorRec => record?.kind === 'behavior' && record.name === name);
  if (!found) throw new Error(`missing source behavior ${parent.name}/${name}`);
  return found;
}

function resolve(file: NmoFile, parameter: ParameterRec): ParameterRec {
  let current = parameter;
  const seen = new Set([parameter.index]);
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

function intParameter(file: NmoFile, owner: BehaviorRec, name: string): number {
  const parameter = owner.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .find((record): record is ParameterRec => record?.kind === 'parameter' && record.name === name);
  if (!parameter) throw new Error(`missing source parameter ${owner.name}/${name}`);
  const value = resolve(file, parameter);
  return new DataView(value.valueBytes.buffer, value.valueBytes.byteOffset).getInt32(0, true);
}

describe('source-authored score counter', () => {
  it('accelerates according to the accumulated displayed score', () => {
    expect(SCORE_COUNT_SPEED).toEqual([
      { limit: 80, step: 1 },
      { limit: 500, step: 5 },
      { limit: 9999, step: 25 },
    ]);
    expect(scoreCountStep(0)).toBe(1);
    expect(scoreCountStep(80)).toBe(1);
    expect(scoreCountStep(81)).toBe(5);
    expect(scoreCountStep(500)).toBe(5);
    expect(scoreCountStep(501)).toBe(25);
  });

  it('uses a strict greater-than cutoff', () => {
    expect(highscoreQualifies(401, 400)).toBe(true);
    expect(highscoreQualifies(400, 400)).toBe(false);
  });
});

describe.skipIf(!existsSync(basePath) || !existsSync(menuPath))('source-authored highscore entry', () => {
  const base = parseNmo(readFileSync(basePath));
  const menu = parseNmo(readFileSync(menuPath));

  it('resets the entry to DB_Options.LastPlayer and limits it to nine characters', () => {
    const options = base.byName.get('DB_Options')?.find((record) => record.kind === 'dataArray');
    if (!options || options.kind !== 'dataArray') throw new Error('missing source DB_Options');
    const lastPlayerColumn = options.columns.findIndex((column) => column.name === 'LastPlayer');

    expect(lastPlayerColumn).toBe(9);
    expect(options.rows[0][lastPlayerColumn]).toBe(SOURCE_DEFAULT_LAST_PLAYER);

    const input = child(menu, behavior(menu, 'Menu_HighscoreEntry'), 'TT InputString');
    expect(intParameter(menu, input, 'Max Size')).toBe(SOURCE_HIGHSCORE_NAME_MAX_LENGTH);
  });

  it('uses Test mode 5 for strict score qualification', () => {
    // Check Highscore owns two Test blocks. The score-qualification test is the
    // one whose B input is wired to a Get Cell output (the row-9 score); the
    // other Test compares against a local constant.
    const check = behavior(base, 'Check Highscore');
    const tests = check.referenceLists
      .flat()
      .map((index) => base.objects[index])
      .filter((record): record is BehaviorRec => record?.kind === 'behavior' && record.name === 'Test');
    expect(tests).toHaveLength(2);
    const qualification = tests.find((node) => {
      const b = node.referenceLists
        .flat()
        .map((index) => base.objects[index])
        .find((record): record is ParameterRec => record?.kind === 'parameter' && record.name === 'iB');
      return b !== undefined && resolve(base, b).name === 'Cell Value';
    });
    expect(qualification).toBeDefined();
    if (!qualification) return;
    expect(intParameter(base, qualification, 'Test')).toBe(5);
    expect(highscoreQualifies(1000, 1000)).toBe(false);
    expect(highscoreQualifies(1001, 1000)).toBe(true);
  });

  it('seeds every level leaderboard exactly like the shipped DB arrays', () => {
    for (let level = 1; level <= 12; level++) {
      const name = `DB_Highscore_Lv${String(level).padStart(2, '0')}`;
      const array = base.byName.get(name)?.find((record) => record.kind === 'dataArray');
      expect(array?.kind, name).toBe('dataArray');
      if (array?.kind !== 'dataArray') continue;
      expect(array.columns.map((column) => column.name)).toEqual(['Playername', 'Points']);
      expect(array.rows).toEqual(
        defaultTable(level).map((entry) => [entry.name, entry.score]),
      );
    }
  });
});
