import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { BehaviorLinkRec, BehaviorRec, NmoFile, ParameterRec } from '../formats/ck2/types.ts';
import { LOADING_SOURCE, completedLoadHandoffDelayMs, loadingBarState } from '../game/loading.ts';
import { SIM_DT } from '../game/constants.ts';

const GAME_DIR = fileURLToPath(new URL('../../Ballance_bin/source1/Ballance/', import.meta.url));
const basePath = `${GAME_DIR}base.cmo`;
const base = existsSync(basePath) ? parseNmo(readFileSync(basePath)) : null;

function behavior(file: NmoFile, name: string): BehaviorRec {
  const record = file.byName.get(name)?.find((candidate): candidate is BehaviorRec => candidate.kind === 'behavior');
  expect(record, `${name} behavior`).toBeDefined();
  return record!;
}

function children(file: NmoFile, parent: BehaviorRec, name: string): BehaviorRec[] {
  return parent.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .filter((record): record is BehaviorRec => record?.kind === 'behavior' && record.name === name);
}

function parameters(file: NmoFile, parent: BehaviorRec): ParameterRec[] {
  return parent.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .filter((record): record is ParameterRec => record?.kind === 'parameter');
}

function links(file: NmoFile, parent: BehaviorRec): BehaviorLinkRec[] {
  return parent.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .filter((record): record is BehaviorLinkRec => record?.kind === 'behaviorLink');
}

function resolved(file: NmoFile, parameter: ParameterRec): ParameterRec {
  let current = parameter;
  const seen = new Set([current.index]);
  while (current.sourceIndex >= 0 || current.sharedIndex >= 0) {
    const nextIndex = current.sourceIndex >= 0 ? current.sourceIndex : current.sharedIndex;
    if (seen.has(nextIndex)) break;
    const next = file.objects[nextIndex];
    if (next?.kind !== 'parameter') break;
    seen.add(nextIndex);
    current = next;
  }
  return current;
}

function floats(file: NmoFile, parameter: ParameterRec): number[] {
  const bytes = resolved(file, parameter).valueBytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.length / 4 }, (_, index) => view.getFloat32(index * 4, true));
}

function scalar(file: NmoFile, parameter: ParameterRec): number {
  return floats(file, parameter)[0];
}

function int(file: NmoFile, parameter: ParameterRec): number {
  const bytes = resolved(file, parameter).valueBytes;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(0, true);
}

describe.skipIf(!base)('source loading screen', () => {
  it('retains the shipped bar entity, material, and nine-part color progression', () => {
    const file = base!;
    const entity = file.byName.get('Ladebalken')?.find((record) => record.kind === 'entity2d');
    const material = file.byName.get('Ladebalken')?.find((record) => record.kind === 'material');
    expect(entity?.kind).toBe('entity2d');
    expect(material?.kind).toBe('material');
    if (entity?.kind !== 'entity2d' || material?.kind !== 'material') return;

    expect(entity.rect).toEqual(LOADING_SOURCE.rect);
    expect(material.diffuse).toEqual([1, 0.6588235294117647, 0, 0]);
    expect(material.sourceBlend).toBe(5);
    expect(material.destBlend).toBe(6);

    const graph = behavior(file, 'Loading_Screen');
    const identity = children(file, graph, 'Identity')[0];
    const component = children(file, graph, 'Set Component')[0];
    const interpolator = children(file, graph, 'Interpolator')[0];
    const waitMessage = children(file, graph, 'Wait Message')[0];
    const test = children(file, graph, 'Test')[0];

    expect(scalar(file, parameters(file, identity).find((parameter) => parameter.name === 'pIn 0')!)).toBe(
      LOADING_SOURCE.parts,
    );
    expect(scalar(file, parameters(file, component).find((parameter) => parameter.name === 'Component 2')!)).toBe(
      LOADING_SOURCE.height,
    );
    const savedSize = graph.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .find((record): record is ParameterRec => record?.kind === 'parameter' && record.name === 'Sizefactor');
    expect(scalar(file, savedSize!)).toBeCloseTo(LOADING_SOURCE.savedPart / LOADING_SOURCE.parts);
    expect(floats(file, parameters(file, interpolator).find((parameter) => parameter.name === 'A')!)).toEqual(
      LOADING_SOURCE.colorA,
    );
    expect(floats(file, parameters(file, interpolator).find((parameter) => parameter.name === 'B')!)).toEqual(
      LOADING_SOURCE.colorB,
    );
    expect(resolved(file, parameters(file, waitMessage).find((parameter) => parameter.name === 'Message')!).managerInt).toBe(
      25,
    );
    expect(int(file, parameters(file, test).find((parameter) => parameter.name === 'Test')!)).toBe(6);
  });

  it('retains the one-frame wait loop and two-frame completed-load handoff', () => {
    const file = base!;
    const loading = behavior(file, 'Loading_Screen');
    const wait = children(file, loading, 'Wait Message')[0];
    const test = children(file, loading, 'Test')[0];
    const waitInput = wait.referenceLists.flat().map((index) => file.objects[index]).find(
      (record) => record?.kind === 'behaviorIo' && record.name === 'In',
    );
    const falseOutput = test.referenceLists.flat().map((index) => file.objects[index]).find(
      (record) => record?.kind === 'behaviorIo' && record.name === 'False',
    );
    expect(links(file, loading).find((link) => link.outputIndex === falseOutput?.index && link.inputIndex === waitInput?.index))
      .toMatchObject({ activationDelay: 1 });

    const loadObject = behavior(file, 'Load_Object');
    const broadcast = children(file, loadObject, 'Broadcast Message')[0];
    const broadcastIn = broadcast.referenceLists.flat().map((index) => file.objects[index]).find(
      (record) => record?.kind === 'behaviorIo' && record.name === 'In',
    );
    expect(links(file, loadObject).find((link) => link.inputIndex === broadcastIn?.index))
      .toMatchObject({ activationDelay: LOADING_SOURCE.completedLoadFrameDelay });
    expect(completedLoadHandoffDelayMs()).toBe(LOADING_SOURCE.completedLoadFrameDelay * SIM_DT * 1000);
  });

  it('starts at the saved four-ninths plus the immediate activation step', () => {
    expect(LOADING_SOURCE.initialPart).toBe(LOADING_SOURCE.savedPart + 1);
    expect(loadingBarState(-1)).toEqual(loadingBarState(LOADING_SOURCE.initialPart));
    expect(loadingBarState(LOADING_SOURCE.parts).progress).toBe(1);
    expect(loadingBarState(999).alpha).toBe(LOADING_SOURCE.colorB[3]);
  });
});
