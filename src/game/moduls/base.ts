/**
 * Modul behavior base: a placed instance of a game element with the
 * original sector lifecycle (activate when its sector starts, deactivate
 * when left, reset on ball death within the sector).
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics.ts';
import type { Ball } from '../ball.ts';
import type { PrefabInstance } from './prefabs.ts';

export interface ModulContext {
  physics: PhysicsWorld;
  scene: THREE.Scene;
  ball: Ball;
  /** fires gameplay events upward (pickups, trafo, checkpoints...) */
  emit: (event: ModulEvent) => void;
}

export type ModulEvent =
  | { kind: 'extraPoint'; amount: number }
  | { kind: 'extraLife' }
  | { kind: 'trafo'; ball: 'paper' | 'wood' | 'stone' }
  | { kind: 'sound'; name: string; position: THREE.Vector3; volume?: number };

export abstract class Modul {
  readonly name: string;
  readonly sector: number;
  readonly instance: PrefabInstance;
  protected ctx: ModulContext;
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

  activate(): void {
    this.active = true;
  }

  deactivate(): void {
    this.active = false;
  }

  /** restore initial state (ball died in this sector) */
  abstract reset(): void;

  /** per-physics-tick update */
  update(_dt: number): void {}

  dispose(): void {}

  /** world matrix of a part as spawned */
  protected partWorldMatrix(obj: THREE.Object3D): THREE.Matrix4 {
    obj.updateWorldMatrix(true, false);
    return obj.matrixWorld.clone();
  }

  /** create a dynamic body for a mesh part with a convex hull collider */
  protected makeDynamicPart(
    obj: THREE.Mesh,
    opts: { mass: number; friction: number; restitution: number; linearDamp?: number; angularDamp?: number },
  ): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const world = this.ctx.physics.world;
    obj.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    obj.matrixWorld.decompose(pos, quat, scale);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setLinearDamping(opts.linearDamp ?? 0)
      .setAngularDamping(opts.angularDamp ?? 0);
    const body = world.createRigidBody(bodyDesc);

    const verts = localVertices(obj, scale);
    const desc =
      RAPIER.ColliderDesc.convexHull(verts) ?? RAPIER.ColliderDesc.ball(1);
    desc.setFriction(opts.friction).setRestitution(opts.restitution).setMass(opts.mass);
    const collider = world.createCollider(desc, body);

    // reparent visual to scene root so physics drives it directly
    this.ctx.scene.attach(obj);
    return { body, collider };
  }

  /** sync a part's visual to its physics body */
  protected syncPart(obj: THREE.Object3D, body: RAPIER.RigidBody): void {
    const t = body.translation();
    const r = body.rotation();
    obj.position.set(t.x, t.y, t.z);
    obj.quaternion.set(r.x, r.y, r.z, r.w);
    obj.updateMatrix();
  }
}

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
