import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { BehaviorRec, Entity2dRec, NmoFile, ParameterRec } from '../formats/ck2/types.ts';
import {
  atlasCropFromUv,
  HUD_SOURCE_ASPECT,
  LIFE_HUD_SOURCE,
  lifeBallRects,
  lifeHookRect,
  POINTS_HUD_SOURCE,
  pointShadowOffset,
} from './hudLayout.ts';

const GAME_DIR = fileURLToPath(new URL('../../Ballance_bin/source1/Ballance', import.meta.url));
const cameraPath = `${GAME_DIR}/3D Entities/Camera.nmo`;
const gameplayPath = `${GAME_DIR}/3D Entities/Gameplay.nmo`;
const interfacePath = `${GAME_DIR}/BuildingBlocks/Interface.dll`;
const fontPath = `${GAME_DIR}/Textures/Font_1.tga`;

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

function intValue(record: ParameterRec): number {
  return new DataView(record.valueBytes.buffer, record.valueBytes.byteOffset, record.valueBytes.byteLength).getInt32(
    0,
    true,
  );
}

function floatValues(record: ParameterRec): number[] {
  const view = new DataView(record.valueBytes.buffer, record.valueBytes.byteOffset, record.valueBytes.byteLength);
  return Array.from({ length: record.valueBytes.byteLength / 4 }, (_, index) => view.getFloat32(index * 4, true));
}

function behavior(file: NmoFile, name: string): BehaviorRec {
  const record = file.byName.get(name)?.find((candidate): candidate is BehaviorRec => candidate.kind === 'behavior');
  if (!record) throw new Error(`missing source behavior ${name}`);
  return record;
}

function childBehavior(file: NmoFile, parent: BehaviorRec, name: string): BehaviorRec {
  const record = parent.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .find((candidate): candidate is BehaviorRec => candidate?.kind === 'behavior' && candidate.name === name);
  if (!record) throw new Error(`missing source behavior ${parent.name}/${name}`);
  return record;
}

function behaviorParameter(file: NmoFile, owner: BehaviorRec, name: string): ParameterRec {
  const record = owner.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .find((candidate): candidate is ParameterRec => candidate?.kind === 'parameter' && candidate.name === name);
  if (!record) throw new Error(`missing source parameter ${owner.name}/${name}`);
  let resolved = record;
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

describe.skipIf(!existsSync(cameraPath) || !existsSync(gameplayPath))('source-authored life HUD', () => {
  const camera = parseNmo(readFileSync(cameraPath));
  const gameplay = parseNmo(readFileSync(gameplayPath));

  it('uses every Camera.nmo CK2dEntity rectangle verbatim', () => {
    const ballTemplate = entity2d(camera, 'Interface_Life_Kugel');
    expect(LIFE_HUD_SOURCE.ball).toEqual(ballTemplate.rect);
    expect(LIFE_HUD_SOURCE.curl).toEqual(entity2d(camera, 'Interface_Life_Startbogen').rect);
    expect(LIFE_HUD_SOURCE.hook).toEqual(entity2d(camera, 'Interface_Life_End').rect);
    expect(ballTemplate.visible).toBe(false);
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
      0.9108999818563461,
      0.8721999824047089,
      0.8334999829530716,
      0.7947999835014343,
    ]);
    expect(lifeHookRect(startLives)[0]).toBeCloseTo(0.7739999890327454, 12);
  });
});

