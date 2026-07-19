/**
 * Modul behavior base: a placed instance of a game element with the
 * original sector lifecycle (activate when its sector starts, deactivate
 * when left, reset on ball death within the sector).
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics.ts';
import type { Ball } from '../ball.ts';
import type { DistanceLoopHandle, Surface } from '../audio.ts';
import type { PrefabInstance } from './prefabs.ts';
import type { PartPhys } from './physTable.ts';
import type { MeshRec } from '../../formats/ck2/types.ts';

export interface ModulContext {
  physics: PhysicsWorld;
  scene: THREE.Scene;
  ball: Ball;
  /** register a modul collider's sound surface */
  registerSurface: (colliderHandle: number, surface: Surface) => void;
  /** flat looping sound with source-authored distance gain */
  attachLoop: (
    name: string,
    target: THREE.Object3D,
    volume?: number,
  ) => DistanceLoopHandle;
  /** perspective point-size scale used by source particle sprites */
  pointScale: () => number;
  /** fires gameplay events upward (pickups, trafo, checkpoints...) */
  emit: (event: ModulEvent) => void;
  /**
   * The source Trafo Manager graph is sequential: from trigger until the
   * replacement ball appears it never re-runs its proximity check. True while
   * that sequence is in flight.
   */
  trafoBusy: () => boolean;
}

export type ModulEvent =
  | { kind: 'extraPoint'; amount: number }
  | { kind: 'extraLife' }
  | {
      kind: 'trafo';
      ball: 'paper' | 'wood' | 'stone';
      position: THREE.Vector3;
      sourceMain: THREE.Object3D;
      sourceShadow: THREE.Object3D | null;
    }
  | { kind: 'sound'; name: string; restart?: boolean; volume?: number };

export interface DynamicPart {
  name: string;
  visual: THREE.Mesh;
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
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

  /** The world-position Y the DepthTest graph reads via Get Y. */
  worldY(): number {
    const part = this.dynamicParts[0];
    if (part) return part.body.translation().y;
    return this.instance.root.position.y;
  }

  partWorldPosition(suffix: string): THREE.Vector3 | null {
    const obj = this.part(suffix);
    if (!obj) return null;
    obj.updateWorldMatrix(true, false);
    return new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
  }

  /** A Virtools-space point transformed by an authored prefab referential. */
  referenceWorldPoint(suffix: string, point: [number, number, number]): THREE.Vector3 | null {
    const obj = this.part(suffix);
    if (!obj) return null;
    obj.updateWorldMatrix(true, false);
    return new THREE.Vector3(point[0], point[1], -point[2]).applyMatrix4(obj.matrixWorld);
  }

  /** A Virtools-space direction transformed by an authored prefab referential. */
  referenceWorldDirection(suffix: string, direction: [number, number, number]): THREE.Vector3 | null {
    const obj = this.part(suffix);
    if (!obj) return null;
    obj.updateWorldMatrix(true, false);
    return new THREE.Vector3(direction[0], direction[1], -direction[2]).transformDirection(obj.matrixWorld);
  }

  /** Like referenceWorldDirection, but preserves the serialized magnitude. */
  referenceWorldVector(suffix: string, vector: [number, number, number]): THREE.Vector3 | null {
    const obj = this.part(suffix);
    if (!obj) return null;
    obj.updateWorldMatrix(true, false);
    return new THREE.Vector3(vector[0], vector[1], -vector[2]).applyMatrix3(
      new THREE.Matrix3().setFromMatrix4(obj.matrixWorld),
    );
  }

  /**
   * Sector activation has stamped this instance at least once. Unactivated
   * prefab copies in the source are parked hidden away from their placement,
   * so systems like the Trafo Manager scan must ignore never-stamped moduls.
   */
  stamped = false;

  /**
   * P_Modul_18 is the only prefab whose deactivation branch has no
   * Hide/Restore IC: fans stay visible when their sector is left.
   */
  protected hiddenWhenInactive = true;

