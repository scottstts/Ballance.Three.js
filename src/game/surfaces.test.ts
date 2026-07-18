import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import { soundSurfaceByName } from './surfaces.ts';

const levelDir = fileURLToPath(
  new URL('../../Ballance_bin/source1/Ballance/3D Entities/Level/', import.meta.url),
);

describe.skipIf(!existsSync(levelDir))('source-authored impact and roll surfaces', () => {
  it('keeps the intentionally distinct group memberships across all levels', () => {
    const differences: string[] = [];
    for (let level = 1; level <= 12; level++) {
      const file = parseNmo(
        readFileSync(`${levelDir}Level_${String(level).padStart(2, '0')}.NMO`),
      );
      const groups = new Map(file.groups.map((group) => [group.name, group]));
      const hit = soundSurfaceByName(file, groups, 'Hit');
      const roll = soundSurfaceByName(file, groups, 'Roll');
      const names = new Set([...hit.keys(), ...roll.keys()]);
      for (const name of names) {
        if (hit.get(name) !== roll.get(name)) differences.push(`${level}:${name}`);
      }
    }
    expect(differences).toEqual([
      '1:A01_Rail_04',
      '2:A02_Floor_03',
      '2:A01_Geländer_01',
      '2:A01_Geländer_02',
      '2:A02_Geländer_02',
      '2:A02_Geländer_01',
      '2:A02_Geländer_03',
      '4:A02_Rail_01',
      '4:A03_Rail_02',
      '5:A03_Rail_04',
      '5:A04_Rail_02',
      '5:A03_Rail_05',
      '5:A03_Modul16',
      '6:A_02_Rail_01',
      '6:A_03_Rail_03',
      '6:A_03_Rail_01',
      '8:A05_Rail_02',
      '9:A01_Rail_03',
      '9:A04_Rail_03',
      '10:A01_Floor_04',
      '11:A03_Rail_04',
    ]);
  });
});
