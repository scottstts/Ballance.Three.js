/**
 * In-world effects built from the original assets: checkpoint/start flames,
 * ball birth, the trafo cage, and the ball shatter pieces from Balls.nmo.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { loadNmo } from '../engine/assets.ts';
import { vxPositionToThree } from '../engine/convert.ts';
import { buildScene, groupEntities, type BuiltScene } from '../engine/sceneBuilder.ts';
import { decodeImageFile, loadCkTexture } from '../engine/textures.ts';
import type { BehaviorRec, LightRec, NmoFile, ParameterRec, TextureRec } from '../formats/ck2/types.ts';
import { localVertices } from './moduls/base.ts';
import { FORCE_SCALE, type BallKind } from './constants.ts';
import { decodeCk2dCurve, evalCurve, type CurveKey } from './curve.ts';
import { BALL_PIECE_COLLISION_GROUPS, type PhysicsWorld } from './physics.ts';
import { ScaleableProximity, type ScaleableProximitySpec } from './proximity.ts';

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

/** Values decoded from the original Point Particle System behaviors. */
export interface FlameSpec {
  emissionDelay: number;
  emission: number;
  emissionVariance: number;
  life: number;
  lifeVariance: number;
  speed: number;
  speedVariance: number;
  yawVariance: number;
  pitchVariance: number;
  initialSize: number;
  initialSizeVariance: number;
  endingSize: number;
  initialColor: readonly [number, number, number, number];
}

export const FLAME_BIG: FlameSpec = {
  emissionDelay: 0.02,
  emission: 1,
  emissionVariance: 1,
  life: 1,
  lifeVariance: 0.5,
  speed: 12,
  speedVariance: 4,
  yawVariance: 0.05235987901687622,
  pitchVariance: 0.05235987901687622,
  initialSize: 5,
  initialSizeVariance: 0.30000001192092896,
  endingSize: 0.10000000149011612,
  initialColor: [0.9215686917304993, 0.16470588743686676, 0.27450981736183167, 0.9803922176361084],
};

export const FLAME_SMALL: FlameSpec = {
  emissionDelay: 0.02,
  emission: 1,
  emissionVariance: 1,
  life: 1,
  lifeVariance: 0.25,
  speed: 8,
  speedVariance: 3,
  yawVariance: 0.05235987901687622,
  pitchVariance: 0.05235987901687622,
  initialSize: 3,
  initialSizeVariance: 0.30000001192092896,
  endingSize: 0.10000000149011612,
  initialColor: [0.9215686917304993, 0.16470588743686676, 0.27450981736183167, 1],
};

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

const flameProximity = (
  exactnessMaxDistance: number,
  minimumFrameDelay: number,
): ScaleableProximitySpec => ({
  distance: 70,
  exactnessMinDistance: 75,
  exactnessMaxDistance,
  minimumFrameDelay,
  maximumFrameDelay: 100,
  initialFrameDelay: 2,
  axes: 5,
  squaredDistance: true,
});

/** Source outer gates that activate the otherwise dormant particle scripts. */
export const FLAME_PROXIMITY_SOURCE = {
  start: flameProximity(120, 5),
  checkpointBig: flameProximity(150, 10),
  checkpointSmall: flameProximity(150, 20),
} as const;

export class Flame {
  readonly points: THREE.Points;
  private spec: FlameSpec;
  private positions: Float32Array;
  private colors: Float32Array;
  private alphas: Float32Array;
  private sizes: Float32Array;
  private ages: Float32Array;
  private lifespans: Float32Array;
  private initialSizes: Float32Array;
  private vel: Float32Array;
  private alive: boolean[];
  private emissionTime = 0;
  origin = new THREE.Vector3();
  orientation = new THREE.Quaternion();

