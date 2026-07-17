/**
 * Level rules: sectors, checkpoints, reset points, fall detection via the
 * level's DepthTestCubes volumes, point countdown, pickups, level end.
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

const CHECKPOINT_RADIUS = 5;
const CHECKPOINT_HEIGHT = 8;
const PICKUP_RADIUS = 4;
const PICKUP_HEIGHT = 6;
/** total of the six +20 orbit balls and the +100 center ball */
export const EXTRA_POINT_VALUE = 220;

export class LevelLogic {
  readonly sectorCount: number;
  currentSector = 1;
  /** ball kind to restore on respawn (kind held when the sector was reached) */
  sectorBallKind: BallKind = 'wood';
  private checkpoints: (BuiltEntity | null)[] = [];
  private resetPoints: (ResetPoint | null)[] = [];
  private balloon: BuiltEntity | null;
  private depthBoxes: THREE.Box3[] = [];
  private pickupsPoint: BuiltEntity[] = [];
  private pickupsLife: BuiltEntity[] = [];
  private collected = new Set<string>();
  private fallbackMinY: number;

  constructor(built: BuiltScene, fallbackMinY: number) {
    this.fallbackMinY = fallbackMinY;

    // checkpoints: PC_TwoFlames_NN activates sector NN+1
    const cps = groupEntities(built, 'PC_Checkpoints');
    for (const e of cps) {
      const n = trailingNumber(e.rec.name);
      if (n !== null) this.checkpoints[n + 1] = e;
    }
    // reset points: PR_Resetpoint_NN = spawn of sector NN
    for (const e of groupEntities(built, 'PR_Resetpoints')) {
      const n = trailingNumber(e.rec.name);
      if (n !== null) this.resetPoints[n] = resetPointFrom(e);
    }
    // level start doubles as sector 1 reset if PR_Resetpoint_01 missing
    const start = groupEntities(built, 'PS_Levelstart')[0];
    if (start && !this.resetPoints[1]) this.resetPoints[1] = resetPointFrom(start);

    this.balloon = groupEntities(built, 'PE_Levelende')[0] ?? null;

    const sectorNames = [...built.groups.keys()].filter((n) => /^Sector_\d+$/.test(n));
    this.sectorCount = Math.max(sectorNames.length, this.resetPoints.length - 1);

    for (const e of groupEntities(built, 'DepthTestCubes')) {
      const box = new THREE.Box3().setFromObject(e.object);
      if (!box.isEmpty()) this.depthBoxes.push(box.expandByScalar(2));
    }

    this.pickupsPoint = rootPlacements(groupEntities(built, 'P_Extra_Point'));
    this.pickupsLife = rootPlacements(groupEntities(built, 'P_Extra_Life'));
  }

  spawnFor(sector: number): ResetPoint {
    const rp = this.resetPoints[sector] ?? this.resetPoints[1];
    if (!rp) return { position: new THREE.Vector3(0, 5, 0), yaw: 0 };
    return rp;
  }

  /**
   * Death check: the DepthTestCubes are kill volumes stacked *beneath* the
   * course — the ball dying means it fell into one (or below the safety net).
   */
  isOutOfWorld(ballPos: THREE.Vector3): boolean {
    if (ballPos.y < this.fallbackMinY) return true;
    for (const box of this.depthBoxes) {
      if (box.containsPoint(ballPos)) return true;
    }
    return false;
  }

  /** Per-tick trigger checks. Returns events that fired. */
  update(ballPos: THREE.Vector3, currentBall: BallKind): LevelEvent[] {
    const events: LevelEvent[] = [];

    // next checkpoint only (original: checkpoints activate in order)
    const nextSector = this.currentSector + 1;
    const cp = this.checkpoints[nextSector];
    if (cp && cylinderContains(cp.object.position, ballPos, CHECKPOINT_RADIUS, CHECKPOINT_HEIGHT)) {
      this.currentSector = nextSector;
      this.sectorBallKind = currentBall;
      events.push({ kind: 'checkpoint', sector: nextSector });
    }

    if (
      this.balloon &&
      this.currentSector >= this.sectorCount &&
      cylinderContains(this.balloon.object.position, ballPos, CHECKPOINT_RADIUS + 2, CHECKPOINT_HEIGHT + 4)
    ) {
      events.push({ kind: 'finish' });
    }

    for (const p of this.pickupsPoint) {
      if (this.collected.has(p.rec.name)) continue;
      if (cylinderContains(p.object.position, ballPos, PICKUP_RADIUS, PICKUP_HEIGHT)) {
        this.collected.add(p.rec.name);
        hidePlacement(p);
        events.push({ kind: 'extraPoint', amount: EXTRA_POINT_VALUE, name: p.rec.name });
      }
    }
    for (const p of this.pickupsLife) {
      if (this.collected.has(p.rec.name)) continue;
      if (cylinderContains(p.object.position, ballPos, PICKUP_RADIUS, PICKUP_HEIGHT)) {
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

function cylinderContains(center: THREE.Vector3, p: THREE.Vector3, radius: number, height: number): boolean {
  const dx = p.x - center.x;
  const dz = p.z - center.z;
  const dy = p.y - center.y;
  return dx * dx + dz * dz <= radius * radius && dy > -height * 0.5 && dy < height;
}

/** Placement roots: entities whose name is the group prefix + _NN. */
function rootPlacements(entities: BuiltEntity[]): BuiltEntity[] {
  return entities.filter((e) => /^P_Extra_(Point|Life)_\d+$/.test(e.rec.name));
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
