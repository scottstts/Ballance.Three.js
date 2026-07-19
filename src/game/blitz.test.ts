import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { BehaviorLinkRec, BehaviorRec, NmoFile, ParameterRec } from '../formats/ck2/types.ts';
import { BLITZ_SOURCE, BlitzSystem } from './blitz.ts';
import { decodeCk2dCurve, evalCurve } from './curve.ts';

const GAME_DIR = [
  fileURLToPath(new URL('../../Ballance_bin/Ballance', import.meta.url)),
  fileURLToPath(new URL('../../Ballance_bin/source1/Ballance', import.meta.url)),
].find(existsSync) ?? '';
const gameplayPath = join(GAME_DIR, '3D Entities/Gameplay.nmo');
const soundPath = join(GAME_DIR, '3D Entities/Sound.nmo');

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

function parameter(file: NmoFile, node: BehaviorRec, name: string): ParameterRec {
  const found = node.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .find((record): record is ParameterRec => record?.kind === 'parameter' && record.name === name);
  if (!found) throw new Error(`missing ${node.name}.${name}`);
  return resolve(file, found);
}

function floatValue(value: ParameterRec): number {
  return new DataView(value.valueBytes.buffer, value.valueBytes.byteOffset).getFloat32(0, true);
}

function links(file: NmoFile, parent: string): BehaviorLinkRec[] {
  return behavior(file, parent).referenceLists
    .flat()
    .map((index) => file.objects[index])
    .filter((record): record is BehaviorLinkRec => record?.kind === 'behaviorLink');
}

describe('ambient blitz scheduler', () => {
  it('runs the hidden double flash, delayed thunder, and sampled repeat timer', () => {
    const scene = new THREE.Scene();
    const thunder = vi.fn();
    const blitz = new BlitzSystem(scene, thunder, () => 0);

    expect(blitz.light.visible).toBe(false);
    expect(blitz.light.position.toArray()).toEqual([...BLITZ_SOURCE.position]);
    blitz.update(3.999);
    expect(blitz.debugState().visible).toBe(false);

    blitz.update(0.001);
    expect(blitz.debugState()).toMatchObject({ visible: true, flashElapsed: 0, nextFlash: 10 });
    expect(blitz.light.color.r).toBe(0);

    blitz.update(0.1);
    expect(blitz.light.color.r).toBeCloseTo(evalCurve(BLITZ_SOURCE.colorCurve, 0.5), 12);
    expect(thunder).not.toHaveBeenCalled();
    blitz.update(0.05);
    expect(thunder).toHaveBeenCalledOnce();
    expect(blitz.light.visible).toBe(true);
    blitz.update(0.05);
    expect(blitz.debugState()).toMatchObject({ visible: false, flashElapsed: null });
    expect(blitz.debugState().nextFlash).toBeCloseTo(9.8, 12);
    expect(blitz.light.color.r).toBe(0);

    blitz.update(9.8);
    expect(blitz.light.visible).toBe(true);
    expect(thunder).toHaveBeenCalledOnce();
  });

  it('freezes when it is not updated and maps the random endpoint to 90 seconds', () => {
    const scene = new THREE.Scene();
    const blitz = new BlitzSystem(scene, () => {}, () => 1);
    blitz.update(2);
    const paused = blitz.debugState();
    expect(blitz.debugState()).toEqual(paused);
    blitz.update(2);
    expect(blitz.debugState()).toMatchObject({ visible: true, nextFlash: 90 });
    blitz.dispose();
    expect(scene.getObjectByName('Light_Blitz')).toBeUndefined();
  });
});

