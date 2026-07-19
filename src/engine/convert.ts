/**
 * Converts parsed CK records into three.js objects.
 * Virtools is left-handed Y-up; three.js right-handed Y-up: negate Z of
 * positions/normals, negate Z row+column of matrices, flip triangle winding.
 */
import * as THREE from 'three';
import type { MaterialRec, MeshRec } from '../formats/ck2/types.ts';

/** `base.cmo` CKScene render setting: 0x000f0f0f. */
export const SCENE_AMBIENT = 15 / 255;

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

export const BLEND_MAP: Record<number, THREE.BlendingDstFactor> = {
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
  /** original texture name */
  textureName?: string;
  /**
   * VX_EFFECT texture-coordinate generation resolved from the material's
   * effect parameter: CK2_3D maps TexGen Type 2 "Reflect" to
   * D3DTSS_TCI_CAMERASPACEREFLECTIONVECTOR and Type 3 "Chrome" to
   * D3DTSS_TCI_CAMERASPACENORMAL, both through diag(0.4,-0.4) + (0.5,0.5).
   */
  effectTexGen?: 'reflect' | 'chrome' | null;
}

/**
 * The single specular light of the fixed-function scene (Light_Ingame plus
 * the per-level tint). Shared uniform objects: addLightRig republishes the
 * live values before each scene build.
 */
const sceneSpecularLight = {
  /** world-space direction the light points at (Virtools forward row, converted) */
  direction: new THREE.Vector3(0.30222097, -0.7331351, -0.60921866),
  color: new THREE.Color(1, 1, 1),
};

export function setSceneSpecularLight(direction: THREE.Vector3, color: THREE.Color): void {
  sceneSpecularLight.direction.copy(direction).normalize();
  sceneSpecularLight.color.copy(color);
}

interface CkShaderPatch {
  texGen?: 'reflect' | 'chrome';
  /** D3D fixed-function VERTEX lighting: specular computed per vertex */
  gouraudSpecular?: { specular: THREE.Color; shininess: number };
}

/**
 * Per-frame camera-space texture generation matching the engine's texgen
 * setup (u = 0.4*x + 0.5, v = -0.4*y + 0.5 over the camera-space normal for
 * Chrome or reflection vector for Reflect), plus D3D's per-VERTEX specular:
 * the fixed-function pipeline lights at vertices and interpolates the
 * specular color, so large flat plates show almost none of the highlight a
 * per-pixel evaluation of the same power would produce. Specular is added
 * after texturing (D3DRS_SPECULARENABLE), using the scene's one specular
 * directional light.
 */
