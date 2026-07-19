/**
 * Level integrity regression: every original level must expose the complete
 * gameplay structure the runtime depends on (sectors, checkpoints, reset
 * points, start/end markers, kill volumes, modul placements).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import { MODUL_PHYS } from './moduls/physTable.ts';

const GAME_DIR = [
  fileURLToPath(new URL('../../Ballance_bin/Ballance', import.meta.url)),
  fileURLToPath(new URL('../../Ballance_bin/source1/Ballance', import.meta.url)),
].find(existsSync) ?? '';
const hasGame = existsSync(GAME_DIR);

/** expected sector counts of the original levels */
const SECTORS: Record<number, number> = { 1: 4, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5, 9: 5, 10: 5, 11: 6, 12: 8 };

describe.skipIf(!hasGame)('level gameplay structure', () => {
  for (let n = 1; n <= 12; n++) {
    it(`Level_${String(n).padStart(2, '0')} has complete structure`, () => {
      const file = parseNmo(
        readFileSync(join(GAME_DIR, '3D Entities/Level', `Level_${String(n).padStart(2, '0')}.NMO`)),
      );
      const groups = new Map(file.groups.map((g) => [g.name, g]));

      const sectorGroups = file.groups.filter((g) => /^Sector_\d+$/.test(g.name));
      expect(sectorGroups.length).toBe(SECTORS[n]);

      expect(groups.get('PS_Levelstart')?.memberIndices.length).toBe(1);
      expect(groups.get('PE_Levelende')?.memberIndices.length).toBe(1);
      expect(groups.get('PC_Checkpoints')?.memberIndices.length).toBe(SECTORS[n] - 1);
      expect(groups.get('PR_Resetpoints')?.memberIndices.length).toBe(SECTORS[n]);
      expect(groups.get('Phys_Floors')?.memberIndices.length).toBeGreaterThan(0);
      expect(groups.get('DepthTestCubes')?.memberIndices.length).toBeGreaterThan(0);

      // every modul group present in the level must have a physics/behavior definition
      for (const g of file.groups) {
        if (/^P_Modul_\d+$/.test(g.name)) {
          const known = g.name in MODUL_PHYS || g.name === 'P_Modul_18';
          expect(known, `${g.name} needs a behavior definition`).toBe(true);
        }
      }

      // placements referenced by sector groups must exist as named entities
      for (const sg of sectorGroups) {
        for (const idx of sg.memberIndices) {
          expect(file.objects[idx]).toBeDefined();
        }
      }
    });
  }

  it('retains the four non-axis-aligned fan placements that require local-box tests', () => {
    const rotated: string[] = [];
    for (let n = 1; n <= 12; n++) {
      const file = parseNmo(
        readFileSync(join(GAME_DIR, '3D Entities/Level', `Level_${String(n).padStart(2, '0')}.NMO`)),
      );
      const group = file.groups.find((candidate) => candidate.name === 'P_Modul_18');
      for (const index of group?.memberIndices ?? []) {
        const entity = file.objects[index];
        if (entity?.kind !== 'entity') continue;
        const basis = [...entity.worldMatrix].filter((_, component) =>
          [0, 1, 2, 4, 5, 6, 8, 9, 10].includes(component),
        );
        const axisAligned = basis.every((value) => {
          const magnitude = Math.abs(value);
          return magnitude < 1e-5 || Math.abs(magnitude - 1) < 1e-5;
        });
        if (!axisAligned) rotated.push(`L${n}:${entity.name}`);
      }
    }
    expect(rotated).toEqual([
      'L2:P_Modul_18_04',
      'L2:P_Modul_18_06',
      'L2:P_Modul_18_07',
      'L12:P_Modul_18_01',
    ]);
  });
});