  constructor(texture: THREE.Texture | null, big: boolean) {
    this.spec = big ? FLAME_BIG : FLAME_SMALL;
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.alphas = new Float32Array(MAX_PARTICLES);
    this.sizes = new Float32Array(MAX_PARTICLES);
    this.ages = new Float32Array(MAX_PARTICLES);
    this.lifespans = new Float32Array(MAX_PARTICLES);
    this.initialSizes = new Float32Array(MAX_PARTICLES);
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
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
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
    } else {
      this.emissionTime = 0;
    }
  }

  update(dt: number, uScale: number): void {
    if (!this.points.visible) return;
    const s = this.spec;
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = uScale;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.alive[i]) continue;
      this.ages[i] += dt;
      if (this.ages[i] >= this.lifespans[i]) {
        this.alive[i] = false;
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        continue;
      }
      this.positions[i * 3] += this.vel[i * 3] * dt;
      this.positions[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = this.ages[i] / this.lifespans[i];
      this.sizes[i] = THREE.MathUtils.lerp(this.initialSizes[i], s.endingSize, t);
      this.colors[i * 3] = s.initialColor[0] * (1 - t);
      this.colors[i * 3 + 1] = s.initialColor[1] * (1 - t);
      this.colors[i * 3 + 2] = s.initialColor[2] * (1 - t);
      this.alphas[i] = s.initialColor[3] * (1 - t);
    }
    // The source behavior emits every 20 ms. Emission variance is an integer
    // range around the authored count (1±1), so a burst contains 0, 1, or 2.
    this.emissionTime += dt;
    while (this.emissionTime >= s.emissionDelay) {
      this.emissionTime -= s.emissionDelay;
      const count = Math.max(
        0,
        s.emission + Math.floor(Math.random() * (s.emissionVariance * 2 + 1)) - s.emissionVariance,
      );
      for (let emitted = 0; emitted < count; emitted++) this.spawn();
    }
    const geo = this.points.geometry;
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('aColor').needsUpdate = true;
    geo.getAttribute('aAlpha').needsUpdate = true;
    geo.getAttribute('aSize').needsUpdate = true;
  }

  private spawn(): void {
    const s = this.spec;
    const slot = this.alive.indexOf(false);
    if (slot < 0) return;
    this.alive[slot] = true;
    this.ages[slot] = 0;
    this.lifespans[slot] = Math.max(0.001, s.life + (Math.random() * 2 - 1) * s.lifeVariance);
    this.initialSizes[slot] = s.initialSize + (Math.random() * 2 - 1) * s.initialSizeVariance;
    this.positions[slot * 3] = this.origin.x;
    this.positions[slot * 3 + 1] = this.origin.y;
    this.positions[slot * 3 + 2] = this.origin.z;
    const yaw = (Math.random() * 2 - 1) * s.yawVariance;
    const pitch = (Math.random() * 2 - 1) * s.pitchVariance;
    const direction = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    ).applyQuaternion(this.orientation);
    const speed = s.speed + (Math.random() * 2 - 1) * s.speedVariance;
    this.vel[slot * 3] = direction.x * speed;
    this.vel[slot * 3 + 1] = direction.y * speed;
    this.vel[slot * 3 + 2] = direction.z * speed;
    this.colors[slot * 3] = s.initialColor[0];
    this.colors[slot * 3 + 1] = s.initialColor[1];
    this.colors[slot * 3 + 2] = s.initialColor[2];
    this.sizes[slot] = this.initialSizes[slot];
    this.alphas[slot] = s.initialColor[3];
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
  private startPosition: THREE.Vector3 | null = null;
  private startActive = false;
  private startProximity = new ScaleableProximity(FLAME_PROXIMITY_SOURCE.start);
  private byCheckpoint = new Map<
    number,
    {
      big: Flame;
      smalls: Flame[];
      position: THREE.Vector3;
      bigActive: boolean;
      smallActive: boolean;
      bigProximity: ScaleableProximity;
      smallProximity: ScaleableProximity;
    }
  >();
  private texture: THREE.Texture | null = null;

  async init(built: BuiltScene, scene: THREE.Scene): Promise<void> {
    this.texture = await spriteTexture('Textures/Particle_Flames.bmp');
    const [startPrefab, checkpointPrefab] = await Promise.all([
      loadNmo('3D Entities/PH/PS_FourFlames.nmo').then(buildScene),
      loadNmo('3D Entities/PH/PC_TwoFlames.nmo').then(buildScene),
    ]);
    built.root.updateMatrixWorld(true);

    // Use the emitter frames serialized in the original prefabs. Besides
    // exact placement, their rotations define the particle emission axis.
    const start = groupEntities(built, 'PS_Levelstart')[0];
    if (start) {
      this.startPosition = start.object.getWorldPosition(new THREE.Vector3());
      for (const suffix of ['A', 'B', 'C', 'D']) {
        const emitter = startPrefab.entities.get(`PS_FourFlames_Flame_${suffix}`)?.object;
        if (emitter) {
          const flame = this.addFlame(scene, start.object, emitter, false);
          flame.visible = false;
          this.startFlames.push(flame);
        }
      }
    }
    for (const cp of groupEntities(built, 'PC_Checkpoints')) {
      const num = Number(/_(\d+)$/.exec(cp.rec.name)?.[1] ?? NaN);
      if (Number.isNaN(num)) continue;
      const bigEmitter = checkpointPrefab.entities.get('PC_TwoFlames_Flame_Big')?.object;
      const smallAEmitter = checkpointPrefab.entities.get('PC_TwoFlames_Flame_SmallA')?.object;
      const smallBEmitter = checkpointPrefab.entities.get('PC_TwoFlames_Flame_SmallB')?.object;
      if (!bigEmitter || !smallAEmitter || !smallBEmitter) continue;
      const big = this.addFlame(scene, cp.object, bigEmitter, true);
      const smallA = this.addFlame(scene, cp.object, smallAEmitter, false);
      const smallB = this.addFlame(scene, cp.object, smallBEmitter, false);
      big.visible = false;
      smallA.visible = false;
      smallB.visible = false;
      this.byCheckpoint.set(num, {
        big,
        smalls: [smallA, smallB],
        position: cp.object.getWorldPosition(new THREE.Vector3()),
        bigActive: false,
        smallActive: false,
        bigProximity: new ScaleableProximity(FLAME_PROXIMITY_SOURCE.checkpointBig),
        smallProximity: new ScaleableProximity(FLAME_PROXIMITY_SOURCE.checkpointSmall),
      });
    }
  }

  private addFlame(scene: THREE.Scene, anchor: THREE.Object3D, emitter: THREE.Object3D, big: boolean): Flame {
    const flame = new Flame(this.texture, big);
    anchor.updateMatrixWorld(true);
    const matrix = anchor.matrixWorld.clone().multiply(emitter.matrix);
    matrix.decompose(flame.origin, flame.orientation, new THREE.Vector3());
    scene.add(flame.points);
    this.flames.push(flame);
    return flame;
  }

  /** apply the original per-sector flame states */
  setSector(sector: number): void {
    this.startActive = sector === 1;
    this.startProximity.reset();
    for (const flame of this.startFlames) flame.visible = false;
    for (const [num, f] of this.byCheckpoint) {
      const armed = num === sector; // PC_TwoFlames_NN gates sector NN+1
      const passed = num === sector - 1;
      f.bigActive = armed;
      f.smallActive = passed;
      f.bigProximity.reset();
      f.smallProximity.reset();
      f.big.visible = false;
      // After Checkpoint reached, the graph starts both small scripts before
      // their outer sampler performs its first check two frames later.
      for (const small of f.smalls) small.visible = passed;
    }
  }

  /** Execute the source proximity blocks at the fixed 66 Hz behavior tick. */
  updateSimulation(ballPosition: THREE.Vector3): void {
    if (this.startActive && this.startPosition) {
      const output = this.startProximity.updatePositions(ballPosition, this.startPosition);
      if (output === 'enterRange') for (const flame of this.startFlames) flame.visible = true;
      else if (output === 'exitRange') for (const flame of this.startFlames) flame.visible = false;
    }
    for (const checkpoint of this.byCheckpoint.values()) {
      if (checkpoint.bigActive) {
        const output = checkpoint.bigProximity.updatePositions(ballPosition, checkpoint.position);
        if (output === 'enterRange') checkpoint.big.visible = true;
        else if (output === 'exitRange') checkpoint.big.visible = false;
      }
      if (checkpoint.smallActive) {
        const output = checkpoint.smallProximity.updatePositions(ballPosition, checkpoint.position);
        if (output === 'enterRange') for (const flame of checkpoint.smalls) flame.visible = true;
        else if (output === 'exitRange') for (const flame of checkpoint.smalls) flame.visible = false;
      }
    }
  }

  update(dt: number, uScale: number): void {
    for (const f of this.flames) f.update(dt, uScale);
  }

  debugState(): Record<string, unknown> {
    return {
      start: {
        active: this.startActive,
        visible: this.startFlames.map((flame) => flame.visible),
        position: this.startPosition?.toArray() ?? null,
      },
      checkpoints: Object.fromEntries(
        [...this.byCheckpoint].map(([number, checkpoint]) => [
          number,
          {
            bigActive: checkpoint.bigActive,
            bigVisible: checkpoint.big.visible,
            smallActive: checkpoint.smallActive,
            smallVisible: checkpoint.smalls.map((flame) => flame.visible),
            position: checkpoint.position.toArray(),
          },
        ]),
      ),
    };
  }
}

/** Values serialized by Balls.nmo's TT Simple Shadow behavior. */
export const BALL_SHADOW_SOURCE = {
  texture: 'Textures/HardShadow.bmp',
  sizeScale: 1.2999999523162842,
  maxHeight: 20,
} as const;

/** Exact projected width used by TT Simple Shadow. */
export function ballShadowFootprintWidth(localBallWidth: number, worldScale = 1): number {
  return localBallWidth * worldScale * BALL_SHADOW_SOURCE.sizeScale;
}

interface ShadowSample {
  collider: number;
  point: THREE.Vector3;
}

const SHADOW_GRID = 13;
const SHADOW_VERTEX_CAPACITY = (SHADOW_GRID - 1) * (SHADOW_GRID - 1) * 6;

/**
 * The original TT Simple Shadow does not create a flat billboard. It adds
 * HardShadow as a vertically projected material channel to every intersecting
 * floor mesh. Sampling the browser collision meshes recreates that conforming
 * projection on ramps, domes, and moving moduls without modifying their source
 * materials.
 */
