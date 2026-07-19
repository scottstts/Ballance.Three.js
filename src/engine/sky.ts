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

/** TT_Gravity_RT's serialized float constants (2pi, the 5pi/4 sector offset, the cap UV scale). */
const SKY_TWO_PI = 6.2831854820251465;
const SKY_ANGLE_OFFSET = 3.9269909858703613;
const SKY_CAP_UV_SCALE = 0.707099974155426;

function sourceSideHeight(source: Readonly<SkySourceParameters>): number {
  if (!source.quadraticSideFaces) return source.sideFaceHeight;
  const angle = SKY_TWO_PI / source.sideMaterialCount;
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
  const angleStep = SKY_TWO_PI / source.sideMaterialCount;

  for (let side = 0; side < source.sideMaterialCount; side++) {
    // The DLL offsets every sector angle by 5pi/4 (0x407B53D2): walls sit
    // perpendicular to the axes instead of forming a rotated diamond.
    const angle0 = side * angleStep + SKY_ANGLE_OFFSET;
    const angle1 = (side + 1) * angleStep + SKY_ANGLE_OFFSET;
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

    // Cap corner UVs: u = x/len * 0.7071 + 0.5, v = -z/len * 0.7071 + 0.5 in
    // the original space (the mirrored port z cancels the negation). The
    // 0.70710 constant (0x3F350481) lands the diagonal corners on exactly 0/1.
    const capU = (x: number) => (x / source.radius) * SKY_CAP_UV_SCALE + 0.5;
    const capV = (portZ: number) => (portZ / source.radius) * SKY_CAP_UV_SCALE + 0.5;

    if (source.topMaterial) {
      const topBase = positions.length / 3;
      positions.push(x0, yHigh, z0, x1, yHigh, z1, 0, yHigh, 0);
      uvs.push(capU(x0), capV(z0), capU(x1), capV(z1), 0.5, 0.5);
      const topIndexStart = indices.length;
      indices.push(topBase, topBase + 1, topBase + 2);
      groups.push({
        start: topIndexStart,
        count: 3,
        materialIndex: source.sideMaterialCount,
      });
    }

    if (source.bottomMaterial) {
      const bottomBase = positions.length / 3;
      // Source order: corner, center, next corner; sequential face indices.
      positions.push(x0, yLow, z0, 0, yLow, 0, x1, yLow, z1);
      uvs.push(capU(x0), capV(z0), 0.5, 0.5, capU(x1), capV(z1));
      const bottomIndexStart = indices.length;
      indices.push(bottomBase, bottomBase + 1, bottomBase + 2);
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

  const materials = images.map((image) => {
    const material = new THREE.MeshBasicMaterial({
      map: image ? faceTexture(image.rgba, image.width, image.height) : null,
      color: image ? 0xffffff : horizonColor,
      depthWrite: false,
      depthTest: false,
      fog: false,
      // The DLL emits outward-wound faces; the player views their backs.
      side: THREE.BackSide,
    });
    // A dedicated shader program guarantees the projection uniform is
    // re-uploaded around the sky draw (see the render callbacks below).
    material.customProgramCacheKey = () => 'tt-sky';
    return material;
  });
  const geometry = buildSourceSkyGeometry(source);
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.name = 'TT_SkyAround_Entity';
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;

  // TT Sky's pre-render callback swaps the projection for the sky draw:
  // newFov = fov + (pi - fov) * distortion over the HORIZONTAL fov taken
  // from the live matrix (m00 = cot(fov/2), m11 = m00 * width/height); the
  // post-render callback restores it. This angularly compresses the sky
  // into a distant-dome look and keeps the open rim off screen at gameplay
  // pitches.
  const savedProjection = new THREE.Matrix4();
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    const projection = (camera as THREE.PerspectiveCamera).projectionMatrix;
    savedProjection.copy(projection);
    const elements = projection.elements;
    const m00 = elements[0];
    const m11 = elements[5];
    const horizontalFov = 2 * Math.atan(1 / m00);
    const widened = horizontalFov + (Math.PI - horizontalFov) * source.distortion;
    const widenedM00 = 1 / Math.tan(widened / 2);
    elements[0] = widenedM00;
    elements[5] = widenedM00 * (m11 / m00);
  };
  mesh.onAfterRender = (_renderer, _scene, camera) => {
    (camera as THREE.PerspectiveCamera).projectionMatrix.copy(savedProjection);
  };

  const group = new THREE.Group();
  group.name = 'sky';
  group.renderOrder = -1000;
  group.add(mesh);
  return { group, horizonColor };
}
