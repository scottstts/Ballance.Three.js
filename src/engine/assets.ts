/**
 * Loads original game files served by the dev-server /bin route.
 * All lookups are case-insensitive (Virtools references differ in case from disk).
 */
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { NmoFile } from '../formats/ck2/types.ts';

const nmoCache = new Map<string, Promise<NmoFile>>();
const bufferCache = new Map<string, Promise<ArrayBuffer>>();

export function fetchGameBuffer(relPath: string): Promise<ArrayBuffer> {
  const key = relPath.toLowerCase();
  let p = bufferCache.get(key);
  if (!p) {
    p = fetch(`/bin/${relPath}`).then((r) => {
      if (!r.ok) throw new Error(`asset not found: ${relPath}`);
      return r.arrayBuffer();
    });
    bufferCache.set(key, p);
  }
  return p;
}

export function loadNmo(relPath: string): Promise<NmoFile> {
  const key = relPath.toLowerCase();
  let p = nmoCache.get(key);
  if (!p) {
    p = fetchGameBuffer(relPath).then((buf) => parseNmo(buf));
    nmoCache.set(key, p);
  }
  return p;
}

export function levelPath(level: number): string {
  return `3D Entities/Level/Level_${String(level).padStart(2, '0')}.NMO`;
}

/** Original per-level sky set assignment (from the level definitions). */
const SKY_LETTERS = ['L', 'E', 'A', 'F', 'C', 'H', 'D', 'G', 'K', 'B', 'J', 'I'];

/**
 * Original `AllLevel.Skytranslation` values. `Gameplay_Sky` feeds the
 * selected vector through `Per Second` into `Texture Scroller` unchanged.
 */
const SKY_TRANSLATIONS = [
  [0.01, 0.01],
  [-0.01, 0.005],
  [0.02, 0.01],
  [-0.01, 0.005],
  [0.01, 0.005],
  [-0.01, 0.005],
  [-0.005, -0.005],
  [0.01, 0],
  [-0.005, 0.01],
  [0.02, 0.01],
  [0.01, 0.01],
  [0.01, 0.04],
] as const;

/** Original `AllLevel.Light` colors; unlisted levels are pure white. */
export const LEVEL_LIGHT_COLORS: Readonly<Record<number, number>> = { 9: 0xe9e9e9, 12: 0x969696 };

export function skyLetter(level: number): string {
  return SKY_LETTERS[level - 1] ?? 'A';
}

export function skyTranslation(level: number): readonly [number, number] {
  return SKY_TRANSLATIONS[level - 1] ?? [0, 0];
}
