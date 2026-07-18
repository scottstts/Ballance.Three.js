/**
 * Source-backed Life Extra and Point Extra behavior.
 *
 * Geometry, sprites, materials, transforms, animation curves, and particle
 * textures come from the shipped P_Extra_Life/Point NMOs. Point movement is a
 * direct TypeScript implementation of the three states in TT_Gravity_RT.dll's
 * `TT Extra` building block: orbit, one-second fly-away, then Verlet pursuit.
 */
import * as THREE from 'three';
import { groupEntities, type BuiltScene } from '../engine/sceneBuilder.ts';
import { loadCkTexture } from '../engine/textures.ts';
import { decodeCk2dCurve, evalCurve, type CurveKey } from './curve.ts';
import { instantiatePrefab, loadPrefab, type PrefabInstance } from './moduls/prefabs.ts';

const LIFE_DURATION = 2;
const LIFE_BOB_A = -0.4;
const LIFE_BOB_B = 1.2;
const LIFE_SCALE_A = 1.2;
const LIFE_SCALE_B = 0.8;
const LIFE_EMISSIVE_A = new THREE.Color(0.6000000238, 0.4745098352, 0.6588235497);
const LIFE_EMISSIVE_B = new THREE.Color(0.2823529541, 0.2000000179, 0.3215686381);

// TT Extra setup parameters recovered from P_Extra_Point_MF Script.
const POINT_ROTATION_SPEED = 5;
const POINT_FLY_AWAY_TIME = 1;
const POINT_AWAY_FORCE = 1;
const POINT_AWAY_DAMPING = 0.3;
const POINT_CHASE_FORCE = 0.12;
const POINT_CHASE_DAMPING = 0.95;
const POINT_FORCE_WIDTH = 0.08;
/** TT Extra compares squared separation with the authored value 4. */
const POINT_HIT_DISTANCE_SQUARED = 4;

const ORBIT_AXES = [
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0.5, 0.5, Math.SQRT1_2),
  new THREE.Vector3(Math.SQRT1_2, -Math.SQRT1_2, 0),
  new THREE.Vector3(-0.5, -0.5, Math.SQRT1_2),
].map((axis) => axis.normalize());

interface LifeVisual {
  name: string;
  group: THREE.Group;
  sphere: THREE.Object3D;
  shadowMaterial: THREE.MeshPhongMaterial | null;
  oilTexture: THREE.Texture | null;
  oilOffset: THREE.Vector2;
  elapsed: number;
}

interface PointSatellite {
  object: THREE.Sprite;
  previous: THREE.Vector3;
  alive: boolean;
  forceScale: number;
}

type PointPhase = 'orbit' | 'away' | 'chase' | 'done';

interface PointVisual {
  name: string;
  group: THREE.Group;
  center: THREE.Sprite;
  floor: THREE.Object3D;
  satellites: PointSatellite[];
  trail: PointTrail;
  phase: PointPhase;
  phaseTime: number;
}

export interface PointPickupHit {
  name: string;
  satellite: number;
}

export class PickupSystem {
  private lifes: LifeVisual[] = [];
  private points: PointVisual[] = [];
  private byName = new Map<string, LifeVisual | PointVisual>();
  private lifeScaleCurve: CurveKey[] = [];
  private lifeBobCurve: CurveKey[] = [];

