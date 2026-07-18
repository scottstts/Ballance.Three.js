/**
 * Read-only census of TT Scaleable Proximity and TT Extra blocks in original
 * NMO files. Usage: node tools/audit-proximity.ts [game-root]
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
    return entry.isDirectory() ? filesBelow(path) : /\.nmo$/i.test(entry.name) ? [path] : [];
  });
}

function resolve(file: NmoFile, parameter: ParameterRec): ParameterRec {
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

function parameters(file: NmoFile, behavior: BehaviorRec): Map<string, ParameterRec> {
  return new Map(
    behavior.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .filter((record): record is ParameterRec => record?.kind === 'parameter')
      .map((parameter) => [parameter.name, resolve(file, parameter)]),
  );
}

function number(parameter: ParameterRec | undefined, integer = false): number | null {
  if (!parameter || parameter.valueBytes.length < 4) return null;
  const view = new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset);
  return integer ? view.getInt32(0, true) : view.getFloat32(0, true);
}

function objectName(file: NmoFile, parameter: ParameterRec | undefined): string | null {
  return file.objects[parameter?.valueObjectIndex ?? -1]?.name ?? null;
}

const rows: Record<string, unknown>[] = [];
for (const path of filesBelow(root)) {
  let file: NmoFile;
  try {
    file = parseNmo(readFileSync(path));
  } catch {
    continue;
  }
  const behaviors = file.objects.filter((record): record is BehaviorRec => record.kind === 'behavior');
  for (const node of behaviors) {
    if (node.name !== 'TT Scaleable Proximity' && node.name !== 'TT Extra') continue;
    const parent = behaviors.find((candidate) =>
      candidate.referenceLists.some((list) => list.includes(node.index)),
    );
    const input = parameters(file, node);
    if (node.name === 'TT Extra') {
      rows.push({
        file: relative(root, path),
        parent: parent?.name ?? null,
        block: node.name,
        activationDistance: number(input.get('Activationdistance')),
        collisionDistanceSquared: number(input.get('Extra_Points CollDistance')),
        exactnessFrameDelay: number(input.get('Exactness Framedelay'), true),
      });
      continue;
    }
    rows.push({
      file: relative(root, path),
      parent: parent?.name ?? null,
      block: node.name,
      distance: number(input.get('Distance')),
      objectB: objectName(file, input.get('ObjectB')),
      exactnessMin: number(input.get('Exactness min. Distance')),
      exactnessMax: number(input.get('Exactness max. Distance')),
      minimumFrameDelay: number(input.get('Minimum Framedelay'), true),
      maximumFrameDelay: number(input.get('Maximum Framedelay'), true),
      initialFrameDelay: number(input.get(''), true),
      axes: number(input.get('Check Axis:'), true),
      squaredDistance: number(input.get('Squared Distance?'), true),
      barycenter: number(input.get('Barycenter?'), true),
    });
  }
}

rows.sort((a, b) => `${a.file}/${a.parent}`.localeCompare(`${b.file}/${b.parent}`));
console.log(JSON.stringify(rows, null, 2));
