import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { BehaviorRec, NmoFile, ParameterRec } from '../formats/ck2/types.ts';
import {
  BALLOON_BODIES,
  BALLOON_FORCES,
  BALLOON_HINGES,
  BALLOON_LAUNCH_FORCE,
  BALLOON_SLIDERS,
  BALLOON_SPRING,
  BALLOON_WAKE_PROXIMITY_SOURCE,
} from './balloon.ts';
import { decodeUfoPath, UFO_SOUND_SOURCE, ufoSoundPitch } from './finale.ts';
import { buildVxTcbControls, evaluateVxTcbRotation } from './vxTcbRotation.ts';

const GAME_DIR = [
  fileURLToPath(new URL('../../Ballance_bin/Ballance', import.meta.url)),
  fileURLToPath(new URL('../../Ballance_bin/source1/Ballance', import.meta.url)),
].find(existsSync) ?? '';
const sourcePath = join(GAME_DIR, '3D Entities/PH/PE_Balloon.nmo');

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

function parameters(file: NmoFile, behavior: BehaviorRec): Map<string, ParameterRec> {
  return new Map(
    behavior.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .filter((record): record is ParameterRec => record?.kind === 'parameter')
      .map((parameter) => [parameter.name, resolve(file, parameter)]),
  );
}

function target(file: NmoFile, behavior: BehaviorRec) {
  const parameter = file.objects[behavior.headerData.at(-2) ?? -1];
  if (parameter?.kind !== 'parameter') return null;
  const resolved = resolve(file, parameter);
  return resolved.valueObjectIndex >= 0 ? file.objects[resolved.valueObjectIndex] : null;
}