export class BallShadow {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly positions = new Float32Array(SHADOW_VERTEX_CAPACITY * 3);
  private readonly uvs = new Float32Array(SHADOW_VERTEX_CAPACITY * 2);
  private readonly samples: ShadowSample[] = Array.from({ length: SHADOW_GRID * SHADOW_GRID }, () => ({
    collider: -1,
    point: new THREE.Vector3(),
  }));
  private readonly widthByVisual = new WeakMap<THREE.Object3D, number>();
  private readonly world: RAPIER.World;
  /**
   * TT Simple Shadow projects only onto CKFloorManager floors; Levelinit's
   * `set Floor` stamps the Floor attribute on exactly the level's `Shadow`
   * group members. Rails, stoppers, invisible helpers, and moving moduls
   * never receive the ball shadow.
   */
  private receivers: ReadonlySet<number> = new Set();

  constructor(physics: PhysicsWorld) {
    this.world = physics.world;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 1,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        color: 0x000000,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.name = 'TT Simple Shadow';
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  setReceivers(receivers: ReadonlySet<number>): void {
    this.receivers = receivers;
  }

  async init(): Promise<void> {
    const tex = await spriteTexture(BALL_SHADOW_SOURCE.texture, 'shadow');
    if (tex) {
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      this.mesh.material.map = tex;
      this.mesh.material.needsUpdate = true;
    }
  }

  update(
    ballPos: THREE.Vector3,
    ballVisual: THREE.Object3D,
    excludeCollider: RAPIER.Collider,
    excludeBody: RAPIER.RigidBody,
  ): void {
    ballVisual.updateWorldMatrix(true, false);
    let localWidth = this.widthByVisual.get(ballVisual);
    if (localWidth === undefined) {
      localWidth = localObjectWidth(ballVisual);
      this.widthByVisual.set(ballVisual, localWidth);
    }
    const scale = new THREE.Vector3().setFromMatrixScale(ballVisual.matrixWorld).x;
    const width = ballShadowFootprintWidth(localWidth, scale);
    const half = width * 0.5;
    const step = width / (SHADOW_GRID - 1);

    for (let z = 0; z < SHADOW_GRID; z++) {
      for (let x = 0; x < SHADOW_GRID; x++) {
        const sample = this.samples[z * SHADOW_GRID + x];
        const ray = new RAPIER.Ray(
          { x: ballPos.x - half + x * step, y: ballPos.y, z: ballPos.z - half + z * step },
          { x: 0, y: -1, z: 0 },
        );
        const hit = this.world.castRayAndGetNormal(
          ray,
          BALL_SHADOW_SOURCE.maxHeight,
          true,
          undefined,
          undefined,
          excludeCollider,
          excludeBody,
          (candidate) => this.receivers.has(candidate.handle),
        );
        if (!hit) {
          sample.collider = -1;
          continue;
        }
        sample.collider = hit.collider.handle;
        // TT applies the texture in the floor's own material pass. A tiny
        // normal offset gives the equivalent depth result for our overlay.
        sample.point.set(ray.origin.x, ballPos.y - hit.timeOfImpact, ray.origin.z);
        sample.point.x += hit.normal.x * 0.01;
        sample.point.y += hit.normal.y * 0.01;
        sample.point.z += hit.normal.z * 0.01;
      }
    }

    let vertexCount = 0;
    const addTriangle = (a: number, b: number, c: number): void => {
      const first = this.samples[a];
      if (first.collider < 0 || first.collider !== this.samples[b].collider || first.collider !== this.samples[c].collider) {
        return;
      }
      for (const index of [a, b, c]) {
        const sample = this.samples[index];
        const p = vertexCount * 3;
        this.positions[p] = sample.point.x;
        this.positions[p + 1] = sample.point.y;
        this.positions[p + 2] = sample.point.z;
        const u = vertexCount * 2;
        const gridX = index % SHADOW_GRID;
        const gridZ = Math.floor(index / SHADOW_GRID);
        this.uvs[u] = gridX / (SHADOW_GRID - 1);
        this.uvs[u + 1] = gridZ / (SHADOW_GRID - 1);
        vertexCount++;
      }
    };
    for (let z = 0; z < SHADOW_GRID - 1; z++) {
      for (let x = 0; x < SHADOW_GRID - 1; x++) {
        const a = z * SHADOW_GRID + x;
        const b = a + 1;
        const c = a + SHADOW_GRID;
        const d = c + 1;
        addTriangle(a, c, b);
        addTriangle(b, c, d);
      }
    }

    const position = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = this.mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    position.needsUpdate = true;
    uv.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, vertexCount);
    this.mesh.visible = vertexCount > 0;
  }

  dispose(): void {
    this.mesh.material.map?.dispose();
    this.mesh.material.dispose();
    this.mesh.geometry.dispose();
  }
}

function localObjectWidth(object: THREE.Object3D): number {
  const rootInverse = object.matrixWorld.clone().invert();
  const relative = new THREE.Matrix4();
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.computeBoundingBox();
    const childBox = child.geometry.boundingBox;
    if (!childBox) return;
    relative.multiplyMatrices(rootInverse, child.matrixWorld);
    for (const x of [childBox.min.x, childBox.max.x]) {
      for (const y of [childBox.min.y, childBox.max.y]) {
        for (const z of [childBox.min.z, childBox.max.z]) {
          box.expandByPoint(point.set(x, y, z).applyMatrix4(relative));
        }
      }
    }
  });
  return box.isEmpty() ? 4 : box.max.x - box.min.x;
}

function resolveEffectParameter(file: NmoFile, parameter: ParameterRec): ParameterRec {
  let current = parameter;
  const seen = new Set([current.index]);
  for (let depth = 0; depth < 32; depth++) {
    const nextIndex = current.sourceIndex >= 0 ? current.sourceIndex : current.sharedIndex;
    if (nextIndex < 0 || seen.has(nextIndex)) break;
    const next = file.objects[nextIndex];
    if (next?.kind !== 'parameter') break;
    seen.add(nextIndex);
    current = next;
  }
  return current;
}

function behaviorParameters(file: NmoFile, behavior: BehaviorRec): Map<string, ParameterRec> {
  return new Map(
    behavior.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .filter((record): record is ParameterRec => record?.kind === 'parameter')
      .map((parameter) => [parameter.name, resolveEffectParameter(file, parameter)]),
  );
}

function behaviorChildren(file: NmoFile, compositeName: string, childName: string): BehaviorRec[] {
  const composite = file.objects.find(
    (record): record is BehaviorRec => record.kind === 'behavior' && record.name === compositeName,
  );
  if (!composite) return [];
  return composite.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .filter((record): record is BehaviorRec => record?.kind === 'behavior' && record.name === childName);
}

function parameterFloat(parameter: ParameterRec | undefined): number {
  if (!parameter || parameter.valueBytes.length < 4) return Number.NaN;
  return new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset).getFloat32(0, true);
}

const MAX_SMOKE_PARTICLES = 60;
const SOURCE_EFFECT_RATE = 66;

export const LIGHTNING_SOURCE = {
  rotationSpeed: 6.2831854820251465,
  sphereDuration: 3,
  scaleDuration: 1.5,
  blueLightDuration: 2.5,
  whiteLightDuration: 1.5,
  smokeDelay: 2.5,
  smokeFrames: 6,
  smoke: {
    maxParticles: 60,
    emission: 20,
    emissionVariance: 10,
    life: 1.6,
    lifeVariance: 1,
    speed: 1,
    speedVariance: 0.5,
    radius: 1.5,
    initialSize: 2,
    endingSize: 3,
    color: 0.7843137979507446,
  },
} as const;