  /**
   * Activate Sector: Set World Matrix (placement) + Show + Physicalize /
   * Activate Script (Reset?=true) - a fresh authored state on every
   * activation. Frozen bodies start asleep (IVP frozen semantics).
   */
  activate(): void {
    this.active = true;
    this.stamped = true;
    this.depthCulled = false;
    this.instance.root.visible = true;
    for (const p of this.dynamicParts) {
      p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, false);
      for (const collider of p.colliders) collider.setEnabled(true);
      p.body.setTranslation({ x: p.homePos.x, y: p.homePos.y, z: p.homePos.z }, false);
      p.body.setRotation({ x: p.homeRot.x, y: p.homeRot.y, z: p.homeRot.z, w: p.homeRot.w }, false);
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      if (p.frozen) p.body.sleep();
      else p.body.wakeUp();
      this.syncPart(p);
    }
  }

  /**
   * Deactivate Sector: the MF false branch destroys joints/forces,
   * unphysicalizes, and Restore IC returns the authored arrangement hidden
   * (Reset 2 objects get explicit Unphysicalize + Hide). The port keeps the
   * joints but parks the bodies fixed with disabled colliders at the
   * authored pose - inert, invisible, and rebuilt fresh on activation.
   */
  deactivate(): void {
    this.active = false;
    if (this.hiddenWhenInactive) this.instance.root.visible = false;
    for (const p of this.dynamicParts) {
      p.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
      for (const collider of p.colliders) collider.setEnabled(false);
      p.body.setTranslation({ x: p.homePos.x, y: p.homePos.y, z: p.homePos.z }, false);
      p.body.setRotation({ x: p.homeRot.x, y: p.homeRot.y, z: p.homeRot.z, w: p.homeRot.w }, false);
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      this.syncPart(p);
    }
  }

  /**
   * Gameplay.nmo/DepthTest culled this instance: Unphysicalize -> Hide ->
   * Set Position (0,0,0) world. Unphysicalize maps to a fixed body with all
   * colliders disabled (no simulation, no interactions), never a disabled
   * body (Rapier panics on joints attached to disabled bodies).
   */
  depthCulled = false;

  depthCull(): void {
    if (this.depthCulled) return;
    this.depthCulled = true;
    for (const p of this.dynamicParts) {
      p.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
      for (const collider of p.colliders) collider.setEnabled(false);
      p.body.setTranslation({ x: 0, y: 0, z: 0 }, false);
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      this.syncPart(p);
    }
    this.instance.root.visible = false;
  }

  private depthRestore(): void {
    if (!this.depthCulled) return;
    this.depthCulled = false;
    for (const p of this.dynamicParts) {
      p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, false);
      for (const collider of p.colliders) collider.setEnabled(true);
    }
    this.instance.root.visible = true;
  }

  /**
   * Restore initial state (ball died in this sector). PH_Groups serializes
   * Reset type 2 for the loose ball and box groups, and Activate Sector runs
   * Set World Matrix + Show + Physicalize on them, so a depth-culled prop is
   * re-physicalized and shown again at its placement.
   */
  reset(): void {
    this.depthRestore();
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

  debugState(): Record<string, unknown> {
    return {
      name: this.name,
      sector: this.sector,
      active: this.active,
      joints: this.joints.length,
      parts: Object.fromEntries(
        this.dynamicParts.map((part) => {
          const position = part.body.translation();
          return [part.name, { position: [position.x, position.y, position.z], sleeping: part.body.isSleeping() }];
        }),
      ),
    };
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
    if (phys.collisionMeshes?.length) {
      obj.updateWorldMatrix(true, false);
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      obj.matrixWorld.decompose(pos, quat, scale);
      const body = this.ctx.physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(pos.x, pos.y, pos.z)
          .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }),
      );
      const colliders = this.createColliders(body, obj, phys, scale);
      return colliders[0] ?? null;
    }
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
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    if (phys.startFrozen) bodyDesc.setSleeping(true);
    const body = world.createRigidBody(bodyDesc);
    this.ctx.physics.setIvpDamping(body, phys.linearDamp ?? 0.1, phys.rotDamp ?? 0.1);

    const colliders = this.createColliders(body, obj, phys, scale);
    const collider = colliders[0];

    // Build compound inertia from the authored hulls at unit density, then
    // scale it to the Physicalize mass. Automatic Calculate Mass Center is
    // false in the source module behaviors, so their serialized shift (often
    // exactly the entity origin) takes precedence over the geometric COM.
    body.recomputeMassPropertiesFromColliders();
    const unitMass = body.mass();
    const unitInertia = body.principalInertia();
    const inertiaFrame = body.principalInertiaLocalFrame();
    const geometricCom = body.localCom();
    for (const partCollider of colliders) partCollider.setDensity(0);
    body.recomputeMassPropertiesFromColliders();
    const mass = phys.mass ?? 1;
    const scaleMass = unitMass > 1e-8 ? mass / unitMass : mass;
    const com = phys.shiftCom
      ? { x: phys.shiftCom[0], y: phys.shiftCom[1], z: -phys.shiftCom[2] }
      : geometricCom;
    body.setAdditionalMassProperties(
      mass,
      com,
      {
        x: Math.max(unitInertia.x * scaleMass, 1e-6),
        y: Math.max(unitInertia.y * scaleMass, 1e-6),
        z: Math.max(unitInertia.z * scaleMass, 1e-6),
      },
      inertiaFrame,
      false,
    );

    // reparent visual to scene root so physics drives it directly
    this.ctx.scene.attach(obj);
    obj.matrixAutoUpdate = true;

    const dp: DynamicPart = {
      name: obj.name,
      visual: obj,
      body,
      colliders,
      collider,
      homePos: pos.clone(),
      homeRot: quat.clone(),
      frozen: phys.startFrozen ?? false,
    };
    this.dynamicParts.push(dp);
    return dp;
  }

  private createColliders(
    body: RAPIER.RigidBody,
    obj: THREE.Mesh,
    phys: PartPhys,
    scale: THREE.Vector3,
  ): RAPIER.Collider[] {
    const descriptions: RAPIER.ColliderDesc[] = [];
    if (phys.sphereRadius) {
      descriptions.push(RAPIER.ColliderDesc.ball(phys.sphereRadius));
    } else if (phys.collisionMeshes?.length) {
      for (const meshName of phys.collisionMeshes) {
        const mesh = this.instance.file.byName
          .get(meshName)
          ?.find((record): record is MeshRec => record.kind === 'mesh');
        if (!mesh) continue;
        const desc = RAPIER.ColliderDesc.convexHull(meshRecordVertices(mesh, scale));
        if (desc) descriptions.push(desc);
      }
    } else {
      const verts = localVertices(obj, scale);
      if (phys.trimesh) {
        const index = obj.geometry.getIndex();
        if (index) descriptions.push(RAPIER.ColliderDesc.trimesh(verts, new Uint32Array(index.array)));
      } else {
        const convex = RAPIER.ColliderDesc.convexHull(verts);
        if (convex) descriptions.push(convex);
      }
    }
    if (descriptions.length === 0) descriptions.push(RAPIER.ColliderDesc.ball(1));

    return descriptions.map((desc) => {
      desc
        .setFriction(phys.friction)
        .setRestitution(phys.elasticity)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
        .setDensity(1);
      if (phys.collisionEnabled === false) desc.setCollisionGroups(0).setSolverGroups(0);
      const collider = this.ctx.physics.world.createCollider(desc, body);
      if (phys.surface && phys.collisionEnabled !== false) this.ctx.registerSurface(collider.handle, phys.surface);
      return collider;
    });
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
    limits?: [number, number],
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
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(pinWorld.x, pinWorld.y, pinWorld.z)
          .setRotation({ x: part.homeRot.x, y: part.homeRot.y, z: part.homeRot.z, w: part.homeRot.w }),
      );
      anchor1 = new THREE.Vector3();
      axis1 = axisWorld.clone().applyQuaternion(part.homeRot.clone().invert()).normalize();
    }
    const inv2 = new THREE.Matrix4().compose(part.homePos, part.homeRot, ONE).invert();
    const anchor2 = pinWorld.clone().applyMatrix4(inv2);

    const data = spherical
      ? RAPIER.JointData.spherical(anchor1, anchor2)
      : RAPIER.JointData.revolute(anchor1, anchor2, axis1);
    const joint = world.createImpulseJoint(data, body1, part.body, true);
    // IVP jointed assemblies do not resolve contacts between the two linked
    // bodies. Rapier enables those contacts by default, which makes authored
    // overlapping hinge geometry inject unbounded separation impulses.
    joint.setContactsEnabled(false);
    if (!spherical && limits) (joint as RAPIER.RevoluteImpulseJoint).setLimits(limits[0], limits[1]);
    this.joints.push(joint);
    return joint;
  }

  /** prismatic joint to the world along a world axis, with limits + optional spring motor */
  protected makePrismatic(
    part: DynamicPart,
    axisWorld: THREE.Vector3,
    limits?: [number, number],
    other: DynamicPart | null = null,
  ): RAPIER.ImpulseJoint {
    const world = this.ctx.physics.world;
    const object2 = other
      ? other.body
      : world.createRigidBody(
          RAPIER.RigidBodyDesc.fixed()
            .setTranslation(part.homePos.x, part.homePos.y, part.homePos.z)
            .setRotation({ x: part.homeRot.x, y: part.homeRot.y, z: part.homeRot.z, w: part.homeRot.w }),
        );
    const anchor1 = new THREE.Vector3();
    const anchor2 = other
      ? part.homePos
          .clone()
          .applyMatrix4(new THREE.Matrix4().compose(other.homePos, other.homeRot, ONE).invert())
      : new THREE.Vector3();
    // Virtools' Target is the first slider object and Object2 is the second;
    // keeping that order also preserves the sign of its serialized limits.
    const axis1 = axisWorld.clone().applyQuaternion(part.homeRot.clone().invert()).normalize();
    const data = RAPIER.JointData.prismatic(anchor1, anchor2, axis1);
    if (limits) {
      data.limitsEnabled = true;
      data.limits = limits;
    }
    const joint = world.createImpulseJoint(data, part.body, object2, true) as RAPIER.PrismaticImpulseJoint;
    joint.setContactsEnabled(false);
    this.joints.push(joint);
    return joint;
  }

  /** Source Set Physics Spring: Position 1 is on Target, Position 2 on Object2/world. */
  protected makeSpring(
    part: DynamicPart,
    other: DynamicPart | null,
    anchor1World: THREE.Vector3,
    anchor2World: THREE.Vector3,
    length: number,
    stiffness: number,
    damping: number,
  ): RAPIER.ImpulseJoint {
    const world = this.ctx.physics.world;
    let body1: RAPIER.RigidBody;
    let anchor1: THREE.Vector3;
    if (other) {
      body1 = other.body;
      const inv1 = new THREE.Matrix4().compose(other.homePos, other.homeRot, ONE).invert();
      anchor1 = anchor2World.clone().applyMatrix4(inv1);
    } else {
      body1 = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(anchor2World.x, anchor2World.y, anchor2World.z),
      );
      anchor1 = new THREE.Vector3();
    }
    const inv2 = new THREE.Matrix4().compose(part.homePos, part.homeRot, ONE).invert();
    const anchor2 = anchor1World.clone().applyMatrix4(inv2);
    const data = RAPIER.JointData.spring(length, stiffness, damping, anchor1, anchor2);
    const joint = world.createImpulseJoint(data, body1, part.body, true);
    joint.setContactsEnabled(false);
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

function meshRecordVertices(mesh: MeshRec, scale: THREE.Vector3): Float32Array {
  const out = new Float32Array(mesh.vertexCount * 3);
  for (let i = 0; i < mesh.vertexCount; i++) {
    out[i * 3] = mesh.positions[i * 3] * scale.x;
    out[i * 3 + 1] = mesh.positions[i * 3 + 1] * scale.y;
    out[i * 3 + 2] = -mesh.positions[i * 3 + 2] * scale.z;
  }
  return out;
}
