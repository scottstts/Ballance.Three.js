import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { BehaviorRec, NmoFile, ParameterRec } from '../formats/ck2/types.ts';
import type { ScaleableProximitySpec } from './proximity.ts';
import { TUTORIAL_SOURCE } from './tutorial.ts';

const gameplayPath = fileURLToPath(
  new URL('../../Ballance_bin/source1/Ballance/3D Entities/Gameplay.nmo', import.meta.url),
);

function behavior(file: NmoFile, index: number): BehaviorRec {
  const record = file.objects[index];
  if (record?.kind !== 'behavior') throw new Error(`missing source behavior ${index}`);
  return record;
}

function child(file: NmoFile, parentIndex: number, name: string): BehaviorRec {
  const found = behavior(file, parentIndex).referenceLists
    .flat()
    .map((index) => file.objects[index])
    .find((record): record is BehaviorRec => record?.kind === 'behavior' && record.name === name);
  if (!found) throw new Error(`missing source behavior ${parentIndex}/${name}`);
  return found;
}

function sourceParameter(file: NmoFile, owner: BehaviorRec, name: string): ParameterRec {
  let parameter = owner.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .find((record): record is ParameterRec => record?.kind === 'parameter' && record.name === name);
  if (!parameter) throw new Error(`missing source parameter ${owner.index}/${name}`);
  const seen = new Set<number>();
  while (!seen.has(parameter.index)) {
    seen.add(parameter.index);
    const next = parameter.sourceIndex >= 0 ? parameter.sourceIndex : parameter.sharedIndex;
    if (next < 0) break;
    const record = file.objects[next];
    if (record?.kind !== 'parameter') break;
    parameter = record;
  }
  return parameter;
}

function floatParameter(file: NmoFile, owner: BehaviorRec, name: string): number {
  const parameter = sourceParameter(file, owner, name);
  return new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset).getFloat32(0, true);
}

function intParameter(file: NmoFile, owner: BehaviorRec, name: string): number {
  const parameter = sourceParameter(file, owner, name);
  return new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset).getInt32(0, true);
}

function vectorParameter(file: NmoFile, owner: BehaviorRec, name: string): number[] {
  const parameter = sourceParameter(file, owner, name);
  const view = new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset);
  return [view.getFloat32(0, true), view.getFloat32(4, true), view.getFloat32(8, true)];
}

function stringParameter(file: NmoFile, owner: BehaviorRec, name: string): string {
  const parameter = sourceParameter(file, owner, name);
  return Buffer.from(parameter.valueBytes).toString('latin1').replace(/\0.*$/s, '');
}

function expectProximity(file: NmoFile, node: BehaviorRec, spec: ScaleableProximitySpec): void {
  expect(floatParameter(file, node, 'Distance')).toBe(spec.distance);
  expect(floatParameter(file, node, 'Exactness min. Distance')).toBe(spec.exactnessMinDistance);
  expect(floatParameter(file, node, 'Exactness max. Distance')).toBe(spec.exactnessMaxDistance);
  expect(intParameter(file, node, 'Minimum Framedelay')).toBe(spec.minimumFrameDelay);
  expect(intParameter(file, node, 'Maximum Framedelay')).toBe(spec.maximumFrameDelay);
  expect(intParameter(file, node, 'Check Axis:')).toBe(spec.axes);
  expect(intParameter(file, node, 'Squared Distance?')).toBe(Number(spec.squaredDistance));
}

describe('tutorial source constants', () => {
  it('retains the authored approach/action choreography', () => {
    expect(Object.values(TUTORIAL_SOURCE.approach).map((spec) => spec.distance)).toEqual([
      16, 14, 4.5, 18, 20,
    ]);
    expect(Object.values(TUTORIAL_SOURCE.action).map((spec) => spec.distance)).toEqual([
      3, 5, 2.5, 3, 2.5,
    ]);
    expect(TUTORIAL_SOURCE.finalHintDelay).toBe(4);
  });
});

