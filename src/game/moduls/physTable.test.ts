import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../../formats/ck2/nmo.ts';
import type { BehaviorRec, NmoFile, ParameterRec } from '../../formats/ck2/types.ts';
import { MODUL_PHYS } from './physTable.ts';

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

function boolValue(parameter: ParameterRec | undefined): boolean {
  if (!parameter || parameter.valueBytes.length < 4) return false;
  return new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset).getUint32(0, true) !== 0;
}

function vectorValue(parameter: ParameterRec | undefined): [number, number, number] {
  if (!parameter || parameter.valueBytes.length < 12) return [Number.NaN, Number.NaN, Number.NaN];
  const view = new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset);
  return [view.getFloat32(0, true), view.getFloat32(4, true), view.getFloat32(8, true)];
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
});
