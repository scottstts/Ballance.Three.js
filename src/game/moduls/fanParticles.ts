/**
 * P_Modul_18's two source-authored planar particle layers.
 *
 * Virtools rendering mode 2 is Line and mode 3 is Sprite. Both emitters use
 * source-alpha/one blending and the P_Modul_18_Particle frame's local -Z axis.
 */
import * as THREE from 'three';

export interface FanParticleLayerSpec {
  emissionDelay: number;
  emission: number;
  emissionVariance: number;
  life: number;
  lifeVariance: number;
  maxParticles: number;
  speed: number;
  speedVariance: number;
  spreading: number;
  spreadingVariance: number;
  initialSize: number;
  endingSize: number;
  initialColor: readonly [number, number, number, number];
  endingColor: readonly [number, number, number, number];
  rendering: 'line' | 'sprite';
  texture: string | null;
  evolutions: number;
  variances: number;
  sourceBlend: number;
  destinationBlend: number;
  realTimeMode: boolean;
  fixedDelta: number;
}

/** Values serialized by P_Modul_18.nmo's two PlanarParticleSystem nodes. */
export const MODUL18_PARTICLE_SOURCE = {
  line: {
    emissionDelay: 0,
    emission: 3,
    emissionVariance: 0,
    life: 0.4,
    lifeVariance: 0.01,
    maxParticles: 100,
    speed: 39.99999910593033,
    speedVariance: 1.0000000474974513,
    spreading: 0,
    spreadingVariance: 0,
    initialSize: 4,
    endingSize: 0.10000000149011612,
    initialColor: [1, 1, 1, 0.2352941334247589],
    endingColor: [0, 0, 0, 0],
    rendering: 'line',
    texture: null,
    evolutions: 2,
    variances: 4,
    sourceBlend: 5,
    destinationBlend: 2,
    realTimeMode: true,
    fixedDelta: 0.02,
  },
  smoke: {
    emissionDelay: 0.02,
    emission: 1,
    emissionVariance: 1,
    life: 0.8,
    lifeVariance: 0.01,
    maxParticles: 40,
    speed: 35.999998450279236,
    speedVariance: 1.0000000474974513,
    spreading: 0,
    spreadingVariance: 0,
    initialSize: 2.299999952316284,
    endingSize: 3,
    initialColor: [1, 1, 1, 0.11764706671237946],
    endingColor: [0, 0, 0, 0],
    rendering: 'sprite',
    texture: 'Particle_Smoke',
    evolutions: 3,
    variances: 12,
    sourceBlend: 5,
    destinationBlend: 2,
    realTimeMode: true,
    fixedDelta: 0.02,
  },
} as const satisfies Record<string, FanParticleLayerSpec>;

const particleVertex = /* glsl */ `
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

const particleFragment = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 texel = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(texel.rgb * vColor, texel.a * vAlpha);
    #include <colorspace_fragment>
  }
`;

const lineVertex = /* glsl */ `
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const lineFragment = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    gl_FragColor = vec4(vColor, vAlpha);
    #include <colorspace_fragment>
  }
`;

function additiveMaterial(options: THREE.ShaderMaterialParameters): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    ...options,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
  });
}

abstract class FanEmitter {
  protected ages: Float32Array;
  protected lifespans: Float32Array;
  protected positions: Float32Array;
  protected velocity: Float32Array;
  protected alive: boolean[];
  protected active = false;
  protected emissionTime = 0;
  protected readonly spec: FanParticleLayerSpec;

  constructor(spec: FanParticleLayerSpec) {
    this.spec = spec;
    this.ages = new Float32Array(spec.maxParticles);
    this.lifespans = new Float32Array(spec.maxParticles);
    this.positions = new Float32Array(spec.maxParticles * 3);
    this.velocity = new Float32Array(spec.maxParticles * 3);
    this.alive = new Array<boolean>(spec.maxParticles).fill(false);
  }

  abstract readonly object: THREE.Object3D;

  setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    this.object.visible = on;
    this.resetParticles();
  }

  aliveCount(): number {
    let count = 0;
    for (const alive of this.alive) if (alive) count++;
    return count;
  }

  update(
    dt: number,
    origin: THREE.Vector3,
    orientation: THREE.Quaternion,
    emitterScale: THREE.Vector3,
    pointScale: number,
  ): void {
    if (!this.active) return;
    if (this.spec.emissionDelay === 0) {
      this.emit(origin, orientation, emitterScale);
    } else {
      this.emissionTime += dt;
      while (this.emissionTime >= this.spec.emissionDelay) {
        this.emissionTime -= this.spec.emissionDelay;
        this.emit(origin, orientation, emitterScale);
      }
    }
    // The source runtime emits first, then advances every live particle by
    // this behavior tick before invoking its renderer.
    this.advance(dt);
    this.commit(pointScale, dt);
  }

  dispose(): void {
    this.object.removeFromParent();
    const renderable = this.object as THREE.Points | THREE.LineSegments;
    renderable.geometry.dispose();
    const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
    for (const material of materials) material.dispose();
  }

  protected abstract advance(dt: number): void;
  protected abstract commit(pointScale: number, dt: number): void;
  protected abstract initializeVisual(slot: number): void;

  protected resetParticles(): void {
    this.alive.fill(false);
    this.ages.fill(0);
    this.lifespans.fill(0);
    this.positions.fill(0);
    this.velocity.fill(0);
    this.emissionTime = 0;
    this.clearVisuals();
  }

  protected abstract clearVisuals(): void;

  private emit(origin: THREE.Vector3, orientation: THREE.Quaternion, emitterScale: THREE.Vector3): void {
    const variance = this.spec.emissionVariance;
    const count = Math.max(
      0,
      this.spec.emission + Math.floor(Math.random() * (variance * 2 + 1)) - variance,
    );
    for (let emitted = 0; emitted < count; emitted++) {
      const slot = this.alive.indexOf(false);
      if (slot < 0) return;
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * emitterScale.x,
        (Math.random() - 0.5) * emitterScale.y,
        0,
      ).applyQuaternion(orientation);
      const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(orientation).normalize();
      this.alive[slot] = true;
      this.ages[slot] = 0;
      this.lifespans[slot] = Math.max(
        0.001,
        this.spec.life + (Math.random() * 2 - 1) * this.spec.lifeVariance,
      );
      this.positions[slot * 3] = origin.x + offset.x;
      this.positions[slot * 3 + 1] = origin.y + offset.y;
      this.positions[slot * 3 + 2] = origin.z + offset.z;
      this.velocity[slot * 3] = direction.x * this.spec.speed;
      this.velocity[slot * 3 + 1] = direction.y * this.spec.speed;
      this.velocity[slot * 3 + 2] = direction.z * this.spec.speed;
      this.initializeVisual(slot);
    }
  }
}

class FanLineEmitter extends FanEmitter {
  readonly object: THREE.LineSegments;
  private linePositions: Float32Array;
  private colors: Float32Array;
  private alphas: Float32Array;

  constructor() {
    const spec = MODUL18_PARTICLE_SOURCE.line;
    super(spec);
    this.linePositions = new Float32Array(spec.maxParticles * 2 * 3);
    this.colors = new Float32Array(spec.maxParticles * 2 * 3);
    this.alphas = new Float32Array(spec.maxParticles * 2);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    this.object = new THREE.LineSegments(
      geometry,
      additiveMaterial({ vertexShader: lineVertex, fragmentShader: lineFragment }),
    );
    this.object.name = 'P_Modul_18_LineParticles';
    this.object.visible = false;
    this.object.frustumCulled = false;
    this.object.renderOrder = 5;
  }