/** Timings/values serialized by AnimTrafo.nmo and Gameplay.nmo. */
export const TRAFO_SOURCE = {
  activationDelay: 1 / SOURCE_EFFECT_RATE,
  openDuration: 0.35,
  travelDuration: 2,
  closeDuration: 0.2,
  ringOffset: [-0.5, 0, -0.5] as const,
  barsOffset: [0, 5.199999809265137, 0] as const,
  flashStep: 0.05,
  flashScroll: 0.5,
  pullDuration: 1.35,
  pullForce: 2,
  pullDamping: 0.699999988079071,
  pullOffset: [0, -3, 0] as const,
  explosionTime: 2.35,
  newBallTime: 2.5,
  triggerDistance: 4.300000190734863,
} as const;

/** Values authored by Balls.nmo's explosion/reset/collision behavior graphs. */
export const SHATTER_SOURCE = {
  resetDelay: 20,
  fadeDuration: 2,
  collisionSoundDuration: 3,
  collisionMinSpeed: 2,
  collisionMaxSpeed: 25,
  collisionCooldown: 0.5,
  paperWindDirection: [-1, 0, 1] as const,
  paperWindForce: 0.029999999329447746,
  kinds: {
    wood: {
      count: 16,
      friction: [2, 2] as const,
      restitution: 1,
      mass: [0.20000000298023224, 0.20000000298023224] as const,
      linearDamping: 0.30000001192092896,
      angularDamping: 0.20000000298023224,
      impulse: [1.5, 3] as const,
      impulsePoint: [0, 1, 0] as const,
      impulseDirection: [0, 1, 0] as const,
      monitoredPieces: [1, 4, 7, 11, 14, 16] as const,
    },
    stone: {
      count: 17,
      friction: [2, 2] as const,
      restitution: 1,
      mass: [0.800000011920929, 0.800000011920929] as const,
      linearDamping: 0.30000001192092896,
      angularDamping: 0.20000000298023224,
      impulse: [4, 9] as const,
      impulsePoint: [-0.05000000074505806, 1, 0.05000000074505806] as const,
      impulseDirection: [0, 1, 0] as const,
      monitoredPieces: [1, 4, 7, 11, 14, 17] as const,
    },
    paper: {
      count: 18,
      friction: [1, 5] as const,
      restitution: 1,
      mass: [0.019999999552965164, 0.09000000357627869] as const,
      linearDamping: 6,
      angularDamping: 0.5,
      impulse: [0.5, 1.2999999523162842] as const,
      impulsePoint: [-0.029999999329447746, 1, 0.019999999552965164] as const,
      impulseDirection: [0, 1, 0] as const,
      monitoredPieces: [] as const,
    },
  },
} as const;

class BirthSmoke {
  readonly points: THREE.Points;
  private positions = new Float32Array(MAX_SMOKE_PARTICLES * 3);
  private colors = new Float32Array(MAX_SMOKE_PARTICLES * 3);
  private alphas = new Float32Array(MAX_SMOKE_PARTICLES);
  private sizes = new Float32Array(MAX_SMOKE_PARTICLES);
  private ages = new Float32Array(MAX_SMOKE_PARTICLES);
  private lifespans = new Float32Array(MAX_SMOKE_PARTICLES);
  private velocity = new Float32Array(MAX_SMOKE_PARTICLES * 3);
  private alive = new Array<boolean>(MAX_SMOKE_PARTICLES).fill(false);
  private framesRemaining = 0;

