import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import { BALL_DEFS } from './constants.ts';

const GAME_DIR = [
  fileURLToPath(new URL('../../Ballance_bin/Ballance', import.meta.url)),
  fileURLToPath(new URL('../../Ballance_bin/source1/Ballance', import.meta.url)),
].find(existsSync) ?? '';
const hasGame = existsSync(GAME_DIR);

describe.skipIf(!hasGame)('source-backed gameplay ball constants', () => {
  it('matches every Physicalize_GameBall row in Balls.nmo', () => {
    const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/Balls.nmo')));
    const table = file.byName.get('Physicalize_GameBall')?.[0];
    expect(table?.kind).toBe('dataArray');
    if (table?.kind !== 'dataArray') return;

    expect(table.columns.map((column) => column.name)).toEqual([
      'Ballname',
      'Friction',
      'Elasticity',
      'Mass',
      'CollGroup',
      'Linear Damp',
      'Rot Damp',
      'Force',
    ]);
    expect(table.rows).toHaveLength(3);
    for (const definition of Object.values(BALL_DEFS)) {
      const row = table.rows.find((candidate) => candidate[0] === definition.entityName);
      expect(row, definition.entityName).toBeDefined();
      if (!row) continue;
      expect(row[4]).toBe('Ball');
      expect(definition.friction).toBeCloseTo(Number(row[1]), 7);
      expect(definition.elasticity).toBeCloseTo(Number(row[2]), 7);
      expect(definition.mass).toBeCloseTo(Number(row[3]), 7);
      expect(definition.linearDamp).toBeCloseTo(Number(row[5]), 7);
      expect(definition.rotDamp).toBeCloseTo(Number(row[6]), 7);
      expect(definition.force).toBeCloseTo(Number(row[7]), 7);
    }
  });
});
