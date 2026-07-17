/** CLI: node tools/dump-nmo.ts <file.nmo> [--full] — summarize an NMO file. */
import { readFileSync } from 'node:fs';
import { parseNmo } from '../src/formats/ck2/nmo.ts';

const path = process.argv[2];
if (!path) {
  console.error('usage: node tools/dump-nmo.ts <file.nmo> [--full]');
  process.exit(1);
}
const full = process.argv.includes('--full');
const file = parseNmo(readFileSync(path));

console.log(`fileVersion=${file.info.fileVersion} writeMode=${file.info.fileWriteMode} objects=${file.objects.length}`);

const byKind = new Map<string, number>();
for (const o of file.objects) byKind.set(o.kind, (byKind.get(o.kind) ?? 0) + 1);
console.log('kinds:', Object.fromEntries(byKind));

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
    const mesh = e.meshIndex >= 0 ? file.objects[e.meshIndex] : null;
    const p = [e.worldMatrix[12], e.worldMatrix[13], e.worldMatrix[14]].map((v) => v.toFixed(1));
    console.log(`  ${e.name} vis=${e.visible} pos=(${p}) mesh=${mesh?.name ?? '-'}`);
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
