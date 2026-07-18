/**
 * Modul behavior registry: maps level group names to behavior classes
 * implementing the original elements' mechanics.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FORCE_SCALE, type BallKind } from '../constants.ts';
import { Modul, type ModulContext, type ModulEvent } from './base.ts';
import type { ModulFactory } from './manager.ts';
import type { PrefabInstance } from './prefabs.ts';
import { MODUL18_FORCE, MODUL29_TRIGGER_PLATE, MODUL_PHYS, type ModulPhys } from './physTable.ts';

/** Simple proximity trigger helper (cylinder around a world point). */
function nearPoint(ballPos: THREE.Vector3, p: THREE.Vector3, radius: number, height: number): boolean {
  const dx = ballPos.x - p.x;
  const dz = ballPos.z - p.z;
  const dy = ballPos.y - p.y;
  return dx * dx + dz * dz <= radius * radius && dy > -height * 0.5 && dy < height;
}

/** prefab-local Virtools vector -> world (RH) direction for an instance */
function localDirToWorld(instance: PrefabInstance, v: [number, number, number]): THREE.Vector3 {
  const dir = new THREE.Vector3(v[0], v[1], -v[2]);
  dir.applyQuaternion(instance.root.quaternion);
  return dir.normalize();
}

/**
 * Table-driven physics modul: builds fixed/dynamic parts, hinges, sliders
 * and optional alternating constant force from the original parameters.
 */
class PhysicsModul extends Modul {
  private altForceState = 0;
  private altTimer = 0;
  private altTarget: ReturnType<Modul['findDynamic']>;
  protected phys: ModulPhys;

  constructor(name: string, sector: number, instance: PrefabInstance, ctx: ModulContext, phys: ModulPhys) {
    super(name, sector, instance, ctx);
    this.phys = phys;

    for (const partPhys of phys.parts) {
      const obj = this.part(partPhys.suffix);
      if (!(obj instanceof THREE.Mesh)) continue;
      if (partPhys.fixed) this.makeFixedPart(obj, partPhys);
      else this.makeDynamicPart(obj, partPhys);
    }
    for (const hinge of phys.hinges ?? []) {
      const part = this.findDynamic(hinge.part);
      const pin = this.partWorldPosition(hinge.pin);
      const axis = this.referenceWorldDirection(hinge.pin, hinge.axis ?? [0, 0, 1]);
      if (!part || !pin || !axis) continue;
      const other = hinge.other ? (this.findDynamic(hinge.other) ?? null) : null;
      this.makeHinge(part, pin, axis, other, hinge.spherical, hinge.limits);
    }
    for (const pris of phys.prismatics ?? []) {
      const part = this.findDynamic(pris.part);
      const first = this.partWorldPosition(pris.points[0]);
      const second = this.partWorldPosition(pris.points[1]);
      if (!part || !first || !second) continue;
      this.makePrismatic(part, second.sub(first).normalize(), pris.limits);
    }
    for (const spring of phys.springs ?? []) {
      const part = this.findDynamic(spring.part);
      const other = spring.other ? (this.findDynamic(spring.other) ?? null) : null;
      const anchor1 = this.referenceWorldPoint(spring.anchor1.ref, spring.anchor1.position);
      const anchor2 = this.referenceWorldPoint(spring.anchor2.ref, spring.anchor2.position);
      if (!part || !anchor1 || !anchor2) continue;
      this.makeSpring(part, other, anchor1, anchor2, spring.length, spring.stiffness, spring.damping);
    }
    this.altTarget = phys.altForce ? this.findDynamic(phys.altForce.part) : undefined;
    // spawn asleep until the sector activates
    for (const p of this.dynamicParts) p.body.sleep();
  }

  override activate(): void {
    super.activate();
    this.altForceState = this.phys.altForce?.startState ?? 0;
    this.altTimer = 0;
  }

