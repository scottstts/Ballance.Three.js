/**
 * Builds a three.js scene graph from a parsed NMO file, resolving mesh /
 * material / texture references and Virtools->three coordinate conversion.
 */
import * as THREE from 'three';
import type { Entity3dLikeRec, GroupRec, MaterialRec, MeshRec, NmoFile, TextureRec } from '../formats/ck2/types.ts';
import { MESH_FLAG_PRELIT } from '../formats/ck2/types.ts';
import { BLEND_MAP, materialToThree, meshToGeometry, spriteMaterialToThree, vxMatrixToThree } from './convert.ts';

/** CK VXBLEND enum values map through the shared factor table. */
const CHANNEL_BLEND_MAP = BLEND_MAP;
import { loadCkTexture } from './textures.ts';

export interface BuiltEntity {
  rec: Entity3dLikeRec;
  object: THREE.Mesh | THREE.Object3D;
}

export interface BuiltScene {
  root: THREE.Group;
  entities: Map<string, BuiltEntity>;
  entitiesByIndex: Map<number, BuiltEntity>;
  groups: Map<string, GroupRec>;
  file: NmoFile;
}

export async function buildScene(file: NmoFile): Promise<BuiltScene> {
  const root = new THREE.Group();
  root.name = 'nmo-root';

  // resolve textures first (async decode)
  const texturePromises = new Map<number, Promise<THREE.Texture | null>>();
  for (const obj of file.objects) {
    if (obj.kind === 'texture') {
      const p = loadCkTexture(obj);
      texturePromises.set(obj.index, p ? p.catch(() => null) : Promise.resolve(null));
    }
  }
  const textures = new Map<number, THREE.Texture | null>();
  for (const [idx, p] of texturePromises) textures.set(idx, await p);

  const geometryCache = new Map<number, THREE.BufferGeometry>();
  const materialCache = new Map<string, THREE.Material>();

  /**
   * VX_EFFECT resolution: the effect parameter's TexGen Type selects Reflect
   * (2) or Chrome (3). The one shipped TexGen-with-referential material
   * (I_DomeEnvironment) serializes a NULL referential = camera, type Reflect.
   */
  const texGenOf = (rec: MaterialRec | null): 'reflect' | 'chrome' | null => {
    if (!rec || rec.effect === 0) return null;
    if (rec.effect === 2) return 'reflect';
    const parameter = rec.effectParameterIndex >= 0 ? file.objects[rec.effectParameterIndex] : null;
    if (parameter?.kind === 'parameter' && parameter.valueBytes && parameter.valueBytes.length >= 4) {
      const type = new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset).getInt32(0, true);
      if (type === 3) return 'chrome';
      if (type === 2) return 'reflect';
    }
    return null;
  };

  const getMaterial = (mtlIndex: number, prelit: boolean): THREE.Material => {
    const key = `${mtlIndex}|${prelit ? 1 : 0}`;
    let mat = materialCache.get(key);
    if (mat) return mat;
    const rec = mtlIndex >= 0 ? (file.objects[mtlIndex] as MaterialRec) : null;
    const texRec = rec && rec.textureIndex >= 0 ? (file.objects[rec.textureIndex] as TextureRec) : null;
    const texture = texRec ? (textures.get(texRec.index) ?? null) : null;
    mat = materialToThree(rec && rec.kind === 'material' ? rec : null, {
      prelit,
      texture,
      colorKeyed: !!texRec?.transparent,
      textureName: texRec?.fileNames.find(Boolean) ?? texRec?.name,
      effectTexGen: texGenOf(rec && rec.kind === 'material' ? rec : null),
    });
    mat.name = rec?.name ?? `mtl-${mtlIndex}`;
    materialCache.set(key, mat);
    return mat;
  };

  /** CKMesh material channel: an extra pass blended over the base result. */
  const getChannelMaterial = (mtlIndex: number, sourceBlend: number, destBlend: number): THREE.Material => {
    const key = `channel|${mtlIndex}|${sourceBlend}|${destBlend}`;
    const cached = materialCache.get(key);
    if (cached) return cached;
    const rec = mtlIndex >= 0 ? (file.objects[mtlIndex] as MaterialRec) : null;
    const texRec = rec && rec.textureIndex >= 0 ? (file.objects[rec.textureIndex] as TextureRec) : null;
    const texture = texRec ? (textures.get(texRec.index) ?? null) : null;
    const mat = materialToThree(rec && rec.kind === 'material' ? rec : null, {
      prelit: false,
      texture,
      colorKeyed: false,
      textureName: texRec?.fileNames.find(Boolean) ?? texRec?.name,
      effectTexGen: texGenOf(rec && rec.kind === 'material' ? rec : null),
    });
    mat.name = `${rec?.name ?? `mtl-${mtlIndex}`} (channel)`;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.blending = THREE.CustomBlending;
    mat.blendEquation = THREE.AddEquation;
    mat.blendSrc = CHANNEL_BLEND_MAP[sourceBlend] ?? THREE.ZeroFactor;
    mat.blendDst = CHANNEL_BLEND_MAP[destBlend] ?? THREE.SrcColorFactor;
    materialCache.set(key, mat);
    return mat;
  };

  const getSpriteMaterial = (mtlIndex: number, uv: [number, number, number, number]): THREE.SpriteMaterial => {
    const key = `sprite|${mtlIndex}|${uv.join(',')}`;
    const cached = materialCache.get(key);
    if (cached instanceof THREE.SpriteMaterial) return cached;
    const rec = mtlIndex >= 0 ? (file.objects[mtlIndex] as MaterialRec) : null;
    const texRec = rec && rec.textureIndex >= 0 ? (file.objects[rec.textureIndex] as TextureRec) : null;
    let texture = texRec ? (textures.get(texRec.index) ?? null) : null;
    if (texture && (uv[0] !== 0 || uv[1] !== 0 || uv[2] !== 1 || uv[3] !== 1)) {
      texture = texture.clone();
      texture.offset.set(uv[0], uv[1]);
      texture.repeat.set(uv[2] - uv[0], uv[3] - uv[1]);
      texture.needsUpdate = true;
    }
    const mat = spriteMaterialToThree(rec?.kind === 'material' ? rec : null, {
      prelit: true,
      texture,
      colorKeyed: !!texRec?.transparent,
      textureName: texRec?.fileNames.find(Boolean) ?? texRec?.name,
    });
    mat.name = rec?.name ?? `sprite-mtl-${mtlIndex}`;
    materialCache.set(key, mat);
    return mat;
  };

  const entities = new Map<string, BuiltEntity>();
  const entitiesByIndex = new Map<number, BuiltEntity>();

  for (const rec of file.entities) {
    let object: THREE.Mesh | THREE.Object3D;
    if (rec.kind === 'sprite3d') {
      object = new THREE.Sprite(getSpriteMaterial(rec.materialIndex, rec.uvRect));
    } else if (rec.meshIndex >= 0) {
      const meshRec = file.objects[rec.meshIndex] as MeshRec;
      if (meshRec.kind === 'mesh' && meshRec.vertexCount > 0) {
        let geo = geometryCache.get(rec.meshIndex);
        if (!geo) {
          geo = meshToGeometry(meshRec);
          geo.name = meshRec.name;
          geometryCache.set(rec.meshIndex, geo);
        }
        const prelit = (meshRec.flags & MESH_FLAG_PRELIT) !== 0;
        const slots = meshRec.materialSlots.length ? meshRec.materialSlots : [-1];
        const materials = slots.map((slotIdx) => getMaterial(slotIdx, prelit));
        const mesh = new THREE.Mesh(geo, materials.length === 1 ? materials[0] : materials);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        // Material channels render the same geometry again with the channel
        // material blended over the base pass (dome/UFO environment overlay).
        for (const channel of meshRec.channels) {
          const overlay = new THREE.Mesh(geo, getChannelMaterial(channel.materialIndex, channel.sourceBlend, channel.destBlend));
          overlay.name = `${meshRec.name} (channel)`;
          overlay.renderOrder = 1;
          mesh.add(overlay);
        }
        object = mesh;
      } else {
        object = new THREE.Object3D();
      }
    } else {
      object = new THREE.Object3D();
    }
    object.name = rec.name;
    object.visible = rec.visible;
    object.matrixAutoUpdate = false;
    vxMatrixToThree(rec.worldMatrix, object.matrix);
    object.matrix.decompose(object.position, object.quaternion, object.scale);
    if (rec.kind === 'sprite3d') object.scale.multiply(new THREE.Vector3(rec.size[0], rec.size[1], 1));
    object.updateMatrix();
    root.add(object);
    const built: BuiltEntity = { rec, object };
    if (rec.name) entities.set(rec.name, built);
    entitiesByIndex.set(rec.index, built);
  }

  const groups = new Map<string, GroupRec>();
  for (const g of file.groups) groups.set(g.name, g);

  return { root, entities, entitiesByIndex, groups, file };
}

