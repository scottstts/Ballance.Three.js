/**
 * In-world effects built from the original assets: checkpoint/start flames,
 * the trafo lightning sphere, and the ball shatter pieces from Balls.nmo.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { loadNmo } from '../engine/assets.ts';
import { buildScene, groupEntities, type BuiltScene } from '../engine/sceneBuilder.ts';
import { decodeImageFile } from '../engine/textures.ts';
import { localVertices } from './moduls/base.ts';
import { BALL_DEFS, type BallKind } from './constants.ts';
import type { PhysicsWorld } from './physics.ts';

async function spriteTexture(path: string, mode: 'glow' | 'shadow' = 'glow'): Promise<THREE.Texture | null> {
  try {
    const img = await decodeImageFile(path);
    const d = img.rgba;
    for (let i = 0; i < d.length; i += 4) {
      const lum = Math.max(d[i], d[i + 1], d[i + 2]);
      if (mode === 'glow') {
        // glow sprites: black background is the transparent key
        d[i + 3] = lum;
      } else {
        // shadow decals: dark blob on white — alpha from darkness, black ink
        d[i + 3] = 255 - lum;
        d[i] = d[i + 1] = d[i + 2] = 0;
      }
    }
    const tex = new THREE.DataTexture(new Uint8Array(img.rgba.buffer), img.width, img.height, THREE.RGBAFormat);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  } catch {
    return null;
  }
}

/** Rising pink flame: layered additive billboards with flicker, like the original. */
export class Flame {
  readonly group = new THREE.Group();
  private sprites: THREE.Sprite[] = [];
  private t = Math.random() * 10;
  big: boolean;

  constructor(texture: THREE.Texture | null, big: boolean) {
    this.big = big;
    // bright magenta core + rising pink wisps, like the original emitters
    const tints = [new THREE.Color(1.6, 0.5, 1.1), new THREE.Color(1.2, 0.35, 0.9), new THREE.Color(1, 0.3, 0.8), new THREE.Color(0.9, 0.35, 0.9)];
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.SpriteMaterial({
        map: texture,
        color: tints[i],
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.95,
      });
      const s = new THREE.Sprite(mat);
      this.group.add(s);
      this.sprites.push(s);
    }
  }

  update(dt: number): void {
    this.t += dt;
    const base = this.big ? 5.2 : 3.6;
    for (let i = 0; i < this.sprites.length; i++) {
      const s = this.sprites[i];
      const phase = this.t * (2.2 + i * 0.7) + i * 2.1;
      const flicker = 0.8 + 0.2 * Math.sin(phase) * Math.sin(phase * 1.7);
      if (i === 0) {
        // core orb at the base
        s.scale.set(base * 0.6 * flicker, base * 0.6 * flicker, 1);
        s.position.y = base * 0.18;
        (s.material as THREE.SpriteMaterial).opacity = 0.95;
        continue;
      }
      const h = base * (0.75 + 0.3 * i);
      s.scale.set(base * 0.42 * flicker, h * flicker, 1);
      s.position.y = h * 0.42 + 0.4 * i + 0.2 * Math.sin(phase * 1.3);
      (s.material as THREE.SpriteMaterial).opacity = (0.85 - i * 0.18) * flicker;
    }
  }
}

/**
 * Flame decorations. Original states: the start pad burns four flames; the
 * *armed* (next) checkpoint burns its big center flame, later checkpoints
 * show two small flames, crossed checkpoints none.
 */
export class FlameSystem {
  private flames: Flame[] = [];
  private byCheckpoint = new Map<string, { big: Flame; smalls: Flame[] }>();
  private texture: THREE.Texture | null = null;

  async init(built: BuiltScene, scene: THREE.Scene): Promise<void> {
    this.texture = await spriteTexture('Textures/Particle_Flames.bmp');
    // start pad: four flames, always burning
    const start = groupEntities(built, 'PS_Levelstart')[0];
    if (start) {
      const offsets = [
        [7.3, 2.1, -6.1],
        [7.3, 2.1, 6.1],
        [-7.2, 2.1, 6.1],
        [-7.2, 2.1, -6.1],
      ];
      for (const [x, y, z] of offsets) this.addFlame(scene, start.object, new THREE.Vector3(x, y, -z), false);
    }
    for (const cp of groupEntities(built, 'PC_Checkpoints')) {
      const big = this.addFlame(scene, cp.object, new THREE.Vector3(0, 1.5, 0), true);
      const smallA = this.addFlame(scene, cp.object, new THREE.Vector3(0, 2.1, 6.9), false);
      const smallB = this.addFlame(scene, cp.object, new THREE.Vector3(0, 2.1, -7.1), false);
      big.group.visible = false;
      this.byCheckpoint.set(cp.rec.name, { big, smalls: [smallA, smallB] });
    }
  }

  private addFlame(scene: THREE.Scene, anchor: THREE.Object3D, offset: THREE.Vector3, big: boolean): Flame {
    const flame = new Flame(this.texture, big);
    const pos = offset.clone().applyQuaternion(anchor.quaternion).add(anchor.position);
    flame.group.position.copy(pos);
    scene.add(flame.group);
    this.flames.push(flame);
    return flame;
  }

  /** the checkpoint the player must reach next: big flame on, smalls off */
  arm(checkpointName: string): void {
    const f = this.byCheckpoint.get(checkpointName);
    if (!f) return;
    f.big.group.visible = true;
    for (const s of f.smalls) s.group.visible = false;
  }

  /** checkpoint crossed: all its flames out */
  extinguish(checkpointName: string): void {
    const f = this.byCheckpoint.get(checkpointName);
    if (!f) return;
    f.big.group.visible = false;
    for (const s of f.smalls) s.group.visible = false;
  }

