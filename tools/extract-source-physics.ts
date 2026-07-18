/**
 * Read-only archaeology tool for the original PH/*.nmo behavior graphs.
 *
 * Usage:
 *   node --experimental-strip-types tools/extract-source-physics.ts [PH directory]
 *
 * The output is deliberately lossless enough for parity work: values are
 * decoded with their serialized parameter GUIDs, while every parameter chain
 * and referenced object index remains visible for independent verification.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNmo } from '../src/formats/ck2/nmo.ts';
import type { BehaviorRec, NmoFile, ParameterRec } from '../src/formats/ck2/types.ts';

const DEFAULT_PH_DIR = 'Ballance_bin/source1/Ballance/3D Entities/PH';
const PHYSICS_BEHAVIOR =
  /^(?:Physicalize|Set Physics (?:Hinge|Ball Joint|Slider|Spring)|SetPhysicsForce|Physics Force)$/i;

const TYPE_GUID = {
  bool: '1ad52a8e:5e741920',
  float: '47884c3f:432c2c20',
  vector: '48824eae:2fe47960',
  int: '5a5716fd:44e276d7',
  object: '5b8a05d5:31ea28d4',
} as const;

interface ResolvedParameter {
  record: ParameterRec;
  chain: number[];
}

interface DecodedParameter {
  index: number;
  name: string;
  chain: number[];
  guid: string | null;
  value: unknown;
}

function resolveParameter(file: NmoFile, parameter: ParameterRec): ResolvedParameter {
  const chain = [parameter.index];
  const seen = new Set(chain);
  let record = parameter;
  for (let depth = 0; depth < 32; depth++) {
    const nextIndex = record.sourceIndex >= 0 ? record.sourceIndex : record.sharedIndex;
    if (nextIndex < 0 || seen.has(nextIndex)) break;
    const next = file.objects[nextIndex];
    if (next?.kind !== 'parameter') break;
    chain.push(nextIndex);
    seen.add(nextIndex);
    record = next;
  }
  return { record, chain };
}

function guidString(parameter: ParameterRec): string | null {
  return parameter.typeGuid?.map((part) => part.toString(16).padStart(8, '0')).join(':') ?? null;
}

function decodeValue(file: NmoFile, parameter: ParameterRec): unknown {
  if (parameter.valueObjectIndex >= 0) {
    const object = file.objects[parameter.valueObjectIndex];
    return { objectIndex: parameter.valueObjectIndex, objectName: object?.name ?? null, objectKind: object?.kind ?? null };
  }

  const bytes = parameter.valueBytes;
  if (bytes.length === 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const guid = guidString(parameter);
  if (guid === TYPE_GUID.bool && bytes.length >= 4) return view.getUint32(0, true) !== 0;
  if (guid === TYPE_GUID.float && bytes.length >= 4) return view.getFloat32(0, true);
  if (guid === TYPE_GUID.int && bytes.length >= 4) return view.getInt32(0, true);
  if (guid === TYPE_GUID.vector && bytes.length >= 12) {
    return [view.getFloat32(0, true), view.getFloat32(4, true), view.getFloat32(8, true)];
  }
  if (guid === TYPE_GUID.object && bytes.length >= 4) {
    const objectIndex = view.getInt32(0, true);
    const object = objectIndex >= 0 ? file.objects[objectIndex] : null;
    return { objectIndex, objectName: object?.name ?? null, objectKind: object?.kind ?? null };
  }

  const nul = bytes.indexOf(0);
  const textBytes = bytes.subarray(0, nul >= 0 ? nul : bytes.length);
  if (textBytes.length > 0 && [...textBytes].every((byte) => byte >= 0x20 && byte <= 0x7e)) {
    return new TextDecoder('windows-1252').decode(textBytes);
  }
  if (bytes.length === 4) {
    return { u32: view.getUint32(0, true), i32: view.getInt32(0, true), f32: view.getFloat32(0, true) };
  }
  if (bytes.length % 4 === 0) {
    return Array.from({ length: bytes.length / 4 }, (_, index) => view.getFloat32(index * 4, true));
  }
  return { hex: [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('') };
}

function decodeParameter(file: NmoFile, parameter: ParameterRec): DecodedParameter {
  const resolved = resolveParameter(file, parameter);
  return {
    index: parameter.index,
    name: parameter.name,
    chain: resolved.chain,
    guid: guidString(resolved.record),
    value: decodeValue(file, resolved.record),
  };
}

function behaviorTarget(file: NmoFile, behavior: BehaviorRec): DecodedParameter | null {
  // Plugin building blocks serialize their Target CKParameterIn directly
  // before saveFlags in the behavior header. Script/composite behaviors have
  // a short two-dword header and are intentionally excluded.
  if (behavior.headerData.length < 7) return null;
  const targetIndex = behavior.headerData.at(-2);
  if (targetIndex === undefined) return null;
  const target = file.objects[targetIndex];
  return target?.kind === 'parameter' ? decodeParameter(file, target) : null;
}

function extractFile(path: string): unknown {
  const file = parseNmo(readFileSync(path));
  const behaviors = file.objects
    .filter((record): record is BehaviorRec => record.kind === 'behavior')
    .filter((record) => PHYSICS_BEHAVIOR.test(record.name) && record.headerData.length >= 7)
    .map((behavior) => {
      const parameters = behavior.referenceLists
        .flat()
        .map((index) => file.objects[index])
        .filter((record): record is ParameterRec => record?.kind === 'parameter')
        .map((parameter) => decodeParameter(file, parameter));
      return { index: behavior.index, name: behavior.name, target: behaviorTarget(file, behavior), parameters };
    });
  return { file: path, objectCount: file.objects.length, behaviors };
}

const phDir = process.argv[2] ?? DEFAULT_PH_DIR;
const files = readdirSync(phDir)
  .filter((name) => name.endsWith('.nmo'))
  .filter((name) => /^(?:P_Modul_\d+|PE_Balloon)\.nmo$/i.test(name))
  .sort();
console.log(JSON.stringify(files.map((name) => extractFile(join(phDir, name))), null, 2));
