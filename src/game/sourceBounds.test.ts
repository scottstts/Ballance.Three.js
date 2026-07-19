import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { describe, expect, it } from 'vitest';
import { sourceEntityObb } from './sourceBounds.ts';

describe('Virtools local-box intersection geometry', () => {
  it('preserves the entity rotation instead of expanding to a world AABB', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 10));
    mesh.rotation.y = Math.PI / 4;
    mesh.updateMatrixWorld(true);

    const volume = sourceEntityObb(mesh, new OBB());
    expect(volume).not.toBeNull();
    if (!volume) return;

    const insideAabbOutsideObb = new OBB(
      new THREE.Vector3(3.5, 0, -3.5),
      new THREE.Vector3(0.1, 0.1, 0.1),
    );
    expect(new THREE.Box3().setFromObject(mesh).containsPoint(insideAabbOutsideObb.center)).toBe(true);
    expect(volume.intersectsOBB(insideAabbOutsideObb)).toBe(false);
  });

  it('uses only the entity mesh when hierarchy is disabled', () => {
    const entity = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    const child = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100));
    entity.add(child);
    entity.updateMatrixWorld(true);

    const bounds = sourceEntityObb(entity, new OBB());
    expect(bounds?.halfSize.toArray()).toEqual([1, 1, 1]);
  });
});

