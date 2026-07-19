/**
 * Modul behavior registry: maps level group names to behavior classes
 * implementing the original elements' mechanics.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { loadCkTexture } from '../../engine/textures.ts';
import { FORCE_SCALE, type BallKind } from '../constants.ts';
import { sourceEntityObb } from '../sourceBounds.ts';
import { ScaleableProximity } from '../proximity.ts';
import { Modul, type ModulContext, type ModulEvent } from './base.ts';
import { FanParticles } from './fanParticles.ts';
import type { ModulFactory } from './manager.ts';
import type { PrefabInstance } from './prefabs.ts';
import {
  MODUL18_FORCE,
  MODUL18_PROXIMITY_SOURCE,
  MODUL18_ROTOR_SPEED,
  MODUL18_SOUND_RANGE,
  MODUL29_BREAK_JOINT_INDEX,
  MODUL29_BREAK_PROXIMITY,
  MODUL29_TRIGGER_PLATE,
  MODUL29_WAKE_PROXIMITY,
  MODUL_PHYS,
  alternatingForceScale,
  type ModulPhys,
} from './physTable.ts';

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
  private wakeProximity: ScaleableProximity | null;
  private wakeGateActive = false;
  protected phys: ModulPhys;

  constructor(name: string, sector: number, instance: PrefabInstance, ctx: ModulContext, phys: ModulPhys) {
    super(name, sector, instance, ctx);
    this.phys = phys;
    this.wakeProximity = phys.wakeProximity ? new ScaleableProximity(phys.wakeProximity.spec) : null;

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
    this.wakeGateActive = this.wakeProximity !== null;
    this.wakeProximity?.reset();
    this.altForceState = this.phys.altForce?.startState ?? 0;
    this.altTimer = 0;
  }

  override update(dt: number): void {
    super.update(dt);
    const wake = this.phys.wakeProximity;
    if (this.active && this.wakeGateActive && this.wakeProximity && wake) {
      const target = this.partWorldPosition(wake.target);
      if (target && this.wakeProximity.updatePositions(this.ctx.ball.position, target) === 'enterRange') {
        this.wakeGateActive = false;
        for (const part of this.dynamicParts) part.body.wakeUp();
      }
    }
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
      const scale = alternatingForceScale(alt, this.altForceState);
      const f = alt.force * FORCE_SCALE * scale;
      this.altTarget.body.resetForces(true);
      if (f !== 0) this.altTarget.body.addForce({ x: dir.x * f, y: dir.y * f, z: dir.z * f }, true);
    }
  }

  override reset(): void {
    super.reset();
    this.wakeGateActive = this.wakeProximity !== null;
    this.wakeProximity?.reset();
    this.altForceState = this.phys.altForce?.startState ?? 0;
    this.altTimer = 0;
  }

  override debugState(): Record<string, unknown> {
    return { ...super.debugState(), wakeGateActive: this.wakeGateActive };
  }
}

/** Breakable plank bridge: a stone ball touching the middle plank snaps the chain. */
class BridgeModul extends PhysicsModul {
  private broken = false;
  private bridgeWakeGateActive = true;
  private bridgeBreakGateActive = false;
  private wakeSampler = new ScaleableProximity(MODUL29_WAKE_PROXIMITY);
  private breakSampler = new ScaleableProximity(MODUL29_BREAK_PROXIMITY);
  /** HingeFrame07: the source link between Platte06 and Platte07. */
  private middleJoint: RAPIER.ImpulseJoint | null;

  constructor(name: string, sector: number, instance: PrefabInstance, ctx: ModulContext, phys: ModulPhys) {
    super(name, sector, instance, ctx, phys);
    this.middleJoint = this.joints[MODUL29_BREAK_JOINT_INDEX] ?? null;
  }

  override activate(): void {
    // Activate Sector recreates all ten hinges fresh, so a bridge broken in
    // an earlier visit is repaired exactly like on a sector reset.
    super.activate();
    this.repairBridge();
    this.bridgeWakeGateActive = true;
    this.bridgeBreakGateActive = false;
    this.wakeSampler.reset();
    this.breakSampler.reset();
  }

  private repairBridge(): void {
    if (!this.broken) return;
    this.broken = false;
    const hinge = this.phys.hinges?.[MODUL29_BREAK_JOINT_INDEX];
    if (!hinge) return;
    const part = this.findDynamic(hinge.part);
    const pin = this.partWorldPosition(hinge.pin);
    const other = hinge.other ? (this.findDynamic(hinge.other) ?? null) : null;
    if (part && pin) {
      const axis = this.referenceWorldDirection(hinge.pin, hinge.axis ?? [0, 0, 1]);
      if (axis) this.middleJoint = this.makeHinge(part, pin, axis, other, hinge.spherical, hinge.limits);
    }
  }

