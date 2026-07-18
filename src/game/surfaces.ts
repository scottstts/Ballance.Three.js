import type { GroupRec, NmoFile } from '../formats/ck2/types.ts';
import type { Surface } from './audio.ts';

export type SoundGroupFamily = 'Hit' | 'Roll';

/** Resolve the level's independent impact or rolling collision-ID groups. */
export function soundSurfaceByName(
  file: NmoFile,
  groups: ReadonlyMap<string, GroupRec>,
  family: SoundGroupFamily,
): Map<string, Surface> {
  const bySoundId: Record<string, Surface> = { '01': 'stone', '02': 'wood', '03': 'metal' };
  const result = new Map<string, Surface>();
  for (const [id, surface] of Object.entries(bySoundId)) {
    const group = groups.get(`Sound_${family}ID_${id}`);
    if (!group) continue;
    for (const index of group.memberIndices) {
      const name = file.objects[index]?.name;
      if (name) result.set(name, surface);
    }
  }
  return result;
}