/** All entity objects that belong to a named group. */
export function groupEntities(scene: BuiltScene, groupName: string): BuiltEntity[] {
  const g = scene.groups.get(groupName);
  if (!g) return [];
  const out: BuiltEntity[] = [];
  for (const idx of g.memberIndices) {
    const e = scene.entitiesByIndex.get(idx);
    if (e) out.push(e);
  }
  return out;
}

/**
 * Levelinit's `set Env. Mapping` runs TT_ReflectionMapping once over every
 * Phys_FloorRails member: a one-shot CPU bake of the mesh base UVs from the
 * invisible FixCube at the world origin. Per vertex in entity-local space:
 * V = normalize(camLocal - position), R = normalize(2*(N.V)*N - V),
 * u = (R.x+1)/2 and v = (R.z+1)/2. Level rails therefore carry a STATIC
 * origin-baked reflection, not a live camera-tracking effect. In the port's
 * mirrored-Z space R.x is unchanged and R.z flips sign, so v = (1-R.z)/2.
 * Shared meshes are re-baked per member; the last group member wins, exactly
 * like the source. Runs for level scenes only (menu rails use live Chrome).
 */
export function bakeRailEnvironmentUvs(scene: BuiltScene): void {
  const inverse = new THREE.Matrix4();
  const camLocal = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const reflected = new THREE.Vector3();
  for (const entry of groupEntities(scene, 'Phys_FloorRails')) {
    const mesh = entry.object;
    if (!(mesh instanceof THREE.Mesh)) continue;
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const uvs = geometry.getAttribute('uv');
    if (!positions || !normals || !uvs) continue;
    mesh.updateWorldMatrix(true, false);
    inverse.copy(mesh.matrixWorld).invert();
    camLocal.set(0, 0, 0).applyMatrix4(inverse);
    for (let i = 0; i < positions.count; i++) {
      toCam
        .set(camLocal.x - positions.getX(i), camLocal.y - positions.getY(i), camLocal.z - positions.getZ(i))
        .normalize();
      normal.set(normals.getX(i), normals.getY(i), normals.getZ(i)).normalize();
      reflected
        .copy(normal)
        .multiplyScalar(2 * normal.dot(toCam))
        .sub(toCam)
        .normalize();
      uvs.setXY(i, (reflected.x + 1) * 0.5, (1 - reflected.z) * 0.5);
    }
    uvs.needsUpdate = true;
  }
}
