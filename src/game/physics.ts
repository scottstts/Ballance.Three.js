/**
 * Rapier physics world running at the original 66 Hz simulation rate.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GRAVITY_Y, SIM_DT, type BallDef } from './constants.ts';

let rapierReady: Promise<void> | null = null;

export interface RigidBodyMotion {
  center: { x: number; y: number; z: number };
  linear: { x: number; y: number; z: number };
  angular: { x: number; y: number; z: number };
}

export type MotionSnapshot = ReadonlyMap<number, RigidBodyMotion>;

function vectorLength(x: number, y: number, z: number): number {
  return Math.hypot(x, y, z);
}

/** Pre-solver velocity of a world point: linear + angular cross radius. */
export function pointVelocity(
  motion: RigidBodyMotion | undefined,
  point: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  if (!motion) return { x: 0, y: 0, z: 0 };
  const rx = point.x - motion.center.x;
  const ry = point.y - motion.center.y;
  const rz = point.z - motion.center.z;
  return {
    x: motion.linear.x + motion.angular.y * rz - motion.angular.z * ry,
    y: motion.linear.y + motion.angular.z * rx - motion.angular.x * rz,
    z: motion.linear.z + motion.angular.x * ry - motion.angular.y * rx,
  };
}

export function relativePointSpeed(
  first: RigidBodyMotion | undefined,
  second: RigidBodyMotion | undefined,
  point: { x: number; y: number; z: number },
): number {
  const a = pointVelocity(first, point);
  const b = pointVelocity(second, point);
  return vectorLength(a.x - b.x, a.y - b.y, a.z - b.z);
}

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
   * Capture velocities before the solver mutates them. physics_RT.dll's
   * collision event supplies the magnitude of this relative-speed vector.
   */
  snapshotMotions(): Map<number, RigidBodyMotion> {
    const motions = new Map<number, RigidBodyMotion>();
    this.world.forEachRigidBody((body) => {
      const center = body.worldCom();
      const linear = body.linvel();
      const angular = body.angvel();
      motions.set(body.handle, {
        center: { x: center.x, y: center.y, z: center.z },
        linear: { x: linear.x, y: linear.y, z: linear.z },
        angular: { x: angular.x, y: angular.y, z: angular.z },
      });
    });
    return motions;
  }

  /** Best Rapier equivalent of IVP's pre-response collision-speed vector. */
  collisionRelativeSpeed(
    first: RAPIER.Collider,
    second: RAPIER.Collider,
    motions: MotionSnapshot,
  ): number {
    const firstMotion = motions.get(first.parent()?.handle ?? -1);
    const secondMotion = motions.get(second.parent()?.handle ?? -1);
    let speed = 0;
    let sampledPoint = false;
    this.world.contactPair(first, second, (manifold) => {
      for (let index = 0; index < manifold.numSolverContacts(); index++) {
        sampledPoint = true;
        speed = Math.max(speed, relativePointSpeed(firstMotion, secondMotion, manifold.solverContactPoint(index)));
      }
    });
    if (sampledPoint) return speed;
    const a = firstMotion?.linear ?? { x: 0, y: 0, z: 0 };
    const b = secondMotion?.linear ?? { x: 0, y: 0, z: 0 };
    return vectorLength(a.x - b.x, a.y - b.y, a.z - b.z);
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
    // FIX_INTERNAL_EDGES stops the ball from tripping on triangle seams of flat floors
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(friction)
      .setRestitution(restitution);
    return this.world.createCollider(desc, body);
  }

  createBallBody(def: BallDef, position: THREE.Vector3): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(def.linearDamp)
      .setAngularDamping(def.rotDamp)
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(bodyDesc);
    // IVP combines friction/elasticity multiplicatively (ball 0.8 x floor 0.7 etc.)
    const colliderDesc = RAPIER.ColliderDesc.ball(def.radius)
      .setFriction(def.friction)
      .setRestitution(def.elasticity)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
      .setMass(def.mass)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    const collider = this.world.createCollider(colliderDesc, body);
    return { body, collider };
  }

  removeBody(body: RAPIER.RigidBody): void {
    this.world.removeRigidBody(body);
  }
}