describe.skipIf(!existsSync(gameplayPath))('source-authored tutorial choreography', () => {
  const gameplay = parseNmo(readFileSync(gameplayPath));

  it('waits at the five outer approach distances before showing each lesson', () => {
    const source = [
      [6971, 4],
      [7120, 5],
      [7045, 6],
      [7180, 7],
      [7224, 8],
    ] as const;
    for (const [graphIndex, chapter] of source) {
      const proximity = child(gameplay, graphIndex, 'TT Scaleable Proximity');
      expectProximity(gameplay, proximity, TUTORIAL_SOURCE.approach[chapter]);
    }
  });

  it('uses separate inner action distances after Return resumes physics', () => {
    const source = [
      [8952, 4],
      [9579, 5],
      [9075, 6],
      [9746, 7],
      [9852, 8],
    ] as const;
    for (const [graphIndex, chapter] of source) {
      const proximity = child(gameplay, graphIndex, 'TT Scaleable Proximity');
      expectProximity(gameplay, proximity, TUTORIAL_SOURCE.action[chapter]);
    }
  });

  it('retains movement completion, arrow fades, key scale, and action handoff timing', () => {
    expectProximity(gameplay, child(gameplay, 8866, 'TT Scaleable Proximity'), TUTORIAL_SOURCE.keyEnd);
    expect(floatParameter(gameplay, child(gameplay, 7971, 'Linear Progression'), 'Duration')).toBe(
      TUTORIAL_SOURCE.arrowFadeMs,
    );
    expect(floatParameter(gameplay, child(gameplay, 7806, 'Linear Progression'), 'Duration')).toBe(
      TUTORIAL_SOURCE.arrowFadeMs,
    );
    expect(floatParameter(gameplay, child(gameplay, 8717, 'Linear Progression'), 'Duration')).toBe(
      TUTORIAL_SOURCE.movementArrowFadeMs,
    );
    expect(floatParameter(gameplay, behavior(gameplay, 8110), 'Duration')).toBe(
      TUTORIAL_SOURCE.arrowScaleMs,
    );
    expect(floatParameter(gameplay, child(gameplay, 10447, 'Delayer'), 'Time to Wait')).toBe(
      TUTORIAL_SOURCE.actionTailDelayMs,
    );
    const controls = [
      [8110, 'forward'],
      [8320, 'back'],
      [8265, 'left'],
      [8548, 'right'],
    ] as const;
    for (const [graphIndex, control] of controls) {
      const scaleGraph = behavior(gameplay, graphIndex);
      expect(stringParameter(gameplay, scaleGraph, 'Pin 0')).toBe(
        TUTORIAL_SOURCE.directionArrowByControl[control],
      );
      const target = vectorParameter(gameplay, scaleGraph, 'B');
      expect(target.slice(0, 2)).toEqual([1, 1]);
      expect(target[2]).toBeCloseTo(TUTORIAL_SOURCE.arrowPressedScale, 6);
    }
  });

  it('places the down arrow at the target referential without a synthetic offset', () => {
    const setPosition = child(gameplay, 7533, 'Set Position');
    expect(vectorParameter(gameplay, setPosition, 'Position')).toEqual(
      TUTORIAL_SOURCE.downArrowPosition,
    );
  });

  it('retains the text/panel fades and four-second final-hints wait', () => {
    expect(floatParameter(gameplay, child(gameplay, 7430, 'Linear Progression'), 'Duration')).toBe(
      TUTORIAL_SOURCE.textFadeMs,
    );
    expect(floatParameter(gameplay, child(gameplay, 10570, 'Bezier Progression'), 'Duration')).toBe(
      TUTORIAL_SOURCE.firstPanelFadeMs,
    );
    expect(floatParameter(gameplay, child(gameplay, 7285, 'Bezier Progression'), 'Duration')).toBe(
      TUTORIAL_SOURCE.laterPanelFadeMs,
    );
    expect(floatParameter(gameplay, child(gameplay, 7366, 'Delayer'), 'Time to Wait')).toBe(
      TUTORIAL_SOURCE.finalHintDelay * 1000,
    );
  });
});