  override update(dt: number): void {
    super.update(dt);
    const alt = this.phys.altForce;
    if (alt && this.altTarget && this.active) {
      this.altTimer += dt;
      if (this.altTimer >= alt.switchTime) {
        this.altTimer -= alt.switchTime;
        this.altForceState = (this.altForceState + 1) % (alt.delayTime !== undefined ? 4 : 2);
      }
      const dir = alt.reference
        ? (this.referenceWorldDirection(alt.reference, alt.axis) ?? localDirToWorld(this.instance, alt.axis))
        : localDirToWorld(this.instance, alt.axis);
      // with delay: 4-state cycle idle, +F, idle, -F; without: +F / -F
      const scale =
        alt.delayTime !== undefined
          ? this.altForceState === 1
            ? 1
            : this.altForceState === 3
              ? -1
              : 0
          : this.altForceState === 0
            ? 1
            : -1;
      const f = alt.force * FORCE_SCALE * scale;
      this.altTarget.body.resetForces(true);
      if (f !== 0) this.altTarget.body.addForce({ x: dir.x * f, y: dir.y * f, z: dir.z * f }, true);
    }
  }

  override reset(): void {
    super.reset();
    this.altForceState = this.phys.altForce?.startState ?? 0;
    this.altTimer = 0;
  }
}

/** Breakable plank bridge: a stone ball touching the middle plank snaps the chain. */
class BridgeModul extends PhysicsModul {
  private broken = false;
  /** the Platte04 -> Platte05 link that snaps (5th authored hinge) */
  private middleJoint: RAPIER.ImpulseJoint | null;

  constructor(name: string, sector: number, instance: PrefabInstance, ctx: ModulContext, phys: ModulPhys) {
    super(name, sector, instance, ctx, phys);
    this.middleJoint = this.joints[4] ?? null;
  }

  override update(dt: number): void {
    super.update(dt);
    if (!this.active || this.broken) return;
    if (this.ctx.ball.kind !== 'stone') return;
    const plate = this.findDynamic(MODUL29_TRIGGER_PLATE);
    if (!plate) return;
    const p = plate.body.translation();
    if (nearPoint(this.ctx.ball.position, new THREE.Vector3(p.x, p.y, p.z), 3.2, 5)) {
      this.broken = true;
      if (this.middleJoint) this.removeJoint(this.middleJoint);
      this.middleJoint = null;
      for (const dp of this.dynamicParts) dp.body.wakeUp();
      this.ctx.emit({ kind: 'sound', name: 'Misc_RopeTears.wav', position: this.ctx.ball.position });
    }
  }

  override reset(): void {
    // the original repairs the bridge on every sector restart
    super.reset();
    if (this.broken) {
      this.broken = false;
      const hinge = this.phys.hinges?.[4];
      if (hinge) {
        const part = this.findDynamic(hinge.part);
        const pin = this.partWorldPosition(hinge.pin);
        const other = hinge.other ? (this.findDynamic(hinge.other) ?? null) : null;
        if (part && pin) {
          const axis = this.referenceWorldDirection(hinge.pin, hinge.axis ?? [0, 0, 1]);
          if (axis) this.middleJoint = this.makeHinge(part, pin, axis, other, hinge.spherical, hinge.limits);
        }
      }
    }
  }
}

/** Fan: applies the original updraft to the ball while inside the wind volume. */
class FanModul extends Modul {
  private windBox: THREE.Box3 | null = null;
  private rotor: THREE.Object3D | undefined;
  private loop: { setActive(on: boolean): void; dispose(): void };

  constructor(name: string, sector: number, instance: PrefabInstance, ctx: ModulContext) {
    super(name, sector, instance, ctx);
    this.loop = ctx.attachLoop('Misc_Ventilator.wav', instance.root, 0.7);
    for (const [partName, obj] of instance.parts) {
      if (partName.includes('Kollisionsquader') && obj instanceof THREE.Mesh) {
        obj.updateWorldMatrix(true, false);
        this.windBox = new THREE.Box3().setFromObject(obj);
        obj.visible = false;
      }
      if (partName.includes('Rotor')) this.rotor = obj;
      // the grid/housing collides
      if ((partName.includes('Gitter') || partName.includes('Boden')) && obj instanceof THREE.Mesh) {
        this.makeFixedPart(obj, { suffix: partName, fixed: true, friction: 0.7, elasticity: 0.4, surface: 'metal' });
      }
    }
    if (!this.windBox) {
      const p = instance.root.position;
      this.windBox = new THREE.Box3(
        new THREE.Vector3(p.x - 4, p.y - 1, p.z - 4),
        new THREE.Vector3(p.x + 4, p.y + 25, p.z + 4),
      );
    }
  }