  constructor(texture: THREE.Texture | null) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uScale: { value: 800 } },
      vertexShader: flameVertex,
      fragmentShader: flameFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.name = 'Ball_Particle_Smoke';
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  reset(): void {
    this.alive.fill(false);
    this.alphas.fill(0);
    this.sizes.fill(0);
    this.framesRemaining = 0;
  }

  start(): void {
    this.framesRemaining = LIGHTNING_SOURCE.smokeFrames;
  }

  update(dt: number, uScale: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = uScale;
    // Exit On -> Off carries an activation delay of six behavior frames. The
    // system emits once per active behavior tick; it is not a serialized 66 Hz
    // clock, so advance exactly one source frame per rendered game frame.
    if (this.framesRemaining > 0) {
      this.framesRemaining--;
      this.emitBurst();
    }

    for (let i = 0; i < MAX_SMOKE_PARTICLES; i++) {
      if (!this.alive[i]) continue;
      this.ages[i] += dt;
      if (this.ages[i] >= this.lifespans[i]) {
        this.alive[i] = false;
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        continue;
      }
      this.positions[i * 3] += this.velocity[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocity[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocity[i * 3 + 2] * dt;
      const t = this.ages[i] / this.lifespans[i];
      this.sizes[i] = THREE.MathUtils.lerp(
        LIGHTNING_SOURCE.smoke.initialSize,
        LIGHTNING_SOURCE.smoke.endingSize,
        t,
      );
      const value = LIGHTNING_SOURCE.smoke.color * (1 - t);
      this.colors[i * 3] = value;
      this.colors[i * 3 + 1] = value;
      this.colors[i * 3 + 2] = value;
      this.alphas[i] = value;
    }

    const geometry = this.points.geometry;
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('aColor').needsUpdate = true;
    geometry.getAttribute('aAlpha').needsUpdate = true;
    geometry.getAttribute('aSize').needsUpdate = true;
  }

  get done(): boolean {
    return this.framesRemaining <= 0 && !this.alive.includes(true);
  }

  private emitBurst(): void {
    const count =
      LIGHTNING_SOURCE.smoke.emission +
      Math.floor(Math.random() * (LIGHTNING_SOURCE.smoke.emissionVariance * 2 + 1)) -
      LIGHTNING_SOURCE.smoke.emissionVariance;
    for (let emitted = 0; emitted < count; emitted++) {
      const slot = this.alive.indexOf(false);
      if (slot < 0) return;
      const direction = new THREE.Vector3().randomDirection();
      const position = direction.clone().multiplyScalar(LIGHTNING_SOURCE.smoke.radius);
      const speed =
        LIGHTNING_SOURCE.smoke.speed + (Math.random() * 2 - 1) * LIGHTNING_SOURCE.smoke.speedVariance;
      this.alive[slot] = true;
      this.ages[slot] = 0;
      this.lifespans[slot] = Math.max(
        0.001,
        LIGHTNING_SOURCE.smoke.life + (Math.random() * 2 - 1) * LIGHTNING_SOURCE.smoke.lifeVariance,
      );
      this.positions[slot * 3] = position.x;
      this.positions[slot * 3 + 1] = position.y;
      this.positions[slot * 3 + 2] = position.z;
      this.velocity[slot * 3] = direction.x * speed;
      this.velocity[slot * 3 + 1] = direction.y * speed;
      this.velocity[slot * 3 + 2] = direction.z * speed;
      this.colors[slot * 3] = LIGHTNING_SOURCE.smoke.color;
      this.colors[slot * 3 + 1] = LIGHTNING_SOURCE.smoke.color;
      this.colors[slot * 3 + 2] = LIGHTNING_SOURCE.smoke.color;
      this.alphas[slot] = LIGHTNING_SOURCE.smoke.color;
      this.sizes[slot] = LIGHTNING_SOURCE.smoke.initialSize;
    }
  }
}

/** Original ball-birth lightning sphere, point light, and smoke burst. */
export class LightningSphere {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private light: THREE.PointLight | null = null;
  private smoke: BirthSmoke | null = null;
  private textures: (THREE.Texture | null)[] = [];
  private scaleCurve: CurveKey[] = [
    [0, 0, 1],
    [1, 1, 1],
  ];
  private blueCurve: CurveKey[] = [
    [0, 0, 0],
    [1, 0, 0],
  ];
  private whiteCurve: CurveKey[] = [
    [0, 1, -1],
    [1, 0, -1],
  ];
  private t = 0;
  private textureFrame = 0;
  private smokeStarted = false;
  active = false;

  constructor() {
    this.group.name = 'Ball_LightningSphere_Effect';
    this.group.visible = false;
  }

  async init(): Promise<void> {
    const file = await loadNmo('3D Entities/Balls.nmo');
    const built = await buildScene(file);
    const sourceMesh = built.entities.get('Ball_LightningSphere')?.object;
    if (sourceMesh instanceof THREE.Mesh) {
      const material = Array.isArray(sourceMesh.material)
        ? sourceMesh.material.map((entry) => entry.clone())
        : sourceMesh.material.clone();
      this.mesh = new THREE.Mesh(sourceMesh.geometry, material);
      this.mesh.name = 'Ball_LightningSphere';
      this.mesh.matrix.copy(sourceMesh.matrix);
      this.mesh.matrix.decompose(this.mesh.position, this.mesh.quaternion, this.mesh.scale);
      this.mesh.matrixAutoUpdate = true;
      this.group.add(this.mesh);
    }

    this.textures = await Promise.all(
      ['Ball_LightningSphere1', 'Ball_LightningSphere2', 'Ball_LightningSphere3'].map(async (name) => {
        const record = file.byName
          .get(name)
          ?.find((candidate): candidate is TextureRec => candidate.kind === 'texture');
        const texture = record ? loadCkTexture(record) : null;
        return texture ? texture.catch(() => null) : null;
      }),
    );
    this.applyTexture(0);

    const lightRecord = file.objects.find(
      (record): record is LightRec => record.kind === 'light' && record.name === 'Ball_Lightning_PointLight',
    );
    if (lightRecord) {
      this.light = new THREE.PointLight(0x000000, lightRecord.lightPower, lightRecord.range, 1);
      this.light.name = lightRecord.name;
      this.light.position.copy(vxPositionToThree(lightRecord.entity.worldMatrix));
      this.group.add(this.light);
    }

    const scaleNode = behaviorChildren(file, 'Scale Lighting Sphere', 'Bezier Progression')[0];
    const scaleBytes = scaleNode ? behaviorParameters(file, scaleNode).get('Progression Curve')?.valueBytes : undefined;
    const scaleCurve = scaleBytes ? decodeCk2dCurve(scaleBytes) : [];
    if (scaleCurve.length >= 2) this.scaleCurve = scaleCurve;

    for (const node of behaviorChildren(file, 'Light  Anim', 'Bezier Progression')) {
      const parameters = behaviorParameters(file, node);
      const duration = parameterFloat(parameters.get('Duration'));
      const bytes = parameters.get('Progression Curve')?.valueBytes;
      const curve = bytes ? decodeCk2dCurve(bytes) : [];
      if (curve.length < 2) continue;
      if (Math.abs(duration - 2500) < 1) this.blueCurve = curve;
      else if (Math.abs(duration - 1500) < 1) this.whiteCurve = curve;
    }

    this.smoke = new BirthSmoke(await spriteTexture('Textures/Particle_Smoke.bmp'));
    this.group.add(this.smoke.points);
  }

  start(): void {
    this.active = true;
    this.t = 0;
    this.textureFrame = 0;
    this.smokeStarted = false;
    this.group.visible = true;
    if (this.mesh) {
      this.mesh.visible = true;
      this.mesh.rotation.set(0, 0, 0);
      this.mesh.scale.setScalar(0);
    }
    if (this.light) {
      this.light.visible = true;
      this.light.color.setRGB(0, 0, 0);
    }
    this.smoke?.reset();
    this.applyTexture(0);
  }

  stop(): void {
    this.active = false;
    this.group.visible = false;
    if (this.light) this.light.visible = false;
  }

  update(dt: number, ballPos: THREE.Vector3, uScale: number): void {
    if (!this.active) return;
    this.t += dt;
    this.group.position.copy(ballPos);

    if (this.mesh) {
      this.mesh.rotation.y = this.t * LIGHTNING_SOURCE.rotationSpeed;
      const scale =
        this.t < LIGHTNING_SOURCE.scaleDuration
          ? evalCurve(this.scaleCurve, this.t / LIGHTNING_SOURCE.scaleDuration)
          : 1;
      this.mesh.scale.setScalar(scale);
      if (this.t >= LIGHTNING_SOURCE.sphereDuration) this.mesh.visible = false;
      // Timer Loop Out drives the three-way Sequencer once per behavior frame.
      this.textureFrame = (this.textureFrame + 1) % this.textures.length;
      this.applyTexture(this.textureFrame);
    }

    if (this.light) {
      if (this.t < LIGHTNING_SOURCE.blueLightDuration) {
        this.light.color.setRGB(0, 0, evalCurve(this.blueCurve, this.t / LIGHTNING_SOURCE.blueLightDuration));
      } else if (this.t < LIGHTNING_SOURCE.blueLightDuration + LIGHTNING_SOURCE.whiteLightDuration) {
        const value = evalCurve(
          this.whiteCurve,
          (this.t - LIGHTNING_SOURCE.blueLightDuration) / LIGHTNING_SOURCE.whiteLightDuration,
        );
        this.light.color.setRGB(value, value, value);
      } else {
        this.light.visible = false;
      }
    }

    if (!this.smokeStarted && this.t >= LIGHTNING_SOURCE.smokeDelay) {
      this.smokeStarted = true;
      this.smoke?.start();
    }
    this.smoke?.update(dt, uScale);
    if (this.smokeStarted && this.smoke?.done) {
      this.stop();
    }
  }

  private applyTexture(index: number): void {
    if (!this.mesh || !this.textures[index]) return;
    const materials = Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshPhongMaterial || material instanceof THREE.MeshBasicMaterial) {
        material.map = this.textures[index];
        if (material instanceof THREE.MeshPhongMaterial) material.emissiveMap = this.textures[index];
        material.needsUpdate = true;
      }
    }
  }
}

interface TrafoRing {
  object: THREE.Object3D;
  basePosition: THREE.Vector3;
  openOffset: THREE.Vector3;
}

function parameterVector3(parameter: ParameterRec | undefined): [number, number, number] | null {
  if (!parameter || parameter.valueBytes.length < 12) return null;
  const view = new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset);
  return [view.getFloat32(0, true), view.getFloat32(4, true), view.getFloat32(8, true)];
}

function materialList(object: THREE.Object3D | null): THREE.Material[] {
  if (!(object instanceof THREE.Mesh)) return [];
  return Array.isArray(object.material) ? object.material : [object.material];
}