  async init(built: BuiltScene, scene: THREE.Scene): Promise<void> {
    const [lifePrefab, pointPrefab] = await Promise.all([loadPrefab('P_Extra_Life'), loadPrefab('P_Extra_Point')]);
    const lifeCurves = lifePrefab.file.objects
      .filter((record) => record.kind === 'parameter' && record.name === 'Progression Curve')
      .map((record) => (record.kind === 'parameter' ? decodeCk2dCurve(record.valueBytes) : []));
    this.lifeScaleCurve = lifeCurves.find((curve) => curve.length === 7) ?? [];
    this.lifeBobCurve = lifeCurves.find((curve) => curve.length === 3) ?? [];

    const particleRec = pointPrefab.file.objects.find(
      (record) => record.kind === 'texture' && record.name === 'ExtraParticle',
    );
    const particleTexture = particleRec?.kind === 'texture' ? await loadCkTexture(particleRec) : null;

    for (const placement of groupEntities(built, 'P_Extra_Life')) {
      if (!/^P_Extra_Life_\d+$/.test(placement.rec.name)) continue;
      hideEmbedded(built, placement.rec.name);
      const instance = instantiatePrefab(lifePrefab, placement.object.matrix);
      showOnly(instance, ['P_Extra_Life_Sphere', 'P_Extra_Life_SilverBall', 'P_Extra_Life_Shadow']);

      const sphere = requiredPart(instance, 'P_Extra_Life_Sphere');
      sphere.matrixAutoUpdate = true;
      const shadow = requiredPart(instance, 'P_Extra_Life_Shadow');
      const shadowMaterial = clonePhongMaterial(shadow);
      const oilMaterial = cloneMaterial(sphere);
      const oilTexture = materialMap(oilMaterial);
      if (oilTexture) {
        const clone = oilTexture.clone();
        clone.wrapS = THREE.RepeatWrapping;
        clone.wrapT = THREE.RepeatWrapping;
        clone.needsUpdate = true;
        setMaterialMap(oilMaterial, clone);
      }

      scene.add(instance.root);
      const visual: LifeVisual = {
        name: placement.rec.name,
        group: instance.root,
        sphere,
        shadowMaterial,
        oilTexture: materialMap(oilMaterial),
        oilOffset: materialMap(oilMaterial)?.offset.clone() ?? new THREE.Vector2(),
        elapsed: 0,
      };
      this.lifes.push(visual);
      this.byName.set(visual.name, visual);
    }

    for (const placement of groupEntities(built, 'P_Extra_Point')) {
      if (!/^P_Extra_Point_\d+$/.test(placement.rec.name)) continue;
      hideEmbedded(built, placement.rec.name);
      const instance = instantiatePrefab(pointPrefab, placement.object.matrix);
      showOnly(instance, [
        'P_Extra_Point_Floor',
        'P_Extra_Point_Ball0',
        'P_Extra_Point_Ball1',
        'P_Extra_Point_Ball2',
        'P_Extra_Point_Ball3',
        'P_Extra_Point_Ball4',
        'P_Extra_Point_Ball5',
        'P_Extra_Point_Ball6',
      ]);
      const center = requiredSprite(instance, 'P_Extra_Point_Ball0');
      const satellites = Array.from({ length: 6 }, (_, index): PointSatellite => {
        const object = requiredSprite(instance, `P_Extra_Point_Ball${index + 1}`);
        object.matrixAutoUpdate = true;
        return {
          object,
          previous: object.position.clone(),
          alive: true,
          // TT Extra's Forcewidth creates a narrow spread of pursuit forces.
          // A stable six-sample distribution reproduces that authored width.
          forceScale: 1 + THREE.MathUtils.lerp(-POINT_FORCE_WIDTH, POINT_FORCE_WIDTH, index / 5),
        };
      });
      const trail = new PointTrail(particleTexture);
      scene.add(trail.points);
      scene.add(instance.root);
      const visual: PointVisual = {
        name: placement.rec.name,
        group: instance.root,
        center,
        floor: requiredPart(instance, 'P_Extra_Point_Floor'),
        satellites,
        trail,
        phase: 'orbit',
        phaseTime: 0,
      };
      this.points.push(visual);
      this.byName.set(visual.name, visual);
    }
  }

  /** Initial collection: hide the +100 center and start the 1000 ms fly-away. */
  collect(name: string): void {
    const visual = this.byName.get(name);
    if (!visual) return;
    if ('satellites' in visual) {
      if (visual.phase !== 'orbit') return;
      visual.center.visible = false;
      visual.floor.visible = false;
      visual.phase = 'away';
      visual.phaseTime = 0;
      for (const satellite of visual.satellites) satellite.previous.copy(satellite.object.position);
    } else {
      visual.group.visible = false;
    }
  }

