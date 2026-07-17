/**
 * Ballance skybox: 5 textured faces (no top — the fog color closes the dome).
 * Rendered as a camera-centered cube, unlit, drawn first without depth writes.
 */
import * as THREE from 'three';
import { decodeImageFile } from './textures.ts';

const SIZE = 1500;

function faceTexture(rgba: Uint8ClampedArray, width: number, height: number, mirrorX: boolean): THREE.Texture {
  let pixels = new Uint8Array(rgba.buffer);
  if (mirrorX) {
    // LH->RH conversion mirrors every face; undo it in the texture
    const src = pixels;
    pixels = new Uint8Array(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const s = (y * width + x) * 4;
        const d = (y * width + (width - 1 - x)) * 4;
        pixels[d] = src[s];
        pixels[d + 1] = src[s + 1];
        pixels[d + 2] = src[s + 2];
        pixels[d + 3] = src[s + 3];
      }
    }
  }
  const tex = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  tex.flipY = true; // plane geometry UVs are GL-style bottom-up
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export interface BuiltSky {
  group: THREE.Group;
  /** average horizon color of the sky faces — the level's fog color */
  horizonColor: THREE.Color;
}

export async function buildSky(letter: string, fogColor: THREE.Color): Promise<BuiltSky> {
  const names = ['Front', 'Back', 'Left', 'Right', 'Down'];
  const images = await Promise.all(
    names.map((n) => decodeImageFile(`Textures/Sky/Sky_${letter}_${n}.bmp`).catch(() => null)),
  );

  // sample the bottom rows of the side faces for the fog/horizon color
  const horizonColor = new THREE.Color(0xbed7e3);
  {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const img of images.slice(0, 4)) {
      if (!img) continue;
      const rows = 6;
      for (let y = img.height - rows; y < img.height; y++) {
        for (let x = 0; x < img.width; x += 4) {
          const i = (y * img.width + x) * 4;
          r += img.rgba[i];
          g += img.rgba[i + 1];
          b += img.rgba[i + 2];
          n++;
        }
      }
    }
    if (n > 0) horizonColor.setRGB(r / n / 255, g / n / 255, b / n / 255).convertSRGBToLinear();
  }
  fogColor.copy(horizonColor);

  const group = new THREE.Group();
  group.name = 'sky';
  group.renderOrder = -1000;

  const mk = (img: { rgba: Uint8ClampedArray; width: number; height: number } | null, mirrorX = true) => {
    const mat = new THREE.MeshBasicMaterial({
      map: img ? faceTexture(img.rgba, img.width, img.height, mirrorX) : null,
      color: img ? 0xffffff : fogColor,
      depthWrite: false,
      depthTest: false,
      fog: false,
      side: THREE.FrontSide,
    });
    const geo = new THREE.PlaneGeometry(SIZE * 2, SIZE * 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -1000;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };

  // planes face inward; Virtools "Front" is +Z in LH which maps to -Z in three,
  // and the handedness flip swaps Left/Right and mirrors every face texture
  const front = mk(images[0]);
  front.position.set(0, 0, -SIZE);
  const back = mk(images[1]);
  back.position.set(0, 0, SIZE);
  back.rotation.y = Math.PI;
  const left = mk(images[3]);
  left.position.set(-SIZE, 0, 0);
  left.rotation.y = Math.PI / 2;
  const right = mk(images[2]);
  right.position.set(SIZE, 0, 0);
  right.rotation.y = -Math.PI / 2;
  const down = mk(images[4]);
  down.position.set(0, -SIZE, 0);
  down.rotation.x = -Math.PI / 2;
  // top face: fog-colored cap
  const top = mk(null);
  top.position.set(0, SIZE, 0);
  top.rotation.x = Math.PI / 2;

  return { group, horizonColor };
}