  override activate(): void {
    super.activate();
    this.loop.setActive(true);
  }

  override deactivate(): void {
    super.deactivate();
    this.loop.setActive(false);
  }

  override update(dt: number): void {
    if (this.rotor) {
      this.rotor.rotation.y += dt * Math.PI * 2;
      this.rotor.updateMatrix();
    }
    if (!this.active || !this.windBox) return;
    if (this.windBox.containsPoint(this.ctx.ball.position)) {
      const up = localDirToWorld(this.instance, [0, 1, 0]);
      const f = MODUL18_FORCE * FORCE_SCALE;
      this.ctx.ball.body.addForce({ x: up.x * f, y: up.y * f, z: up.z * f }, true);
    }
  }

  override reset(): void {}

  override dispose(): void {
    super.dispose();
    this.loop.dispose();
  }
}

/** Ball transformer: touching it morphs the ball type (with re-arm on leave). */
class TrafoModul extends Modul {
  private target: BallKind;
  private triggered = false;

  constructor(name: string, sector: number, instance: PrefabInstance, ctx: ModulContext, target: BallKind) {
    super(name, sector, instance, ctx);
    this.target = target;
  }

  override update(): void {
    const root = this.instance.root.position;
    if (this.triggered) {
      if (!nearPoint(this.ctx.ball.position, root, 7, 7)) this.triggered = false;
      return;
    }
    if (this.ctx.ball.kind !== this.target && nearPoint(this.ctx.ball.position, root, 4.5, 5)) {
      this.triggered = true;
      this.ctx.emit({ kind: 'trafo', ball: this.target, position: root.clone() });
      this.ctx.emit({ kind: 'sound', name: 'Misc_Trafo.wav', position: root.clone() });
    }
  }

  override reset(): void {
    this.triggered = false;
  }
}

const make =
  (
    groupName: string,
    ctor: (name: string, sector: number, instance: PrefabInstance, ctx: ModulContext) => Modul,
  ): ModulFactory => ({ groupName, create: ctor });

const physFactory = (groupName: string): ModulFactory =>
  make(groupName, (n, s, i, c) => new PhysicsModul(n, s, i, c, MODUL_PHYS[groupName]));

export const modulFactories: ModulFactory[] = [
  make('P_Trafo_Paper', (n, s, i, c) => new TrafoModul(n, s, i, c, 'paper')),
  make('P_Trafo_Wood', (n, s, i, c) => new TrafoModul(n, s, i, c, 'wood')),
  make('P_Trafo_Stone', (n, s, i, c) => new TrafoModul(n, s, i, c, 'stone')),
  make('P_Modul_18', (n, s, i, c) => new FanModul(n, s, i, c)),
  make('P_Modul_29', (n, s, i, c) => new BridgeModul(n, s, i, c, MODUL_PHYS.P_Modul_29)),
  physFactory('P_Box'),
  physFactory('P_Dome'),
  physFactory('P_Ball_Paper'),
  physFactory('P_Ball_Wood'),
  physFactory('P_Ball_Stone'),
  physFactory('P_Modul_01'),
  physFactory('P_Modul_03'),
  physFactory('P_Modul_08'),
  physFactory('P_Modul_17'),
  physFactory('P_Modul_19'),
  physFactory('P_Modul_25'),
  physFactory('P_Modul_26'),
  physFactory('P_Modul_30'),
  physFactory('P_Modul_34'),
  physFactory('P_Modul_37'),
  physFactory('P_Modul_41'),
];

export type { ModulEvent };
