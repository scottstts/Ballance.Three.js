import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { Entity2dRec, NmoFile } from '../formats/ck2/types.ts';
import { atlasCropFromUv } from './hudLayout.ts';
import {
  CONFIRM_RECTS,
  CREDITS_FONT_SOURCE,
  CREDITS_LOGO_UV,
  CREDITS_RECTS,
  CREDITS_TIMING,
  HIGHSCORE_ENTRY_RECTS,
  HIGHSCORE_RECTS,
  LARGE_MENU_BUTTON_RECTS,
  LEVEL_BUTTON_RECTS,
  MENU_ATLAS_UV_SOURCE,
  MENU_BACK_RECT,
  MENU_BAND_RECT,
  OPTIONS_RECTS,
  SCORE_RECTS,
  creditTextWait,
  decodeCreditBlocks,
} from './menuLayout.ts';

const menuPath = fileURLToPath(
  new URL('../../Ballance_bin/source1/Ballance/3D Entities/Menu.nmo', import.meta.url),
);

function entity2d(file: NmoFile, name: string): Entity2dRec {
  const entity = file.byName.get(name)?.find((record): record is Entity2dRec => record.kind === 'entity2d');
  if (!entity) throw new Error(`missing source 2D entity ${name}`);
  return entity;
}

function materialName(file: NmoFile, name: string): string | undefined {
  return file.objects[entity2d(file, name).materialIndex]?.name;
}

