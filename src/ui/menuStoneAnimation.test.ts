import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { vxPositionToThree } from '../engine/convert.ts';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { Entity3dRec } from '../formats/ck2/types.ts';
import { applyMenuStoneAnimation, decodeMenuStoneAnimationSource } from './menuStoneAnimation.ts';

const menuLevelPath = fileURLToPath(
  new URL('../../Ballance_bin/source1/Ballance/3D Entities/MenuLevel.nmo', import.meta.url),
);

describe.skipIf(!existsSync(menuLevelPath))('source-authored menu stone-ball animation', () => {
  const file = parseNmo(readFileSync(menuLevelPath));
  const source = decodeMenuStoneAnimationSource(file);

  it('retains every recorded linear controller key', () => {
    expect(source.track.name).toBe('Record Anim');
    expect(file.objects[source.track.entityIndex]?.name).toBe('I_Ball_Stone');
    expect(source.track.length).toBe(4445);
    expect(source.track.positionKeys).toHaveLength(4445);
    expect(source.track.rotationKeys).toHaveLength(4445);
    expect(source.track.scaleKeys).toHaveLength(4445);
    expect(source.track.positionKeys[0].time).toBe(0);
    expect(source.track.positionKeys.at(-1)?.time).toBe(4444);
    expect(source.track.rotationKeys.at(-1)?.time).toBe(4444);
    expect(source.track.scaleKeys.at(-1)?.time).toBe(4444);
    expect(source.track.animationFlags).toBe(0);
  });

  it('uses the exact looping Play Animation 3D Entity timing', () => {
    expect(source.durationSeconds).toBe(59.246);
    expect(source.loop).toBe(true);
    expect(source.progression).toEqual([
      [0, 0, 1],
      [1, 1, 1],
    ]);
  });

  it('starts at the serialized I_Ball_Stone transform and wraps exactly', () => {
    const entity = file.objects[source.track.entityIndex] as Entity3dRec;
    const object = new THREE.Object3D();
    applyMenuStoneAnimation(source, 0, object);
    expect(object.position.toArray()).toEqual(vxPositionToThree(entity.worldMatrix).toArray());
    expect(object.quaternion.x).toBeCloseTo(0, 6);
    expect(object.quaternion.y).toBeCloseTo(0, 6);
    expect(object.quaternion.z).toBeCloseTo(0, 6);
    expect(object.quaternion.w).toBeCloseTo(1, 6);
    expect(object.scale.toArray()).toEqual([
      source.track.scaleKeys[0].value[0],
      source.track.scaleKeys[0].value[1],
      source.track.scaleKeys[0].value[2],
    ]);

    const wrapped = new THREE.Object3D();
    applyMenuStoneAnimation(source, source.durationSeconds, wrapped);
    expect(wrapped.matrix.toArray()).toEqual(object.matrix.toArray());
  });
});
