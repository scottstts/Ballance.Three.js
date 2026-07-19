/**
 * Read-only CKWaveSound and sound-building-block census for the original game.
 * Usage: node --experimental-strip-types tools/audit-audio.ts [game-root]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseNmo } from '../src/formats/ck2/nmo.ts';
import type { BehaviorRec, NmoFile, ParameterRec } from '../src/formats/ck2/types.ts';

const defaultRoots = ['Ballance_bin/source1/Ballance', 'Ballance_bin/Ballance'];
const root = process.argv[2] ?? defaultRoots.find(existsSync);
if (!root) throw new Error('missing original game root');

function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? filesBelow(path)
      : /\.(?:nmo|cmo)$/i.test(entry.name)
        ? [path]
        : [];
  });
}

function resolveParameter(file: NmoFile, parameter: ParameterRec): ParameterRec {
  let current = parameter;
  const seen = new Set([current.index]);
  while (current.sourceIndex >= 0 || current.sharedIndex >= 0) {
    const index = current.sourceIndex >= 0 ? current.sourceIndex : current.sharedIndex;
    const next = file.objects[index];
    if (next?.kind !== 'parameter' || seen.has(next.index)) break;
    seen.add(next.index);
    current = next;
  }
  return current;
}

function targetWave(file: NmoFile, behavior: BehaviorRec): string | null {
  const indices = [...behavior.headerData, ...behavior.referenceLists.flat()];
  for (const index of indices) {
    const parameter = file.objects[index];
    if (parameter?.kind !== 'parameter') continue;
    const resolved = resolveParameter(file, parameter);
    const target = file.objects[resolved.valueObjectIndex];
    if (target?.kind === 'waveSound') return target.name;
  }
  return null;
}

const rows: Record<string, unknown>[] = [];
for (const path of filesBelow(root)) {
  let file: NmoFile;
  try {
    file = parseNmo(readFileSync(path));
  } catch {
    continue;
  }
  const source = relative(root, path);
  const behaviors = file.objects.filter((record): record is BehaviorRec => record.kind === 'behavior');
  const soundBlocks = behaviors
    .map((behavior) => ({ index: behavior.index, name: behavior.name, target: targetWave(file, behavior) }))
    .filter(({ target }) => target !== null);
  for (const sound of file.objects.filter((record) => record.kind === 'waveSound')) {
    if (sound.kind !== 'waveSound') continue;
    rows.push({
      source,
      index: sound.index,
      name: sound.name,
      file: sound.fileName,
      waveType: sound.waveType,
      loop: sound.loop,
      streaming: sound.streaming,
      gain: sound.gain,
      pan: sound.pan,
      pitch: sound.pitch,
      priority: sound.priority,
      minDistance: sound.minDistance,
      maxDistance: sound.maxDistance,
      attached: file.objects[sound.attachedEntityIndex]?.name ?? null,
      blocks: soundBlocks
        .filter(({ target }) => target === sound.name)
        .map(({ index, name }) => ({ index, name })),
    });
  }
}

rows.sort((a, b) => `${a.source}/${a.name}`.localeCompare(`${b.source}/${b.name}`));
console.log(JSON.stringify(rows, null, 2));