  update(dt: number): void {
    for (const f of this.flames) {
      if (f.group.visible) f.update(dt);
    }
  }
}

/** The ball's round drop shadow (HardShadow.bmp), projected onto the floor. */
export class BallShadow {
  readonly mesh: THREE.Mesh;

  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 4.6),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        color: 0x000000,
      }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  async init(): Promise<void> {
    const tex = await spriteTexture('Textures/HardShadow.bmp', 'shadow');
    if (tex) {
      const mat = this.mesh.material as THREE.MeshBasicMaterial;
      mat.map = tex;
      mat.needsUpdate = true;
    }
  }

  /** place under the ball using a downward ray hit */
  update(hitY: number | null, ballPos: THREE.Vector3): void {
    if (hitY === null) {
      this.mesh.visible = false;
      return;
    }
    const height = ballPos.y - hitY;
    this.mesh.visible = height < 30;
    this.mesh.position.set(ballPos.x, hitY + 0.08, ballPos.z);
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.55 * THREE.MathUtils.clamp(1 - height / 30, 0.15, 1);
  }
}

/** The trafo transformation lightning sphere (Ball_LightningSphere textures). */
export class LightningSphere {
  readonly mesh: THREE.Mesh;
  private textures: (THREE.Texture | null)[] = [];
  private t = 0;
  active = false;

  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(3.1, 24, 16),
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        color: 0x88aaff,
      }),
    );
    this.mesh.visible = false;
  }

  async init(): Promise<void> {
    this.textures = await Promise.all([
      spriteTexture('Textures/Ball_LightningSphere1.bmp'),
      spriteTexture('Textures/Ball_LightningSphere2.bmp'),
      spriteTexture('Textures/Ball_LightningSphere3.bmp'),
    ]);
  }

  start(): void {
    this.active = true;
    this.t = 0;
    this.mesh.visible = true;
  }

  stop(): void {
    this.active = false;
    this.mesh.visible = false;
  }

  update(dt: number, ballPos: THREE.Vector3): void {
    if (!this.active) return;
    this.t += dt;
    this.mesh.position.copy(ballPos);
    this.mesh.rotation.y += dt * 2.2;
    const frame = Math.floor(this.t * 12) % this.textures.length;
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    if (this.textures[frame]) mat.map = this.textures[frame];
    mat.opacity = 0.75 + 0.25 * Math.sin(this.t * 25);
    mat.needsUpdate = true;
  }
}

interface Piece {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
}

/** Original ball shatter: the Ball_<Kind>_pieceNN meshes fly apart. */
export class ShatterSystem {
  private templates = new Map<BallKind, { mesh: THREE.Mesh; local: THREE.Matrix4 }[]>();
  private live: Piece[] = [];
  private physics: PhysicsWorld;
  private scene: THREE.Scene;

  constructor(physics: PhysicsWorld, scene: THREE.Scene) {
    this.physics = physics;
    this.scene = scene;
  }

  async init(): Promise<void> {
    const file = await loadNmo('3D Entities/Balls.nmo');
    const built = await buildScene(file);
    for (const kind of ['paper', 'wood', 'stone'] as BallKind[]) {
      const prefix = `Ball_${kind[0].toUpperCase() + kind.slice(1)}_piece`;
      const list: { mesh: THREE.Mesh; local: THREE.Matrix4 }[] = [];
      for (const [name, e] of built.entities) {
        if (name.startsWith(prefix) && e.object instanceof THREE.Mesh) {
          list.push({ mesh: e.object, local: e.object.matrix.clone() });
        }
      }
      this.templates.set(kind, list);
    }
  }

  burst(kind: BallKind, center: THREE.Vector3): void {
    this.clear();
    const def = BALL_DEFS[kind];
    const templates = this.templates.get(kind) ?? [];
    for (const t of templates) {
      const mesh = new THREE.Mesh(t.mesh.geometry, t.mesh.material);
      mesh.name = `shatter_piece:${t.mesh.name}`;
      const offset = new THREE.Vector3().setFromMatrixPosition(t.local);
      const pos = center.clone().add(offset);
      mesh.position.copy(pos);
      this.scene.add(mesh);

      const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setLinearDamping(kind === 'paper' ? 6 : 0.3)
        .setAngularDamping(kind === 'paper' ? 0.5 : 0.2);
      const body = this.physics.world.createRigidBody(bodyDesc);
      const scale = new THREE.Vector3(1, 1, 1);
      const desc =
        RAPIER.ColliderDesc.convexHull(localVertices(mesh, scale)) ?? RAPIER.ColliderDesc.ball(0.4);
      desc.setFriction(kind === 'wood' ? 2 : 0.8).setRestitution(1).setMass(kind === 'stone' ? 0.8 : 0.2);
      this.physics.world.createCollider(desc, body);

      // explosion impulse within the original piece force range
      const f = def.piecesMinForce + Math.random() * (def.piecesMaxForce - def.piecesMinForce);
      const dir = offset.clone().add(new THREE.Vector3(0, 0.6, 0)).normalize();
      body.applyImpulse({ x: dir.x * f, y: dir.y * f, z: dir.z * f }, true);
      body.setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: (Math.random() - 0.5) * 8 }, true);
      this.live.push({ mesh, body });
    }
  }

  update(): void {
    for (const p of this.live) {
      const t = p.body.translation();
      const r = p.body.rotation();
      p.mesh.position.set(t.x, t.y, t.z);
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  clear(): void {
    for (const p of this.live) {
      this.scene.remove(p.mesh);
      this.physics.world.removeRigidBody(p.body);
    }
    this.live = [];
  }
}
