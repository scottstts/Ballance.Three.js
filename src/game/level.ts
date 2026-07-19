/**
 * Level rules: sectors, checkpoints, reset points, fall detection via the
 * point countdown, pickups, and level end. DepthTestCubes are installed as
 * exact physics sensors by the game bootstrap.
 */
import * as THREE from 'three';
import type { BuiltScene, BuiltEntity } from '../engine/sceneBuilder.ts';
import { groupEntities } from '../engine/sceneBuilder.ts';
import type { BallKind } from './constants.ts';

export type LevelEvent =
  | { kind: 'checkpoint'; sector: number }
  | { kind: 'death' }
  | { kind: 'finish' }
  | { kind: 'extraPoint'; amount: number; name: string }
  | { kind: 'extraLife'; name: string };

export interface ResetPoint {
  position: THREE.Vector3;
  yaw: number;
}

interface SectorPickup {
  entity: BuiltEntity;
  sector: number;
}

/** Exact all-axis trigger spheres from the original prefab behavior graphs. */
export const LEVEL_TRIGGER_SOURCE = {
  checkpointDistance: 6.5,
  /** PC_TwoFlames uses its big-flame frame rather than the prefab root. */
  checkpointTargetOffset: [0, 1.4948457479476929, 0] as const,
  extraLifeDistance: 4.5,
  /** TT Extra's authored Activationdistance. */
  extraPointDistance: 3,
  finishDistance: 1,
} as const;
/** total of the six +20 orbit balls and the +100 center ball */
export const EXTRA_POINT_VALUE = 220;

export class LevelLogic {
  readonly sectorCount: number;
  currentSector = 1;
  private checkpoints: (THREE.Vector3 | null)[] = [];
  private resetPoints: (ResetPoint | null)[] = [];
  private balloon: THREE.Vector3 | null;
  private pickupsPoint: SectorPickup[] = [];
  private pickupsLife: SectorPickup[] = [];
  private collected = new Set<string>();
  constructor(built: BuiltScene) {

    // checkpoints: PC_TwoFlames_NN activates sector NN+1
    const cps = groupEntities(built, 'PC_Checkpoints');
    for (const e of cps) {
      const n = trailingNumber(e.rec.name);
      if (n !== null) {
        this.checkpoints[n + 1] = sourceTargetPosition(e.object, LEVEL_TRIGGER_SOURCE.checkpointTargetOffset);
      }
    }
    // reset points: PR_Resetpoint_NN = spawn of sector NN
    for (const e of groupEntities(built, 'PR_Resetpoints')) {
      const n = trailingNumber(e.rec.name);
      if (n !== null) this.resetPoints[n] = resetPointFrom(e);
    }
    // level start doubles as sector 1 reset if PR_Resetpoint_01 missing
    const start = groupEntities(built, 'PS_Levelstart')[0];
    if (start && !this.resetPoints[1]) this.resetPoints[1] = resetPointFrom(start);

    this.balloon = groupEntities(built, 'PE_Levelende')[0]?.object.position.clone() ?? null;

    const sectorNames = [...built.groups.keys()].filter((n) => /^Sector_\d+$/.test(n));
    this.sectorCount = Math.max(sectorNames.length, this.resetPoints.length - 1);

    this.pickupsPoint = sectorPickups(built, rootPlacements(groupEntities(built, 'P_Extra_Point')));
    this.pickupsLife = sectorPickups(built, rootPlacements(groupEntities(built, 'P_Extra_Life')));
  }

  spawnFor(sector: number): ResetPoint {
    const rp = this.resetPoints[sector] ?? this.resetPoints[1];
    if (!rp) return { position: new THREE.Vector3(0, 5, 0), yaw: 0 };
    return rp;
  }

  /** The active section's source script resets its Life Extras after a fall. */
  resetAfterFall(): void {
    for (const pickup of this.pickupsLife) {
      if (pickup.sector === this.currentSector) this.collected.delete(pickup.entity.rec.name);
    }
  }