  /** Fixed-step TT Extra movement and hit detection. */
  updateSimulation(dt: number, ballPosition: THREE.Vector3): PointPickupHit[] {
    const hits: PointPickupHit[] = [];
    for (const visual of this.points) {
      if (!visual.group.visible || visual.phase === 'done') continue;
      const center = visual.center.position;

      if (visual.phase === 'orbit') {
        const angle = POINT_ROTATION_SPEED * dt;
        for (let index = 0; index < visual.satellites.length; index++) {
          const satellite = visual.satellites[index];
          satellite.object.position.sub(center).applyAxisAngle(ORBIT_AXES[index], angle).add(center);
          satellite.previous.copy(satellite.object.position);
        }
        continue;
      }

      visual.phaseTime += dt;
      if (visual.phase === 'away') {
        for (const satellite of visual.satellites) {
          if (!satellite.alive) continue;
          verletStep(
            satellite,
            satellite.object.position.clone().sub(center),
            POINT_AWAY_FORCE * dt,
            POINT_AWAY_DAMPING,
          );
        }
        if (visual.phaseTime >= POINT_FLY_AWAY_TIME) {
          visual.phase = 'chase';
          visual.phaseTime = 0;
        }
        continue;
      }

      const target = visual.group.worldToLocal(ballPosition.clone());
      let liveCount = 0;
      for (let index = 0; index < visual.satellites.length; index++) {
        const satellite = visual.satellites[index];
        if (!satellite.alive) continue;
        liveCount++;
        if (satellite.object.position.distanceToSquared(target) < POINT_HIT_DISTANCE_SQUARED) {
          satellite.alive = false;
          satellite.object.visible = false;
          liveCount--;
          hits.push({ name: visual.name, satellite: index + 1 });
          continue;
        }
        verletStep(
          satellite,
          target.clone().sub(satellite.object.position),
          POINT_CHASE_FORCE * satellite.forceScale * dt,
          POINT_CHASE_DAMPING,
        );
      }
      if (liveCount === 0) visual.phase = 'done';
    }
    return hits;
  }

  /** Visual animation and the original 90 ms / 1000 ms orbit trails. */
  update(dt: number, pointScale: number): void {
    for (const visual of this.lifes) {
      if (!visual.group.visible) continue;
      visual.elapsed += dt;
      const progression = (visual.elapsed % LIFE_DURATION) / LIFE_DURATION;
      const scaleValue = this.lifeScaleCurve.length ? evalCurve(this.lifeScaleCurve, progression) : progression;
      const bobValue = this.lifeBobCurve.length ? evalCurve(this.lifeBobCurve, progression) : progression;
      visual.sphere.position.y = THREE.MathUtils.lerp(LIFE_BOB_A, LIFE_BOB_B, bobValue);
      visual.sphere.scale.set(1, THREE.MathUtils.lerp(LIFE_SCALE_A, LIFE_SCALE_B, scaleValue), 1);
      if (visual.shadowMaterial) visual.shadowMaterial.emissive.copy(LIFE_EMISSIVE_A).lerp(LIFE_EMISSIVE_B, bobValue);
      if (visual.oilTexture) {
        visual.oilTexture.offset.set(
          visual.oilOffset.x + Math.sin(visual.elapsed) * 0.2,
          visual.oilOffset.y + Math.cos(visual.elapsed) * 0.2,
        );
      }
    }

    for (const visual of this.points) {
      visual.group.updateMatrixWorld(true);
      visual.trail.update(dt, visual.satellites, visual.phase !== 'done' && visual.group.visible, pointScale);
    }
  }

  /** Crossing a checkpoint drops any satellites that have not hit yet. */
  checkpoint(): void {
    for (const visual of this.points) {
      if (visual.phase !== 'away' && visual.phase !== 'chase') continue;
      for (const satellite of visual.satellites) {
        satellite.alive = false;
        satellite.object.visible = false;
      }
      visual.phase = 'done';
    }
  }

  /** Section reset: Life Extras return; collected Point Extras remain gone. */
  resetAfterFall(): void {
    this.checkpoint();
    for (const visual of this.lifes) {
      visual.group.visible = true;
      visual.elapsed = 0;
    }
  }
}

function verletStep(satellite: PointSatellite, acceleration: THREE.Vector3, force: number, damping: number): void {
  const current = satellite.object.position.clone();
  const next = current
    .clone()
    .add(current.clone().sub(satellite.previous).multiplyScalar(damping))
    .add(acceleration.multiplyScalar(force));
  satellite.previous.copy(current);
  satellite.object.position.copy(next);
}

function hideEmbedded(built: BuiltScene, placementName: string): void {
  const entity = built.entities.get(placementName);
  if (entity) entity.object.visible = false;
}

function showOnly(instance: PrefabInstance, names: string[]): void {
  const shown = new Set(names);
  for (const [name, object] of instance.parts) {
    if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) object.visible = shown.has(name);
  }
}

function requiredPart(instance: PrefabInstance, name: string): THREE.Object3D {
  const part = instance.parts.get(name);
  if (!part) throw new Error(`${instance.root.name}: missing source part ${name}`);
  return part;
}