/** The original transformation cage, evaluated from AnimTrafo.nmo's graph. */
export class TrafoAnim {
  readonly group = new THREE.Group();
  private rings: TrafoRing[] = [];
  private bars: THREE.Object3D | null = null;
  private barsBase = new THREE.Vector3();
  private flash: THREE.Mesh | null = null;
  private flashBase = new THREE.Vector3();
  private ringColorMaterials: THREE.Material[] = [];
  private trafoColors = new Map<BallKind, THREE.Color>();
  private sourceMain: THREE.Object3D | null = null;
  private sourceMainWasVisible = true;
  private sourceShadowMaterials: THREE.Material[] = [];
  private openCurve: CurveKey[] = [
    [0, 0, 0],
    [1, 1, 0],
  ];
  private travelCurve: CurveKey[] = [
    [0, 0, 0],
    [1, 0, 0],
  ];
  private closeCurve: CurveKey[] = [
    [0, 1, 0],
    [1, 0, 0],
  ];
  private openDuration: number = TRAFO_SOURCE.openDuration;
  private travelDuration: number = TRAFO_SOURCE.travelDuration;
  private closeDuration: number = TRAFO_SOURCE.closeDuration;
  private ringOffset: [number, number, number] = [...TRAFO_SOURCE.ringOffset];
  private barsOffset: [number, number, number] = [...TRAFO_SOURCE.barsOffset];
  active = false;
  private t = 0;

  async init(): Promise<void> {
    try {
      const [file, ...trafoFiles] = await Promise.all([
        loadNmo('3D Entities/AnimTrafo.nmo'),
        loadNmo('3D Entities/PH/P_Trafo_Paper.nmo'),
        loadNmo('3D Entities/PH/P_Trafo_Wood.nmo'),
        loadNmo('3D Entities/PH/P_Trafo_Stone.nmo'),
      ]);
      const built = await buildScene(file);
      this.group.add(built.root);
      built.root.updateMatrixWorld(true);
      for (let i = 1; i <= 4; i++) {
        const ring = built.entities.get(`AnimTrafo_Ringpart${i}`)?.object;
        const frame = built.entities.get(`AnimTrafo_Frame0${i}`)?.object;
        if (!ring || !frame) continue;
        const localOffset = new THREE.Vector3(this.ringOffset[0], this.ringOffset[1], -this.ringOffset[2]);
        localOffset.applyMatrix3(new THREE.Matrix3().setFromMatrix4(frame.matrix));
        this.rings.push({ object: ring, basePosition: ring.position.clone(), openOffset: localOffset });
        for (const material of materialList(ring)) {
          if (material.name === 'AnimTrafo_RingParts_Color' && !this.ringColorMaterials.includes(material)) {
            this.ringColorMaterials.push(material);
          }
        }
      }
      this.bars = built.entities.get('AnimTrafo_Bars')?.object ?? null;
      this.barsBase.copy(this.bars?.position ?? new THREE.Vector3());
      const flash = built.entities.get('AnimTrafo_Flashfield');
      if (flash && flash.object instanceof THREE.Mesh) {
        this.flash = flash.object;
        this.flashBase.copy(flash.object.position);
        const mats = Array.isArray(flash.object.material) ? flash.object.material : [flash.object.material];
        for (const m of mats) {
          m.transparent = true;
          m.depthWrite = false;
          if (m.map) {
            m.map.wrapS = THREE.RepeatWrapping;
            m.map.needsUpdate = true;
          }
        }
      }

      this.readProgression(file, 'Ring_Open', (duration, curve, end) => {
        this.openDuration = duration;
        this.openCurve = curve;
        if (end) this.ringOffset = end;
      });
      this.readProgression(file, 'Up ´n Down', (duration, curve, end) => {
        this.travelDuration = duration;
        this.travelCurve = curve;
        if (end) this.barsOffset = end;
      });
      this.readProgression(file, 'Ring_Close', (duration, curve) => {
        this.closeDuration = duration;
        this.closeCurve = curve;
      });

      // Get Colors reads material-list element 1 from the active trafo. Cache
      // the same serialized diffuse values so the animation material is not
      // inferred from a complementary renderer's material conversion.
      for (const [index, kind] of (['paper', 'wood', 'stone'] as BallKind[]).entries()) {
        const color = trafoFiles[index].objects.find(
          (record) => record.kind === 'material' && record.name === `P_Trafo_${kind[0].toUpperCase()}${kind.slice(1)}_Color`,
        );
        if (color?.kind === 'material') this.trafoColors.set(kind, new THREE.Color(...color.diffuse.slice(0, 3)));
      }
    } catch {
      /* keep an empty group if the file is absent */
    }
    this.group.visible = false;
  }

  start(kind: BallKind, sourceMain: THREE.Object3D, sourceShadow: THREE.Object3D | null): void {
    if (this.active) this.stop();
    this.active = true;
    this.t = 0;
    this.sourceMain = sourceMain;
    this.sourceMainWasVisible = sourceMain.visible;
    sourceMain.updateWorldMatrix(true, false);
    sourceMain.matrixWorld.decompose(this.group.position, this.group.quaternion, this.group.scale);
    this.group.updateMatrix();
    sourceMain.visible = false;
    this.sourceShadowMaterials = materialList(sourceShadow);
    const sourceColor = this.trafoColors.get(kind);
    if (sourceColor) {
      for (const material of this.ringColorMaterials) {
        if ('color' in material && material.color instanceof THREE.Color) material.color.copy(sourceColor);
      }
    }
    for (const ring of this.rings) ring.object.visible = true;
    if (this.bars) this.bars.visible = true;
    if (this.flash) this.flash.visible = false;
    this.applyPose(0, 0, false, 1);
    this.group.visible = true;
  }

  stop(): void {
    this.active = false;
    this.group.visible = false;
    if (this.sourceMain) this.sourceMain.visible = this.sourceMainWasVisible;
    this.sourceMain = null;
    this.sourceShadowMaterials = [];
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const graphTime = Math.max(0, this.t - TRAFO_SOURCE.activationDelay);
    if (graphTime < this.openDuration) {
      const ring = evalCurve(this.openCurve, graphTime / this.openDuration);
      this.applyPose(ring, 0, false, 1);
      return;
    }
    const travelTime = graphTime - this.openDuration;
    if (travelTime < this.travelDuration) {
      const progression = evalCurve(this.travelCurve, travelTime / this.travelDuration);
      const shadowAlpha = THREE.MathUtils.lerp(1, 0.19607844948768616, progression);
      this.applyPose(1, this.barsOffset[1] * progression, true, shadowAlpha);
      return;
    }
    const closeTime = travelTime - this.travelDuration;
    if (closeTime < this.closeDuration) {
      // The shared Up 'n Down curve ends back at zero, so its diffuse
      // interpolator has already restored the shadow from 0.196078 to 1.
      this.applyPose(evalCurve(this.closeCurve, closeTime / this.closeDuration), 0, false, 1);
      return;
    }
    this.stop();
  }

