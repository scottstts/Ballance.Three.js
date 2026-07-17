/**
 * Ballance skybox: 5 textured faces (no top — the fog color closes the dome).
 * Rendered as a camera-centered cube, unlit, drawn first without depth writes.
 */
import * as THREE from 'three';
import { decodeImageFile } from './textures.ts';

const SIZE = 1500;

function faceTexture(rgba: Uint8ClampedArray, width: number, height: number): THREE.Texture {
  const tex = new THREE.DataTexture(new Uint8Array(rgba.buffer), width, height, THREE.RGBAFormat);
  tex.flipY = true; // plane geometry UVs are GL-style bottom-up
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export async function buildSky(letter: string, fogColor: THREE.Color): Promise<THREE.Group> {
  const names = ['Front', 'Back', 'Left', 'Right', 'Down'];
  const images = await Promise.all(
    names.map((n) => decodeImageFile(`Textures/Sky/Sky_${letter}_${n}.bmp`).catch(() => null)),
  );
  const group = new THREE.Group();
  group.name = 'sky';
  group.renderOrder = -1000;

  const mk = (img: { rgba: Uint8ClampedArray; width: number; height: number } | null) => {
    const mat = new THREE.MeshBasicMaterial({
      map: img ? faceTexture(img.rgba, img.width, img.height) : null,
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

  // planes face inward; Virtools "Front" is +Z in LH which maps to -Z in three
  const front = mk(images[0]);
  front.position.set(0, 0, -SIZE);
  const back = mk(images[1]);
  back.position.set(0, 0, SIZE);
  back.rotation.y = Math.PI;
  const left = mk(images[2]);
  left.position.set(-SIZE, 0, 0);
  left.rotation.y = Math.PI / 2;
  const right = mk(images[3]);
  right.position.set(SIZE, 0, 0);
  right.rotation.y = -Math.PI / 2;
  const down = mk(images[4]);
  down.position.set(0, -SIZE, 0);
  down.rotation.x = -Math.PI / 2;
  down.rotation.z = Math.PI;
  // top face: fog-colored cap
  const top = mk(null);
  top.position.set(0, SIZE, 0);
  top.rotation.x = Math.PI / 2;

  return group;
}
