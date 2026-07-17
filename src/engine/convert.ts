/**
 * Converts parsed CK records into three.js objects.
 * Virtools is left-handed Y-up; three.js right-handed Y-up: negate Z of
 * positions/normals, negate Z row+column of matrices, flip triangle winding.
 */
import * as THREE from 'three';
import type { MaterialRec, MeshRec } from '../formats/ck2/types.ts';

/** Virtools row-vector matrix (rows: right/up/forward/pos) -> three column-vector matrix in RH space. */
export function vxMatrixToThree(m: Float32Array, out = new THREE.Matrix4()): THREE.Matrix4 {
  out.set(
    m[0], m[4], -m[8], m[12],
    m[1], m[5], -m[9], m[13],
    -m[2], -m[6], m[10], -m[14],
    0, 0, 0, 1,
  );
  return out;
}

export function vxPositionToThree(m: Float32Array): THREE.Vector3 {
  return new THREE.Vector3(m[12], m[13], -m[14]);
}

export function meshToGeometry(mesh: MeshRec): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const n = mesh.vertexCount;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = mesh.positions[i * 3];
    positions[i * 3 + 1] = mesh.positions[i * 3 + 1];
    positions[i * 3 + 2] = -mesh.positions[i * 3 + 2];
    normals[i * 3] = mesh.normals[i * 3];
    normals[i * 3 + 1] = mesh.normals[i * 3 + 1];
    normals[i * 3 + 2] = -mesh.normals[i * 3 + 2];
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs.slice(), 2));

  if (mesh.colors) {
    // D3D ARGB dword -> little-endian bytes B,G,R,A
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const c = mesh.colors[i];
      colors[i * 3] = ((c >>> 16) & 0xff) / 255;
      colors[i * 3 + 1] = ((c >>> 8) & 0xff) / 255;
      colors[i * 3 + 2] = (c & 0xff) / 255;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  // winding flip for handedness change; group faces by material slot
  const order = sortFacesByMaterial(mesh);
  const indices = new Uint16Array(mesh.faceCount * 3);
  let w = 0;
  for (const f of order) {
    indices[w++] = mesh.faceIndices[f * 3];
    indices[w++] = mesh.faceIndices[f * 3 + 2];
    indices[w++] = mesh.faceIndices[f * 3 + 1];
  }
  geo.setIndex(new THREE.BufferAttribute(indices, 1));

  // build geometry groups per material slot
  let start = 0;
  let currentMtl = order.length ? mesh.faceMaterials[order[0]] : 0;
  for (let i = 0; i <= order.length; i++) {
    const mtl = i < order.length ? mesh.faceMaterials[order[i]] : -1;
    if (mtl !== currentMtl) {
      geo.addGroup(start * 3, (i - start) * 3, currentMtl);
      start = i;
      currentMtl = mtl;
    }
  }
  return geo;
}

function sortFacesByMaterial(mesh: MeshRec): number[] {
  const order = Array.from({ length: mesh.faceCount }, (_, i) => i);
  order.sort((a, b) => mesh.faceMaterials[a] - mesh.faceMaterials[b] || a - b);
  return order;
}

const BLEND_MAP: Record<number, THREE.BlendingDstFactor> = {
  1: THREE.ZeroFactor,
  2: THREE.OneFactor,
  3: THREE.SrcColorFactor,
  4: THREE.OneMinusSrcColorFactor,
  5: THREE.SrcAlphaFactor,
  6: THREE.OneMinusSrcAlphaFactor,
  7: THREE.DstAlphaFactor,
  8: THREE.OneMinusDstAlphaFactor,
  9: THREE.DstColorFactor,
  10: THREE.OneMinusDstColorFactor,
};

export interface MaterialBuildOptions {
  prelit: boolean;
  texture: THREE.Texture | null;
  /** texture uses color-key transparency (needs alpha cutout) */
  colorKeyed?: boolean;
}

export function materialToThree(rec: MaterialRec | null, opts: MaterialBuildOptions): THREE.Material {
  const { prelit, texture } = opts;
  const diffuse = rec?.diffuse ?? [1, 1, 1, 1];
  const common = {
    map: texture,
    side: rec?.twoSided ? THREE.DoubleSide : THREE.FrontSide,
    vertexColors: prelit,
  } as const;

  let mat: THREE.MeshPhongMaterial | THREE.MeshBasicMaterial;
  if (prelit) {
    mat = new THREE.MeshBasicMaterial({ ...common, color: new THREE.Color(1, 1, 1) });
  } else {
    mat = new THREE.MeshPhongMaterial({
      ...common,
      color: new THREE.Color(diffuse[0], diffuse[1], diffuse[2]),
      emissive: rec ? new THREE.Color(rec.emissive[0], rec.emissive[1], rec.emissive[2]) : new THREE.Color(0, 0, 0),
      specular: rec ? new THREE.Color(rec.specular[0] * 0.5, rec.specular[1] * 0.5, rec.specular[2] * 0.5) : new THREE.Color(0, 0, 0),
      shininess: rec?.specularPower && rec.specularPower > 0 ? rec.specularPower : 1,
    });
  }

  const opacity = diffuse[3];
  if (rec?.alphaBlend) {
    mat.transparent = true;
    mat.blending = THREE.CustomBlending;
    mat.blendEquation = THREE.AddEquation;
    mat.blendSrc = BLEND_MAP[rec.sourceBlend] ?? THREE.SrcAlphaFactor;
    mat.blendDst = BLEND_MAP[rec.destBlend] ?? THREE.OneMinusSrcAlphaFactor;
    mat.depthWrite = rec.zWrite;
    mat.opacity = opacity;
  } else if (opacity < 1) {
    mat.transparent = true;
    mat.opacity = opacity;
    if (rec) mat.depthWrite = rec.zWrite;
  } else if (rec && !rec.zWrite) {
    mat.depthWrite = false;
  }
  if (rec?.alphaTest && rec.alphaRef > 0) {
    mat.alphaTest = rec.alphaRef / 255;
  } else if (texture && opts.colorKeyed) {
    // color-keyed textures need a cutout to avoid dark fringes
    mat.alphaTest = 0.5;
  }
  return mat;
}