  private applyPose(ringProgress: number, barsY: number, flashVisible: boolean, shadowAlpha: number): void {
    for (const ring of this.rings) {
      ring.object.position.copy(ring.basePosition).addScaledVector(ring.openOffset, ringProgress);
      ring.object.position.y += barsY;
      ring.object.updateMatrix();
    }
    if (this.bars) {
      this.bars.position.copy(this.barsBase);
      this.bars.position.y += barsY;
      this.bars.updateMatrix();
    }
    if (this.flash) {
      this.flash.visible = flashVisible;
      this.flash.position.copy(this.flashBase);
      this.flash.position.y += barsY;
      this.flash.updateMatrix();
      const step = Math.floor(Math.max(0, this.t - TRAFO_SOURCE.activationDelay - this.openDuration) / TRAFO_SOURCE.flashStep);
      const offset = step % 2 === 0 ? TRAFO_SOURCE.flashScroll : 0;
      for (const material of materialList(this.flash)) {
        if ('map' in material && material.map instanceof THREE.Texture) material.map.offset.x = offset;
      }
    }
    for (const material of this.sourceShadowMaterials) {
      if ('color' in material && material.color instanceof THREE.Color) material.color.setRGB(1, 1, 1);
      material.transparent = true;
      material.opacity = shadowAlpha;
    }
  }

  private readProgression(
    file: NmoFile,
    scriptName: string,
    apply: (duration: number, curve: CurveKey[], end: [number, number, number] | null) => void,
  ): void {
    const progression = behaviorChildren(file, scriptName, 'Bezier Progression')[0];
    if (!progression) return;
    const parameters = behaviorParameters(file, progression);
    const duration = parameterFloat(parameters.get('Duration')) / 1000;
    const curve = decodeCk2dCurve(parameters.get('Progression Curve')?.valueBytes ?? new Uint8Array());
    const script = file.objects.find(
      (record): record is BehaviorRec => record.kind === 'behavior' && record.name === scriptName,
    );
    const interpolator = script?.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .find((record): record is BehaviorRec => record?.kind === 'behavior' && record.name === 'Interpolator');
    const end = interpolator ? parameterVector3(behaviorParameters(file, interpolator).get('B')) : null;
    if (Number.isFinite(duration) && duration > 0 && curve.length >= 2) apply(duration, curve, end);
  }
}

interface PieceTemplate {
  mesh: THREE.Mesh;
  local: THREE.Matrix4;
  number: number;
}

interface Piece {
  kind: BallKind;
  number: number;
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  soundCooldown: number;
  preLinvel: THREE.Vector3;
  preAngvel: THREE.Vector3;
}

interface ShatterState {
  kind: BallKind;
  /** time since Ball_Explosion_<Kind> started */
  age: number;
  /** time since Trafo Manager set this kind's Piecesflag */
  resetAge: number;
  collisionEventsActive: boolean;
  pieces: Piece[];
  materials: Set<THREE.Material>;
}

/** Original ball shatter: the Ball_<Kind>_pieceNN meshes fly apart. */
export class ShatterSystem {
  private templates = new Map<BallKind, PieceTemplate[]>();
  private fadeCurves = new Map<BallKind, CurveKey[]>();
  private states = new Map<BallKind, ShatterState>();
  private colliderPieces = new Map<number, Piece>();
  private physics: PhysicsWorld;
  private scene: THREE.Scene;
  private playSound: ((name: string, volume: number) => void) | null = null;

  constructor(physics: PhysicsWorld, scene: THREE.Scene) {
    this.physics = physics;
    this.scene = scene;
  }

  setSoundPlayer(playSound: (name: string, volume: number) => void): void {
    this.playSound = playSound;
  }

  async init(): Promise<void> {
    const file = await loadNmo('3D Entities/Balls.nmo');
    const built = await buildScene(file);
    for (const kind of ['paper', 'wood', 'stone'] as BallKind[]) {
      const title = kind[0].toUpperCase() + kind.slice(1);
      const list = groupEntities(built, `Ball_${title}_Pieces`)
        .filter((entry): entry is typeof entry & { object: THREE.Mesh } => entry.object instanceof THREE.Mesh)
        .map((entry, index) => ({ mesh: entry.object, local: entry.object.matrix.clone(), number: index + 1 }));
      this.templates.set(kind, list);
      const fade = behaviorChildren(file, `Fade ${title} Pieces`, 'Bezier Progression')[0];
      const curve = fade
        ? decodeCk2dCurve(behaviorParameters(file, fade).get('Progression Curve')?.valueBytes ?? new Uint8Array())
        : [];
      this.fadeCurves.set(
        kind,
        curve.length >= 2
          ? curve
          : [
              [0, 0, 0],
              [1, 1, 0],
            ],
      );
    }
  }

  burst(kind: BallKind, center: THREE.Vector3, resetAge = 0): void {
    // The source owns one persistent group per kind. A repeat throw restores
    // that group's initial conditions without removing the other two kinds.
    this.removeKind(kind);
    const source = SHATTER_SOURCE.kinds[kind];
    const templates = this.templates.get(kind) ?? [];
    const pieces: Piece[] = [];
    const copiedMaterials = new Map<THREE.Material, THREE.Material>();
    const stateMaterials = new Set<THREE.Material>();
    for (const t of templates) {
      const copyMaterial = (material: THREE.Material): THREE.Material => {
        let copy = copiedMaterials.get(material);
        if (!copy) {
          copy = material.clone();
          copy.transparent = true;
          copy.opacity = 1;
          copy.needsUpdate = true;
          copiedMaterials.set(material, copy);
          stateMaterials.add(copy);
        }
        return copy;
      };
      const material = Array.isArray(t.mesh.material)
        ? t.mesh.material.map(copyMaterial)
        : copyMaterial(t.mesh.material);
      const mesh = new THREE.Mesh(t.mesh.geometry, material);
      mesh.name = `shatter_piece:${t.mesh.name}`;
      mesh.matrixAutoUpdate = false;
      const offset = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      t.local.decompose(offset, rotation, scale);
      const pos = center.clone().add(offset);
      mesh.position.copy(pos);
      mesh.quaternion.copy(rotation);
      mesh.scale.copy(scale);
      mesh.updateMatrix();
      this.scene.add(mesh);

      const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation(rotation);
      const body = this.physics.world.createRigidBody(bodyDesc);
      this.physics.setIvpDamping(body, source.linearDamping, source.angularDamping);
      const desc =
        RAPIER.ColliderDesc.convexHull(localVertices(mesh, scale)) ?? RAPIER.ColliderDesc.ball(0.4);
      const friction = randomRange(source.friction);
      const mass = randomRange(source.mass);
      const monitorsCollision = source.monitoredPieces.some((number) => number === t.number);
      desc
        .setFriction(friction)
        .setRestitution(source.restitution)
        .setMass(mass)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
        .setActiveEvents(monitorsCollision ? RAPIER.ActiveEvents.COLLISION_EVENTS : RAPIER.ActiveEvents.NONE)
        // Pieces physicalize with IVP Collision Group "Ball": they never
        // collide with the player ball.
        .setCollisionGroups(BALL_PIECE_COLLISION_GROUPS);
      const collider = this.physics.world.createCollider(desc, body);
      // Every source Physicalize has Automatic Calculate Mass Center=false
      // and Shift Mass Center=(0,0,0). Retain Rapier's shape inertia while
      // placing the rigid body's mass center at the authored entity origin.
      collider.setMassProperties(
        mass,
        { x: 0, y: 0, z: 0 },
        body.principalInertia(),
        body.principalInertiaLocalFrame(),
      );

      // Physics Impulse uses the piece itself as both referentials. Applying
      // it at the authored local point also recovers the paper/stone torque;
      // wood's collinear point/direction intentionally starts with no spin.
      const impulse = vxVector(source.impulseDirection)
        .applyQuaternion(rotation)
        .multiplyScalar(randomRange(source.impulse));
      const point = vxVector(source.impulsePoint).applyQuaternion(rotation).add(pos);
      body.applyImpulseAtPoint(impulse, point, true);
      const piece: Piece = {
        kind,
        number: t.number,
        mesh,
        body,
        collider,
        soundCooldown: 0,
        preLinvel: new THREE.Vector3(),
        preAngvel: new THREE.Vector3(),
      };
      pieces.push(piece);
      this.colliderPieces.set(collider.handle, piece);
    }
    this.states.set(kind, {
      kind,
      age: 0,
      resetAge,
      collisionEventsActive: source.monitoredPieces.length > 0,
      pieces,
      materials: stateMaterials,
    });
    if (kind === 'paper') this.playSound?.('Pieces_Paper.wav', 1);
  }

