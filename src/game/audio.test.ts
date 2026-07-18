import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { BehaviorRec, BehaviorLinkRec, NmoFile, ParameterRec, WaveSoundRec } from '../formats/ck2/types.ts';
import {
  COLLISION_SOUND_SOURCE,
  LEVEL_THEMES,
  MUSIC_SOURCE,
  ROLL_SOUND_SOURCE,
  WOODEN_FLAP_SOUND_SOURCE,
  collisionSpeedVolume,
  levelFinalMusic,
  linearVolume,
  musicVariation,
  proximityVolume,
  rollPitch,
  rollVolume,
} from './audio.ts';
import { scaleableProximityFrameDelay } from './proximity.ts';

const GAME_DIR = [
  fileURLToPath(new URL('../../Ballance_bin/Ballance', import.meta.url)),
  fileURLToPath(new URL('../../Ballance_bin/source1/Ballance', import.meta.url)),
].find(existsSync) ?? '';
const soundPath = join(GAME_DIR, '3D Entities/Sound.nmo');
const levelinitPath = join(GAME_DIR, '3D Entities/Levelinit.nmo');
const musicfilesPath = join(GAME_DIR, '3D Entities/Musicfiles.nmo');
const parameterOperationsPath = join(GAME_DIR, 'Managers/ParameterOperations.dll');

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

function stringValue(value: ParameterRec): string {
  return Buffer.from(value.valueBytes).toString('latin1').replace(/\0.*$/s, '');
}

function waveTargetName(file: NmoFile, node: BehaviorRec): string {
  const targetIndex = node.headerData.at(-2) ?? -1;
  const target = file.objects[targetIndex];
  if (target?.kind !== 'parameter') throw new Error(`missing ${node.name} target`);
  const resolved = resolve(file, target);
  return file.objects[resolved.valueObjectIndex]?.name ?? resolved.name;
}

function links(file: NmoFile, parent: string): BehaviorLinkRec[] {
  return behavior(file, parent).referenceLists
    .flat()
    .map((index) => file.objects[index])
    .filter((record): record is BehaviorLinkRec => record?.kind === 'behaviorLink');
}