  /** Per-tick trigger checks. Returns events that fired. */
  update(
    ballPos: THREE.Vector3,
    currentBall: BallKind,
    pickupActive: (name: string) => boolean = () => true,
  ): LevelEvent[] {
    const events: LevelEvent[] = [];

    // next checkpoint only (original: checkpoints activate in order)
    const nextSector = this.currentSector + 1;
    const cp = this.checkpoints[nextSector];
    if (cp && sphereContains(cp, ballPos, LEVEL_TRIGGER_SOURCE.checkpointDistance)) {
      this.currentSector = nextSector;
      events.push({ kind: 'checkpoint', sector: nextSector });
    }

    if (
      this.balloon &&
      this.currentSector >= this.sectorCount &&
      sphereContains(this.balloon, ballPos, LEVEL_TRIGGER_SOURCE.finishDistance)
    ) {
      events.push({ kind: 'finish' });
    }

    for (const { entity: p, sector } of this.pickupsPoint) {
      if (sector !== this.currentSector) continue;
      if (this.collected.has(p.rec.name)) continue;
      if (!pickupActive(p.rec.name)) continue;
      // TT Extra performs a true 3D distance check at Activationdistance=3.
      if (sphereContains(p.object.position, ballPos, LEVEL_TRIGGER_SOURCE.extraPointDistance)) {
        this.collected.add(p.rec.name);
        hidePlacement(p);
        events.push({ kind: 'extraPoint', amount: EXTRA_POINT_VALUE, name: p.rec.name });
      }
    }
    for (const { entity: p, sector } of this.pickupsLife) {
      if (sector !== this.currentSector) continue;
      if (this.collected.has(p.rec.name)) continue;
      if (!pickupActive(p.rec.name)) continue;
      if (sphereContains(p.object.position, ballPos, LEVEL_TRIGGER_SOURCE.extraLifeDistance)) {
        this.collected.add(p.rec.name);
        hidePlacement(p);
        events.push({ kind: 'extraLife', name: p.rec.name });
      }
    }

    return events;
  }
}

function trailingNumber(name: string): number | null {
  const m = /_(\d+)$/.exec(name);
  return m ? parseInt(m[1], 10) : null;
}

function resetPointFrom(e: BuiltEntity): ResetPoint {
  const pos = e.object.position.clone();
  // entity forward (Virtools +Z) after conversion points along local -Z
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(e.object.quaternion);
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  return { position: pos, yaw };
}

export function sphereContains(center: THREE.Vector3, point: THREE.Vector3, distance: number): boolean {
  return center.distanceToSquared(point) < distance * distance;
}

function sourceTargetPosition(
  root: THREE.Object3D,
  offset: readonly [number, number, number],
): THREE.Vector3 {
  root.updateWorldMatrix(true, false);
  return root.localToWorld(new THREE.Vector3(offset[0], offset[1], offset[2]));
}

/** Levelinit's Replace PH iterates group members: every member is a placement. */
function rootPlacements(entities: BuiltEntity[]): BuiltEntity[] {
  return entities;
}

/** Resolve source group membership rather than guessing from placement IDs. */
function sectorPickups(built: BuiltScene, entities: BuiltEntity[]): SectorPickup[] {
  const byIndex = new Map<number, number>();
  for (const [name, group] of built.groups) {
    const match = /^Sector_(\d+)$/.exec(name);
    if (!match) continue;
    const sector = Number.parseInt(match[1], 10);
    for (const index of group.memberIndices) byIndex.set(index, sector);
  }
  return entities.map((entity) => ({ entity, sector: byIndex.get(entity.rec.index) ?? 1 }));
}

function hidePlacement(root: BuiltEntity): void {
  root.object.visible = false;
  // level files embed the pickup content as siblings prefixed by the root name
  const parent = root.object.parent;
  if (!parent) return;
  for (const child of parent.children) {
    if (child.name.startsWith(root.rec.name + '_') || child.name.startsWith(root.rec.name + ':')) {
      child.visible = false;
    }
  }
}
