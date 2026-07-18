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
import { evalCurve } from './curve.ts';
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

/**
 * Checkpoint/start flame: a particle emitter replicating the original
 * Virtools particle systems (parameters recovered from the Ballance Unity
 * Rebuild FlameBig/FlameSmall prefabs, which mirror the original emitters):
 * near-vertical cone, ~26 particles/s, alpha-blended sprites tinted with an
 * HDR pink, each particle randomly leaning crimson or smoke-white.
 */
interface FlameSpec {
  life: number;
  speed: number;
  size: number;
  rate: number;
  /** [t, value, slope] Hermite keys for size over lifetime */
  sizeKeys: [number, number, number][];
}

const FLAME_BIG: FlameSpec = {
  life: 1.5,
  speed: 2,
  size: 1.5,
  rate: 26,
  sizeKeys: [
    [0, 0.376, 10.89],
    [0.211, 0.971, -1.406],
    [1, 0.2, -0.47],
  ],
};

const FLAME_SMALL: FlameSpec = {
  life: 1.0,
  speed: 2.6,
  size: 1.2,
  rate: 25,
  sizeKeys: [
    [0, 0.6, 7.2],
    [0.221, 1, -0.9],
    [1, 0.05, -0.5],
  ],
};

// original material: tex * HDR tint * per-particle gradient, SrcAlpha blend
const TINT = new THREE.Color(4.372, 2.2479, 3.8764);
const CRIMSON = new THREE.Color(0.9216 * TINT.r, 0.1686 * TINT.g, 0.2745 * TINT.b);
const MATERIAL_ALPHA = 0.6235;

const flameVertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    vAlpha = aAlpha;
    vColor = aColor;
    gl_Position = projectionMatrix * mv;
  }
`;

const flameFragment = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    vec3 rgb = min(vec3(1.0), tex.rgb * vColor);
    gl_FragColor = vec4(rgb, tex.a * vAlpha);
    #include <colorspace_fragment>
  }
`;

const MAX_PARTICLES = 50;

export class Flame {
  readonly points: THREE.Points;
  private spec: FlameSpec;
  private positions: Float32Array;
  private colors: Float32Array;
  private alphas: Float32Array;
  private sizes: Float32Array;
  private ages: Float32Array;
  private mix: Float32Array;
  private vel: Float32Array;
  private alive: boolean[];
  private spawnAcc = Math.random();
  origin = new THREE.Vector3();

  constructor(texture: THREE.Texture | null, big: boolean) {
    this.spec = big ? FLAME_BIG : FLAME_SMALL;
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.alphas = new Float32Array(MAX_PARTICLES);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.ages = new Float32Array(MAX_PARTICLES);
    this.mix = new Float32Array(MAX_PARTICLES);
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.alive = new Array<boolean>(MAX_PARTICLES).fill(false);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uScale: { value: 800 },
      },
      vertexShader: flameVertex,
      fragmentShader: flameFragment,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  get visible(): boolean {
    return this.points.visible;
  }

  set visible(on: boolean) {
    if (this.points.visible === on) return;
    this.points.visible = on;
    if (!on) {
      this.alive.fill(false);
      this.alphas.fill(0);
      this.sizes.fill(0);
    }
  }

  update(dt: number, uScale: number): void {
    if (!this.points.visible) return;
    const s = this.spec;
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = uScale;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.alive[i]) continue;
      this.ages[i] += dt;
      if (this.ages[i] >= s.life) {
        this.alive[i] = false;
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        continue;
      }
      this.positions[i * 3] += this.vel[i * 3] * dt;
      this.positions[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = this.ages[i] / s.life;
      this.sizes[i] = s.size * evalCurve(s.sizeKeys, t);
      // gradient blend: crimson curve fades by t=0.847, white fades linearly
      const m = this.mix[i];
      const aCrimson = 0.478 * Math.max(0, 1 - t / 0.847);
      const aWhite = 1 - t;
      this.alphas[i] = (aCrimson * (1 - m) + aWhite * m) * MATERIAL_ALPHA;
    }
    // spawn new particles
    this.spawnAcc += s.rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      const slot = this.alive.indexOf(false);
      if (slot < 0) break;
      this.alive[slot] = true;
      this.ages[slot] = 0;
      const m = Math.random();
      this.mix[slot] = m;
      this.positions[slot * 3] = this.origin.x;
      this.positions[slot * 3 + 1] = this.origin.y;
      this.positions[slot * 3 + 2] = this.origin.z;
      // near-vertical cone (~1.2 degrees) like the original emitters
      const cone = 0.022 * Math.random();
      const phi = Math.random() * Math.PI * 2;
      this.vel[slot * 3] = Math.sin(cone) * Math.cos(phi) * s.speed;
      this.vel[slot * 3 + 1] = Math.cos(cone) * s.speed;
      this.vel[slot * 3 + 2] = Math.sin(cone) * Math.sin(phi) * s.speed;
      const c = new THREE.Color().lerpColors(CRIMSON, TINT, m);
      this.colors[slot * 3] = c.r;
      this.colors[slot * 3 + 1] = c.g;
      this.colors[slot * 3 + 2] = c.b;
      this.sizes[slot] = s.size * evalCurve(s.sizeKeys, 0);
      const aCrimson = 0.478;
      this.alphas[slot] = (aCrimson * (1 - m) + m) * MATERIAL_ALPHA;
    }
    const geo = this.points.geometry;
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('aColor').needsUpdate = true;
    geo.getAttribute('aAlpha').needsUpdate = true;
    geo.getAttribute('aSize').needsUpdate = true;
  }
}

