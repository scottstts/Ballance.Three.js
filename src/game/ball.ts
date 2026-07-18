/**
 * Player ball: physics body + visual mesh loaded from the original Balls.nmo.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { loadNmo } from '../engine/assets.ts';
import { buildScene } from '../engine/sceneBuilder.ts';
import { BALL_DEFS, FORCE_SCALE, type BallDef, type BallKind } from './constants.ts';
import type { PhysicsWorld } from './physics.ts';

export class Ball {
  kind: BallKind = 'wood';
  def: BallDef = BALL_DEFS.wood;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  visual: THREE.Object3D;
  private visuals: Record<BallKind, THREE.Object3D>;
  private physics: PhysicsWorld;
  /** the paper ball is physicalized as its crumpled mesh, not a sphere */
  private paperHull: Float32Array | null = null;

  private constructor(
    physics: PhysicsWorld,
    visuals: Record<BallKind, THREE.Object3D>,
    parent: THREE.Object3D,
    position: THREE.Vector3,
  ) {
    this.physics = physics;
    this.visuals = visuals;
    const { body, collider } = physics.createBallBody(this.def, position);
    this.body = body;
    this.collider = collider;
    this.visual = visuals.wood;
    for (const v of Object.values(visuals)) {
      v.visible = false;
      parent.add(v);
    }
    this.visual.visible = true;
    this.paperHull = hullVertices(visuals.paper);
  }

  static async create(physics: PhysicsWorld, parent: THREE.Object3D, position: THREE.Vector3): Promise<Ball> {
    const file = await loadNmo('3D Entities/Balls.nmo');
    const built = await buildScene(file);
    const grab = (name: string): THREE.Object3D => {
      const e = built.entities.get(name);
      if (!e) throw new Error(`missing ${name} in Balls.nmo`);
      const obj = e.object;
      obj.removeFromParent();
      obj.position.set(0, 0, 0);
      obj.quaternion.identity();
      obj.updateMatrix();
      obj.visible = true;
      return obj;
    };
    const visuals: Record<BallKind, THREE.Object3D> = {
      paper: grab('Ball_Paper'),
      wood: grab('Ball_Wood'),
      stone: grab('Ball_Stone'),
    };
    return new Ball(physics, visuals, parent, position);
  }

  setKind(kind: BallKind): void {
    if (kind === this.kind) return;
    this.kind = kind;
    this.def = BALL_DEFS[kind];
    this.visual.visible = false;
    this.visual = this.visuals[kind];
    this.visual.visible = true;
    // swap the collider: paper uses its crumpled mesh hull (original
    // physicalizes it as a mesh, BallRadius 0), wood/stone are spheres
    const world = this.physics.world;
    world.removeCollider(this.collider, false);
    let desc: RAPIER.ColliderDesc | null = null;
    if (kind === 'paper' && this.paperHull) desc = RAPIER.ColliderDesc.convexHull(this.paperHull);
    desc ??= RAPIER.ColliderDesc.ball(this.def.radius);
    desc
      .setFriction(this.def.friction)
      .setRestitution(this.def.elasticity)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
      .setMass(this.def.mass)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    this.collider = world.createCollider(desc, this.body);
    this.body.setLinearDamping(this.def.linearDamp);
    this.body.setAngularDamping(this.def.rotDamp);
    this.body.wakeUp();
  }

  /** Constant push force in a camera-relative horizontal direction. */
  applyPush(dir: THREE.Vector3): void {
    const f = this.def.force * FORCE_SCALE;
    this.body.resetForces(true);
    if (dir.lengthSq() > 0) {
      this.body.addForce({ x: dir.x * f, y: 0, z: dir.z * f }, true);
    }
  }

  teleport(position: THREE.Vector3): void {
    this.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  /** Sync the visual to the physics transform. */
  syncVisual(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.visual.position.set(t.x, t.y, t.z);
    this.visual.quaternion.set(r.x, r.y, r.z, r.w);
    this.visual.updateMatrix();
  }

  dispose(): void {
    this.physics.removeBody(this.body);
  }
}

/** collect local-space vertices of the first mesh under an object */
function hullVertices(obj: THREE.Object3D): Float32Array | null {
  let found: Float32Array | null = null;
  obj.traverse((child) => {
    if (found || !(child instanceof THREE.Mesh)) return;
    const pos = child.geometry.getAttribute('position');
    if (pos) found = new Float32Array(pos.array);
  });
  return found;
}
