/**
 * Modul behavior registry: maps level group names to behavior classes.
 */
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Modul, type ModulContext, type ModulEvent } from './base.ts';
import type { ModulFactory } from './manager.ts';
import type { PrefabInstance } from './prefabs.ts';
import type { BallKind } from '../constants.ts';

/** Simple proximity trigger helper (cylinder around the instance root). */
function nearBall(ctx: ModulContext, root: THREE.Object3D, radius: number, height: number): boolean {
  const b = ctx.ball.position;
  const p = root.position;
  const dx = b.x - p.x;
  const dz = b.z - p.z;
  const dy = b.y - p.y;
  return dx * dx + dz * dz <= radius * radius && dy > -height * 0.5 && dy < height;
}

/** Ball transformer: touching it morphs the ball type (with cooldown). */
class TrafoModul extends Modul {
  private target: BallKind;
  private triggered = false;

  constructor(name: string, sector: number, instance: PrefabInstance, ctx: ModulContext, target: BallKind) {
    super(name, sector, instance, ctx);
    this.target = target;
  }

  override update(): void {
    if (this.triggered) {
      if (!nearBall(this.ctx, this.instance.root, 6, 6)) this.triggered = false;
      return;
    }
    if (this.ctx.ball.kind !== this.target && nearBall(this.ctx, this.instance.root, 4.5, 5)) {
      this.triggered = true;
      this.ctx.emit({ kind: 'trafo', ball: this.target });
      this.ctx.emit({ kind: 'sound', name: 'Misc_Trafo.wav', position: this.instance.root.position });
    }
  }

  override reset(): void {
    this.triggered = false;
  }
}

/** Dynamic physics prop (wooden crate / stone dome cover). */
class DynamicPropModul extends Modul {
  private body: RAPIER.RigidBody | null = null;
  private visual: THREE.Mesh | null = null;
  private home = new THREE.Matrix4();

  constructor(
    name: string,
    sector: number,
    instance: PrefabInstance,
    ctx: ModulContext,
    partSuffix: string,
    opts: { mass: number; friction: number; restitution: number },
  ) {
    super(name, sector, instance, ctx);
    const part = this.part(partSuffix);
    if (part instanceof THREE.Mesh) {
      this.visual = part;
      this.home = this.partWorldMatrix(part);
      const { body } = this.makeDynamicPart(part, opts);
      this.body = body;
      // inactive sectors: body frozen until activated
      this.body.setEnabled(false);
    }
  }

  override activate(): void {
    super.activate();
    this.body?.setEnabled(true);
  }

  override deactivate(): void {
    super.deactivate();
    this.body?.setEnabled(false);
  }

  override update(): void {
    if (this.body && this.visual) this.syncPart(this.visual, this.body);
  }

  override reset(): void {
    if (!this.body || !this.visual) return;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    this.home.decompose(pos, quat, scale);
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.body.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.syncPart(this.visual, this.body);
  }
}

/** Placeholder for moduls whose behavior is not yet implemented: static visual. */
class StaticModul extends Modul {
  override reset(): void {}
}

const make =
  (
    groupName: string,
    ctor: (name: string, sector: number, instance: PrefabInstance, ctx: ModulContext) => Modul,
  ): ModulFactory => ({ groupName, create: ctor });

export const modulFactories: ModulFactory[] = [
  make('P_Trafo_Paper', (n, s, i, c) => new TrafoModul(n, s, i, c, 'paper')),
  make('P_Trafo_Wood', (n, s, i, c) => new TrafoModul(n, s, i, c, 'wood')),
  make('P_Trafo_Stone', (n, s, i, c) => new TrafoModul(n, s, i, c, 'stone')),
  make('P_Box', (n, s, i, c) => new DynamicPropModul(n, s, i, c, '_MF', { mass: 1.2, friction: 0.6, restitution: 0.2 })),
  make(
    'P_Dome',
    (n, s, i, c) => new DynamicPropModul(n, s, i, c, 'Dome_MF', { mass: 4, friction: 0.4, restitution: 0.2 }),
  ),
  make('P_Modul_01', (n, s, i, c) => new StaticModul(n, s, i, c)),
  make('P_Modul_03', (n, s, i, c) => new StaticModul(n, s, i, c)),
  make('P_Modul_08', (n, s, i, c) => new StaticModul(n, s, i, c)),
  make('P_Modul_17', (n, s, i, c) => new StaticModul(n, s, i, c)),
  make('P_Modul_18', (n, s, i, c) => new StaticModul(n, s, i, c)),
  make('P_Modul_19', (n, s, i, c) => new StaticModul(n, s, i, c)),
  make('P_Modul_25', (n, s, i, c) => new StaticModul(n, s, i, c)),
  make('P_Modul_26', (n, s, i, c) => new StaticModul(n, s, i, c)),
  make('P_Modul_29', (n, s, i, c) => new StaticModul(n, s, i, c)),
  make('P_Modul_30', (n, s, i, c) => new StaticModul(n, s, i, c)),
  make('P_Modul_34', (n, s, i, c) => new StaticModul(n, s, i, c)),
  make('P_Modul_37', (n, s, i, c) => new StaticModul(n, s, i, c)),
  make('P_Modul_41', (n, s, i, c) => new StaticModul(n, s, i, c)),
];

export type { ModulEvent };