/**
 * Flame decorations, following the original sector logic:
 * - start pad (PS_FourFlames): four small flames while sector 1 is current
 * - the just-passed checkpoint: two small flames on its side pods
 * - the next (armed) checkpoint: one big flame at its center
 * - every other checkpoint: nothing
 */
export class FlameSystem {
  private flames: Flame[] = [];
  private startFlames: Flame[] = [];
  private byCheckpoint = new Map<number, { big: Flame; smalls: Flame[] }>();
  private texture: THREE.Texture | null = null;

  async init(built: BuiltScene, scene: THREE.Scene): Promise<void> {
    this.texture = await spriteTexture('Textures/Particle_Flames.bmp');
    // start pad: four small flames at the pod corners (original prefab offsets)
    const start = groupEntities(built, 'PS_Levelstart')[0];
    if (start) {
      const offsets = [
        [-6.16, 1.7, -7.64],
        [-6.34, 1.7, 6.93],
        [6.02, 1.7, 6.91],
        [6.07, 1.7, -7.63],
      ];
      for (const [x, y, z] of offsets) {
        this.startFlames.push(this.addFlame(scene, start.object, new THREE.Vector3(x, y, z), false));
      }
    }
    for (const cp of groupEntities(built, 'PC_Checkpoints')) {
      const num = Number(/_(\d+)$/.exec(cp.rec.name)?.[1] ?? NaN);
      if (Number.isNaN(num)) continue;
      const big = this.addFlame(scene, cp.object, new THREE.Vector3(0, 1.12, 0), true);
      const smallA = this.addFlame(scene, cp.object, new THREE.Vector3(6.93, 1.6, 0), false);
      const smallB = this.addFlame(scene, cp.object, new THREE.Vector3(-6.93, 1.6, 0), false);
      big.visible = false;
      smallA.visible = false;
      smallB.visible = false;
      this.byCheckpoint.set(num, { big, smalls: [smallA, smallB] });
    }
  }

  private addFlame(scene: THREE.Scene, anchor: THREE.Object3D, offset: THREE.Vector3, big: boolean): Flame {
    const flame = new Flame(this.texture, big);
    flame.origin.copy(offset).applyQuaternion(anchor.quaternion).add(anchor.position);
    scene.add(flame.points);
    this.flames.push(flame);
    return flame;
  }

  /** apply the original per-sector flame states */
  setSector(sector: number): void {
    for (const f of this.startFlames) f.visible = sector === 1;
    for (const [num, f] of this.byCheckpoint) {
      const armed = num === sector; // PC_TwoFlames_NN gates sector NN+1
      const passed = num === sector - 1;
      f.big.visible = armed;
      for (const s of f.smalls) s.visible = passed;
    }
  }

  update(dt: number, uScale: number): void {
    for (const f of this.flames) f.update(dt, uScale);
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

/**
 * The original transformation cage (AnimTrafo.nmo): four environment-mapped
 * rings, a bar cage and the flash field, spun around the ball during the
 * 2.3s transformation. (The original plays authored keyframes; this drives
 * the same meshes procedurally.)
 */
export class TrafoAnim {
  readonly group = new THREE.Group();
  private rings: THREE.Object3D[] = [];
  private flash: THREE.Mesh | null = null;
  active = false;
  private t = 0;

  async init(): Promise<void> {
    try {
      const built = await buildScene(await loadNmo('3D Entities/AnimTrafo.nmo'));
      this.group.add(built.root);
      built.root.updateMatrixWorld(true);
      for (let i = 1; i <= 4; i++) {
        const e = built.entities.get(`AnimTrafo_Ringpart${i}`);
        if (e) this.rings.push(e.object);
      }
      const flash = built.entities.get('AnimTrafo_Flashfield');
      if (flash && flash.object instanceof THREE.Mesh) {
        this.flash = flash.object;
        const mats = Array.isArray(flash.object.material) ? flash.object.material : [flash.object.material];
        for (const m of mats) {
          m.transparent = true;
          m.blending = THREE.AdditiveBlending;
          m.depthWrite = false;
        }
      }
    } catch {
      /* keep an empty group if the file is absent */
    }
    this.group.visible = false;
  }

  start(): void {
    this.active = true;
    this.t = 0;
    this.group.visible = true;
  }

  stop(): void {
    this.active = false;
    this.group.visible = false;
  }

  update(dt: number, ballPos: THREE.Vector3): void {
    if (!this.active) return;
    this.t += dt;
    this.group.position.copy(ballPos);
    // quick scale-in, rings counter-rotating at different speeds
    const s = Math.min(1, this.t / 0.18);
    this.group.scale.setScalar(0.4 + 0.6 * s);
    const speeds = [2.6, -3.3, 2.1, -2.8];
    this.rings.forEach((r, i) => {
      r.rotation.y += dt * speeds[i % speeds.length];
      r.updateMatrix();
    });
    if (this.flash) {
      this.flash.rotation.y -= dt * 1.7;
      this.flash.updateMatrix();
      const mats = Array.isArray(this.flash.material) ? this.flash.material : [this.flash.material];
      for (const m of mats) m.opacity = 0.55 + 0.35 * Math.sin(this.t * 21);
    }
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
      desc
        .setFriction(kind === 'wood' ? 2 : 0.8)
        .setRestitution(1)
        .setMass(kind === 'stone' ? 0.8 : 0.2)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Multiply);
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
