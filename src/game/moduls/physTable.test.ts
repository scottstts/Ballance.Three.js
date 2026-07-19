import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../../formats/ck2/nmo.ts';
import type { BehaviorRec, NmoFile, ParameterRec } from '../../formats/ck2/types.ts';
import { MODUL18_PARTICLE_SOURCE } from './fanParticles.ts';
import {
  MODUL18_FORCE,
  MODUL18_PROXIMITY_SOURCE,
  MODUL18_ROTOR_SPEED,
  MODUL18_SOUND_RANGE,
  MODUL29_BREAK_JOINT_INDEX,
  MODUL29_BREAK_PROXIMITY,
  MODUL29_TRIGGER_PLATE,
  MODUL29_WAKE_PROXIMITY,
  MODUL_PHYS,
  alternatingForceScale,
} from './physTable.ts';

const GAME_DIR = [
  fileURLToPath(new URL('../../../Ballance_bin/Ballance', import.meta.url)),
  fileURLToPath(new URL('../../../Ballance_bin/source1/Ballance', import.meta.url)),
].find(existsSync) ?? '';
const hasGame = existsSync(GAME_DIR);

const MODULES = [
  'P_Modul_01',
  'P_Modul_03',
  'P_Modul_08',
  'P_Modul_17',
  'P_Modul_19',
  'P_Modul_25',
  'P_Modul_26',
  'P_Modul_29',
  'P_Modul_30',
  'P_Modul_34',
  'P_Modul_37',
  'P_Modul_41',
] as const;

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

function behaviorParameters(file: NmoFile, behavior: BehaviorRec): Map<string, ParameterRec> {
  const out = new Map<string, ParameterRec>();
  for (const index of behavior.referenceLists.flat()) {
    const record = file.objects[index];
    if (record?.kind === 'parameter') out.set(record.name, resolve(file, record));
  }
  return out;
}

function targetObject(file: NmoFile, behavior: BehaviorRec) {
  const index = behavior.headerData.at(-2) ?? -1;
  const parameter = file.objects[index];
  if (parameter?.kind !== 'parameter') return null;
  const resolved = resolve(file, parameter);
  return resolved.valueObjectIndex >= 0 ? file.objects[resolved.valueObjectIndex] : null;
}

function objectValue(file: NmoFile, parameter: ParameterRec | undefined) {
  if (!parameter || parameter.valueObjectIndex < 0) return null;
  return file.objects[parameter.valueObjectIndex] ?? null;
}

function floatValue(parameter: ParameterRec | undefined): number {
  if (!parameter || parameter.valueBytes.length < 4) return Number.NaN;
  return new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset).getFloat32(0, true);
}

function intValue(parameter: ParameterRec | undefined): number {
  if (!parameter || parameter.valueBytes.length < 4) return Number.NaN;
  return new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset).getInt32(0, true);
}

function boolValue(parameter: ParameterRec | undefined): boolean {
  if (!parameter || parameter.valueBytes.length < 4) return false;
  return new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset).getUint32(0, true) !== 0;
}

function vectorValue(parameter: ParameterRec | undefined): [number, number, number] {
  if (!parameter || parameter.valueBytes.length < 12) return [Number.NaN, Number.NaN, Number.NaN];
  const view = new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset);
  return [view.getFloat32(0, true), view.getFloat32(4, true), view.getFloat32(8, true)];
}

function colorValue(parameter: ParameterRec | undefined): [number, number, number, number] {
  if (!parameter || parameter.valueBytes.length < 16) return [Number.NaN, Number.NaN, Number.NaN, Number.NaN];
  const view = new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset);
  return [0, 4, 8, 12].map((offset) => view.getFloat32(offset, true)) as [number, number, number, number];
}

