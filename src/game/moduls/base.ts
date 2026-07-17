/**
 * Modul behavior base: a placed instance of a game element with the
 * original sector lifecycle (activate when its sector starts, deactivate
 * when left, reset on ball death within the sector).
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics.ts';
import type { Ball } from '../ball.ts';
import type { Surface } from '../audio.ts';
import type { PrefabInstance } from './prefabs.ts';
import type { PartPhys } from './physTable.ts';

export interface ModulContext {
  physics: PhysicsWorld;
  scene: THREE.Scene;
  ball: Ball;
  /** register a modul collider's sound surface */
  registerSurface: (colliderHandle: number, surface: Surface) => void;
  /** fires gameplay events upward (pickups, trafo, checkpoints...) */
  emit: (event: ModulEvent) => void;
}

export type ModulEvent =
  | { kind: 'extraPoint'; amount: number }
  | { kind: 'extraLife' }
  | { kind: 'trafo'; ball: 'paper' | 'wood' | 'stone' }
  | { kind: 'sound'; name: string; position: THREE.Vector3; volume?: number };

export interface DynamicPart {
  name: string;
  visual: THREE.Mesh;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  homePos: THREE.Vector3;
  homeRot: THREE.Quaternion;
  frozen: boolean;
}

export abstract class Modul {
  readonly name: string;
  readonly sector: number;
  readonly instance: PrefabInstance;
  protected ctx: ModulContext;
  protected dynamicParts: DynamicPart[] = [];
  protected joints: RAPIER.ImpulseJoint[] = [];
  active = false;

  constructor(name: string, sector: number, instance: PrefabInstance, ctx: ModulContext) {
    this.name = name;
    this.sector = sector;
    this.instance = instance;
    this.ctx = ctx;
  }

  /** part lookup by suffix (parts are named <PrefabName>_<Suffix>) */
  part(suffix: string): THREE.Object3D | undefined {
    for (const [name, obj] of this.instance.parts) {
      if (name.endsWith(suffix)) return obj;
    }
    return undefined;
  }

  partWorldPosition(suffix: string): THREE.Vector3 | null {
    const obj = this.part(suffix);
    if (!obj) return null;
    obj.updateWorldMatrix(true, false);
    return new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
  }

  // Inactive moduls sleep rather than disable: Rapier panics on joints
  // attached to disabled bodies, and IVP "frozen" semantics are sleep-like
  // anyway (bodies wake on contact once their sector is live).
  activate(): void {
    this.active = true;
    for (const p of this.dynamicParts) {
      if (p.frozen) p.body.sleep();
      else p.body.wakeUp();
    }
  }

  deactivate(): void {
    this.active = false;
    for (const p of this.dynamicParts) p.body.sleep();
  }

  /** restore initial state (ball died in this sector) */
  reset(): void {
    for (const p of this.dynamicParts) {
      p.body.setTranslation({ x: p.homePos.x, y: p.homePos.y, z: p.homePos.z }, false);
      p.body.setRotation({ x: p.homeRot.x, y: p.homeRot.y, z: p.homeRot.z, w: p.homeRot.w }, false);
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      if (p.frozen && this.active) p.body.sleep();
      this.syncPart(p);
    }
  }

  /** per-physics-tick update */
  update(_dt: number): void {
    for (const p of this.dynamicParts) this.syncPart(p);
  }

  dispose(): void {
    for (const p of this.dynamicParts) this.ctx.physics.world.removeRigidBody(p.body);
    this.dynamicParts = [];
  }

  protected syncPart(p: DynamicPart): void {
    const t = p.body.translation();
    const r = p.body.rotation();
    p.visual.position.set(t.x, t.y, t.z);
    p.visual.quaternion.set(r.x, r.y, r.z, r.w);
    p.visual.updateMatrix();
  }

  /** build a static collider for a mesh part (world-space baked trimesh) */
  protected makeFixedPart(obj: THREE.Mesh, phys: PartPhys): RAPIER.Collider | null {
    const collider = this.ctx.physics.addStaticMesh(obj, phys.friction, phys.elasticity);
    if (collider && phys.surface) this.ctx.registerSurface(collider.handle, phys.surface);
    return collider;
  }