function targetName(file: NmoFile, behavior: BehaviorRec): string | null {
  const parameter = file.objects[behavior.headerData.at(-2) ?? -1];
  if (parameter?.kind !== 'parameter') return null;
  const resolved = resolve(file, parameter);
  return file.objects[resolved.valueObjectIndex]?.name ?? resolved.name;
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

function stringValue(parameter: ParameterRec | undefined): string {
  return parameter ? Buffer.from(parameter.valueBytes).toString('latin1').replace(/\0.*$/s, '') : '';
}

function matchingSuffix(name: string, suffix: string): boolean {
  return name.endsWith(suffix);
}

describe.skipIf(!existsSync(sourcePath))('source-backed PE_Balloon physics', () => {
  const file = existsSync(sourcePath) ? parseNmo(readFileSync(sourcePath)) : null;

  it('matches the one-shot horizontal physics-wake proximity', () => {
    if (!file) return;
    const proximity = file.objects
      .filter((record): record is BehaviorRec => record.kind === 'behavior' && record.name === 'TT Scaleable Proximity')
      .find((record) => floatValue(parameters(file, record).get('Distance')) === BALLOON_WAKE_PROXIMITY_SOURCE.distance);
    expect(proximity).toBeDefined();
    if (!proximity) return;
    const source = parameters(file, proximity);
    expect(floatValue(source.get('Exactness min. Distance'))).toBe(
      BALLOON_WAKE_PROXIMITY_SOURCE.exactnessMinDistance,
    );
    expect(floatValue(source.get('Exactness max. Distance'))).toBe(
      BALLOON_WAKE_PROXIMITY_SOURCE.exactnessMaxDistance,
    );
    expect(intValue(source.get('Minimum Framedelay'))).toBe(BALLOON_WAKE_PROXIMITY_SOURCE.minimumFrameDelay);
    expect(intValue(source.get('Maximum Framedelay'))).toBe(BALLOON_WAKE_PROXIMITY_SOURCE.maximumFrameDelay);
    expect(intValue(source.get(''))).toBe(BALLOON_WAKE_PROXIMITY_SOURCE.initialFrameDelay);
    expect(intValue(source.get('Check Axis:'))).toBe(BALLOON_WAKE_PROXIMITY_SOURCE.axes);
    expect(boolValue(source.get('Squared Distance?'))).toBe(BALLOON_WAKE_PROXIMITY_SOURCE.squaredDistance);
  });

  it('expands the five source Physicalize templates to all 18 bodies and authored hulls', () => {
    if (!file) return;
    const physicalize = file.objects
      .filter((record): record is BehaviorRec => record.kind === 'behavior')
      .filter((record) => record.name === 'Physicalize' && record.headerData.length >= 7);
    // Plates and the combined rope/balloon selector are source-driven lists,
    // so their saved target resolves to the last selected item. The fifth
    // Physicalize node belongs to a separate runtime-selected effect object.
    expect(physicalize).toHaveLength(5);
    expect(BALLOON_BODIES).toHaveLength(18);

    for (const definition of BALLOON_BODIES) {
      const templateSuffix = /^_Platte\d+$/.test(definition.part)
        ? '_Platte08'
        : /^_Ballon_Seil\d+$/.test(definition.part)
          ? '_Ballon04'
          : /^_Ballon\d+$/.test(definition.part)
            ? '_Ballon04'
            : definition.part;
      const behavior = physicalize.find((candidate) => target(file, candidate)?.name.endsWith(templateSuffix));
      expect(behavior, `missing Physicalize template for ${definition.part}`).toBeDefined();
      if (!behavior) continue;
      const input = parameters(file, behavior);
      const phys = definition.physicalize;
      expect(phys.fixed ?? false).toBe(boolValue(input.get('Fixed ?')));
      expect(phys.friction).toBeCloseTo(floatValue(input.get('Friction')), 6);
      expect(phys.elasticity).toBeCloseTo(floatValue(input.get('Elasticity')), 6);
      expect(phys.mass ?? 1).toBeCloseTo(floatValue(input.get('Mass')), 6);
      expect(phys.startFrozen ?? false).toBe(boolValue(input.get('Start Frozen')));
      expect(phys.collisionEnabled ?? true).toBe(boolValue(input.get('Enable Collision')));
      expect(phys.linearDamp ?? 0.1).toBeCloseTo(floatValue(input.get('Linear Speed Dampening')), 6);
      expect(phys.rotDamp ?? 0.1).toBeCloseTo(floatValue(input.get('Rot Speed Dampening')), 6);
      expect(phys.shiftCom).toEqual(vectorValue(input.get('Shift Mass Center')));

      const sourceMeshes = [...input]
        .filter(([name]) => /^convex(?:\s+\d+)?$/i.test(name))
        .map(([, parameter]) => objectValue(file, parameter)?.name)
        .filter((name): name is string => !!name);
      if (phys.collisionMeshes) expect(phys.collisionMeshes).toEqual(sourceMeshes);
      else expect(sourceMeshes).toEqual([]);
    }
  });

  it('matches all 17 hinge targets, partners, and referentials', () => {
    if (!file) return;
    const hinges = file.objects
      .filter((record): record is BehaviorRec => record.kind === 'behavior')
      .filter((record) => record.name === 'Set Physics Hinge' && record.headerData.length >= 7);
    expect(hinges).toHaveLength(17);
    expect(BALLOON_HINGES).toHaveLength(17);
    for (const behavior of hinges) {
      const sourceTarget = target(file, behavior);
      const input = parameters(file, behavior);
      const other = objectValue(file, input.get('Object2'));
      const pin = objectValue(file, input.get('Joint Referential'));
      const definition = BALLOON_HINGES.find(
        (hinge) =>
          !!sourceTarget &&
          matchingSuffix(sourceTarget.name, hinge.target) &&
          !!pin &&
          matchingSuffix(pin.name, hinge.pin) &&
          (other ? !!hinge.other && matchingSuffix(other.name, hinge.other) : hinge.other === undefined),
      );
      expect(definition, `${sourceTarget?.name} -> ${other?.name ?? 'world'} at ${pin?.name}`).toBeDefined();
      expect(boolValue(input.get('Limitations (-180 to 180 degree)'))).toBe(false);
    }
  });

  it('matches both sliders and the spring, including signed limits', () => {
    if (!file) return;
    const sliders = file.objects
      .filter((record): record is BehaviorRec => record.kind === 'behavior')
      .filter((record) => record.name === 'Set Physics Slider' && record.headerData.length >= 7);
    expect(sliders).toHaveLength(2);
    expect(BALLOON_SLIDERS).toHaveLength(2);
    for (const behavior of sliders) {
      const sourceTarget = target(file, behavior);
      const input = parameters(file, behavior);
      const other = objectValue(file, input.get('Object2'));
      const first = objectValue(file, input.get('Axis first Point'));
      const second = objectValue(file, input.get('Axis second Point'));
      const definition = BALLOON_SLIDERS.find(
        (slider) =>
          !!sourceTarget &&
          matchingSuffix(sourceTarget.name, slider.target) &&
          (other ? !!slider.other && matchingSuffix(other.name, slider.other) : slider.other === undefined),
      );
      expect(definition).toBeDefined();
      expect(first?.name.endsWith(definition?.points[0] ?? '')).toBe(true);
      expect(second?.name.endsWith(definition?.points[1] ?? '')).toBe(true);
      if (boolValue(input.get('Limitations (meter)'))) {
        expect(definition?.limits?.[0]).toBeCloseTo(floatValue(input.get('Lower Limit')), 6);
        expect(definition?.limits?.[1]).toBeCloseTo(floatValue(input.get('Upper Limit')), 6);
      } else {
        expect(definition?.limits).toBeUndefined();
      }
    }

    const spring = file.objects
      .filter((record): record is BehaviorRec => record.kind === 'behavior')
      .find((record) => record.name === 'Set Physics Spring' && record.headerData.length >= 7);
    expect(spring).toBeDefined();
    if (!spring) return;
    const springTarget = target(file, spring);
    const input = parameters(file, spring);
    expect(springTarget?.name.endsWith(BALLOON_SPRING.target)).toBe(true);
    expect(objectValue(file, input.get('Object2'))?.name.endsWith(BALLOON_SPRING.other)).toBe(true);
    expect(objectValue(file, input.get('Referential 1'))?.name.endsWith(BALLOON_SPRING.anchor1)).toBe(true);
    expect(objectValue(file, input.get('Referential 2'))?.name.endsWith(BALLOON_SPRING.anchor2)).toBe(true);
    expect(vectorValue(input.get('Position 1'))).toEqual([0, 0, 0]);
    expect(vectorValue(input.get('Position 2'))).toEqual([0, 0, 0]);
    expect(BALLOON_SPRING.length).toBeCloseTo(floatValue(input.get('Length')), 6);
    expect(BALLOON_SPRING.stiffness).toBeCloseTo(floatValue(input.get('Constant')), 6);
    expect(BALLOON_SPRING.damping).toBeCloseTo(floatValue(input.get('Linear Dampening')), 6);
  });

  it('matches all nine source force targets, directions, references, and values', () => {
    if (!file) return;
    const forces = file.objects
      .filter((record): record is BehaviorRec => record.kind === 'behavior')
      .filter((record) => record.name === 'SetPhysicsForce' && record.headerData.length >= 7);
    const definitions = [...BALLOON_FORCES, BALLOON_LAUNCH_FORCE];
    expect(forces).toHaveLength(9);
    expect(definitions).toHaveLength(9);
    for (const behavior of forces) {
      const sourceTarget = target(file, behavior);
      const input = parameters(file, behavior);
      const reference = objectValue(file, input.get('Direction Ref'));
      const direction = vectorValue(input.get('Direction'));
      const definition = definitions.find(
        (force) =>
          !!sourceTarget &&
          matchingSuffix(sourceTarget.name, force.part) &&
          !!reference &&
          matchingSuffix(reference.name, force.reference) &&
          force.direction.every((value, axis) => Math.abs(value - direction[axis]) < 1e-6),
      );
      expect(definition, `${sourceTarget?.name} force ${direction.join(',')}`).toBeDefined();
      expect(definition?.value).toBeCloseTo(floatValue(input.get('Force Value')), 6);
    }
  });

  it('matches the UFO flat-loop distance and speed-controlled pitch graph', () => {
    if (!file) return;
    const ufo = file.byName.get('UFO')?.find((record): record is BehaviorRec => record.kind === 'behavior');
    expect(ufo).toBeDefined();
    if (!ufo) return;
    const children = ufo.referenceLists.flat().map((index) => file.objects[index]);
    const proximity = children.find(
      (record): record is BehaviorRec => record?.kind === 'behavior' && record.name === 'TT ProximityVolumeControl',
    );
    const speedometer = children.find(
      (record): record is BehaviorRec => record?.kind === 'behavior' && record.name === 'TT SpeedOMeter',
    );
    const calculator = children.find(
      (record): record is BehaviorRec => record?.kind === 'behavior' && record.name === 'Calculator',
    );
    expect(floatValue(proximity ? parameters(file, proximity).get('Near-Distance') : undefined)).toBe(
      UFO_SOUND_SOURCE.nearDistance,
    );
    expect(floatValue(proximity ? parameters(file, proximity).get('Far-Distance') : undefined)).toBe(
      UFO_SOUND_SOURCE.farDistance,
    );
    expect(floatValue(speedometer ? parameters(file, speedometer).get('Minimum Speed') : undefined)).toBe(
      UFO_SOUND_SOURCE.minimumSpeed,
    );
    expect(floatValue(speedometer ? parameters(file, speedometer).get('Maximum Speed') : undefined)).toBe(
      UFO_SOUND_SOURCE.maximumSpeed,
    );
    expect(stringValue(calculator ? parameters(file, calculator).get('expression') : undefined)).toBe('a+1');
    expect(ufoSoundPitch(0)).toBe(1);
    expect(ufoSoundPitch(50)).toBe(1.5);
    expect(ufoSoundPitch(100)).toBe(2);
    expect(ufoSoundPitch(200)).toBe(2);
  });

  it('keeps the three UFO wave players and their distinct authored triggers', () => {
    if (!file) return;
    const ufo = file.byName.get('UFO')?.find((record): record is BehaviorRec => record.kind === 'behavior');
    const grab = file.byName.get('Greif Anim')?.find((record): record is BehaviorRec => record.kind === 'behavior');
    expect(ufo).toBeDefined();
    expect(grab).toBeDefined();
    if (!ufo || !grab) return;
    const ufoChildren = ufo.referenceLists.flat().map((index) => file.objects[index]);
    const ufoPlayers = ufoChildren.filter(
      (record): record is BehaviorRec => record?.kind === 'behavior' && record.name === 'Wave Player',
    );
    const grabPlayers = grab.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .filter((record): record is BehaviorRec => record?.kind === 'behavior' && record.name === 'Wave Player');
    expect(ufoPlayers.map((player) => targetName(file, player)).sort()).toEqual(['Misc_UFO', 'Music_Final']);
    expect(grabPlayers.map((player) => targetName(file, player))).toEqual(['Misc_UFO_anim']);

    const rowTest = ufoChildren.find(
      (record): record is BehaviorRec => record?.kind === 'behavior' && record.name === 'Test',
    );
    expect(intValue(rowTest ? parameters(file, rowTest).get('B') : undefined)).toBe(11);
    expect(decodeUfoPath(file).filter((step) => step.startAnimation)).toHaveLength(1);
  });

  it('evaluates the UFO arms with the shipped quaternion TCB controller', () => {
    if (!file) return;
    const animation = file.byName
      .get('UFO_Animation')
      ?.find((record) => record.kind === 'keyedAnimation');
    expect(animation?.kind).toBe('keyedAnimation');
    if (!animation || animation.kind !== 'keyedAnimation') return;
    const track = file.objects[animation.animationIndices[0]];
    expect(track.kind).toBe('objectAnimation');
    if (track.kind !== 'objectAnimation') return;

    expect(track.rotationControllerType).toBe(0x45b52a02);
    const controls = buildVxTcbControls(track.rotationKeys);
    const at47 = evaluateVxTcbRotation(track.rotationKeys, controls, 47);
    const at72Half = evaluateVxTcbRotation(track.rotationKeys, controls, 72.5);
    expect(at47.z).toBeCloseTo(0.09910679163503085, 12);
    expect(at47.w).toBeCloseTo(-0.9950768029915132, 12);
    expect(at72Half.z).toBeCloseTo(-0.45400392577589826, 12);
    expect(at72Half.w).toBeCloseTo(-0.8909996831537442, 12);

    const previous = track.rotationKeys[1].quaternion;
    const next = track.rotationKeys[2].quaternion;
    const linear = new THREE.Quaternion(-previous[0], -previous[1], previous[2], previous[3])
      .normalize()
      .slerp(new THREE.Quaternion(-next[0], -next[1], next[2], next[3]).normalize(), 0.5);
    expect(Math.abs(linear.z - at47.z)).toBeGreaterThan(0.01);
  });
});