function applyCkShaderPatch(mat: THREE.Material, patch: CkShaderPatch): void {
  const texGen = patch.texGen ?? null;
  const gouraud = patch.gouraudSpecular ?? null;
  mat.onBeforeCompile = (shader) => {
    let vertexDecl = '';
    let vertexMain = '';
    let fragmentDecl = '';
    if (texGen) {
      vertexDecl += 'varying vec2 vTexGenUv;\n';
      fragmentDecl += 'varying vec2 vTexGenUv;\n';
      vertexMain +=
        texGen === 'chrome'
          ? `  vec3 texgenNormal = normalize( normalMatrix * vec3( normal ) );
  vTexGenUv = vec2( 0.4 * texgenNormal.x + 0.5, -0.4 * texgenNormal.y + 0.5 );\n`
          : `  vec3 texgenNormal = normalize( normalMatrix * vec3( normal ) );
  vec3 texgenEye = normalize( mvPosition.xyz );
  vec3 texgenReflected = 2.0 * dot( texgenNormal, texgenEye ) * texgenNormal - texgenEye;
  vTexGenUv = vec2( 0.4 * texgenReflected.x + 0.5, -0.4 * texgenReflected.y + 0.5 );\n`;
    }
    if (gouraud) {
      shader.uniforms.uCkSpecularColor = { value: gouraud.specular };
      shader.uniforms.uCkShininess = { value: gouraud.shininess };
      shader.uniforms.uCkLightDirection = { value: sceneSpecularLight.direction };
      shader.uniforms.uCkLightColor = { value: sceneSpecularLight.color };
      vertexDecl +=
        'uniform vec3 uCkSpecularColor;\nuniform float uCkShininess;\nuniform vec3 uCkLightDirection;\nuniform vec3 uCkLightColor;\nvarying vec3 vCkSpecular;\n';
      fragmentDecl += 'varying vec3 vCkSpecular;\n';
      vertexMain += `  vec3 ckNormal = normalize( normalMatrix * vec3( normal ) );
  vec3 ckToLight = normalize( ( viewMatrix * vec4( -uCkLightDirection, 0.0 ) ).xyz );
  vec3 ckToView = normalize( -mvPosition.xyz );
  vec3 ckHalf = normalize( ckToLight + ckToView );
  vCkSpecular = uCkLightColor * uCkSpecularColor * pow( max( dot( ckNormal, ckHalf ), 0.0 ), uCkShininess );\n`;
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertexDecl}`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>\n{\n${vertexMain}}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${fragmentDecl}`);
    if (texGen) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
  diffuseColor *= texture2D( map, vTexGenUv );
#endif`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#ifdef USE_EMISSIVEMAP
  totalEmissiveRadiance *= texture2D( emissiveMap, vTexGenUv ).rgb;
#endif`,
        );
    }
    if (gouraud) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        'outgoingLight += vCkSpecular;\n#include <opaque_fragment>',
      );
    }
  };
  mat.customProgramCacheKey = () => `ck-${texGen ?? 'none'}-${gouraud ? 'gouraud' : 'plain'}`;
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
    // D3D fixed-function lighting keeps a separate per-material ambient.
    // Three's AmbientLight would multiply the diffuse color instead, so fold
    // the exact sceneAmbient * materialAmbient term into the texture-modulated
    // emissive term. specularPower 0 disables specular entirely.
    const specOn = !!rec && rec.specularPower > 0;
    const emissive = rec
      ? new THREE.Color(
          rec.emissive[0] + rec.ambient[0] * SCENE_AMBIENT,
          rec.emissive[1] + rec.ambient[1] * SCENE_AMBIENT,
          rec.emissive[2] + rec.ambient[2] * SCENE_AMBIENT,
        )
      : new THREE.Color(0, 0, 0);
    mat = new THREE.MeshPhongMaterial({
      ...common,
      color: new THREE.Color(diffuse[0], diffuse[1], diffuse[2]),
      emissive,
      emissiveMap: texture,
      // Specular renders through the D3D per-vertex patch below; three's
      // per-pixel term stays disabled.
      specular: new THREE.Color(0, 0, 0),
      shininess: specOn ? rec.specularPower : 30,
    });
    const patch: { texGen?: 'reflect' | 'chrome'; gouraudSpecular?: { specular: THREE.Color; shininess: number } } = {};
    if (texture && opts.effectTexGen) patch.texGen = opts.effectTexGen;
    if (specOn && rec) {
      patch.gouraudSpecular = {
        specular: new THREE.Color(rec.specular[0], rec.specular[1], rec.specular[2]),
        shininess: rec.specularPower,
      };
    }
    if (patch.texGen || patch.gouraudSpecular) applyCkShaderPatch(mat, patch);
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
  // Prelit meshes carry baked lighting; only their texgen needs the patch.
  if (prelit && texture && opts.effectTexGen) applyCkShaderPatch(mat, { texGen: opts.effectTexGen });
  return mat;
}

/** CKSprite3D uses the same CKMaterial state but must remain camera-facing. */
export function spriteMaterialToThree(rec: MaterialRec | null, opts: MaterialBuildOptions): THREE.SpriteMaterial {
  const diffuse = rec?.diffuse ?? [1, 1, 1, 1];
  const transparent = !!rec?.alphaBlend || diffuse[3] < 1 || !!opts.colorKeyed;
  const mat = new THREE.SpriteMaterial({
    map: opts.texture,
    color: new THREE.Color(diffuse[0], diffuse[1], diffuse[2]),
    opacity: diffuse[3],
    transparent,
    depthWrite: rec?.zWrite ?? true,
    alphaTest: opts.colorKeyed ? 0.5 : rec?.alphaTest ? rec.alphaRef / 255 : 0,
  });
  if (rec?.alphaBlend) {
    mat.blending = THREE.CustomBlending;
    mat.blendEquation = THREE.AddEquation;
    mat.blendSrc = BLEND_MAP[rec.sourceBlend] ?? THREE.SrcAlphaFactor;
    mat.blendDst = BLEND_MAP[rec.destBlend] ?? THREE.OneMinusSrcAlphaFactor;
  }
  return mat;
}
