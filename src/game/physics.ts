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

interface IvpDampingBody {
  body: RAPIER.RigidBody;
  linear: number;
  angular: number;
}

function vectorLength(x: number, y: number, z: number): number {
  return Math.hypot(x, y, z);
}

/**
 * IVP applies linear damping explicitly before force and gravity impulses.
 * The shipped physics_RT.dll copies the serialized coefficient directly to
 * IVP's speed_damp_factor; IVP uses this linear branch below while d*dt < .25.
 */
export function ivpLinearDampingFactor(damping: number, dt = SIM_DT): number {
  const scaled = damping * dt;
  return scaled < 0.25 ? 1 - scaled : Math.exp(-scaled);
}

/**
 * The original uses the squared length of its three-axis damping vector to
 * select the rotation branch. Ballance serializes one isotropic scalar.
 */
export function ivpAngularDampingFactor(damping: number, dt = SIM_DT): number {
  const scaled = damping * dt;
  return 3 * scaled * scaled < 0.5 ? 1 - scaled : Math.exp(-scaled);
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
  private readonly ivpDampingBodies = new Map<number, IvpDampingBody>();
  private dampingPrepared = false;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
    this.world.timestep = SIM_DT;
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  step(): void {
    this.prepareIvpDamping();
    this.world.step(this.eventQueue);
    this.dampingPrepared = false;
  }

  /**
   * Register the original IVP coefficients without enabling Rapier's own
   * implicit, post-force damping law.
   */
  setIvpDamping(body: RAPIER.RigidBody, linear: number, angular: number): void {
    body.setLinearDamping(0);
    body.setAngularDamping(0);
    this.ivpDampingBodies.set(body.handle, { body, linear, angular });
  }

  private prepareIvpDamping(): void {
    if (this.dampingPrepared) return;
    for (const [handle, state] of this.ivpDampingBodies) {
      const { body } = state;
      if (!body.isValid()) {
        this.ivpDampingBodies.delete(handle);
        continue;
      }
      if (!body.isDynamic() || body.isSleeping()) continue;
      const linear = body.linvel();
      const angular = body.angvel();
      const linearFactor = ivpLinearDampingFactor(state.linear);
      const angularFactor = ivpAngularDampingFactor(state.angular);
      body.setLinvel(
        { x: linear.x * linearFactor, y: linear.y * linearFactor, z: linear.z * linearFactor },
        false,
      );
      body.setAngvel(
        { x: angular.x * angularFactor, y: angular.y * angularFactor, z: angular.z * angularFactor },
        false,
      );
    }
    this.dampingPrepared = true;
  }

  /**
   * Capture velocities before the solver mutates them. physics_RT.dll's
   * collision event supplies the magnitude of this relative-speed vector.
   */
  snapshotMotions(): Map<number, RigidBodyMotion> {
    // IVP's gravity controller damps the existing velocity before committing
    // the current SetPhysicsForce impulses. Prepare that same first phase so
    // collision-speed samples observe the source-authored damping law.
    this.prepareIvpDamping();
    const motions = new Map<number, RigidBodyMotion>();
    this.world.forEachRigidBody((body) => {
      const center = body.worldCom();
      const linear = body.linvel();
      const angular = body.angvel();
      let linearX = linear.x;
      let linearY = linear.y;
      let linearZ = linear.z;
      let angularX = angular.x;
      let angularY = angular.y;
      let angularZ = angular.z;
      if (body.isDynamic() && !body.isSleeping()) {
        // SetPhysicsForce is an IVP_CP_ACTUATOR controller: it queues an
        // asynchronous impulse before the gravity controller damps, commits
        // those impulses, and adds gravity. Predict that controller phase so
        // impact sounds sample the velocity immediately before contact solve.
        const force = body.userForce();
        const invMassDt = body.invMass() * SIM_DT;
        linearX += force.x * invMassDt;
        linearY += force.y * invMassDt + GRAVITY_Y * body.gravityScale() * SIM_DT;
        linearZ += force.z * invMassDt;
        const torque = body.userTorque();
        const inertia = body.effectiveWorldInvInertia();
        angularX += (inertia.m11 * torque.x + inertia.m12 * torque.y + inertia.m13 * torque.z) * SIM_DT;
        angularY += (inertia.m21 * torque.x + inertia.m22 * torque.y + inertia.m23 * torque.z) * SIM_DT;
        angularZ += (inertia.m31 * torque.x + inertia.m32 * torque.y + inertia.m33 * torque.z) * SIM_DT;
      }
      motions.set(body.handle, {
        center: { x: center.x, y: center.y, z: center.z },
        linear: { x: linearX, y: linearY, z: linearZ },
        angular: { x: angularX, y: angularY, z: angularZ },
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

  /**
   * Invisible DepthTestCubes retain their authored world-space mesh as a
   * non-response collision trigger. This lets every player collider shape
   * (including the paper convex hull) enter the exact source volume.
   */
  addStaticSensorMesh(object: THREE.Mesh): RAPIER.Collider | null {
    const geo = object.geometry;
    const posAttr = geo.getAttribute('position');
    const index = geo.getIndex();
    if (!posAttr || !index) return null;
    const vertices = new Float32Array(posAttr.count * 3);
    const point = new THREE.Vector3();
    object.updateWorldMatrix(true, false);
    for (let vertex = 0; vertex < posAttr.count; vertex++) {
      point.fromBufferAttribute(posAttr, vertex).applyMatrix4(object.matrixWorld);
      vertices[vertex * 3] = point.x;
      vertices[vertex * 3 + 1] = point.y;
      vertices[vertex * 3 + 2] = point.z;
    }
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const desc = RAPIER.ColliderDesc.trimesh(new Float32Array(vertices), new Uint32Array(index.array))
      .setSensor(true)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    return this.world.createCollider(desc, body);
  }

  createBallBody(def: BallDef, position: THREE.Vector3): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(bodyDesc);
    this.setIvpDamping(body, def.linearDamp, def.rotDamp);
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
    this.ivpDampingBodies.delete(body.handle);
    this.world.removeRigidBody(body);
  }
}