  protected advance(dt: number): void {
    for (let slot = 0; slot < this.spec.maxParticles; slot++) {
      if (!this.alive[slot]) continue;
      this.ages[slot] += dt;
      if (this.ages[slot] >= this.lifespans[slot]) {
        this.alive[slot] = false;
        this.alphas[slot * 2] = 0;
        this.alphas[slot * 2 + 1] = 0;
        continue;
      }
      this.positions[slot * 3] += this.velocity[slot * 3] * dt;
      this.positions[slot * 3 + 1] += this.velocity[slot * 3 + 1] * dt;
      this.positions[slot * 3 + 2] += this.velocity[slot * 3 + 2] * dt;
    }
  }

  protected commit(_pointScale = 0, dt = 0): void {
    const spec = MODUL18_PARTICLE_SOURCE.line;
    for (let slot = 0; slot < spec.maxParticles; slot++) {
      if (!this.alive[slot]) continue;
      const t = this.ages[slot] / this.lifespans[slot];
      const previousT = Math.max(0, this.ages[slot] - dt) / this.lifespans[slot];
      const base = slot * 3;
      const lineBase = slot * 6;
      const vertexBase = slot * 2;
      const vx = this.velocity[base];
      const vy = this.velocity[base + 1];
      const vz = this.velocity[base + 2];
      // TT_ParticleSystems_RT.dll's mode-2 renderer writes the prior position
      // first and current position plus authored Spreading second. P_Modul_18
      // authors Spreading=0; Initial/Ending Size are not read by this renderer.
      this.linePositions[lineBase] = this.positions[base] - vx * dt;
      this.linePositions[lineBase + 1] = this.positions[base + 1] - vy * dt;
      this.linePositions[lineBase + 2] = this.positions[base + 2] - vz * dt;
      this.linePositions[lineBase + 3] = this.positions[base] + vx * spec.spreading;
      this.linePositions[lineBase + 4] = this.positions[base + 1] + vy * spec.spreading;
      this.linePositions[lineBase + 5] = this.positions[base + 2] + vz * spec.spreading;
      for (let component = 0; component < 3; component++) {
        this.colors[lineBase + component] = THREE.MathUtils.lerp(
          spec.initialColor[component],
          spec.endingColor[component],
          previousT,
        );
        this.colors[lineBase + 3 + component] = THREE.MathUtils.lerp(
          spec.initialColor[component],
          spec.endingColor[component],
          t,
        );
      }
      this.alphas[vertexBase] = THREE.MathUtils.lerp(
        spec.initialColor[3],
        spec.endingColor[3],
        previousT,
      );
      this.alphas[vertexBase + 1] = THREE.MathUtils.lerp(
        spec.initialColor[3],
        spec.endingColor[3],
        t,
      );
    }
    this.object.geometry.attributes.position.needsUpdate = true;
    this.object.geometry.attributes.aColor.needsUpdate = true;
    this.object.geometry.attributes.aAlpha.needsUpdate = true;
  }

  protected initializeVisual(): void {}

  protected clearVisuals(): void {
    this.linePositions.fill(0);
    this.colors.fill(0);
    this.alphas.fill(0);
    this.commit();
  }
}

class FanSmokeEmitter extends FanEmitter {
  readonly object: THREE.Points;
  private colors: Float32Array;
  private alphas: Float32Array;
  private sizes: Float32Array;
  private initialSizes: Float32Array;

  constructor() {
    const spec = MODUL18_PARTICLE_SOURCE.smoke;
    super(spec);
    this.colors = new Float32Array(spec.maxParticles * 3);
    this.alphas = new Float32Array(spec.maxParticles);
    this.sizes = new Float32Array(spec.maxParticles);
    this.initialSizes = new Float32Array(spec.maxParticles);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.object = new THREE.Points(
      geometry,
      additiveMaterial({
        uniforms: { uMap: { value: null }, uScale: { value: 800 } },
        vertexShader: particleVertex,
        fragmentShader: particleFragment,
      }),
    );
    this.object.name = 'P_Modul_18_SmokeParticles';
    this.object.visible = false;
    this.object.frustumCulled = false;
    this.object.renderOrder = 5;
  }