  override update(dt: number): void {
    super.update(dt);
    if (!this.active || this.broken) return;

    if (this.bridgeWakeGateActive) {
      const root = this.instance.root.getWorldPosition(new THREE.Vector3());
      if (this.wakeSampler.updatePositions(this.ctx.ball.position, root) === 'enterRange') {
        this.bridgeWakeGateActive = false;
        this.bridgeBreakGateActive = true;
        this.breakSampler.reset();
        for (const part of this.dynamicParts) part.body.wakeUp();
      }
    }
    if (!this.bridgeBreakGateActive) return;

    const plate = this.findDynamic(MODUL29_TRIGGER_PLATE);
    if (!plate) return;
    const p = plate.body.translation();
    const output = this.breakSampler.updatePositions(this.ctx.ball.position, p);
    if (output === 'enterRange' && this.ctx.ball.kind === 'stone') {
      this.broken = true;
      this.bridgeBreakGateActive = false;
      if (this.middleJoint) this.removeJoint(this.middleJoint);
      this.middleJoint = null;
      for (const dp of this.dynamicParts) dp.body.wakeUp();
      this.ctx.emit({ kind: 'sound', name: 'Misc_RopeTears.wav' });
    }
  }

  override reset(): void {
    // the original repairs the bridge on every sector restart
    super.reset();
    this.bridgeWakeGateActive = true;
    this.bridgeBreakGateActive = false;
    this.wakeSampler.reset();
    this.breakSampler.reset();
    this.repairBridge();
  }

  override debugState(): Record<string, unknown> {
    return {
      ...super.debugState(),
      broken: this.broken,
      wakeGateActive: this.bridgeWakeGateActive,
      breakGateActive: this.bridgeBreakGateActive,
      breakJointPresent: this.middleJoint !== null,
    };
  }
}

/** Fan: applies the original updraft to the ball while inside the wind volume. */
class FanModul extends Modul {
  private windObb: OBB | null = null;
  private ballObb = new OBB();
  private rotor: THREE.Object3D | undefined;
  private particleTarget: THREE.Object3D;
  private effectActive = false;
  private forceActive = false;
  private soundActive = false;
  private outerProximity = new ScaleableProximity(MODUL18_PROXIMITY_SOURCE.outer);
  private forceProximity = new ScaleableProximity(MODUL18_PROXIMITY_SOURCE.force);
  private soundProximity = new ScaleableProximity(MODUL18_PROXIMITY_SOURCE.sound);
  private loop: ReturnType<ModulContext['attachLoop']>;
  private particles: FanParticles;

  constructor(name: string, sector: number, instance: PrefabInstance, ctx: ModulContext) {
    super(name, sector, instance, ctx);
    // P_Modul_18's deactivation branch has no Hide/Restore IC.
    this.hiddenWhenInactive = false;
    this.particleTarget = this.part('_Particle') ?? instance.root;
    this.particles = new FanParticles(ctx.scene, this.particleTarget);
    const smokeTexture = instance.file.byName
      .get('Particle_Smoke')
      ?.find((record) => record.kind === 'texture');
    if (smokeTexture?.kind === 'texture') {
      void loadCkTexture(smokeTexture)?.then((texture) => this.particles.setSmokeTexture(texture));
    }
    this.loop = ctx.attachLoop('Misc_Ventilator.wav', instance.root, 1);
    this.loop.setDistanceRange(MODUL18_SOUND_RANGE.near, MODUL18_SOUND_RANGE.far);
    for (const [partName, obj] of instance.parts) {
      if (partName.includes('Kollisionsquader') && obj instanceof THREE.Mesh) {
        obj.updateWorldMatrix(true, false);
        this.windObb = sourceEntityObb(obj, new OBB());
        obj.visible = false;
      }
      if (partName.includes('Rotor')) this.rotor = obj;
      // the grid/housing collides
      if ((partName.includes('Gitter') || partName.includes('Boden')) && obj instanceof THREE.Mesh) {
        this.makeFixedPart(obj, { suffix: partName, fixed: true, friction: 0.7, elasticity: 0.4, surface: 'metal' });
      }
    }
  }

  override activate(): void {
    super.activate();
    this.effectActive = false;
    this.forceActive = false;
    this.soundActive = false;
    this.outerProximity.reset();
    this.forceProximity.reset();
    this.soundProximity.reset();
    this.loop.setActive(false);
    this.particles.setActive(false);
  }

  override deactivate(): void {
    super.deactivate();
    this.effectActive = false;
    this.forceActive = false;
    this.soundActive = false;
    this.loop.setActive(false);
    this.particles.setActive(false);
  }

