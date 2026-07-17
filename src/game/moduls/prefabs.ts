/**
 * Prefab instantiation from the original PH/*.nmo files.
 * A prefab is a set of named parts positioned relative to its _MF master
 * frame; instances re-root those parts at a placement's world transform.
 */
import * as THREE from 'three';
import { loadNmo } from '../../engine/assets.ts';
import { buildScene } from '../../engine/sceneBuilder.ts';

export interface PrefabPart {
  name: string;
  /** template object (shared geometry/materials) */
  object: THREE.Object3D;
  /** prefab-local matrix (relative to the master frame) */
  local: THREE.Matrix4;
}

export interface Prefab {
  name: string;
  parts: PrefabPart[];
}

const prefabCache = new Map<string, Promise<Prefab>>();

export function loadPrefab(name: string): Promise<Prefab> {
  let p = prefabCache.get(name);
  if (!p) {
    p = loadNmo(`3D Entities/PH/${name}.nmo`)
      .then((file) => buildScene(file))
      .then((built) => {
        const parts: PrefabPart[] = [];
        for (const [entName, e] of built.entities) {
          if (entName.endsWith('_MF') && !(e.object instanceof THREE.Mesh)) continue;
          parts.push({ name: entName, object: e.object, local: e.object.matrix.clone() });
        }
        return { name, parts };
      });
    prefabCache.set(name, p);
  }
  return p;
}

export interface PrefabInstance {
  root: THREE.Group;
  parts: Map<string, THREE.Object3D>;
}

/**
 * Instantiate prefab parts under a group positioned by the placement's
 * world matrix. Parts keep their prefab-local offsets as child transforms.
 */
export function instantiatePrefab(prefab: Prefab, placementMatrix: THREE.Matrix4): PrefabInstance {
  const root = new THREE.Group();
  root.name = `${prefab.name}(inst)`;
  root.matrixAutoUpdate = false;
  root.matrix.copy(placementMatrix);
  root.matrix.decompose(root.position, root.quaternion, root.scale);
  root.updateMatrix();

  const parts = new Map<string, THREE.Object3D>();
  for (const part of prefab.parts) {
    let obj: THREE.Object3D;
    if (part.object instanceof THREE.Mesh) {
      obj = new THREE.Mesh(part.object.geometry, part.object.material);
    } else {
      obj = new THREE.Object3D();
    }
    obj.name = part.name;
    obj.visible = true;
    obj.matrixAutoUpdate = false;
    obj.matrix.copy(part.local);
    obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
    obj.updateMatrix();
    root.add(obj);
    parts.set(part.name, obj);
  }
  return { root, parts };
}
