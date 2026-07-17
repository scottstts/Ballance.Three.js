/**
 * Animated pickups matching the original: Extra Life is an iridescent
 * bubble (oil texture) with a silver ball inside, bobbing and spinning;
 * Extra Point is a silver ball ringed by six orbiting silver balls with
 * red-orange glow rings.
 */
import * as THREE from 'three';
import { loadNmo } from '../engine/assets.ts';
import { buildScene, groupEntities, type BuiltScene } from '../engine/sceneBuilder.ts';

interface LifeVisual {
  name: string;
  group: THREE.Group;
  bubble: THREE.Object3D | null;
  t: number;
}

interface PointVisual {
  name: string;
  group: THREE.Group;
  orbiters: THREE.Object3D[];
  rings: THREE.Object3D[];
  t: number;
}

export class PickupSystem {
  private lifes: LifeVisual[] = [];
  private points: PointVisual[] = [];
  private byName = new Map<string, THREE.Group>();

  async init(built: BuiltScene, scene: THREE.Scene): Promise<void> {
    // template pieces from the original prefabs
    const lifePrefab = await buildScene(await loadNmo('3D Entities/PH/P_Extra_Life.nmo'));
    const bubbleTemplate = lifePrefab.entities.get('P_Extra_Life_Sphere');

    for (const e of groupEntities(built, 'P_Extra_Life')) {
      if (!/^P_Extra_Life_\d+$/.test(e.rec.name)) continue;
      hideEmbedded(built, e.rec.name);
      const group = new THREE.Group();
      group.position.copy(e.object.position);
      let bubble: THREE.Object3D | null = null;
      if (bubbleTemplate && bubbleTemplate.object instanceof THREE.Mesh) {
        bubble = new THREE.Mesh(bubbleTemplate.object.geometry, bubbleTemplate.object.material);
        bubble.rotation.y = Math.random() * Math.PI;
        group.add(bubble);
      }
      const silver = makeSilverBall(0.55);
      group.add(silver);
      scene.add(group);
      const v: LifeVisual = { name: e.rec.name, group, bubble, t: Math.random() * 5 };
      this.lifes.push(v);
      this.byName.set(e.rec.name, group);
    }

    for (const e of groupEntities(built, 'P_Extra_Point')) {
      if (!/^P_Extra_Point_\d+$/.test(e.rec.name)) continue;
      hideEmbedded(built, e.rec.name);
      const group = new THREE.Group();
      group.position.copy(e.object.position);
      group.add(makeSilverBall(0.7));
      const orbiters: THREE.Object3D[] = [];
      const rings: THREE.Object3D[] = [];
      // three tilted orbit circles, two balls each — like the original's povits
      for (let c = 0; c < 3; c++) {
        const carrier = new THREE.Group();
        carrier.rotation.set((c * Math.PI) / 3.2, (c * Math.PI) / 1.7, c * 0.6);
        group.add(carrier);
        for (let b = 0; b < 2; b++) {
          const holder = new THREE.Group();
          holder.rotation.y = b * Math.PI;
          const ball = makeSilverBall(0.32);
          ball.position.set(2.0, 0, 0);
          holder.add(ball);
          carrier.add(holder);
          orbiters.push(holder);
        }
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(2.0, 0.045, 6, 48),
          new THREE.MeshBasicMaterial({
            color: 0xff5030,
            blending: THREE.AdditiveBlending,
            transparent: true,
            opacity: 0.65,
            depthWrite: false,
          }),
        );
        ring.rotation.x = Math.PI / 2;
        carrier.add(ring);
        rings.push(carrier);
      }
      scene.add(group);
      const v: PointVisual = { name: e.rec.name, group, orbiters, rings, t: Math.random() * 5 };
      this.points.push(v);
      this.byName.set(e.rec.name, group);
    }
  }

  /** collect animation: hide (the fly-to-HUD burst is approximated by a flash) */
  collect(name: string): void {
    const group = this.byName.get(name);
    if (group) group.visible = false;
  }

  update(dt: number): void {
    for (const v of this.lifes) {
      if (!v.group.visible) continue;
      v.t += dt;
      if (v.bubble) v.bubble.rotation.y += dt * 0.9;
      v.group.children.forEach((c) => {
        c.position.y = Math.sin(v.t * 1.8) * 0.35;
      });
    }
    const rot = ((3 * Math.PI) / 180) * 66; // original: 3° per physics tick
    for (const v of this.points) {
      if (!v.group.visible) continue;
      v.t += dt;
      for (let i = 0; i < v.orbiters.length; i++) {
        v.orbiters[i].rotation.y += dt * rot * (i % 2 === 0 ? 1 : -1) * 0.5;
      }
      for (const carrier of v.rings) carrier.rotation.y += dt * 0.4;
    }
  }
}

function hideEmbedded(built: BuiltScene, placementName: string): void {
  const e = built.entities.get(placementName);
  if (e) e.object.visible = false;
}

let silverTexture: THREE.Texture | null | undefined;

function makeSilverBall(radius: number): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xdfe3e8,
    metalness: 0.9,
    roughness: 0.25,
  });
  if (silverTexture) mat.map = silverTexture;
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), mat);
}

export function setSilverTexture(tex: THREE.Texture | null): void {
  silverTexture = tex;
}