describe.skipIf(!existsSync(gameplayPath) || !existsSync(soundPath))('original Gameplay_Blitz binary authority', () => {
  const gameplay = existsSync(gameplayPath) ? parseNmo(readFileSync(gameplayPath)) : null;
  const sound = existsSync(soundPath) ? parseNmo(readFileSync(soundPath)) : null;

  it('matches the hidden non-specular directional light and its authored transform', () => {
    if (!gameplay) return;
    const light = gameplay.byName.get('Light_Blitz')?.find((record) => record.kind === 'light');
    expect(light?.kind).toBe('light');
    if (light?.kind !== 'light') return;
    expect(light.visible).toBe(false);
    expect(light.lightType).toBe(3);
    expect(light.active).toBe(true);
    expect(light.specularFlag).toBe(false);
    expect(light.color).toEqual([1, 1, 1, 1]);
    expect(light.range).toBe(BLITZ_SOURCE.range);
    expect(light.lightPower).toBe(BLITZ_SOURCE.power);
    expect([light.entity.worldMatrix[12], light.entity.worldMatrix[13], -light.entity.worldMatrix[14]]).toEqual([
      ...BLITZ_SOURCE.position,
    ]);
    expect([light.entity.worldMatrix[8], light.entity.worldMatrix[9], -light.entity.worldMatrix[10]]).toEqual([
      ...BLITZ_SOURCE.direction,
    ]);
  });

  it('matches both timers, the exact eight-key curve, and the light target', () => {
    if (!gameplay) return;
    const delayers = children(gameplay, 'Gameplay_Blitz', 'Delayer');
    expect(delayers.map((node) => floatValue(parameter(gameplay, node, 'Time to Wait')) / 1000).sort()).toEqual([
      BLITZ_SOURCE.thunderDelay,
      BLITZ_SOURCE.initialDelay,
    ]);
    const random = children(gameplay, 'Gameplay_Blitz', 'Random')[0];
    expect(floatValue(parameter(gameplay, random, 'Min')) / 1000).toBe(BLITZ_SOURCE.intervalMin);
    expect(floatValue(parameter(gameplay, random, 'Max')) / 1000).toBe(BLITZ_SOURCE.intervalMax);

    const progression = children(gameplay, 'Gameplay_Blitz', 'Bezier Progression')[0];
    expect(floatValue(parameter(gameplay, progression, 'Duration')) / 1000).toBe(BLITZ_SOURCE.flashDuration);
    expect(decodeCk2dCurve(parameter(gameplay, progression, 'Progression Curve').valueBytes)).toEqual(
      BLITZ_SOURCE.colorCurve,
    );

    const setColor = children(gameplay, 'Gameplay_Blitz', 'Set Light Color')[0];
    const target = gameplay.objects[setColor.headerData.at(-2) ?? -1];
    expect(target?.kind).toBe('parameter');
    if (target?.kind !== 'parameter') return;
    const resolvedTarget = resolve(gameplay, target);
    expect(gameplay.objects[resolvedTarget.valueObjectIndex]?.name).toBe('Light_Blitz');
  });

  it('routes Donner to the flat thunder wave with stop-now/play-next-frame edges', () => {
    if (!sound) return;
    const wavePlayer = children(sound, 'Donner', 'Wave Player')[0];
    const targetIndex = wavePlayer.headerData.at(-2) ?? -1;
    const target = sound.objects[targetIndex];
    expect(target?.kind).toBe('parameter');
    if (target?.kind === 'parameter') {
      expect(resolve(sound, target).name).toBe('Music_thunder Sound');
    }
    const byInput = new Map(
      links(sound, 'Donner').map((link) => [sound.objects[link.inputIndex]?.name, link.activationDelay]),
    );
    expect(byInput.get('Stop')).toBe(0);
    expect(byInput.get('Play')).toBe(1);
    // Unlike the 41 preloaded waves, thunder is created dynamically from this
    // parameter/file pair when the group receives Donner.
    expect(existsSync(join(GAME_DIR, 'Sounds/Music_thunder.wav'))).toBe(true);
  });

  it('activates only on the last level through letzer Level?', () => {
    if (!gameplay) return;
    // Gameplay_Ingame/activate Scripts runs `letzer Level?`: Get Cell reads
    // CurrentLevel[0][0] and Test mode 1 (==) compares it against the
    // AllLevel row count before the one conditional Activate Script - the
    // blitz exists only on level 12.
    const gate = behavior(gameplay, 'letzer Level?');
    const test = gate.referenceLists
      .flat()
      .map((index) => gameplay.objects[index])
      .find((record): record is BehaviorRec => record?.kind === 'behavior' && record.name === 'Test');
    expect(test).toBeDefined();
    if (!test) return;
    const view = parameter(gameplay, test, 'Test');
    expect(new DataView(view.valueBytes.buffer, view.valueBytes.byteOffset).getInt32(0, true)).toBe(1);
    const getCell = gate.referenceLists
      .flat()
      .map((index) => gameplay.objects[index])
      .find((record): record is BehaviorRec => record?.kind === 'behavior' && record.name === 'Get Cell');
    expect(getCell).toBeDefined();
    if (!getCell) return;
    const column = parameter(gameplay, getCell, 'Column Index');
    expect(new DataView(column.valueBytes.buffer, column.valueBytes.byteOffset).getInt32(0, true)).toBe(0);
  });
});