describe('source-authored collision and rolling helpers', () => {
  it('normalizes collision speed against max without subtracting the minimum', () => {
    expect(collisionSpeedVolume(2.0001, 30)).toBeCloseTo(2.0001 / 30, 8);
    expect(collisionSpeedVolume(15, 15)).toBe(1);
    expect(collisionSpeedVolume(30.1, 30)).toBe(1);
    expect(collisionSpeedVolume(0, 30)).toBe(0.0001);
  });

  it('converts the flap detector output with TT_LinearVolume', () => {
    expect(linearVolume(0.01)).toBe(0);
    expect(linearVolume(0.5)).toBeCloseTo(0.02 * Math.sqrt(50), 12);
    expect(linearVolume(1)).toBe(1);
    expect(linearVolume(2)).toBe(1);
  });

  it('uses the multiplication and calculator expressions without old per-ball curves', () => {
    expect(rollVolume(0)).toBe(0);
    expect(rollVolume(10)).toBeCloseTo(0.5, 7);
    expect(rollVolume(25)).toBe(1);
    expect(rollPitch(0)).toBe(0.5);
    expect(rollPitch(20)).toBeCloseTo(0.7, 12);
  });

  it('uses the flat linear gain from TT ProximityVolumeControl', () => {
    expect(proximityVolume(0, 2, 25)).toBe(1);
    expect(proximityVolume(2, 2, 25)).toBe(1);
    expect(proximityVolume(13.5, 2, 25)).toBe(0.5);
    expect(proximityVolume(25, 2, 25)).toBe(0);
    expect(proximityVolume(100, 2, 25)).toBe(0);
  });
});

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

    it('matches all four PhysicsCollDetection surface layers', () => {
      if (!sound) return;
      const detectors = children(sound, 'Hit Sounds', 'PhysicsCollDetection');
      expect(detectors).toHaveLength(4);
      const byId = new Map(detectors.map((detector) => [integerValue(parameter(sound, detector, 'Collision ID')), detector]));
      for (const source of Object.values(COLLISION_SOUND_SOURCE)) {
        const detector = byId.get(source.collisionId);
        expect(detector).toBeDefined();
        if (!detector) continue;
        expect(floatValue(parameter(sound, detector, 'Min Speed m/s'))).toBe(source.minSpeed);
        expect(floatValue(parameter(sound, detector, 'Max Speed m/s'))).toBe(source.maxSpeed);
        expect(floatValue(parameter(sound, detector, 'Sleep afterwards'))).toBe(source.sleep);
        expect(integerValue(parameter(sound, detector, 'Use Collision ID'))).toBe(1);
      }
    });

    it('decodes all 41 CKWaveSound objects with their exact flat settings', () => {
      if (!sound) return;
      const waves = sound.objects.filter((record): record is WaveSoundRec => record.kind === 'waveSound');
      expect(waves).toHaveLength(41);
      for (const wave of waves) {
        expect(wave.waveType, wave.name).toBe(1);
        expect(wave.streaming, wave.name).toBe(false);
        expect(wave.priority, wave.name).toBe(0.5);
        expect(wave.gain, wave.name).toBe(1);
        expect(wave.pan, wave.name).toBe(0);
        expect(wave.pitch, wave.name).toBe(1);
        expect(wave.attachedEntityIndex, wave.name).toBe(-1);
        expect(wave.position, wave.name).toEqual([0, 0, 0]);
        expect(wave.direction, wave.name).toEqual([0, 0, 1]);
      }
      expect(waves.filter((wave) => wave.loop).map((wave) => wave.name)).toEqual(['Misc_Ventilator_01']);
      expect(
        Object.fromEntries(
          waves
            .filter((wave) => ['Misc_Lightning', 'Misc_StartLevel', 'Misc_Fall', 'Extra_Hit'].includes(wave.name))
            .map((wave) => [wave.name, [wave.fileName, wave.soundLengthMs]]),
        ),
      ).toEqual({
        Misc_Fall: ['Misc_Fall.wav', 5572],
        Misc_StartLevel: ['Misc_StartLevel.wav', 4248],
        Extra_Hit: ['Extra_Hit.wav', 501],
        Misc_Lightning: ['Misc_Lightning.wav', 3459],
      });
    });

    it('restarts every Simple Sound Messages wave on the source behavior tick', () => {
      if (!sound) return;
      const players = children(sound, 'Simple Sound Messages', 'Wave Player');
      expect(players).toHaveLength(11);
      expect(players.map((player) => waveTargetName(sound, player)).sort()).toEqual(
        [
          'Extra_Life_Blob',
          'Menu_click',
          'Menu_dong',
          'Menu_load',
          'Misc_Checkpoint',
          'Misc_Fall',
          'Misc_Lightning',
          'Misc_StartLevel',
          'Misc_Trafo',
          'Misc_extraball',
          'Music_Highscore Sound',
        ].sort(),
      );
      for (const player of players) {
        expect(floatValue(parameter(sound, player, 'Fade In')), player.name).toBe(0);
        expect(floatValue(parameter(sound, player, 'Fade Out')), player.name).toBe(0);
        expect(integerValue(parameter(sound, player, 'Loop')), player.name).toBe(0);
      }

      const owner = new Map<number, BehaviorRec>();
      for (const player of players) {
        for (const list of player.referenceLists) {
          for (const index of list) if (sound.objects[index]?.kind === 'behaviorIo') owner.set(index, player);
        }
      }
      const inbound = links(sound, 'Simple Sound Messages').filter((link) => owner.has(link.inputIndex));
      const playDelays = inbound
        .filter((link) => sound.objects[link.inputIndex]?.name === 'Play')
        .map((link) => link.activationDelay)
        .sort((a, b) => a - b);
      const stopDelays = inbound
        .filter((link) => sound.objects[link.inputIndex]?.name === 'Stop')
        .map((link) => link.activationDelay);
      expect(playDelays).toEqual([0, ...Array.from({ length: 10 }, () => 1)]);
      expect(stopDelays).toEqual(Array.from({ length: 11 }, () => 0));
      expect(floatValue(parameter(sound, children(sound, 'Simple Sound Messages', 'Delayer')[0], 'Time to Wait'))).toBe(
        317,
      );
    });

    it('uses flat full-volume sound instances for extras and wooden flaps', () => {
      if (!sound) return;
      const instances = [
        ...children(sound, 'HitSound Woodenflaps', 'Play Sound Instance'),
        ...children(sound, 'Extrapoint HitStart', 'Play Sound Instance'),
        ...children(sound, 'Extrapoint HitPieces', 'Play Sound Instance'),
      ];
      expect(instances).toHaveLength(6);
      for (const instance of instances) expect(integerValue(parameter(sound, instance, '2D'))).toBe(1);
      for (const graph of ['Extrapoint HitStart', 'Extrapoint HitPieces']) {
        for (const instance of children(sound, graph, 'Play Sound Instance')) {
          expect(floatValue(parameter(sound, instance, 'Volume'))).toBe(1);
        }
      }
    });

    it('uses one multiplication and the exact rolling pitch expression', () => {
      if (!sound) return;
      const control = behavior(sound, 'MultiRollSoundControl');
      const op = children(sound, control.name, 'Op')[0];
      expect(floatValue(parameter(sound, op, 'p2'))).toBe(ROLL_SOUND_SOURCE.volumeFactor);
      const operationIds = parameters(sound, op)
        .filter((entry) => entry.name === '' && entry.valueBytes.byteLength === 4)
        .map(integerValue);
      expect(operationIds).toEqual([0x38996b85, 0x334e35c2]);
      expect(stringValue(parameter(sound, children(sound, control.name, 'Calculator')[0], 'expression'))).toBe(
        '0.5+(a*0.01)',
      );
      if (existsSync(parameterOperationsPath)) {
        expect(readFileSync(parameterOperationsPath).includes(Buffer.from('Multiplication\0', 'latin1'))).toBe(true);
      }
    });

    it('uses identical 0.3-second rolling contact gates for every ball', () => {
      if (!sound) return;
      for (const graph of ['Roll Paper', 'Roll Wood/Stone']) {
        const contact = children(sound, graph, 'PhysicsContinuousContact')[0];
        expect(floatValue(parameter(sound, contact, 'Time Delay Start'))).toBe(ROLL_SOUND_SOURCE.contactDelayStart);
        expect(floatValue(parameter(sound, contact, 'Time Delay End'))).toBe(ROLL_SOUND_SOURCE.contactDelayEnd);
        expect(integerValue(parameter(sound, contact, 'Number Group Output'))).toBe(ROLL_SOUND_SOURCE.contactOutputs);
      }
    });

    it('matches the independent per-flap collision detector', () => {
      if (!sound) return;
      const detector = children(sound, 'HitSound Woodenflaps', 'PhysicsCollDetection')[0];
      expect(floatValue(parameter(sound, detector, 'Min Speed m/s'))).toBe(WOODEN_FLAP_SOUND_SOURCE.minSpeed);
      expect(floatValue(parameter(sound, detector, 'Max Speed m/s'))).toBe(WOODEN_FLAP_SOUND_SOURCE.maxSpeed);
      expect(floatValue(parameter(sound, detector, 'Sleep afterwards'))).toBe(WOODEN_FLAP_SOUND_SOURCE.sleep);
      expect(integerValue(parameter(sound, detector, 'Use Collision ID'))).toBe(0);
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
