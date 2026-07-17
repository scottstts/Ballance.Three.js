/**
 * ModulManager: discovers placements in the level, instantiates prefabs at
 * their transforms (hiding the embedded placement previews), assigns each
 * instance to its sector, and drives the sector lifecycle.
 */
import type { BuiltScene } from '../../engine/sceneBuilder.ts';
import { groupEntities } from '../../engine/sceneBuilder.ts';
import type { Modul, ModulContext } from './base.ts';
import { loadPrefab, instantiatePrefab, type Prefab } from './prefabs.ts';

export interface ModulFactory {
  /** group name in level files, e.g. "P_Modul_01" — also the PH prefab name */
  groupName: string;
  create(name: string, sector: number, instance: ReturnType<typeof instantiatePrefab>, ctx: ModulContext): Modul;
}

export class ModulManager {
  readonly moduls: Modul[] = [];

  private constructor() {}

  static async create(
    built: BuiltScene,
    ctx: ModulContext,
    factories: ModulFactory[],
    sectorOf: (placementName: string) => number,
  ): Promise<ModulManager> {
    const mgr = new ModulManager();

    // preload all needed prefabs in parallel
    const needed = new Set<string>();
    for (const f of factories) {
      if (groupEntities(built, f.groupName).length > 0) needed.add(f.groupName);
    }
    const prefabs = new Map<string, Prefab>();
    await Promise.all(
      [...needed].map(async (name) => {
        prefabs.set(name, await loadPrefab(name));
      }),
    );

    for (const f of factories) {
      const prefab = prefabs.get(f.groupName);
      if (!prefab) continue;
      for (const e of groupEntities(built, f.groupName)) {
        // placements are the entities named exactly <group>_NN
        if (!new RegExp(`^${f.groupName}_\\d+$`).test(e.rec.name)) continue;
        // hide the embedded placement preview
        hidePlacementVisuals(built, e.rec.name);
        const instance = instantiatePrefab(prefab, e.object.matrix);
        ctx.scene.add(instance.root);
        const modul = f.create(e.rec.name, sectorOf(e.rec.name), instance, ctx);
        mgr.moduls.push(modul);
      }
    }
    return mgr;
  }

  setSector(sector: number): void {
    for (const m of this.moduls) {
      if (m.sector === sector && !m.active) m.activate();
      else if (m.sector !== sector && m.active) m.deactivate();
    }
  }

  resetSector(sector: number): void {
    for (const m of this.moduls) {
      if (m.sector === sector) m.reset();
    }
  }

  update(dt: number): void {
    for (const m of this.moduls) {
      if (m.active) m.update(dt);
    }
  }

  dispose(): void {
    for (const m of this.moduls) m.dispose();
  }
}

function hidePlacementVisuals(built: BuiltScene, placementName: string): void {
  const e = built.entities.get(placementName);
  if (e) e.object.visible = false;
}

export type { Modul };

/** Build the placement→sector lookup from the level's Sector_XX groups. */
export function sectorLookup(built: BuiltScene): (name: string) => number {
  const map = new Map<string, number>();
  for (const [groupName, group] of built.groups) {
    const m = /^Sector_(\d+)$/.exec(groupName);
    if (!m) continue;
    const sector = parseInt(m[1], 10);
    for (const idx of group.memberIndices) {
      const obj = built.file.objects[idx];
      if (obj?.name) map.set(obj.name, sector);
    }
  }
  return (name) => map.get(name) ?? 1;
}
