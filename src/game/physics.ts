/**
 * Rapier physics world running at the original 66 Hz simulation rate.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GRAVITY_Y, SIM_DT, type BallDef } from './constants.ts';

let rapierReady: Promise<void> | null = null;

export function initRapier(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly eventQueue: RAPIER.EventQueue;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
    this.world.timestep = SIM_DT;
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  step(): void {
    this.world.step(this.eventQueue);
  }

  /**
   * Static trimesh collider from world-space-baked geometry.
   * Returns the collider so callers can map contacts back to game objects.
   */
  addStaticMesh(
    object: THREE.Mesh,
    friction: number,
    restitution: number,
  ): RAPIER.Collider | null {
    const geo = object.geometry;
    const posAttr = geo.getAttribute('position');
    const index = geo.getIndex();
    if (!posAttr || !index) return null;
    const vertices = new Float32Array(posAttr.count * 3);
    const v = new THREE.Vector3();
    object.updateWorldMatrix(true, false);
    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(object.matrixWorld);
      vertices[i * 3] = v.x;
      vertices[i * 3 + 1] = v.y;
      vertices[i * 3 + 2] = v.z;
    }
    const indices = new Uint32Array(index.array);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices)
      .setFriction(friction)
      .setRestitution(restitution)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
    return this.world.createCollider(desc, body);
  }

  createBallBody(def: BallDef, position: THREE.Vector3): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(def.linearDamp)
      .setAngularDamping(def.rotDamp)
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.ball(def.radius)
      .setFriction(def.friction)
      .setRestitution(def.elasticity)
      .setMass(def.mass)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    const collider = this.world.createCollider(colliderDesc, body);
    return { body, collider };
  }

  removeBody(body: RAPIER.RigidBody): void {
    this.world.removeRigidBody(body);
  }
}