  setTexture(texture: THREE.Texture): void {
    (this.object.material as THREE.ShaderMaterial).uniforms.uMap.value = texture;
  }

  protected advance(dt: number): void {
    const spec = MODUL18_PARTICLE_SOURCE.smoke;
    for (let slot = 0; slot < spec.maxParticles; slot++) {
      if (!this.alive[slot]) continue;
      this.ages[slot] += dt;
      if (this.ages[slot] >= this.lifespans[slot]) {
        this.alive[slot] = false;
        this.alphas[slot] = 0;
        this.sizes[slot] = 0;
        continue;
      }
      this.positions[slot * 3] += this.velocity[slot * 3] * dt;
      this.positions[slot * 3 + 1] += this.velocity[slot * 3 + 1] * dt;
      this.positions[slot * 3 + 2] += this.velocity[slot * 3 + 2] * dt;
      const t = this.ages[slot] / this.lifespans[slot];
      this.sizes[slot] = THREE.MathUtils.lerp(this.initialSizes[slot], spec.endingSize, t);
      for (let component = 0; component < 3; component++) {
        this.colors[slot * 3 + component] = THREE.MathUtils.lerp(
          spec.initialColor[component],
          spec.endingColor[component],
          t,
        );
      }
      this.alphas[slot] = THREE.MathUtils.lerp(spec.initialColor[3], spec.endingColor[3], t);
    }
  }

  protected commit(pointScale: number, _dt = 0): void {
    (this.object.material as THREE.ShaderMaterial).uniforms.uScale.value = pointScale;
    this.object.geometry.attributes.position.needsUpdate = true;
    this.object.geometry.attributes.aColor.needsUpdate = true;
    this.object.geometry.attributes.aAlpha.needsUpdate = true;
    this.object.geometry.attributes.aSize.needsUpdate = true;
  }

  protected initializeVisual(slot: number): void {
    const spec = MODUL18_PARTICLE_SOURCE.smoke;
    this.initialSizes[slot] = spec.initialSize;
    this.sizes[slot] = spec.initialSize;
    this.colors[slot * 3] = spec.initialColor[0];
    this.colors[slot * 3 + 1] = spec.initialColor[1];
    this.colors[slot * 3 + 2] = spec.initialColor[2];
    this.alphas[slot] = spec.initialColor[3];
  }

  protected clearVisuals(): void {
    this.colors.fill(0);
    this.alphas.fill(0);
    this.sizes.fill(0);
    this.initialSizes.fill(0);
    this.commit(800);
  }
}

export class FanParticles {
  private readonly line = new FanLineEmitter();
  private readonly smoke = new FanSmokeEmitter();
  private readonly origin = new THREE.Vector3();
  private readonly orientation = new THREE.Quaternion();
  private readonly emitterScale = new THREE.Vector3();
  private readonly emitter: THREE.Object3D;
  private active = false;

  constructor(scene: THREE.Scene, emitter: THREE.Object3D) {
    this.emitter = emitter;
    scene.add(this.line.object);
    scene.add(this.smoke.object);
  }

  setSmokeTexture(texture: THREE.Texture): void {
    this.smoke.setTexture(texture);
  }

  setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    this.line.setActive(on);
    this.smoke.setActive(on);
  }

  update(dt: number, pointScale: number): void {
    if (!this.active) return;
    this.emitter.updateWorldMatrix(true, false);
    this.emitter.getWorldPosition(this.origin);
    this.emitter.getWorldQuaternion(this.orientation);
    this.emitter.getWorldScale(this.emitterScale);
    this.line.update(dt, this.origin, this.orientation, this.emitterScale, pointScale);
    this.smoke.update(dt, this.origin, this.orientation, this.emitterScale, pointScale);
  }

  debugState(): Record<string, unknown> {
    return {
      active: this.active,
      lines: this.line.aliveCount(),
      smoke: this.smoke.aliveCount(),
    };
  }

  dispose(): void {
    this.line.dispose();
    this.smoke.dispose();
  }
}