describe.skipIf(
  !existsSync(cameraPath) || !existsSync(gameplayPath) || !existsSync(interfacePath) || !existsSync(fontPath),
)(
  'source-authored points HUD',
  () => {
    const camera = parseNmo(readFileSync(cameraPath));
    const gameplay = parseNmo(readFileSync(gameplayPath));
    const energy = behavior(gameplay, 'Gameplay_Energy');
    const init = childBehavior(gameplay, energy, 'Init');
    const font = childBehavior(gameplay, init, 'Set Font Properties');
    const text = childBehavior(gameplay, energy, '2D Text');
    const glow = childBehavior(gameplay, energy, 'Bezier Progression');

    it('uses all Camera.nmo score rectangles and UVs verbatim', () => {
      const background = entity2d(camera, 'Interface_Points_bg');
      const sourceGlow = entity2d(camera, 'Interface_Points_glow');
      const digits = entity2d(camera, 'Interface_Points_digits');

      expect(POINTS_HUD_SOURCE.background).toEqual(background.rect);
      expect(POINTS_HUD_SOURCE.backgroundUv).toEqual(background.relativeRect);
      expect(POINTS_HUD_SOURCE.glow).toEqual(sourceGlow.rect);
      expect(POINTS_HUD_SOURCE.glowUv).toEqual(sourceGlow.relativeRect);
      expect(POINTS_HUD_SOURCE.digits).toEqual(digits.rect);
      expect(atlasCropFromUv(background.relativeRect)).toEqual({ x: 83, y: 186, w: 173, h: 65 });
      expect(atlasCropFromUv(sourceGlow.relativeRect)).toEqual({ x: 111, y: 130, w: 144, h: 53 });
    });

    it('uses Gameplay.nmo point-font scale, spacing, colors, shadow, alignment, and margins', () => {
      expect(POINTS_HUD_SOURCE.font.space).toEqual(floatValues(behaviorParameter(gameplay, font, 'Space')));
      expect(POINTS_HUD_SOURCE.font.scale).toEqual(floatValues(behaviorParameter(gameplay, font, 'Scale')));
      expect(POINTS_HUD_SOURCE.font.color).toEqual(floatValues(behaviorParameter(gameplay, font, 'Color')));
      expect(POINTS_HUD_SOURCE.font.endColor).toEqual(floatValues(behaviorParameter(gameplay, font, 'End Color')));
      expect(POINTS_HUD_SOURCE.font.shadowColor).toEqual(floatValues(behaviorParameter(gameplay, font, 'Shadow Color')));
      expect(POINTS_HUD_SOURCE.font.shadowAngle).toBe(floatValue(behaviorParameter(gameplay, font, 'Shadow Angle')));
      expect(POINTS_HUD_SOURCE.font.shadowDistance).toBe(floatValue(behaviorParameter(gameplay, font, 'Shadow Distance')));
      expect(POINTS_HUD_SOURCE.font.shadowSize).toEqual(floatValues(behaviorParameter(gameplay, font, 'Shadow Size')));
      expect(POINTS_HUD_SOURCE.font.alignment).toBe(intValue(behaviorParameter(gameplay, text, 'Alignment')));
      expect(POINTS_HUD_SOURCE.font.margins).toEqual(floatValues(behaviorParameter(gameplay, text, 'Margins')));
      expect(POINTS_HUD_SOURCE.font.screenProportional).toBe(
        (intValue(behaviorParameter(gameplay, text, 'Text Properties')) & 1) !== 0,
      );

      const fontTexture = readFileSync(fontPath);
      expect(POINTS_HUD_SOURCE.font.cellPixels).toBe(fontTexture.readUInt16LE(12) / 16);
      expect(POINTS_HUD_SOURCE.font.texturePixels).toEqual([
        fontTexture.readUInt16LE(12),
        fontTexture.readUInt16LE(14),
      ]);
      expect(HUD_SOURCE_ASPECT).toBe(4 / 3);

      const dll = readFileSync(interfacePath);
      expect(dll.includes(Buffer.from('Top-Left=5,Top=4,Top-Right=6,Left=1,Center=0,Right=2'))).toBe(true);
      expect(pointShadowOffset()[0]).toBeCloseTo(Math.SQRT2, 6);
      expect(pointShadowOffset()[1]).toBeCloseTo(Math.SQRT2, 6);
    });

    it('uses the Extrapoint glow duration', () => {
      expect(POINTS_HUD_SOURCE.glowDurationMs).toBe(floatValue(behaviorParameter(gameplay, glow, 'Duration')));
    });
  },
);
