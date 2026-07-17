/**
 * Builds a three.js scene graph from a parsed NMO file, resolving mesh /
 * material / texture references and Virtools->three coordinate conversion.
 */
import * as THREE from 'three';
import type { Entity3dRec, GroupRec, MaterialRec, MeshRec, NmoFile, TextureRec } from '../formats/ck2/types.ts';
import { MESH_FLAG_PRELIT } from '../formats/ck2/types.ts';
import { materialToThree, meshToGeometry, vxMatrixToThree } from './convert.ts';
import { loadCkTexture } from './textures.ts';

export interface BuiltEntity {
  rec: Entity3dRec;
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
    });
    mat.name = rec?.name ?? `mtl-${mtlIndex}`;
    materialCache.set(key, mat);
    return mat;
  };

  const entities = new Map<string, BuiltEntity>();
  const entitiesByIndex = new Map<number, BuiltEntity>();

  for (const rec of file.entities) {
    let object: THREE.Mesh | THREE.Object3D;
    if (rec.meshIndex >= 0) {
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
