import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { BehaviorLinkRec, BehaviorRec, NmoFile, ParameterRec } from '../formats/ck2/types.ts';
import {
  FINISH_HANDOFF_FRAME_DELAY,
  LEVEL_START_LIVES,
  LEVEL_START_POINTS,
  LIFE_BONUS_POINTS,
  POINT_COUNT_INTERVAL,
} from './constants.ts';
import { advancePointCountdown } from './energy.ts';

const gameplayPath = fileURLToPath(
  new URL('../../Ballance_bin/source1/Ballance/3D Entities/Gameplay.nmo', import.meta.url),
);

function behavior(file: NmoFile, name: string): BehaviorRec {
  const result = file.byName.get(name)?.find((record): record is BehaviorRec => record.kind === 'behavior');
  if (!result) throw new Error(`missing source behavior ${name}`);
  return result;
}

function children(file: NmoFile, parent: BehaviorRec, name: string): BehaviorRec[] {
  return parent.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .filter(
      (record): record is BehaviorRec => record?.kind === 'behavior' && (name === '' || record.name === name),
    );
}

function parameters(file: NmoFile, owner: BehaviorRec): ParameterRec[] {
  return owner.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .filter((record): record is ParameterRec => record?.kind === 'parameter');
}

function resolve(file: NmoFile, parameter: ParameterRec): ParameterRec {
  let current = parameter;
  const seen = new Set([current.index]);
  for (let depth = 0; depth < 32; depth++) {
    const nextIndex = current.sourceIndex >= 0 ? current.sourceIndex : current.sharedIndex;
    if (nextIndex < 0 || seen.has(nextIndex)) break;
    const next = file.objects[nextIndex];
    if (next?.kind !== 'parameter') break;
    current = next;
    seen.add(current.index);
  }
  return current;
}

function intValue(parameter: ParameterRec): number {
  return new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset).getInt32(0, true);
}

function messageName(file: NmoFile, owner: BehaviorRec): string | null {
  const message = parameters(file, owner)
    .map((parameter) => resolve(file, parameter))
    .find((parameter) => parameter.managerInt !== null);
  return message?.managerInt === null || message === undefined ? null : file.messageTypes[message.managerInt];
}

function graphLinks(file: NmoFile, parent: BehaviorRec): BehaviorLinkRec[] {
  return parent.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .filter((record): record is BehaviorLinkRec => record?.kind === 'behaviorLink');
}

function ioOwners(file: NmoFile, parent: BehaviorRec): Map<number, BehaviorRec> {
  const result = new Map<number, BehaviorRec>();
  for (const node of children(file, parent, '')) {
    for (const index of node.referenceLists.flat()) {
      if (file.objects[index]?.kind === 'behaviorIo') result.set(index, node);
    }
  }
  return result;
}

describe('point countdown', () => {
  it('preserves a partial 500 ms interval across inactive time', () => {
    let state = advancePointCountdown({ points: 1000, remainder: 0 }, 0.49, true);
    expect(state).toEqual({ points: 1000, remainder: 0.49 });
    state = advancePointCountdown(state, 5, false);
    expect(state).toEqual({ points: 1000, remainder: 0.49 });
    state = advancePointCountdown(state, 0.01, true);
    expect(state.points).toBe(999);
    expect(state.remainder).toBeCloseTo(0, 12);
  });

  it('catches up whole intervals and never subtracts below zero', () => {
    expect(advancePointCountdown({ points: 2, remainder: 0.25 }, 2, true)).toEqual({
      points: 0,
      remainder: 0.25,
    });
  });
});

describe.skipIf(!existsSync(gameplayPath))('Gameplay_Energy binary authority', () => {
  const file = existsSync(gameplayPath) ? parseNmo(readFileSync(gameplayPath)) : null;

  it('owns the start values, countdown interval, and reserve bonus', () => {
    if (!file) return;
    const energy = file.byName.get('Energy')?.find((record) => record.kind === 'dataArray');
    expect(energy?.kind).toBe('dataArray');
    if (energy?.kind !== 'dataArray') return;
    expect(energy.columns.map((column) => column.name)).toEqual([
      'Points',
      'Lifes',
      'StartPoints',
      'StartLifes',
      'Timefactor',
      'LifeBonus',
    ]);
    expect(energy.rows[0]).toEqual([
      0,
      0,
      LEVEL_START_POINTS,
      LEVEL_START_LIVES,
      POINT_COUNT_INTERVAL * 1000,
      LIFE_BONUS_POINTS,
    ]);
  });

  it('pauses and resumes TT_Timer only through the four authored messages', () => {
    if (!file) return;
    const energy = behavior(file, 'Gameplay_Energy');
    const switcher = children(file, energy, 'Switch On Message')[0];
    const messages = parameters(file, switcher)
      .filter((parameter) => parameter.name.startsWith('Message '))
      .map((parameter) => resolve(file, parameter))
      .map((parameter) => (parameter.managerInt === null ? null : file.messageTypes[parameter.managerInt]));
    expect(messages).toEqual(['Pause Level', 'Counter inactive', 'Unpause Level', 'Counter active']);

    const deactivate = behavior(file, 'Deactivate Ball');
    expect(children(file, deactivate, 'Send Message').map((node) => messageName(file, node))).toContain(
      'Counter inactive',
    );
    const newBall = behavior(file, 'New Ball');
    expect(children(file, newBall, 'Send Message').map((node) => messageName(file, node))).toContain(
      'Counter active',
    );
  });

  it('uses >= 500 ms and != 0 before subtracting a point', () => {
    if (!file) return;
    const energy = behavior(file, 'Gameplay_Energy');
    const timer = children(file, energy, 'Timer')[0];
    const tests = children(file, timer, 'Test');
    const modes = tests.map((node) => {
      const mode = parameters(file, node).find((parameter) => parameter.name === 'Test');
      if (!mode) throw new Error('missing source Timer/Test mode');
      return intValue(resolve(file, mode));
    });
    expect(modes).toEqual([6, 2]); // >= elapsed threshold, then != zero points
  });

  it('keeps the counter live for the two-frame Level_Finish handoff', () => {
    if (!file) return;
    const events = behavior(file, 'Gameplay_Events');
    const nodes = events.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .filter((record): record is BehaviorRec => record?.kind === 'behavior');
    const links = graphLinks(file, events);
    const owners = ioOwners(file, events);
    const counterSenders = nodes.filter(
      (node) => node.name === 'Send Message' && messageName(file, node) === 'Counter inactive',
    );
    const finishCounter = counterSenders.find((node) =>
      links.some(
        (link) => owners.get(link.outputIndex)?.index === node.index && owners.get(link.inputIndex)?.name === 'Set Parent',
      ),
    );
    expect(finishCounter).toBeDefined();
    if (!finishCounter) return;
    const incoming = links.find((link) => owners.get(link.inputIndex)?.index === finishCounter.index);
    const identity = incoming ? owners.get(incoming.outputIndex) : undefined;
    expect(identity?.name).toBe('Identity');
    const delayed = links.find((link) => owners.get(link.inputIndex)?.index === identity?.index);
    expect(delayed?.activationDelay).toBe(FINISH_HANDOFF_FRAME_DELAY);
  });
});
