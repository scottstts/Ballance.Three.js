import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { Entity2dRec, NmoFile, ParameterRec } from '../formats/ck2/types.ts';
import { LIFE_HUD_SOURCE, lifeBallRects, lifeHookRect } from './hudLayout.ts';

const GAME_DIR = fileURLToPath(new URL('../../Ballance_bin/source1/Ballance', import.meta.url));
const cameraPath = `${GAME_DIR}/3D Entities/Camera.nmo`;
const gameplayPath = `${GAME_DIR}/3D Entities/Gameplay.nmo`;

function entity2d(file: NmoFile, name: string): Entity2dRec {
  const record = file.byName.get(name)?.find((candidate): candidate is Entity2dRec => candidate.kind === 'entity2d');
  if (!record) throw new Error(`missing source CK2dEntity ${name}`);
  return record;
}

function parameter(file: NmoFile, name: string): ParameterRec {
  const record = file.byName.get(name)?.find((candidate): candidate is ParameterRec => candidate.kind === 'parameter');
  if (!record) throw new Error(`missing source parameter ${name}`);
  return record;
}

function floatValue(record: ParameterRec): number {
  return new DataView(record.valueBytes.buffer, record.valueBytes.byteOffset, record.valueBytes.byteLength).getFloat32(
    0,
    true,
  );
}

describe.skipIf(!existsSync(cameraPath) || !existsSync(gameplayPath))('source-authored life HUD', () => {
  const camera = parseNmo(readFileSync(cameraPath));
  const gameplay = parseNmo(readFileSync(gameplayPath));

  it('uses every Camera.nmo CK2dEntity rectangle verbatim', () => {
    expect(LIFE_HUD_SOURCE.ball).toEqual(entity2d(camera, 'Interface_Life_Kugel').rect);
    expect(LIFE_HUD_SOURCE.curl).toEqual(entity2d(camera, 'Interface_Life_Startbogen').rect);
    expect(LIFE_HUD_SOURCE.hook).toEqual(entity2d(camera, 'Interface_Life_End').rect);
  });

  it('uses Gameplay.nmo reserve count, spacing, and hook formula', () => {
    const energy = gameplay.byName.get('Energy')?.find((record) => record.kind === 'dataArray');
    if (!energy || energy.kind !== 'dataArray') throw new Error('missing source Energy array');
    const startLivesColumn = energy.columns.findIndex(({ name }) => name === 'StartLifes');
    const startLives = Number(energy.rows[0]?.[startLivesColumn]);

    expect(startLives).toBe(3);
    expect(LIFE_HUD_SOURCE.ballOffsetX).toBe(floatValue(parameter(gameplay, 'Offset LifeBalls x')));
    expect(lifeBallRects(startLives)).toHaveLength(4);
    expect(lifeBallRects(startLives).map((rect) => rect[0])).toEqual([
      0.9495999813079834,
      0.9108999818563461,
      0.8721999824047089,
      0.8334999829530716,
    ]);
    expect(lifeHookRect(startLives)[0]).toBeCloseTo(0.8126999884843826, 12);
  });
});