describe.skipIf(!existsSync(menuPath))('source-authored menu layout', () => {
  const menu = parseNmo(readFileSync(menuPath));

  it('uses the source black band and large/back button rectangles', () => {
    expect(MENU_BAND_RECT).toEqual(entity2d(menu, 'M_BlackScreen').rect);
    for (let index = 0; index < LARGE_MENU_BUTTON_RECTS.length; index++) {
      expect(LARGE_MENU_BUTTON_RECTS[index]).toEqual(entity2d(menu, `M_Main_But_${index + 1}`).rect);
    }
    expect(MENU_BACK_RECT).toEqual(entity2d(menu, 'M_Pause_But_Back').rect);
  });

  it('uses all twelve single-column source level rectangles', () => {
    expect(LEVEL_BUTTON_RECTS).toHaveLength(12);
    for (let index = 0; index < LEVEL_BUTTON_RECTS.length; index++) {
      expect(LEVEL_BUTTON_RECTS[index]).toEqual(
        entity2d(menu, `M_Start_But_${String(index + 1).padStart(2, '0')}`).rect,
      );
    }
  });

  it('uses the complete highscore, confirmation, and score-field geometry', () => {
    expect(HIGHSCORE_RECTS.title).toEqual(entity2d(menu, 'M_Highscore_Title').rect);
    expect(HIGHSCORE_RECTS.previous).toEqual(entity2d(menu, 'M_Highscore_But_1').rect);
    expect(HIGHSCORE_RECTS.next).toEqual(entity2d(menu, 'M_Highscore_But_2').rect);
    expect(HIGHSCORE_RECTS.exit).toEqual(entity2d(menu, 'M_Highscore_But_Back').rect);
    for (let index = 0; index < HIGHSCORE_RECTS.rows.length; index++) {
      expect(HIGHSCORE_RECTS.rows[index]).toEqual(
        entity2d(menu, `M_Highscore_Place${String(index + 1).padStart(2, '0')}`).rect,
      );
    }

    expect(CONFIRM_RECTS.question).toEqual(entity2d(menu, 'M_YesNo_TextSprite').rect);
    expect(CONFIRM_RECTS.yes).toEqual(entity2d(menu, 'M_YesNo_But_Yes').rect);
    expect(CONFIRM_RECTS.no).toEqual(entity2d(menu, 'M_YesNo_But_No').rect);

    expect(HIGHSCORE_ENTRY_RECTS.title).toEqual(entity2d(menu, 'M_HighEntry_Title').rect);
    expect(HIGHSCORE_ENTRY_RECTS.score).toEqual(entity2d(menu, 'M_HighEntry_Score').rect);
    expect(HIGHSCORE_ENTRY_RECTS.name).toEqual(entity2d(menu, 'M_HighEntry_NameEntry').rect);
    expect(HIGHSCORE_ENTRY_RECTS.confirm).toEqual(entity2d(menu, 'M_HighEntry_But_1').rect);

    expect(SCORE_RECTS.field).toEqual(entity2d(menu, 'M_Score_Field').rect);
    expect(SCORE_RECTS.highlight).toEqual(entity2d(menu, 'M_Score_Highlight').rect);
    expect(SCORE_RECTS.line).toEqual(entity2d(menu, 'M_Score_Line').rect);
    for (let index = 0; index < 4; index++) {
      expect(SCORE_RECTS.labels[index]).toEqual(entity2d(menu, `M_Score_Text${index + 1}`).rect);
      expect(SCORE_RECTS.values[index]).toEqual(entity2d(menu, `M_Score_Score${index + 1}`).rect);
    }
  });

  it('uses the serialized options and credits rectangles', () => {
    expect(OPTIONS_RECTS.title).toEqual(entity2d(menu, 'M_Options_Title').rect);
    expect(OPTIONS_RECTS.back).toEqual(entity2d(menu, 'M_Options_But_Back').rect);
    for (let index = 0; index < OPTIONS_RECTS.rootButtons.length; index++) {
      expect(OPTIONS_RECTS.rootButtons[index]).toEqual(entity2d(menu, `M_Options_But_${index + 1}`).rect);
    }
    expect(OPTIONS_RECTS.graphics.resolutionField).toEqual(entity2d(menu, 'M_Opt_Gra_ResField').rect);
    expect(OPTIONS_RECTS.graphics.syncField).toEqual(entity2d(menu, 'M_Opt_Graph_SynchField').rect);
    expect(OPTIONS_RECTS.graphics.cloudsField).toEqual(entity2d(menu, 'M_Opt_Gra_CloudsField').rect);
    for (let index = 0; index < OPTIONS_RECTS.controls.fields.length; index++) {
      expect(OPTIONS_RECTS.controls.fields[index]).toEqual(entity2d(menu, `M_Opt_Keys_Field${index + 1}`).rect);
    }
    expect(OPTIONS_RECTS.controls.invertField).toEqual(entity2d(menu, 'M_Opt_Keys_Inv_Field').rect);
    expect(OPTIONS_RECTS.sound.field).toEqual(entity2d(menu, 'M_Opt_Sound_VolField').rect);
    expect(CREDITS_RECTS.text).toEqual(entity2d(menu, 'M_Credits_Text').rect);
    expect(CREDITS_RECTS.back).toEqual(entity2d(menu, 'M_Credits_But_Back').rect);
    expect(CREDITS_RECTS.logo1).toEqual(entity2d(menu, 'M_Credits_Logo1').rect);
    expect(CREDITS_RECTS.logo2).toEqual(entity2d(menu, 'M_Credits_Logo2').rect);
    expect(CREDITS_LOGO_UV.logo1).toEqual(entity2d(menu, 'M_Credits_Logo1').relativeRect);
    expect(CREDITS_LOGO_UV.logo2).toEqual(entity2d(menu, 'M_Credits_Logo2').relativeRect);
  });

  it('reads all credit pages verbatim and follows the Text Fader wait expression', () => {
    const credits = decodeCreditBlocks(menu);
    expect(credits).toHaveLength(23);
    expect(credits[0]).toEqual({
      title: '\nBallance',
      copy: '\n\n\n\nA Cyparade production\n\nAll rights reserved.\n Berlin 2004.',
    });
    expect(credits[13].copy).toContain('Annette Weinberg, \nLaura and Adrian');
    expect(creditTextWait(credits[0], 0)).toBe(
      credits[0].copy.length * CREDITS_TIMING.textMillisecondsPerCharacter - 500,
    );
    expect(creditTextWait(credits[1], 1)).toBe(
      credits[1].copy.length * CREDITS_TIMING.textMillisecondsPerCharacter + 1500,
    );
    expect(CREDITS_TIMING.logo1FadeIn + CREDITS_TIMING.logo1Wait + CREDITS_TIMING.logo1FadeOut).toBe(5000);
    expect(CREDITS_TIMING.logo2FadeIn + CREDITS_TIMING.logo2Wait + CREDITS_TIMING.logo2FadeOut).toBe(6500);
    expect(CREDITS_FONT_SOURCE.titleScale).toEqual([0.6000000238418579, 0.6499999761581421]);
    expect(CREDITS_FONT_SOURCE.copyScale).toEqual([0.4000000059604645, 0.44999998807907104]);
    expect(CREDITS_FONT_SOURCE.shadowAlpha).toBe(0.501960813999176);
    expect(CREDITS_FONT_SOURCE.shadowAngle).toBe(2.094395160675049);
    expect(CREDITS_FONT_SOURCE.shadowDistance).toBe(4);
  });

  it('crops every shared menu sprite from the serialized UV rectangles', () => {
    expect(MENU_ATLAS_UV_SOURCE.buttonLarge).toEqual(entity2d(menu, 'M_Main_But_1').relativeRect);
    expect(MENU_ATLAS_UV_SOURCE.buttonMedium).toEqual(entity2d(menu, 'M_Pause_But_Back').relativeRect);
    expect(MENU_ATLAS_UV_SOURCE.levelButton).toEqual(entity2d(menu, 'M_Start_But_01').relativeRect);
    expect(MENU_ATLAS_UV_SOURCE.highscoreRow).toEqual(entity2d(menu, 'M_Highscore_Place01').relativeRect);
    expect(MENU_ATLAS_UV_SOURCE.highscorePrevious).toEqual(entity2d(menu, 'M_Highscore_But_1').relativeRect);
    expect(MENU_ATLAS_UV_SOURCE.highscoreNext).toEqual(entity2d(menu, 'M_Highscore_But_2').relativeRect);
    expect(MENU_ATLAS_UV_SOURCE.confirmSmall).toEqual(entity2d(menu, 'M_YesNo_But_Yes').relativeRect);
    expect(MENU_ATLAS_UV_SOURCE.optionField).toEqual(entity2d(menu, 'M_Opt_Gra_ResField').relativeRect);
    expect(MENU_ATLAS_UV_SOURCE.keyField).toEqual(entity2d(menu, 'M_Opt_Keys_Field1').relativeRect);
    expect(MENU_ATLAS_UV_SOURCE.arrowLeft).toEqual(entity2d(menu, 'M_Opt_Gra_ResButLeft').relativeRect);
    expect(MENU_ATLAS_UV_SOURCE.arrowRight).toEqual(entity2d(menu, 'M_Opt_Gra_ResButRight').relativeRect);
    expect(MENU_ATLAS_UV_SOURCE.scoreHighlight).toEqual(entity2d(menu, 'M_Score_Highlight').relativeRect);
    expect(MENU_ATLAS_UV_SOURCE.scoreLine).toEqual(entity2d(menu, 'M_Score_Line').relativeRect);

    expect(materialName(menu, 'M_Main_But_1')).toBe('M_Button_Up');
    expect(materialName(menu, 'M_Start_But_01')).toBe('M_Button_Inactive');
    expect(materialName(menu, 'M_Highscore_Place01')).toBe('M_Button_Inactive');
    expect(materialName(menu, 'M_YesNo_But_Yes')).toBe('M_Button_Inactive');

    expect(atlasCropFromUv(MENU_ATLAS_UV_SOURCE.buttonLarge)).toEqual({ x: 0, y: 131, w: 256, h: 60 });
    expect(atlasCropFromUv(MENU_ATLAS_UV_SOURCE.buttonMedium)).toEqual({ x: 61, y: 192, w: 161, h: 60 });
    expect(atlasCropFromUv(MENU_ATLAS_UV_SOURCE.levelButton)).toEqual({ x: 0, y: 63, w: 166, h: 32 });
    expect(atlasCropFromUv(MENU_ATLAS_UV_SOURCE.highscoreRow)).toEqual({ x: 0, y: 16, w: 256, h: 28 });
  });
});
