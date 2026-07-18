/** CLI: node tools/dump-nmo.ts <file.nmo> [--full] — summarize an NMO file. */
import { readFileSync } from 'node:fs';
import { parseNmo } from '../src/formats/ck2/nmo.ts';
import type { CameraRec, CKRecord, ParameterRec } from '../src/formats/ck2/types.ts';

const path = process.argv[2];
if (!path) {
  console.error('usage: node tools/dump-nmo.ts <file.nmo> [--full]');
  process.exit(1);
}
const full = process.argv.includes('--full');
const objects = process.argv.includes('--objects');
const identifiers = process.argv.includes('--identifiers');
const raw = process.argv.includes('--raw');
const references = process.argv.includes('--references');
const decoded = process.argv.includes('--decoded');
const graphEdgesOnly = process.argv.includes('--edges-only');
const graphFilter = process.argv.find((arg) => arg.startsWith('--graph='))?.slice('--graph='.length);
const graphIndexText = process.argv.find((arg) => arg.startsWith('--graph-index='))?.slice('--graph-index='.length);
const graphIndex = graphIndexText === undefined ? null : Number(graphIndexText);
const nameFilter = process.argv.find((arg) => arg.startsWith('--name='))?.slice('--name='.length);
const classFilterText = process.argv.find((arg) => arg.startsWith('--class='))?.slice('--class='.length);
const classFilter = classFilterText === undefined ? null : Number(classFilterText);
const indexFilterText = process.argv.find((arg) => arg.startsWith('--index='))?.slice('--index='.length);
const indexFilter = indexFilterText === undefined ? null : Number(indexFilterText);
const fromFilterText = process.argv.find((arg) => arg.startsWith('--from='))?.slice('--from='.length);
const fromFilter = fromFilterText === undefined ? null : Number(fromFilterText);
const toFilterText = process.argv.find((arg) => arg.startsWith('--to='))?.slice('--to='.length);
const toFilter = toFilterText === undefined ? null : Number(toFilterText);
const containsIndexText = process.argv.find((arg) => arg.startsWith('--contains-index='))?.slice('--contains-index='.length);
const containsIndex = containsIndexText === undefined ? null : Number(containsIndexText);
const file = parseNmo(readFileSync(path));