  override update(dt: number): void {
    if (!this.active) return;
    const particlePosition = this.particleTarget.getWorldPosition(new THREE.Vector3());
    const outer = this.outerProximity.updatePositions(this.ctx.ball.position, particlePosition);
    if (outer === 'enterRange') {
      this.effectActive = true;
      this.particles.setActive(true);
      this.forceActive = false;
      this.forceProximity.reset();
      this.soundProximity.reset();
    } else if (outer === 'exitRange') {
      this.effectActive = false;
      this.forceActive = false;
      this.soundActive = false;
      this.loop.setActive(false);
      this.particles.setActive(false);
    }
    if (!this.effectActive) return;

    if (this.rotor) {
      this.rotor.rotation.y += dt * MODUL18_ROTOR_SPEED;
      this.rotor.updateMatrix();
    }
    this.particles.update(dt, this.ctx.pointScale());

    const soundPosition = this.instance.root.getWorldPosition(new THREE.Vector3());
    this.loop.setDistance(this.ctx.ball.position.distanceTo(soundPosition));
    const sound = this.soundProximity.updatePositions(this.ctx.ball.position, soundPosition);
    if (sound === 'enterRange') this.soundActive = true;
    else if (sound === 'exitRange') this.soundActive = false;
    if (sound === 'enterRange' || sound === 'exitRange') this.loop.setActive(this.soundActive);

    const force = this.forceProximity.updatePositions(this.ctx.ball.position, particlePosition);
    if (force === 'enterRange') this.forceActive = false;
    else if (force === 'inRange' && this.windObb) {
      const activeBallObb = this.ctx.ball.worldBoundingObb(this.ballObb);
      this.forceActive = activeBallObb ? this.windObb.intersectsOBB(activeBallObb) : false;
    }
    if (this.forceActive) {
      const up = localDirToWorld(this.instance, [0, 1, 0]);
      const f = MODUL18_FORCE * FORCE_SCALE;
      this.ctx.ball.body.addForce({ x: up.x * f, y: up.y * f, z: up.z * f }, true);
    }
  }

  override reset(): void {
    this.effectActive = false;
    this.forceActive = false;
    this.soundActive = false;
    this.outerProximity.reset();
    this.forceProximity.reset();
    this.soundProximity.reset();
    this.loop.setActive(false);
    this.particles.setActive(false);
  }

  override debugState(): Record<string, unknown> {
    return {
      ...super.debugState(),
      effectActive: this.effectActive,
      forceActive: this.forceActive,
      soundActive: this.soundActive,
      proximityFrames: {
        outer: this.outerProximity.remainingFrames(),
        force: this.forceProximity.remainingFrames(),
        sound: this.soundProximity.remainingFrames(),
      },
      particlePosition: this.particleTarget.getWorldPosition(new THREE.Vector3()).toArray(),
      soundPosition: this.instance.root.getWorldPosition(new THREE.Vector3()).toArray(),
      rotorRotationY: this.rotor?.rotation.y ?? null,
      particles: this.particles.debugState(),
      windObb: this.windObb
        ? {
            center: this.windObb.center.toArray(),
            halfSize: this.windObb.halfSize.toArray(),
            rotation: this.windObb.rotation.toArray(),
          }
        : null,
    };
  }

  override dispose(): void {
    super.dispose();
    this.loop.dispose();
    this.particles.dispose();
  }
}

/**
 * Ball transformer. The source Trafo Manager runs Get Nearest In Group over
 * ALL transformer placements (no sector scoping), then Test mode 3
 * (distance < 4.3) and `Ist Trafo != Ball?` (Test mode 2). The selection is
 * therefore centralized in ModulManager; this modul only carries its target
 * kind, anchor, and the trigger side effects.
 */
export class TrafoModul extends Modul {
  readonly trafoKind: BallKind;

  constructor(name: string, sector: number, instance: PrefabInstance, ctx: ModulContext, target: BallKind) {
    super(name, sector, instance, ctx);
    this.trafoKind = target;
  }

  private prefabParts(): { sourceMain: THREE.Object3D; sourceShadow: THREE.Object3D | null } {
    const prefix = `P_Trafo_${this.trafoKind[0].toUpperCase()}${this.trafoKind.slice(1)}`;
    return {
      sourceMain: this.part(`${prefix}_MF`) ?? this.instance.root,
      sourceShadow: this.part(`${prefix}_Shadow`) ?? null,
    };
  }

  trafoAnchor(target: THREE.Vector3): THREE.Vector3 {
    const { sourceMain } = this.prefabParts();
    sourceMain.updateWorldMatrix(true, false);
    return sourceMain.getWorldPosition(target);
  }

  fireTrafo(position: THREE.Vector3): void {
    const { sourceMain, sourceShadow } = this.prefabParts();
    this.ctx.emit({ kind: 'trafo', ball: this.trafoKind, position, sourceMain, sourceShadow });
    this.ctx.emit({ kind: 'sound', name: 'Misc_Trafo.wav', restart: true });
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