  /** build a dynamic body for a mesh part per the original parameters */
  protected makeDynamicPart(obj: THREE.Mesh, phys: PartPhys): DynamicPart {
    const world = this.ctx.physics.world;
    obj.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    obj.matrixWorld.decompose(pos, quat, scale);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setLinearDamping(phys.linearDamp ?? 0.1)
      .setAngularDamping(phys.rotDamp ?? 0.1);
    if (phys.startFrozen) bodyDesc.setSleeping(true);
    const body = world.createRigidBody(bodyDesc);

    const verts = localVertices(obj, scale);
    let desc: RAPIER.ColliderDesc | null = null;
    if (phys.trimesh) {
      const index = obj.geometry.getIndex();
      if (index) desc = RAPIER.ColliderDesc.trimesh(verts, new Uint32Array(index.array));
    }
    desc ??= RAPIER.ColliderDesc.convexHull(verts) ?? RAPIER.ColliderDesc.ball(1);
    desc.setFriction(phys.friction).setRestitution(phys.elasticity);

    // mass properties: original mass, optional shifted center, box-approx inertia
    const mass = phys.mass ?? 1;
    const bbox = new THREE.Box3().setFromBufferAttribute(obj.geometry.getAttribute('position') as THREE.BufferAttribute);
    const ex = Math.max(0.2, (bbox.max.x - bbox.min.x) * scale.x);
    const ey = Math.max(0.2, (bbox.max.y - bbox.min.y) * scale.y);
    const ez = Math.max(0.2, (bbox.max.z - bbox.min.z) * scale.z);
    const ix = (mass / 12) * (ey * ey + ez * ez);
    const iy = (mass / 12) * (ex * ex + ez * ez);
    const iz = (mass / 12) * (ex * ex + ey * ey);
    const com = phys.shiftCom ? { x: phys.shiftCom[0], y: phys.shiftCom[1], z: -phys.shiftCom[2] } : { x: 0, y: 0, z: 0 };
    desc.setMassProperties(mass, com, { x: ix, y: iy, z: iz }, { x: 0, y: 0, z: 0, w: 1 });

    const collider = world.createCollider(desc, body);
    if (phys.surface) this.ctx.registerSurface(collider.handle, phys.surface);

    // reparent visual to scene root so physics drives it directly
    this.ctx.scene.attach(obj);
    obj.matrixAutoUpdate = true;

    const dp: DynamicPart = {
      name: obj.name,
      visual: obj,
      body,
      collider,
      homePos: pos.clone(),
      homeRot: quat.clone(),
      frozen: phys.startFrozen ?? false,
    };
    this.dynamicParts.push(dp);
    return dp;
  }

  protected findDynamic(suffix: string): DynamicPart | undefined {
    return this.dynamicParts.find((p) => p.name.endsWith(suffix));
  }

  /** revolute or spherical joint between a part and the world (or another part) */
  protected makeHinge(
    part: DynamicPart,
    pinWorld: THREE.Vector3,
    axisWorld: THREE.Vector3,
    other: DynamicPart | null,
    spherical = false,
  ): RAPIER.ImpulseJoint {
    const world = this.ctx.physics.world;
    let body1: RAPIER.RigidBody;
    let anchor1: THREE.Vector3;
    let axis1: THREE.Vector3;
    if (other) {
      body1 = other.body;
      const inv1 = new THREE.Matrix4().compose(other.homePos, other.homeRot, ONE).invert();
      anchor1 = pinWorld.clone().applyMatrix4(inv1);
      axis1 = axisWorld.clone().applyQuaternion(other.homeRot.clone().invert()).normalize();
    } else {
      body1 = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(pinWorld.x, pinWorld.y, pinWorld.z),
      );
      anchor1 = new THREE.Vector3();
      axis1 = axisWorld.clone().normalize();
    }
    const inv2 = new THREE.Matrix4().compose(part.homePos, part.homeRot, ONE).invert();
    const anchor2 = pinWorld.clone().applyMatrix4(inv2);

    const data = spherical
      ? RAPIER.JointData.spherical(anchor1, anchor2)
      : RAPIER.JointData.revolute(anchor1, anchor2, axis1);
    const joint = world.createImpulseJoint(data, body1, part.body, true);
    this.joints.push(joint);
    return joint;
  }

  /** prismatic joint to the world along a world axis, with limits + optional spring motor */
  protected makePrismatic(
    part: DynamicPart,
    axisWorld: THREE.Vector3,
    limits: [number, number],
    spring?: { stiffness: number; damping: number },
  ): RAPIER.ImpulseJoint {
    const world = this.ctx.physics.world;
    const base = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(part.homePos.x, part.homePos.y, part.homePos.z),
    );
    const inv2 = new THREE.Matrix4().compose(part.homePos, part.homeRot, ONE).invert();
    const anchor2 = part.homePos.clone().applyMatrix4(inv2);
    const data = RAPIER.JointData.prismatic({ x: 0, y: 0, z: 0 }, anchor2, axisWorld.clone().normalize());
    data.limitsEnabled = true;
    data.limits = limits;
    const joint = world.createImpulseJoint(data, base, part.body, true) as RAPIER.PrismaticImpulseJoint;
    if (spring) {
      joint.configureMotorPosition(0, spring.stiffness, spring.damping);
    }
    this.joints.push(joint);
    return joint;
  }

  protected removeJoint(joint: RAPIER.ImpulseJoint): void {
    this.ctx.physics.world.removeImpulseJoint(joint, true);
    this.joints = this.joints.filter((j) => j !== joint);
  }
}

const ONE = new THREE.Vector3(1, 1, 1);

export function localVertices(obj: THREE.Mesh, scale: THREE.Vector3): Float32Array {
  const attr = obj.geometry.getAttribute('position');
  const out = new Float32Array(attr.count * 3);
  for (let i = 0; i < attr.count; i++) {
    out[i * 3] = attr.getX(i) * scale.x;
    out[i * 3 + 1] = attr.getY(i) * scale.y;
    out[i * 3 + 2] = attr.getZ(i) * scale.z;
  }
  return out;
}