function parameterValue(parameter: ParameterRec): string {
  if (parameter.managerGuid && parameter.managerInt !== null) {
    const manager = parameter.managerGuid.map((value) => value.toString(16).padStart(8, '0')).join(':');
    const message = parameter.managerGuid[0] === 0x466a0fac ? file.messageTypes[parameter.managerInt] : undefined;
    return `manager=${manager} int=${parameter.managerInt}` + (message === undefined ? '' : ` value=${JSON.stringify(message)}`);
  }
  if (parameter.valueObjectIndex >= 0) {
    const object = file.objects[parameter.valueObjectIndex];
    return `object=[${parameter.valueObjectIndex}]${JSON.stringify(object?.name ?? '')}`;
  }
  const bytes = parameter.valueBytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length === 4) {
    const u32 = view.getUint32(0, true);
    const object = u32 < file.objects.length ? file.objects[u32] : null;
    return `u32=${u32} i32=${view.getInt32(0, true)} f32=${view.getFloat32(0, true)}` +
      (object ? ` object=[${u32}]${JSON.stringify(object.name)}` : '');
  }
  if (bytes.length > 0 && bytes.length % 4 === 0) {
    const floats = Array.from({ length: bytes.length / 4 }, (_, index) => view.getFloat32(index * 4, true));
    return `f32=[${floats.join(',')}]`;
  }
  return `hex=${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function resolveParameter(parameter: ParameterRec): { record: ParameterRec; chain: number[] } {
  const chain = [parameter.index];
  let current = parameter;
  const seen = new Set(chain);
  for (let depth = 0; depth < 16; depth++) {
    const nextIndex = current.sourceIndex >= 0 ? current.sourceIndex : current.sharedIndex;
    if (nextIndex < 0 || seen.has(nextIndex)) break;
    const next = file.objects[nextIndex];
    if (next?.kind !== 'parameter') break;
    chain.push(nextIndex);
    seen.add(nextIndex);
    current = next;
  }
  return { record: current, chain };
}

console.log(`fileVersion=${file.info.fileVersion} writeMode=${file.info.fileWriteMode} objects=${file.objects.length}`);

const byKind = new Map<string, number>();
for (const o of file.objects) byKind.set(o.kind, (byKind.get(o.kind) ?? 0) + 1);
console.log('kinds:', Object.fromEntries(byKind));

if (objects) {
  console.log('\n== object table ==');
  for (const o of file.objects) {
    if (nameFilter !== undefined && !o.name.toLocaleLowerCase().includes(nameFilter.toLocaleLowerCase())) continue;
    if (classFilter !== null && o.classId !== classFilter) continue;
    if (indexFilter !== null && o.index !== indexFilter) continue;
    if (fromFilter !== null && o.index < fromFilter) continue;
    if (toFilter !== null && o.index > toFilter) continue;
    if (containsIndex !== null && (o.kind !== 'behavior' || !o.referenceLists.some((list) => list.includes(containsIndex)))) continue;
    const chunk = file.chunks[o.index];
    console.log(
      `  [${String(o.index).padStart(4)}] class=${String(o.classId).padStart(3)} kind=${o.kind.padEnd(8)} ` +
        `name=${JSON.stringify(o.name)} chunk=${chunk ? `${chunk.data.length}dw` : '-'}`,
    );
    if (identifiers && chunk) {
      for (const id of chunk.identifiers()) {
        console.log(
          `         ident=0x${id.identifier.toString(16).padStart(8, '0')} at=${id.position} payload=${id.payloadDwords}dw`,
        );
      }
    }
    if (raw && chunk) {
      for (let pos = 0; pos < chunk.data.length; pos += 8) {
        const values = [...chunk.data.subarray(pos, pos + 8)];
        const hex = values.map((value) => value.toString(16).padStart(8, '0')).join(' ');
        const ascii = values
          .flatMap((value) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24])
          .map((value) => (value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '.'))
          .join('');
        console.log(`         ${String(pos).padStart(5)}: ${hex.padEnd(71)}  ${ascii}`);
      }
    }
    if (references && chunk) {
      for (let pos = 0; pos < chunk.data.length; pos++) {
        const target = chunk.data[pos] | 0;
        const ref = target >= 0 && target < file.objects.length ? file.objects[target] : null;
        if (!ref || ref.name === '') continue;
        console.log(
          `         ref@${pos} -> [${target}] class=${ref.classId} kind=${ref.kind} name=${JSON.stringify(ref.name)}`,
        );
      }
    }
    if (decoded) {
      if (o.kind === 'parameter') {
        console.log(
          `         type=${o.typeGuid?.map((value) => `0x${value.toString(16).padStart(8, '0')}`).join(':') ?? '-'} ` +
            `version=${o.valueVersion} ${parameterValue(o)} owner=${o.ownerIndex} shared=${o.sharedIndex} source=${o.sourceIndex}`,
        );
      } else if (o.kind === 'behaviorLink') {
        const output = o.outputIndex >= 0 ? file.objects[o.outputIndex] : null;
        const input = o.inputIndex >= 0 ? file.objects[o.inputIndex] : null;
        console.log(
          `         delay=${o.activationDelay}/${o.currentDelay} output=[${o.outputIndex}]${JSON.stringify(output?.name ?? '')} ` +
            `input=[${o.inputIndex}]${JSON.stringify(input?.name ?? '')}`,
        );
      } else if (o.kind === 'behaviorIo') {
        console.log(`         flags=0x${o.flags.toString(16)}`);
      } else if (o.kind === 'behavior') {
        console.log(
          `         flags=0x${o.behaviorFlags.toString(16)} save=0x${o.saveFlags.toString(16)} ` +
            `header=${o.headerData.map((value) => `0x${value.toString(16)}`).join(',')}`,
        );
        o.referenceLists.forEach((list, listIndex) => {
          const members = list.map((target) => {
            const ref = target >= 0 && target < file.objects.length ? file.objects[target] : null;
            return `[${target}]c${ref?.classId ?? '-'}:${JSON.stringify(ref?.name ?? '')}`;
          });
          console.log(`         list${listIndex}(${list.length}) ${members.join(' ')}`);
        });
        if (o.trailingData.length) {
          console.log(`         trailing ${o.trailingData.map((value) => `0x${value.toString(16)}`).join(' ')}`);
        }
      } else if (o.kind === 'objectAnimation') {
        console.log(`         entity=${o.entityIndex} length=${o.length} rotationKeys=${o.rotationKeys.length}`);
        for (const key of o.rotationKeys) {
          console.log(`         t=${key.time} q=${key.quaternion.join(',')} tcb=${key.tension},${key.continuity},${key.bias}`);
        }
      } else if (o.kind === 'keyedAnimation') {
        console.log(`         animations=${o.animationIndices.join(',')}`);
      } else if (o.kind === 'entity') {
        console.log(`         place=${o.placeIndex} parent=${o.parentIndex}`);
        if ('fieldOfView' in o) {
          const camera = o as CameraRec;
          console.log(
            `         camera projection=${camera.projectionType} fov=${camera.fieldOfView} zoom=${camera.orthographicZoom} ` +
              `aspect=0x${camera.aspectRatio.toString(16)} planes=${camera.nearPlane},${camera.farPlane} target=${camera.targetIndex}`,
          );
        }
        console.log(
          `         matrix=${Array.from(o.worldMatrix)
            .map((value) => Number(value.toFixed(7)))
            .join(',')}`,
        );
      } else if (o.kind === 'sprite3d') {
        console.log(`         parent=${o.parentIndex} material=${o.materialIndex} size=${o.size.join(',')} uv=${o.uvRect.join(',')}`);
        console.log(
          `         matrix=${Array.from(o.worldMatrix)
            .map((value) => Number(value.toFixed(7)))
            .join(',')}`,
        );
      } else if (o.kind === 'light') {
        console.log(
          `         parent=${o.entity.parentIndex} type=${o.lightType} active=${o.active} specular=${o.specularFlag} color=${o.color.join(',')} ` +
            `attenuation=${o.constAttenuation},${o.linearAttenuation},${o.quadAttenuation} range=${o.range} power=${o.lightPower}`,
        );
        console.log(
          `         matrix=${Array.from(o.entity.worldMatrix)
            .map((value) => Number(value.toFixed(7)))
            .join(',')}`,
        );
      } else if (o.kind === 'material') {
        const texture = o.textureIndex >= 0 ? file.objects[o.textureIndex] : null;
        console.log(
          `         texture=[${o.textureIndex}]${JSON.stringify(texture?.name ?? '')} ` +
            `blend=${o.sourceBlend}/${o.destBlend} alpha=${o.alphaBlend}/${o.alphaTest} ` +
            `address=${o.textureAddressMode} diffuse=${o.diffuse.join(',')}`,
        );
      } else if (o.kind === 'entity2d') {
        console.log(
          `         flags=0x${o.flags.toString(16)} rect=${o.rect.join(',')} relative=${o.relativeRect.join(',')} ` +
          `material=${o.materialIndex} parent=${o.parentIndex}`,
        );
      } else if (o.kind === 'waveSound') {
        console.log(
          `         file=${JSON.stringify(o.fileName)} type=${o.waveType} flags=0x${o.flags.toString(16)} ` +
            `loop=${o.loop} streaming=${o.streaming} lengthMs=${o.soundLengthMs} ` +
            `priority=${o.priority} gain=${o.gain} pan=${o.pan} pitch=${o.pitch}`,
        );
        console.log(
          `         cone=${o.cone.join(',')} distance=${o.minDistance},${o.maxDistance},${o.distanceModel} ` +
            `attached=${o.attachedEntityIndex} position=${o.position.join(',')} direction=${o.direction.join(',')}`,
        );
      } else if (o.kind === 'dataArray') {
        console.log(`         columns=${JSON.stringify(o.columns)}`);
        console.log(`         rows=${JSON.stringify(o.rows)}`);
      } else if (o.kind === 'curve') {
        console.log(
          `         points=${o.pointIndices.join(',')} open=${o.open} steps=${o.stepCount} fit=${o.fittingCoefficient}`,
        );
        console.log(
          `         matrix=${Array.from(o.entity.worldMatrix)
            .map((value) => Number(value.toFixed(7)))
            .join(',')}`,
        );
      } else if (o.kind === 'curvePoint') {
        console.log(
          `         curve=${o.curveIndex} flags=0x${o.flags.toString(16)} tcb=${o.tension},${o.continuity},${o.bias} ` +
            `position=${o.curvePosition} incoming=${o.incomingTangent.join(',')} outgoing=${o.outgoingTangent.join(',')}`,
        );
        console.log(
          `         matrix=${Array.from(o.entity.worldMatrix)
            .map((value) => Number(value.toFixed(7)))
            .join(',')}`,
        );
      }
    }
  }
}

if (graphFilter !== undefined || graphIndex !== null) {
  const byIndex = graphIndex === null ? undefined : file.objects[graphIndex];
  const composite = byIndex?.kind === 'behavior'
    ? byIndex
    : graphFilter === undefined
      ? undefined
      : file.byName
          .get(graphFilter)
          ?.find((record): record is Extract<CKRecord, { kind: 'behavior' }> => record.kind === 'behavior');
  if (!composite) {
    console.log(`\n== behavior graph ${graphIndex === null ? JSON.stringify(graphFilter) : `[${graphIndex}]`} not found ==`);
  } else {
    const ioOwner = new Map<number, Extract<CKRecord, { kind: 'behavior' }>>();
    for (const record of file.objects) {
      if (record.kind !== 'behavior') continue;
      for (const list of record.referenceLists) {
        for (const index of list) if (file.objects[index]?.kind === 'behaviorIo') ioOwner.set(index, record);
      }
    }
    const nodes = composite.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .filter((record): record is Extract<CKRecord, { kind: 'behavior' }> => record?.kind === 'behavior');
    const links = composite.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .filter((record): record is Extract<CKRecord, { kind: 'behaviorLink' }> => record?.kind === 'behaviorLink');
    console.log(`\n== behavior graph ${JSON.stringify(composite.name)} [${composite.index}] ==`);
    if (!graphEdgesOnly) {
      for (const node of nodes) {
        console.log(`  node [${node.index}] ${JSON.stringify(node.name)}`);
        const parameters = node.referenceLists
          .flat()
          .map((index) => file.objects[index])
          .filter((record): record is ParameterRec => record?.kind === 'parameter');
        for (const parameter of parameters) {
          const resolved = resolveParameter(parameter);
          console.log(
            `    param [${parameter.index}] ${JSON.stringify(parameter.name)} chain=${resolved.chain.join('->')} ` +
              `${parameterValue(resolved.record)}`,
          );
        }
      }
    }
    console.log('  edges');
    for (const link of links) {
      const from = ioOwner.get(link.outputIndex);
      const to = ioOwner.get(link.inputIndex);
      const output = file.objects[link.outputIndex];
      const input = file.objects[link.inputIndex];
      console.log(
        `    [${from?.index ?? '-'}]${JSON.stringify(from?.name ?? '')}.${JSON.stringify(output?.name ?? '')} -> ` +
          `[${to?.index ?? '-'}]${JSON.stringify(to?.name ?? '')}.${JSON.stringify(input?.name ?? '')} ` +
          `delay=${link.activationDelay}`,
      );
    }
  }
}

const arrays = file.objects.filter((o) => o.kind === 'dataArray');
if (arrays.length > 0 && (full || process.argv.includes('--arrays'))) {
  console.log('\n== data arrays ==');
  for (const array of arrays) {
    if (nameFilter !== undefined && !array.name.toLocaleLowerCase().includes(nameFilter.toLocaleLowerCase())) continue;
    console.log(`  ${array.name} (${array.rows.length} rows)`);
    console.log(`    ${array.columns.map((column) => `${column.name}[${column.type}]`).join(' | ')}`);
    for (const row of array.rows) console.log(`    ${row.map((value) => JSON.stringify(value)).join(' | ')}`);
  }
}

console.log('\n== groups ==');
for (const g of file.groups) {
  console.log(`  ${g.name} (${g.memberIndices.length})`);
  if (full) {
    for (const idx of g.memberIndices) {
      const m = file.objects[idx];
      console.log(`      ${m.kind}: ${m.name}`);
    }
  }
}

console.log('\n== textures ==');
for (const o of file.objects) {
  if (o.kind !== 'texture') continue;
  const src = o.fileNames.filter(Boolean).join(',') || (o.embedded.some(Boolean) ? `embedded:${o.embedded.find(Boolean)?.ext}` : o.raw ? 'raw' : 'none');
  console.log(`  ${o.name} -> ${src} transparent=${o.transparent} tc=${o.transparentColor.toString(16)}`);
}

if (full) {
  console.log('\n== entities ==');
  for (const e of file.entities) {
    const mesh = e.kind === 'entity' && e.meshIndex >= 0 ? file.objects[e.meshIndex] : null;
    const p = [e.worldMatrix[12], e.worldMatrix[13], e.worldMatrix[14]].map((v) => v.toFixed(1));
    const visual = e.kind === 'sprite3d' ? `sprite=${file.objects[e.materialIndex]?.name ?? '-'}` : `mesh=${mesh?.name ?? '-'}`;
    console.log(`  ${e.name} vis=${e.visible} pos=(${p}) ${visual}`);
  }
  console.log('\n== materials ==');
  for (const o of file.objects) {
    if (o.kind !== 'material') continue;
    const tex = o.textureIndex >= 0 ? file.objects[o.textureIndex].name : '-';
    console.log(
      `  ${o.name} tex=${tex} d=${o.diffuse.map((c) => c.toFixed(2))} e=${o.emissive.map((c) => c.toFixed(2))} ` +
        `blend=${o.alphaBlend ? `${o.sourceBlend}/${o.destBlend}` : '-'} 2s=${o.twoSided} zw=${o.zWrite} at=${o.alphaTest}`,
    );
  }
}
