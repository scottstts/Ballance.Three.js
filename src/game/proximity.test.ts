import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ScaleableProximity,
  proximityDistance,
  scaleableProximityFrameDelay,
  type ScaleableProximitySpec,
} from './proximity.ts';

const DLL_PATH = fileURLToPath(
  new URL('../../Ballance_bin/source1/Ballance/BuildingBlocks/TT_Toolbox_RT.dll', import.meta.url),
);

const SPEC: ScaleableProximitySpec = {
  distance: 10,
  exactnessMinDistance: 10,
  exactnessMaxDistance: 20,
  minimumFrameDelay: 2,
  maximumFrameDelay: 6,
  initialFrameDelay: 2,
  axes: 7,
  squaredDistance: false,
};

describe('TT Scaleable Proximity runtime reconstruction', () => {
  it('applies the plugin X/Y/Z bit mask', () => {
    const a = new THREE.Vector3(4, 8, 12);
    const b = new THREE.Vector3(1, 2, 3);
    expect(proximityDistance(a, b, 1)).toBe(3);
    expect(proximityDistance(a, b, 2)).toBe(6);
    expect(proximityDistance(a, b, 4)).toBe(9);
    expect(proximityDistance(a, b, 3)).toBeCloseTo(Math.hypot(3, 6));
    expect(proximityDistance(a, b, 5)).toBeCloseTo(Math.hypot(3, 9));
    expect(proximityDistance(a, b, 7)).toBeCloseTo(Math.hypot(3, 6, 9));
  });

  it('interpolates a deterministic frame delay and truncates toward zero', () => {
    expect(scaleableProximityFrameDelay(5, SPEC)).toBe(2);
    expect(scaleableProximityFrameDelay(15, SPEC)).toBe(4);
    expect(scaleableProximityFrameDelay(20, SPEC)).toBe(6);

    const squared = { ...SPEC, exactnessMinDistance: 10, exactnessMaxDistance: 30, squaredDistance: true };
    // (20²-10²)/(30²-10²)=0.375; 2+trunc(0.375*4)=3.
    expect(scaleableProximityFrameDelay(20, squared)).toBe(3);
  });

  it('uses the serialized counter, a strict threshold, and transition outputs', () => {
    const proximity = new ScaleableProximity(SPEC);
    expect(proximity.updateDistance(9)).toBeNull();
    expect(proximity.updateDistance(9)).toBe('enterRange');
    expect(proximity.updateDistance(10)).toBeNull();
    expect(proximity.updateDistance(10)).toBe('exitRange');
    expect(proximity.updateDistance(9)).toBeNull();
    expect(proximity.updateDistance(9)).toBe('enterRange');
  });

  it('resets Last Check on In while preserving the local countdown', () => {
    const proximity = new ScaleableProximity(SPEC);
    expect(proximity.updateDistance(9)).toBeNull();
    expect(proximity.remainingFrames()).toBe(1);
    proximity.restartTransitionState();
    expect(proximity.remainingFrames()).toBe(1);
    expect(proximity.updateDistance(9)).toBe('enterRange');
  });
});

describe.skipIf(!existsSync(DLL_PATH))('shipped TT Toolbox authority', () => {
  it('serializes the exact axis bit-field mapping used by the runtime', () => {
    const binary = readFileSync(DLL_PATH);
    expect(binary.includes(Buffer.from('X=1,Y=2,Z=4,XY=3,XZ=5,YZ=6,XYZ=7\0'))).toBe(true);
  });
});
