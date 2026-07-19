/** Source-faithful implementation of TT_Toolbox_RT.dll's `TT SkyAround`. */
import * as THREE from 'three';
import { decodeImageFile } from './textures.ts';

export interface SkySourceParameters {
  distortion: number;
  radius: number;
  quadraticSideFaces: boolean;
  sideFaceHeight: number;
  yPosition: number;
  sideMaterialCount: number;
  topMaterial: boolean;
  bottomMaterial: boolean;
}

/** `MenuLevel.nmo/TT Sky` serialized inputs and settings. */
export const MENU_SKY_SOURCE: Readonly<SkySourceParameters> = Object.freeze({
  distortion: 0.09999999403953552,
  radius: 70,
  quadraticSideFaces: true,
  sideFaceHeight: 10,
  yPosition: 0,
  sideMaterialCount: 4,
  topMaterial: false,
  bottomMaterial: true,
});

/** `Gameplay.nmo/TT Sky` serialized inputs and settings. */
export const GAMEPLAY_SKY_SOURCE: Readonly<SkySourceParameters> = Object.freeze({
  distortion: 0.14999999105930328,
  radius: 100,
  quadraticSideFaces: true,
  sideFaceHeight: 10,
  yPosition: 0,
  sideMaterialCount: 4,
  topMaterial: false,
  bottomMaterial: true,
});

function sourceSideHeight(source: Readonly<SkySourceParameters>): number {
  if (!source.quadraticSideFaces) return source.sideFaceHeight;
  const angle = (Math.PI * 2) / source.sideMaterialCount;
  const nextX = Math.cos(angle) * source.radius;
  const nextZ = Math.sin(angle) * source.radius;
  return Math.hypot(source.radius - nextX, -nextZ);
}

/**
 * Rebuilds the exact procedural topology emitted by the shipped SkyAround BB.
 * Virtools positions are converted to Three coordinates by negating Z, while
 * the original D3D UVs remain unchanged.
 */
export function buildSourceSkyGeometry(source: Readonly<SkySourceParameters>): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const groups: Array<{ start: number; count: number; materialIndex: number }> = [];
  const sideHeight = sourceSideHeight(source);
  const yLow = source.yPosition - sideHeight * 0.5;
  const yHigh = source.yPosition + sideHeight * 0.5;
  const angleStep = (Math.PI * 2) / source.sideMaterialCount;

  for (let side = 0; side < source.sideMaterialCount; side++) {
    const angle0 = side * angleStep;
    const angle1 = (side + 1) * angleStep;
    const x0 = Math.cos(angle0) * source.radius;
    const sourceZ0 = Math.sin(angle0) * source.radius;
    const x1 = Math.cos(angle1) * source.radius;
    const sourceZ1 = Math.sin(angle1) * source.radius;
    const z0 = -sourceZ0;
    const z1 = -sourceZ1;
    const base = positions.length / 3;

    // The BB duplicates all four side vertices for every material sector.
    positions.push(x0, yLow, z0, x1, yLow, z1, x1, yHigh, z1, x0, yHigh, z0);
    uvs.push(1, 1, 0, 1, 0, 0, 1, 0);
    const sideIndexStart = indices.length;
    indices.push(base + 2, base, base + 1, base + 2, base + 3, base);
    groups.push({ start: sideIndexStart, count: 6, materialIndex: side });

    if (source.topMaterial) {
      const topBase = positions.length / 3;
      positions.push(0, yHigh, 0, x0, yHigh, z0, x1, yHigh, z1);
      uvs.push(
        0.5,
        0.5,
        x0 / source.radius * 0.5 + 0.5,
        sourceZ0 / source.radius * 0.5 + 0.5,
        x1 / source.radius * 0.5 + 0.5,
        sourceZ1 / source.radius * 0.5 + 0.5,
      );
      const topIndexStart = indices.length;
      indices.push(topBase + 2, topBase + 1, topBase);
      groups.push({
        start: topIndexStart,
        count: 3,
        materialIndex: source.sideMaterialCount,
      });
    }

    if (source.bottomMaterial) {
      const bottomBase = positions.length / 3;
      positions.push(0, yLow, 0, x0, yLow, z0, x1, yLow, z1);
      uvs.push(
        0.5,
        0.5,
        x0 / source.radius * 0.5 + 0.5,
        sourceZ0 / source.radius * 0.5 + 0.5,
        x1 / source.radius * 0.5 + 0.5,
        sourceZ1 / source.radius * 0.5 + 0.5,
      );
      const bottomIndexStart = indices.length;
      indices.push(bottomBase + 2, bottomBase + 1, bottomBase);
      groups.push({
        start: bottomIndexStart,
        count: 3,
        materialIndex: source.sideMaterialCount + Number(source.topMaterial),
      });
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.name = 'TT_SkyAround_Mesh';
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.computeBoundingSphere();
  return geometry;
}

function faceTexture(rgba: Uint8ClampedArray, width: number, height: number): THREE.Texture {
  const texture = new THREE.DataTexture(new Uint8Array(rgba.buffer), width, height, THREE.RGBAFormat);
  // The source UVs use D3D convention (v=0 is the top image row).
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export interface BuiltSky {
  group: THREE.Group;
  /** Average lower-edge color, used only to clear pixels outside the open top. */
  horizonColor: THREE.Color;
}

export async function buildSky(
  letter: string,
  fogColor: THREE.Color,
  source: Readonly<SkySourceParameters> = GAMEPLAY_SKY_SOURCE,
): Promise<BuiltSky> {
  const names = ['Back', 'Right', 'Front', 'Left', 'Down'];
  const images = await Promise.all(
    names.map((name) => decodeImageFile(`Textures/Sky/Sky_${letter}_${name}.bmp`).catch(() => null)),
  );

  let red = 0;
  let green = 0;
  let blue = 0;
  let samples = 0;
  for (const image of images.slice(0, source.sideMaterialCount)) {
    if (!image) continue;
    const firstRow = Math.max(0, image.height - 6);
    for (let y = firstRow; y < image.height; y++) {
      for (let x = 0; x < image.width; x += 4) {
        const index = (y * image.width + x) * 4;
        red += image.rgba[index];
        green += image.rgba[index + 1];
        blue += image.rgba[index + 2];
        samples++;
      }
    }
  }
  const horizonColor = samples === 0
    ? fogColor.clone()
    : new THREE.Color()
        .setRGB(red / samples / 255, green / samples / 255, blue / samples / 255)
        .convertSRGBToLinear();
  fogColor.copy(horizonColor);

  const materials = images.map((image) => new THREE.MeshBasicMaterial({
    map: image ? faceTexture(image.rgba, image.width, image.height) : null,
    color: image ? 0xffffff : horizonColor,
    depthWrite: false,
    depthTest: false,
    fog: false,
    // The DLL emits outward-wound faces; the player views their backs.
    side: THREE.BackSide,
  }));
  const geometry = buildSourceSkyGeometry(source);
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.name = 'TT_SkyAround_Entity';
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;

  const group = new THREE.Group();
  group.name = 'sky';
  group.renderOrder = -1000;
  group.add(mesh);
  return { group, horizonColor };
}