describe.skipIf(!hasGame)('source-backed module physics table', () => {
  for (const moduleName of MODULES) {
    it(`${moduleName} matches original Physicalize bodies and collision hulls`, () => {
      const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/PH', `${moduleName}.nmo`)));
      const sourceBodies = file.objects
        .filter((record): record is BehaviorRec => record.kind === 'behavior')
        .filter((record) => record.name === 'Physicalize' && record.headerData.length >= 7)
        .map((behavior) => ({ behavior, target: targetObject(file, behavior) }))
        .filter((entry) => entry.target?.kind === 'entity');
      const matched = new Set<string>();

      for (const { behavior, target } of sourceBodies) {
        if (!target || target.kind !== 'entity') continue;
        const part = MODUL_PHYS[moduleName].parts.find((candidate) => target.name.endsWith(candidate.suffix));
        expect(part, `${target.name} needs a runtime body`).toBeDefined();
        if (!part) continue;
        matched.add(part.suffix);
        const parameters = behaviorParameters(file, behavior);
        expect(part.fixed ?? false).toBe(boolValue(parameters.get('Fixed ?')));
        expect(part.friction).toBeCloseTo(floatValue(parameters.get('Friction')), 6);
        expect(part.elasticity).toBeCloseTo(floatValue(parameters.get('Elasticity')), 6);
        expect(part.mass ?? 1).toBeCloseTo(floatValue(parameters.get('Mass')), 6);
        expect(part.startFrozen ?? false).toBe(boolValue(parameters.get('Start Frozen')));
        expect(part.collisionEnabled ?? true).toBe(boolValue(parameters.get('Enable Collision')));
        expect(part.linearDamp ?? 0.1).toBeCloseTo(floatValue(parameters.get('Linear Speed Dampening')), 6);
        expect(part.rotDamp ?? 0.1).toBeCloseTo(floatValue(parameters.get('Rot Speed Dampening')), 6);
        const sourceShift = vectorValue(parameters.get('Shift Mass Center'));
        expect(part.shiftCom).toHaveLength(3);
        for (let axis = 0; axis < 3; axis++) expect(part.shiftCom?.[axis]).toBeCloseTo(sourceShift[axis], 6);

        const sourceMeshes = [...parameters]
          .filter(([name]) => /^convex(?:\s+\d+)?$/i.test(name))
          .map(([, parameter]) => objectValue(file, parameter)?.name)
          .filter((name): name is string => !!name);
        if (part.collisionMeshes) {
          expect(part.collisionMeshes).toEqual(sourceMeshes);
        } else {
          const visualMesh = target.meshIndex >= 0 ? file.objects[target.meshIndex]?.name : undefined;
          expect(sourceMeshes).toEqual(visualMesh ? [visualMesh] : []);
        }
      }
      expect(matched).toEqual(new Set(MODUL_PHYS[moduleName].parts.map((part) => part.suffix)));
    });

    it(`${moduleName} matches original hinge and ball-joint topology`, () => {
      const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/PH', `${moduleName}.nmo`)));
      const sourceJoints = file.objects
        .filter((record): record is BehaviorRec => record.kind === 'behavior')
        .filter(
          (record) =>
            (record.name === 'Set Physics Hinge' || record.name === 'Set Physics Ball Joint') &&
            record.headerData.length >= 7,
        );
      const definitions = MODUL_PHYS[moduleName].hinges ?? [];
      expect(definitions).toHaveLength(sourceJoints.length);
      for (const behavior of sourceJoints) {
        const target = targetObject(file, behavior);
        expect(target?.kind).toBe('entity');
        if (target?.kind !== 'entity') continue;
        const parameters = behaviorParameters(file, behavior);
        const other = objectValue(file, parameters.get('Object2'));
        const pin = objectValue(
          file,
          parameters.get('Joint Referential') ?? parameters.get('Referential 1'),
        );
        const definition = definitions.find(
          (candidate) =>
            target.name.endsWith(candidate.part) &&
            !!pin?.name.endsWith(candidate.pin) &&
            (other ? !!candidate.other && other.name.endsWith(candidate.other) : candidate.other === undefined),
        );
        expect(definition, `${behavior.name} ${target.name} at ${pin?.name}`).toBeDefined();
        expect(definition?.spherical ?? false).toBe(behavior.name === 'Set Physics Ball Joint');
        if (behavior.name === 'Set Physics Hinge') {
          expect(definition?.limits).toBeUndefined();
          expect(boolValue(parameters.get('Limitations (-180 to 180 degree)'))).toBe(false);
        }
      }
    });
  }

  it('P_Modul_18 matches its activation, updraft, rotor, and sound gates', () => {
    const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/PH/P_Modul_18.nmo')));
    const proximities = file.objects.filter(
      (record): record is BehaviorRec => record.kind === 'behavior' && record.name === 'TT Scaleable Proximity',
    );
    for (const [name, definition] of Object.entries(MODUL18_PROXIMITY_SOURCE)) {
      const node = proximities.find(
        (candidate) => floatValue(behaviorParameters(file, candidate).get('Distance')) === definition.distance,
      );
      expect(node, `missing fan ${name} proximity`).toBeDefined();
      if (!node) continue;
      const source = behaviorParameters(file, node);
      expect(floatValue(source.get('Exactness min. Distance'))).toBe(definition.exactnessMinDistance);
      expect(floatValue(source.get('Exactness max. Distance'))).toBe(definition.exactnessMaxDistance);
      expect(intValue(source.get('Minimum Framedelay'))).toBe(definition.minimumFrameDelay);
      expect(intValue(source.get('Maximum Framedelay'))).toBe(definition.maximumFrameDelay);
      expect(intValue(source.get(''))).toBe(definition.initialFrameDelay);
      expect(intValue(source.get('Check Axis:'))).toBe(definition.axes);
      expect(boolValue(source.get('Squared Distance?'))).toBe(definition.squaredDistance);
      const target = objectValue(file, source.get('ObjectB'));
      expect(target?.name.endsWith(name === 'sound' ? '_MF' : '_Particle')).toBe(true);
    }

    const force = file.objects.find(
      (record): record is BehaviorRec => record.kind === 'behavior' && record.name === 'SetPhysicsForce',
    );
    expect(floatValue(force ? behaviorParameters(file, force).get('Force Value') : undefined)).toBeCloseTo(
      MODUL18_FORCE,
      7,
    );
    const perSecond = file.objects.find(
      (record): record is BehaviorRec => record.kind === 'behavior' && record.name === 'Per Second',
    );
    expect(floatValue(perSecond ? behaviorParameters(file, perSecond).get('X') : undefined)).toBe(-MODUL18_ROTOR_SPEED);
    const volume = file.objects.find(
      (record): record is BehaviorRec => record.kind === 'behavior' && record.name === 'TT ProximityVolumeControl',
    );
    const volumeParameters = volume ? behaviorParameters(file, volume) : new Map<string, ParameterRec>();
    expect(floatValue(volumeParameters.get('Near-Distance'))).toBe(MODUL18_SOUND_RANGE.near);
    expect(floatValue(volumeParameters.get('Far-Distance'))).toBe(MODUL18_SOUND_RANGE.far);
    expect(
      file.byName.get('P_Modul_18_Kollisionsquader')?.some((record) => record.kind === 'entity'),
    ).toBe(true);
  });

  it('P_Modul_18 matches both source planar particle layers', () => {
    const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/PH/P_Modul_18.nmo')));
    const nodes = file.objects.filter(
      (record): record is BehaviorRec => record.kind === 'behavior' && record.name === 'PlanarParticleSystem',
    );
    expect(nodes).toHaveLength(2);
    for (const spec of Object.values(MODUL18_PARTICLE_SOURCE)) {
      const node = nodes.find(
        (candidate) => intValue(behaviorParameters(file, candidate).get('Maximum Number')) === spec.maxParticles,
      );
      expect(node, `missing ${spec.rendering} fan particles`).toBeDefined();
      if (!node) continue;
      const source = behaviorParameters(file, node);
      expect(floatValue(source.get('Emission Delay')) / 1000).toBeCloseTo(spec.emissionDelay, 8);
      expect(intValue(source.get('Emission'))).toBe(spec.emission);
      expect(intValue(source.get('Emission Variance'))).toBe(spec.emissionVariance);
      expect(floatValue(source.get('Lifespan')) / 1000).toBeCloseTo(spec.life, 8);
      expect(floatValue(source.get('Lifespan Variance')) / 1000).toBeCloseTo(spec.lifeVariance, 8);
      expect(floatValue(source.get('Speed')) * 1000).toBeCloseTo(spec.speed, 6);
      expect(floatValue(source.get('Speed Variance')) * 1000).toBeCloseTo(spec.speedVariance, 6);
      expect(floatValue(source.get('Angular Speed/Spreading'))).toBeCloseTo(spec.spreading, 8);
      expect(floatValue(source.get('Angular Speed Variance/Spreading Variation'))).toBeCloseTo(
        spec.spreadingVariance,
        8,
      );
      expect(floatValue(source.get('Initial Size'))).toBeCloseTo(spec.initialSize, 7);
      expect(floatValue(source.get('Ending Size'))).toBeCloseTo(spec.endingSize, 7);
      expect(colorValue(source.get('Initial Color and Alpha'))).toEqual(spec.initialColor);
      expect(colorValue(source.get('Ending Color and Alpha'))).toEqual(spec.endingColor);
      expect(intValue(source.get('Particle Rendering'))).toBe(spec.rendering === 'line' ? 2 : 3);
      expect(intValue(source.get('Evolutions'))).toBe(spec.evolutions);
      expect(intValue(source.get('Variances'))).toBe(spec.variances);
      expect(intValue(source.get('Source Blend'))).toBe(spec.sourceBlend);
      expect(intValue(source.get('Destination Blend'))).toBe(spec.destinationBlend);
      expect(boolValue(source.get('Real-Time Mode'))).toBe(spec.realTimeMode);
      expect(floatValue(source.get('DeltaTime')) / 1000).toBeCloseTo(spec.fixedDelta, 8);
      const texture = objectValue(file, source.get('Texture'));
      expect(texture?.name ?? null).toBe(spec.texture);
    }

    const emitter = file.byName.get('P_Modul_18_Particle')?.find((record) => record.kind === 'entity');
    expect(emitter?.kind).toBe('entity');
    if (emitter?.kind === 'entity') {
      // The source frame converts so Three local -Z is the plume's global +Y.
      expect(emitter.worldMatrix[4]).toBeCloseTo(0, 4);
      expect(emitter.worldMatrix[5]).toBeCloseTo(0, 4);
      expect(emitter.worldMatrix[6]).toBeCloseTo(-1, 4);
      expect(emitter.worldMatrix[8]).toBeCloseTo(0, 4);
      expect(emitter.worldMatrix[9]).toBeCloseTo(1, 4);
      expect(emitter.worldMatrix[10]).toBeCloseTo(0, 4);
    }
  });

  it('P_Modul_29 matches both proximity gates and the exact broken hinge', () => {
    const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/PH/P_Modul_29.nmo')));
    const proximities = file.objects.filter(
      (record): record is BehaviorRec => record.kind === 'behavior' && record.name === 'TT Scaleable Proximity',
    );
    const expectProximity = (distance: number, source: typeof MODUL29_WAKE_PROXIMITY) => {
      const node = proximities.find((candidate) => floatValue(behaviorParameters(file, candidate).get('Distance')) === distance);
      expect(node).toBeDefined();
      if (!node) return;
      const parameters = behaviorParameters(file, node);
      expect(floatValue(parameters.get('Exactness min. Distance'))).toBe(source.exactnessMinDistance);
      expect(floatValue(parameters.get('Exactness max. Distance'))).toBe(source.exactnessMaxDistance);
      expect(intValue(parameters.get('Minimum Framedelay'))).toBe(source.minimumFrameDelay);
      expect(intValue(parameters.get('Maximum Framedelay'))).toBe(source.maximumFrameDelay);
      expect(intValue(parameters.get(''))).toBe(source.initialFrameDelay);
      expect(intValue(parameters.get('Check Axis:'))).toBe(source.axes);
      expect(boolValue(parameters.get('Squared Distance?'))).toBe(source.squaredDistance);
      if (distance === MODUL29_BREAK_PROXIMITY.distance) {
        expect(objectValue(file, parameters.get('ObjectB'))?.name.endsWith(MODUL29_TRIGGER_PLATE)).toBe(true);
      }
    };
    expectProximity(MODUL29_WAKE_PROXIMITY.distance, MODUL29_WAKE_PROXIMITY);
    expectProximity(MODUL29_BREAK_PROXIMITY.distance, MODUL29_BREAK_PROXIMITY);

    const hinges = file.byName.get('10 Hinges')?.find(
      (record): record is BehaviorRec => record.kind === 'behavior',
    );
    expect(hinges).toBeDefined();
    if (!hinges) return;
    const input = hinges.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .find((record) => record?.kind === 'behaviorIo' && record.name === 'input2');
    const breakLink = hinges.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .find((record) => record?.kind === 'behaviorLink' && record.outputIndex === input?.index);
    expect(breakLink?.kind).toBe('behaviorLink');
    if (breakLink?.kind !== 'behaviorLink') return;
    const sourceHinge = file.objects.find(
      (record): record is BehaviorRec =>
        record.kind === 'behavior' && record.referenceLists.some((list) => list.includes(breakLink.inputIndex)),
    );
    expect(sourceHinge?.name).toBe('Set Physics Hinge');
    if (!sourceHinge) return;
    const source = behaviorParameters(file, sourceHinge);
    const definition = MODUL_PHYS.P_Modul_29.hinges?.[MODUL29_BREAK_JOINT_INDEX];
    expect(targetObject(file, sourceHinge)?.name.endsWith(definition?.part ?? '')).toBe(true);
    expect(objectValue(file, source.get('Object2'))?.name.endsWith(definition?.other ?? '')).toBe(true);
    expect(objectValue(file, source.get('Joint Referential'))?.name.endsWith(definition?.pin ?? '')).toBe(true);
  });

  it('P_Modul_08 starts +Z and preserves its +/idle/-/idle 500 ms cycle', () => {
    const definition = MODUL_PHYS.P_Modul_08.altForce;
    expect(definition).toEqual({
      part: '_Schaukel',
      force: 1.1,
      switchTime: 0.5,
      delayTime: 0.5,
      axis: [0, 0, 1],
      reference: '_Fix',
      startState: 1,
    });
    if (!definition) return;
    expect([1, 2, 3, 0].map((state) => alternatingForceScale(definition, state))).toEqual([1, 0, -1, 0]);

    const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/PH/P_Modul_08.nmo')));
    const graph = file.byName.get('Physicalize and Swing')?.find(
      (record): record is BehaviorRec => record.kind === 'behavior',
    );
    expect(graph).toBeDefined();
    if (!graph) return;
    const nodes = graph.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .filter((record): record is BehaviorRec => record?.kind === 'behavior');
    const forces = nodes.filter((node) => node.name === 'SetPhysicsForce');
    expect(forces).toHaveLength(2);
    expect(forces.map((node) => vectorValue(behaviorParameters(file, node).get('Direction')))).toEqual([
      [0, 0, -1],
      [0, 0, 1],
    ]);
    expect(
      forces.map((node) => floatValue(behaviorParameters(file, node).get('Force Value'))),
    ).toEqual([Math.fround(definition.force), Math.fround(definition.force)]);
    for (const node of forces) {
      expect(objectValue(file, behaviorParameters(file, node).get('Direction Ref'))?.name.endsWith('_Fix')).toBe(
        true,
      );
    }
    expect(
      nodes
        .filter((node) => node.name === 'Delayer')
        .map((node) => floatValue(behaviorParameters(file, node).get('Time to Wait'))),
    ).toEqual([500, 500, 500, 500]);

    const positive = forces.find(
      (node) => vectorValue(behaviorParameters(file, node).get('Direction'))[2] === 1,
    );
    const delayedCreate = graph.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .find(
        (record) =>
          record?.kind === 'behaviorLink' &&
          record.activationDelay === 1 &&
          positive?.referenceLists.some((list) => list.includes(record.inputIndex)),
      );
    expect(delayedCreate?.kind).toBe('behaviorLink');
  });

  it('P_Modul_26 starts +Z and alternates sign every 1500 ms', () => {
    const definition = MODUL_PHYS.P_Modul_26.altForce;
    expect(definition).toEqual({
      part: '_Sack',
      force: 0.25,
      switchTime: 1.5,
      axis: [0, 0, 1],
      reference: '_Halter',
      startState: 0,
    });
    if (!definition) return;
    expect([0, 1].map((state) => alternatingForceScale(definition, state))).toEqual([1, -1]);

    const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/PH/P_Modul_26.nmo')));
    const graph = file.byName.get('Swing')?.find((record): record is BehaviorRec => record.kind === 'behavior');
    expect(graph).toBeDefined();
    if (!graph) return;
    const nodes = graph.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .filter((record): record is BehaviorRec => record?.kind === 'behavior');
    const forces = nodes.filter((node) => node.name === 'SetPhysicsForce');
    expect(forces.map((node) => vectorValue(behaviorParameters(file, node).get('Direction')))).toEqual([
      [0, 0, -1],
      [0, 0, 1],
    ]);
    expect(
      forces.map((node) => floatValue(behaviorParameters(file, node).get('Force Value'))),
    ).toEqual([definition.force, definition.force]);
    for (const node of forces) {
      expect(
        objectValue(file, behaviorParameters(file, node).get('Direction Ref'))?.name.endsWith('_Halter'),
      ).toBe(true);
    }
    const delay = nodes.find((node) => node.name === 'Delayer');
    expect(floatValue(delay ? behaviorParameters(file, delay).get('Time to Wait') : undefined)).toBe(1500);

    const positive = forces.find(
      (node) => vectorValue(behaviorParameters(file, node).get('Direction'))[2] === 1,
    );
    const sequencer = nodes.find((node) => node.name === 'Sequencer');
    expect(intValue(sequencer ? behaviorParameters(file, sequencer).get('Current') : undefined)).toBe(-1);
    const firstOutput = sequencer?.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .find((record) => record?.kind === 'behaviorIo' && record.name === 'Out 1');
    const firstCreate = graph.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .find(
        (record) =>
          record?.kind === 'behaviorLink' &&
          record.outputIndex === firstOutput?.index &&
          positive?.referenceLists.some((list) => list.includes(record.inputIndex)),
      );
    expect(firstCreate?.kind).toBe('behaviorLink');
  });

  for (const moduleName of ['P_Modul_01', 'P_Modul_03', 'P_Modul_19', 'P_Modul_25', 'P_Modul_30', 'P_Modul_34', 'P_Modul_37']) {
    it(`${moduleName} matches its one-shot source physics-wake gate`, () => {
      const definition = MODUL_PHYS[moduleName]?.wakeProximity;
      expect(definition).toBeDefined();
      if (!definition) return;
      const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/PH', `${moduleName}.nmo`)));
      const node = file.objects
        .filter((record): record is BehaviorRec => record.kind === 'behavior' && record.name === 'TT Scaleable Proximity')
        .find((candidate) =>
          objectValue(file, behaviorParameters(file, candidate).get('ObjectB'))?.name.endsWith(definition.target),
        );
      expect(node).toBeDefined();
      if (!node) return;
      const source = behaviorParameters(file, node);
      expect(floatValue(source.get('Distance'))).toBe(definition.spec.distance);
      expect(floatValue(source.get('Exactness min. Distance'))).toBe(definition.spec.exactnessMinDistance);
      expect(floatValue(source.get('Exactness max. Distance'))).toBe(definition.spec.exactnessMaxDistance);
      expect(intValue(source.get('Minimum Framedelay'))).toBe(definition.spec.minimumFrameDelay);
      expect(intValue(source.get('Maximum Framedelay'))).toBe(definition.spec.maximumFrameDelay);
      expect(intValue(source.get(''))).toBe(definition.spec.initialFrameDelay);
      expect(intValue(source.get('Check Axis:'))).toBe(definition.spec.axes);
      expect(boolValue(source.get('Squared Distance?'))).toBe(definition.spec.squaredDistance);
    });
  }
});
