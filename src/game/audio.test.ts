import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { BehaviorRec, NmoFile, ParameterRec } from '../formats/ck2/types.ts';
import { LEVEL_THEMES, MUSIC_SOURCE, levelFinalMusic, musicVariation } from './audio.ts';
import { scaleableProximityFrameDelay } from './proximity.ts';

const GAME_DIR = [
  fileURLToPath(new URL('../../Ballance_bin/Ballance', import.meta.url)),
  fileURLToPath(new URL('../../Ballance_bin/source1/Ballance', import.meta.url)),
].find(existsSync) ?? '';
const soundPath = join(GAME_DIR, '3D Entities/Sound.nmo');
const levelinitPath = join(GAME_DIR, '3D Entities/Levelinit.nmo');
const musicfilesPath = join(GAME_DIR, '3D Entities/Musicfiles.nmo');

function behavior(file: NmoFile, name: string): BehaviorRec {
  const found = file.objects.find(
    (record): record is BehaviorRec => record.kind === 'behavior' && record.name === name,
  );
  if (!found) throw new Error(`missing source behavior ${name}`);
  return found;
}

function children(file: NmoFile, parent: string, name: string): BehaviorRec[] {
  return behavior(file, parent).referenceLists
    .flat()
    .map((index) => file.objects[index])
    .filter((record): record is BehaviorRec => record?.kind === 'behavior' && record.name === name);
}

function resolve(file: NmoFile, parameter: ParameterRec): ParameterRec {
  let current = parameter;
  const seen = new Set([current.index]);
  for (let depth = 0; depth < 32; depth++) {
    const nextIndex = current.sourceIndex >= 0 ? current.sourceIndex : current.sharedIndex;
    if (nextIndex < 0 || seen.has(nextIndex)) break;
    const next = file.objects[nextIndex];
    if (next?.kind !== 'parameter') break;
    seen.add(nextIndex);
    current = next;
  }
  return current;
}

function parameters(file: NmoFile, node: BehaviorRec): ParameterRec[] {
  return node.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .filter((record): record is ParameterRec => record?.kind === 'parameter');
}

function parameter(file: NmoFile, node: BehaviorRec, name: string): ParameterRec {
  const found = parameters(file, node).find((entry) => entry.name === name);
  if (!found) throw new Error(`missing ${node.name}.${name}`);
  return resolve(file, found);
}

function floatValue(value: ParameterRec): number {
  return new DataView(value.valueBytes.buffer, value.valueBytes.byteOffset).getFloat32(0, true);
}

function integerValue(value: ParameterRec): number {
  return new DataView(value.valueBytes.buffer, value.valueBytes.byteOffset).getInt32(0, true);
}

describe('source-authored music helpers', () => {
  it('uses all three equal variations and permits an immediate repeat', () => {
    expect([musicVariation(0), musicVariation(0.34), musicVariation(0.99)]).toEqual([1, 2, 3]);
    expect(musicVariation(0.5)).toBe(musicVariation(0.5));
  });

  it('selects one mutually-exclusive final wave', () => {
    expect(levelFinalMusic(1)).toBe('Music_Final.wav');
    expect(levelFinalMusic(11)).toBe('Music_Final.wav');
    expect(levelFinalMusic(12)).toBe('Music_LastFinal.wav');
  });

  it('scales the last-stage sampler deterministically from 5 to 20 frames', () => {
    const spec = {
      distance: MUSIC_SOURCE.lastStageDistance,
      exactnessMinDistance: MUSIC_SOURCE.lastStageExactnessMinDistance,
      exactnessMaxDistance: MUSIC_SOURCE.lastStageExactnessMaxDistance,
      minimumFrameDelay: MUSIC_SOURCE.lastStageMinFrameDelay,
      maximumFrameDelay: MUSIC_SOURCE.lastStageMaxFrameDelay,
      initialFrameDelay: MUSIC_SOURCE.lastStageInitialFrameDelay,
      axes: 7,
      squaredDistance: false,
    };
    expect(scaleableProximityFrameDelay(200, spec)).toBe(5);
    expect(scaleableProximityFrameDelay(225, spec)).toBe(12);
    expect(scaleableProximityFrameDelay(250, spec)).toBe(20);
  });
});

