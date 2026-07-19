/**
 * ModulManager: discovers placements in the level, instantiates prefabs at
 * their transforms (hiding the embedded placement previews), assigns each
 * instance to its sector, and drives the sector lifecycle.
 */
import * as THREE from 'three';
import type { BuiltScene } from '../../engine/sceneBuilder.ts';
import { groupEntities } from '../../engine/sceneBuilder.ts';
import { TRAFO_SOURCE } from '../effects.ts';
import type { Modul, ModulContext } from './base.ts';
import { loadPrefab, instantiatePrefab, type Prefab } from './prefabs.ts';
import { TrafoModul } from './registry.ts';

export interface ModulFactory {
  /** group name in level files, e.g. "P_Modul_01" — also the PH prefab name */
  groupName: string;
  create(name: string, sector: number, instance: ReturnType<typeof instantiatePrefab>, ctx: ModulContext): Modul;
}

/** Levelinit.nmo/DepthTestGroups rows: the groups joined into the runtime DepthTest group. */
export const DEPTH_TEST_GROUPS = ['P_Ball_Paper', 'P_Ball_Wood', 'P_Ball_Stone', 'P_Box'] as const;

/** Gameplay.nmo/DepthTest subtracts 200 from get maxDepth's minimum once per activation. */
export const DEPTH_TEST_OFFSET = 200;

/**
 * Gameplay.nmo/get maxDepth: min(0, min over DepthTestCubes members of the
 * world-AABB minimum corner Y).
 */
export function sourceMaxDepth(cubeBounds: readonly THREE.Box3[]): number {
  let maxDepth = 0;
  for (const bounds of cubeBounds) {
    if (bounds.min.y < maxDepth) maxDepth = bounds.min.y;
  }
  return maxDepth;
}

export class ModulManager {
  readonly moduls: Modul[] = [];
  private trafos: TrafoModul[] = [];
  private ctx: ModulContext | null = null;
  private trafoAnchor = new THREE.Vector3();
  private trafoNearestAnchor = new THREE.Vector3();
  private depthCandidates: Modul[] = [];
  private depthThreshold = -Infinity;
  private depthScan = 0;

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
        // Levelinit's Replace PH runs Group to Array: EVERY group member is a
        // placement (L04/L12 author "_NNa" names beside the plain "_NN" ones).
        // hide the embedded placement preview
        hidePlacementVisuals(built, e.rec.name);
        const instance = instantiatePrefab(prefab, e.object.matrix);
        ctx.scene.add(instance.root);
        const modul = f.create(e.rec.name, sectorOf(e.rec.name), instance, ctx);
        // Prefab copies load hidden and unphysicalized; only Activate Sector
        // stamps, shows, and physicalizes them.
        modul.deactivate();
        mgr.moduls.push(modul);
      }
    }
    mgr.trafos = mgr.moduls.filter((m): m is TrafoModul => m instanceof TrafoModul);
    mgr.ctx = ctx;

    // Levelinit's fill DepthTest Group unions the four loose-prop groups;
    // Gameplay's DepthTest culls their members below maxDepth - 200.
    mgr.depthCandidates = mgr.moduls.filter((m) =>
      DEPTH_TEST_GROUPS.some((groupName) => m.name.startsWith(`${groupName}_`)),
    );
    const cubeBounds: THREE.Box3[] = [];
    for (const e of groupEntities(built, 'DepthTestCubes')) {
      if (!(e.object instanceof THREE.Mesh)) continue;
      if (!e.object.geometry.boundingBox) e.object.geometry.computeBoundingBox();
      const bounds = e.object.geometry.boundingBox;
      if (!bounds || bounds.isEmpty()) continue;
      e.object.updateWorldMatrix(true, false);
      cubeBounds.push(bounds.clone().applyMatrix4(e.object.matrixWorld));
    }
    mgr.depthThreshold = sourceMaxDepth(cubeBounds) - DEPTH_TEST_OFFSET;
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
    this.updateTrafoManager();
    this.updateDepthTest();
  }

  /**
   * Gameplay.nmo/DepthTest: round-robin ONE group member per behavioral
   * frame; a member whose world Y drops below maxDepth - 200 is
   * unphysicalized, hidden, and parked at the world origin.
   */
  private updateDepthTest(): void {
    const count = this.depthCandidates.length;
    if (count === 0) return;
    this.depthScan = (this.depthScan + 1) % count;
    const candidate = this.depthCandidates[this.depthScan];
    if (candidate.depthCulled) return;
    if (candidate.worldY() < this.depthThreshold) candidate.depthCull();
  }

  /**
   * Gameplay.nmo/Trafo Manager: Get Nearest In Group over every transformer
   * placement (the attribute group is level-wide, not sector-scoped), then
   * strict distance < 4.3 (Test mode 3) and target kind != current ball
   * (`Ist Trafo != Ball?`, Test mode 2). Only the nearest transformer is ever
   * examined, so a same-kind nearest blocks a farther mismatched one.
   */
  private updateTrafoManager(): void {
    const ctx = this.ctx;
    if (!ctx || this.trafos.length === 0 || ctx.trafoBusy()) return;
    const ballPosition = ctx.ball.position;
    let nearest: TrafoModul | null = null;
    let nearestDistance = Infinity;
    for (const trafo of this.trafos) {
      // Never-stamped copies are parked away from their placement in the
      // source; they only become reachable once their sector activated.
      if (!trafo.stamped) continue;
      const distance = trafo.trafoAnchor(this.trafoAnchor).distanceTo(ballPosition);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = trafo;
        this.trafoNearestAnchor.copy(this.trafoAnchor);
      }
    }
    if (!nearest || nearestDistance >= TRAFO_SOURCE.triggerDistance) return;
    if (nearest.trafoKind === ctx.ball.kind) return;
    nearest.fireTrafo(this.trafoNearestAnchor.clone());
  }

  debugState(): Record<string, unknown>[] {
    return this.moduls.map((modul) => modul.debugState());
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