function requiredSprite(instance: PrefabInstance, name: string): THREE.Sprite {
  const part = requiredPart(instance, name);
  if (!(part instanceof THREE.Sprite)) throw new Error(`${instance.root.name}: ${name} is not CKSprite3D`);
  return part;
}

function cloneMaterial(object: THREE.Object3D): THREE.Material | null {
  if (!(object instanceof THREE.Mesh)) return null;
  if (Array.isArray(object.material)) {
    object.material = object.material.map((material) => material.clone());
    return object.material[0] ?? null;
  }
  object.material = object.material.clone();
  return object.material;
}

function clonePhongMaterial(object: THREE.Object3D): THREE.MeshPhongMaterial | null {
  const material = cloneMaterial(object);
  return material instanceof THREE.MeshPhongMaterial ? material : null;
}

function materialMap(material: THREE.Material | null): THREE.Texture | null {
  return material && 'map' in material ? ((material as THREE.MeshBasicMaterial).map ?? null) : null;
}

function setMaterialMap(material: THREE.Material | null, map: THREE.Texture): void {
  if (material && 'map' in material) (material as THREE.MeshBasicMaterial).map = map;
}

const TRAIL_CAPACITY = 96;
const TRAIL_EMISSION_DELAY = 0.09;
const TRAIL_LIFESPAN = 1;
const TRAIL_LIFESPAN_VARIANCE = 0.25;

class PointTrail {
  readonly points: THREE.Points;
  private positions = new Float32Array(TRAIL_CAPACITY * 3);
  private sizes = new Float32Array(TRAIL_CAPACITY);
  private alphas = new Float32Array(TRAIL_CAPACITY);
  private ages = new Float32Array(TRAIL_CAPACITY);
  private lifespans = new Float32Array(TRAIL_CAPACITY);
  private alive = new Array<boolean>(TRAIL_CAPACITY).fill(false);
  private spawnAcc = new Float32Array(6);
  private spawnCounter = 0;

  constructor(texture: THREE.Texture | null) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uScale: { value: 800 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        varying float vAlpha;
        uniform float uScale;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying float vAlpha;
        void main() {
          vec4 texel = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(texel.rgb, texel.a * vAlpha);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.name = 'P_Extra_Point_Trails';
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  update(dt: number, satellites: PointSatellite[], emit: boolean, pointScale: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = pointScale;
    for (let index = 0; index < TRAIL_CAPACITY; index++) {
      if (!this.alive[index]) continue;
      this.ages[index] += dt;
      const t = this.ages[index] / this.lifespans[index];
      if (t >= 1) {
        this.alive[index] = false;
        this.sizes[index] = 0;
        this.alphas[index] = 0;
      } else {
        this.sizes[index] = THREE.MathUtils.lerp(0.5, 0.2, t);
        this.alphas[index] = THREE.MathUtils.lerp(1, 0.1568627506, t);
      }
    }

    if (emit) {
      for (let satelliteIndex = 0; satelliteIndex < satellites.length; satelliteIndex++) {
        const satellite = satellites[satelliteIndex];
        if (!satellite.alive || !satellite.object.visible) continue;
        this.spawnAcc[satelliteIndex] += dt;
        while (this.spawnAcc[satelliteIndex] >= TRAIL_EMISSION_DELAY) {
          this.spawnAcc[satelliteIndex] -= TRAIL_EMISSION_DELAY;
          this.spawn(satellite.object, satelliteIndex);
        }
      }
    }

    const geometry = this.points.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aSize.needsUpdate = true;
    geometry.attributes.aAlpha.needsUpdate = true;
  }

  private spawn(source: THREE.Object3D, satelliteIndex: number): void {
    const slot = this.alive.indexOf(false);
    if (slot < 0) return;
    const position = source.getWorldPosition(new THREE.Vector3());
    this.positions[slot * 3] = position.x;
    this.positions[slot * 3 + 1] = position.y;
    this.positions[slot * 3 + 2] = position.z;
    this.ages[slot] = 0;
    // Source variance is 250 ms; distribute it deterministically across the
    // six emitters and successive particles while retaining the exact range.
    const sample = ((satelliteIndex * 7 + this.spawnCounter++) % 13) / 12;
    this.lifespans[slot] = TRAIL_LIFESPAN + (sample * 2 - 1) * TRAIL_LIFESPAN_VARIANCE;
    this.sizes[slot] = 0.5;
    this.alphas[slot] = 1;
    this.alive[slot] = true;
  }
}
