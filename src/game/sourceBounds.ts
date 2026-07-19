/**
 * Virtools CKCollisionManager box tests use each entity's local mesh bounds
 * transformed by its world matrix (an OBB), unless the caller explicitly asks
 * for the cheaper world box. Ballance's fan asks for local boxes on both sides.
 */
import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';

/** Build an OBB from an entity's own mesh only; hierarchy traversal is opt-in in Virtools. */
export function sourceEntityObb(
  entity: THREE.Object3D,
  target: OBB,
  worldMatrix: THREE.Matrix4 = entity.matrixWorld,
): OBB | null {
  if (!(entity instanceof THREE.Mesh)) return null;
  if (!entity.geometry.boundingBox) entity.geometry.computeBoundingBox();
  const bounds = entity.geometry.boundingBox;
  if (!bounds || bounds.isEmpty()) return null;
  return target.fromBox3(bounds).applyMatrix4(worldMatrix);
}