describe.skipIf(!existsSync(soundPath) || !existsSync(levelinitPath) || !existsSync(musicfilesPath))(
  'original music binary authority',
  () => {
    const sound = existsSync(soundPath) ? parseNmo(readFileSync(soundPath)) : null;
    const levelinit = existsSync(levelinitPath) ? parseNmo(readFileSync(levelinitPath)) : null;
    const musicfiles = existsSync(musicfilesPath) ? parseNmo(readFileSync(musicfilesPath)) : null;

    it('derives every level theme from Levelinit.nmo/AllLevel', () => {
      if (!levelinit) return;
      const levels = levelinit.byName.get('AllLevel')?.find((record) => record.kind === 'dataArray');
      expect(levels?.kind).toBe('dataArray');
      if (levels?.kind !== 'dataArray') return;
      expect(levels.columns[7]?.name).toBe('Music');
      expect(Object.values(LEVEL_THEMES)).toEqual(levels.rows.map((row) => Number(row[7])));
    });

    it('runs independent 0..15 s atmosphere and 0..50 s theme graphs', () => {
      if (!sound) return;
      const atmoRandom = children(sound, 'Music_Atmo', 'Random')[0];
      const themeRandom = children(sound, 'Music_Theme', 'Random')[0];
      expect(floatValue(parameter(sound, atmoRandom, 'Min')) / 1000).toBe(MUSIC_SOURCE.atmoDelayMin);
      expect(floatValue(parameter(sound, atmoRandom, 'Max')) / 1000).toBe(MUSIC_SOURCE.atmoDelayMax);
      expect(floatValue(parameter(sound, themeRandom, 'Min')) / 1000).toBe(MUSIC_SOURCE.themeDelayMin);
      expect(floatValue(parameter(sound, themeRandom, 'Max')) / 1000).toBe(MUSIC_SOURCE.themeDelayMax);

      for (const graph of ['Music_Atmo', 'Music_Theme']) {
        const selector = children(sound, graph, 'Random Switch')[0];
        expect(['Coef 1', 'Coef 2', 'Coef 3'].map((name) => floatValue(parameter(sound, selector, name)))).toEqual([
          1, 1, 1,
        ]);
        expect(integerValue(parameter(sound, selector, 'Forbid twice the same'))).toBe(0);
      }

      const startup = children(sound, 'Music_Manager', 'Delayer')[0];
      expect(floatValue(parameter(sound, startup, 'Time to Wait')) / 1000).toBe(MUSIC_SOURCE.themeActivationDelay);
    });

    it('uses exact one-second group fades', () => {
      if (!sound) return;
      for (const graph of ['Fade In Music', 'Fade Out Music']) {
        const progression = children(sound, graph, 'Linear Progression')[0];
        expect(floatValue(parameter(sound, progression, 'Duration')) / 1000).toBe(MUSIC_SOURCE.fadeDuration);
      }
    });

    it('stops only the theme at the last checkpoint and keeps atmosphere independent', () => {
      if (!sound) return;
      const manager = behavior(sound, 'Music_Manager');
      const ioOwner = new Map<number, BehaviorRec>();
      for (const record of sound.objects) {
        if (record.kind !== 'behavior') continue;
        for (const list of record.referenceLists) {
          for (const index of list) if (sound.objects[index]?.kind === 'behaviorIo') ioOwner.set(index, record);
        }
      }
      const edges = manager.referenceLists
        .flat()
        .map((index) => sound.objects[index])
        .filter((record) => record?.kind === 'behaviorLink')
        .map((link) => {
          if (link.kind !== 'behaviorLink') return '';
          const output = sound.objects[link.outputIndex];
          const input = sound.objects[link.inputIndex];
          return `${ioOwner.get(link.outputIndex)?.name}.${output?.name}->${ioOwner.get(link.inputIndex)?.name}.${input?.name}`;
        });
      expect(edges).toContain('get lastStage.Out 0->Music_Atmo.On');
      expect(edges).toContain('Delayer.Out->Music_Theme.On');
      expect(edges).toContain('Last Stage.Last Checkpoint->Music_Theme.Off');
      expect(edges.some((edge) => edge.includes('Last Checkpoint->Music_Atmo.Off'))).toBe(false);
    });

    it('matches Last Stage loop, strict proximity sampler, and final selector', () => {
      if (!sound) return;
      const proximity = children(sound, 'Last Stage', 'TT Scaleable Proximity')[0];
      expect(floatValue(parameter(sound, proximity, 'Distance'))).toBe(MUSIC_SOURCE.lastStageDistance);
      expect(floatValue(parameter(sound, proximity, 'Exactness min. Distance'))).toBe(
        MUSIC_SOURCE.lastStageExactnessMinDistance,
      );
      expect(floatValue(parameter(sound, proximity, 'Exactness max. Distance'))).toBe(
        MUSIC_SOURCE.lastStageExactnessMaxDistance,
      );
      expect(integerValue(parameter(sound, proximity, 'Minimum Framedelay'))).toBe(
        MUSIC_SOURCE.lastStageMinFrameDelay,
      );
      expect(integerValue(parameter(sound, proximity, 'Maximum Framedelay'))).toBe(
        MUSIC_SOURCE.lastStageMaxFrameDelay,
      );
      expect(integerValue(parameter(sound, proximity, ''))).toBe(MUSIC_SOURCE.lastStageInitialFrameDelay);
      expect(integerValue(parameter(sound, proximity, 'Check Axis:'))).toBe(7);
      expect(integerValue(parameter(sound, proximity, 'Squared Distance?'))).toBe(0);
      const ambient = children(sound, 'Last Stage', 'Wave Player')[0];
      expect(integerValue(parameter(sound, ambient, 'Loop'))).toBe(1);

      const endSelector = children(sound, 'Play EndMusic', 'Test')[0];
      expect(integerValue(parameter(sound, endSelector, 'Test'))).toBe(1); // Comparison Operator: Equal
      expect(sound.byName.has('Music_Final Sound')).toBe(true);
      expect(sound.byName.has('Music_LastFinal Sound')).toBe(true);
    });

    it('loads the exact flat music group shipped by Musicfiles.nmo', () => {
      if (!musicfiles) return;
      const group = musicfiles.groups.find((entry) => entry.name === 'All_Musicfiles');
      expect(group).toBeDefined();
      const names = group?.memberIndices.map((index) => musicfiles.objects[index]?.name).sort();
      expect(names).toEqual(
        ['Music_Atmo_1', 'Music_Atmo_2', 'Music_Atmo_3', 'Music_EndCheckpoint', 'Music_Final', 'Music_Highscore'].sort(),
      );
    });
  },
);