  /** Advance source timers/forces once per 66 Hz gameplay step. */
  advance(dt: number): void {
    for (const state of [...this.states.values()]) {
      state.age += dt;
      state.resetAge += dt;
      for (const piece of state.pieces) {
        const v = piece.body.linvel();
        const w = piece.body.angvel();
        piece.preLinvel.set(v.x, v.y, v.z);
        piece.preAngvel.set(w.x, w.y, w.z);
        piece.soundCooldown = Math.max(0, piece.soundCooldown - dt);
      }
      if (state.collisionEventsActive && state.age >= SHATTER_SOURCE.collisionSoundDuration) {
        for (const piece of state.pieces) piece.collider.setActiveEvents(RAPIER.ActiveEvents.NONE);
        state.collisionEventsActive = false;
      }

      // Ball_PaperWind is activated by the explosion and explicitly stopped
      // as Ball_ResetPieces_Paper starts, before its fade progression.
      if (state.kind === 'paper' && state.resetAge < SHATTER_SOURCE.resetDelay) {
        const force = vxVector(SHATTER_SOURCE.paperWindDirection).multiplyScalar(
          SHATTER_SOURCE.paperWindForce * FORCE_SCALE,
        );
        for (const piece of state.pieces) {
          piece.body.resetForces(false);
          piece.body.addForce(force, true);
        }
      } else if (state.kind === 'paper') {
        // Deactivating SetPhysicsForce clears its persistent force before the
        // fade continues under inertia/gravity alone.
        for (const piece of state.pieces) piece.body.resetForces(false);
      }

      if (state.resetAge >= SHATTER_SOURCE.resetDelay) {
        const time = (state.resetAge - SHATTER_SOURCE.resetDelay) / SHATTER_SOURCE.fadeDuration;
        const curve = this.fadeCurves.get(state.kind) ?? [
          [0, 0, 0],
          [1, 1, 0],
        ];
        const alpha = 1 - evalCurve(curve, THREE.MathUtils.clamp(time, 0, 1));
        for (const material of state.materials) material.opacity = alpha;
      }
      if (state.resetAge >= SHATTER_SOURCE.resetDelay + SHATTER_SOURCE.fadeDuration) {
        this.removeKind(state.kind);
      }
    }
  }

  /** Consume a Rapier collision-start event for source piece sounds. */
  handleCollision(handle1: number, handle2: number): void {
    const first = this.colliderPieces.get(handle1);
    const second = this.colliderPieces.get(handle2);
    if (first) this.playCollision(first, handle2);
    if (second) this.playCollision(second, handle1);
  }

  update(): void {
    for (const state of this.states.values()) {
      for (const piece of state.pieces) {
        const t = piece.body.translation();
        const r = piece.body.rotation();
        piece.mesh.position.set(t.x, t.y, t.z);
        piece.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        piece.mesh.updateMatrix();
      }
    }
  }

  clear(): void {
    for (const kind of [...this.states.keys()]) this.removeKind(kind);
  }

  private playCollision(piece: Piece, otherHandle: number): void {
    const state = this.states.get(piece.kind);
    const source = SHATTER_SOURCE.kinds[piece.kind];
    if (
      !state ||
      state.age > SHATTER_SOURCE.collisionSoundDuration ||
      piece.soundCooldown > 0 ||
      !source.monitoredPieces.some((number) => number === piece.number)
    ) {
      return;
    }
    const otherCollider = this.physics.world.getCollider(otherHandle);
    if (!otherCollider) return;
    let speed = 0;
    this.physics.world.contactPair(piece.collider, otherCollider, (manifold) => {
      const normal = manifold.normal();
      const count = Math.max(1, manifold.numSolverContacts());
      for (let index = 0; index < count; index++) {
        const contact = manifold.numSolverContacts() > 0
          ? manifold.solverContactPoint(index)
          : piece.body.translation();
        const ownVelocity = preStepPointVelocity(piece, contact);
        const otherPiece = this.colliderPieces.get(otherHandle);
        const otherVelocity = otherPiece
          ? preStepPointVelocity(otherPiece, contact)
          : otherCollider.parent()?.velocityAtPoint(contact) ?? { x: 0, y: 0, z: 0 };
        speed = Math.max(
          speed,
          Math.abs(
            (ownVelocity.x - otherVelocity.x) * normal.x +
              (ownVelocity.y - otherVelocity.y) * normal.y +
              (ownVelocity.z - otherVelocity.z) * normal.z,
          ),
        );
      }
    });
    if (speed < SHATTER_SOURCE.collisionMinSpeed) return;
    const volume = THREE.MathUtils.clamp(
      (speed - SHATTER_SOURCE.collisionMinSpeed) /
        (SHATTER_SOURCE.collisionMaxSpeed - SHATTER_SOURCE.collisionMinSpeed),
      0,
      1,
    );
    piece.soundCooldown = SHATTER_SOURCE.collisionCooldown;
    this.playSound?.(`Pieces_${piece.kind[0].toUpperCase()}${piece.kind.slice(1)}.wav`, volume);
  }

  private removeKind(kind: BallKind): void {
    const state = this.states.get(kind);
    if (!state) return;
    for (const piece of state.pieces) {
      this.colliderPieces.delete(piece.collider.handle);
      this.scene.remove(piece.mesh);
      this.physics.world.removeRigidBody(piece.body);
    }
    for (const material of state.materials) material.dispose();
    this.states.delete(kind);
  }
}

function randomRange(range: readonly [number, number]): number {
  return range[0] + Math.random() * (range[1] - range[0]);
}

/** Virtools left-handed vector -> three/Rapier right-handed vector. */
function vxVector(vector: readonly [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(vector[0], vector[1], -vector[2]);
}

function preStepPointVelocity(piece: Piece, point: { x: number; y: number; z: number }): THREE.Vector3 {
  const origin = piece.body.translation();
  const radius = new THREE.Vector3(point.x - origin.x, point.y - origin.y, point.z - origin.z);
  return piece.preAngvel.clone().cross(radius).add(piece.preLinvel);
}
