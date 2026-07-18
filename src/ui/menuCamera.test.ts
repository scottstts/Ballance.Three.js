import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { CameraRec, CurvePointRec, CurveRec, WaveSoundRec } from '../formats/ck2/types.ts';
import { decodeMenuCameraSource, menuCameraProgress, sampleMenuCameraPath } from './menuCamera.ts';

const menuLevelPath = fileURLToPath(
  new URL('../../Ballance_bin/source1/Ballance/3D Entities/MenuLevel.nmo', import.meta.url),
);

describe.skipIf(!existsSync(menuLevelPath))('source-authored menu backdrop', () => {
  const file = parseNmo(readFileSync(menuLevelPath));
  const source = decodeMenuCameraSource(file);

  it('uses the target-camera projection and 44-second looping progression', () => {
    const camera = file.byName
      .get('Cam_MenuLevel')
      ?.find((record): record is CameraRec => record.kind === 'entity' && 'fieldOfView' in record);

    expect(camera?.projectionType).toBe(1);
    expect(source.fieldOfViewDegrees).toBeCloseTo(54.4322227, 6);
    expect(source.aspectRatio).toBe(4 / 3);
    expect(source.nearPlane).toBe(20);
    expect(source.farPlane).toBe(550);
    expect(source.target.toArray()).toEqual([0, 0, -0]);
    expect(source.durationSeconds).toBe(44);
    expect(source.progression).toEqual([
      [0, 0, 1],
      [1, 1, 1],
    ]);
    expect(menuCameraProgress(source, 11)).toBeCloseTo(0.25, 10);
    expect(menuCameraProgress(source, 44)).toBe(0);
  });

  it('uses all four closed CKCurve points and their saved tangents', () => {
    const curve = file.byName
      .get('I_MenuLevel_Curve')
      ?.find((record): record is CurveRec => record.kind === 'curve');
    const points = curve?.pointIndices.map((index) => file.objects[index] as CurvePointRec);

    expect(curve?.open).toBe(false);
    expect(curve?.stepCount).toBe(100);
    expect(curve?.fittingCoefficient).toBe(0);
    expect(curve?.pointIndices).toEqual([499, 500, 501, 498]);
    expect(points?.map((point) => point.continuity)).toEqual([
      -0.6000000238418579,
      -0.6000000238418579,
      -0.6000000238418579,
      -0.6000000238418579,
    ]);
    expect(source.points).toHaveLength(4);
    expect(sampleMenuCameraPath(source, 0).toArray()).toEqual(source.points[0].position.toArray());
    expect(sampleMenuCameraPath(source, 0.25).toArray()).toEqual(source.points[1].position.toArray());
    expect(sampleMenuCameraPath(source, 0.5).toArray()).toEqual(source.points[2].position.toArray());
    expect(sampleMenuCameraPath(source, 0.75).toArray()).toEqual(source.points[3].position.toArray());
    expect(sampleMenuCameraPath(source, 1).toArray()).toEqual(source.points[0].position.toArray());
  });

  it('keeps the one-shot atmosphere sound at its serialized gain', () => {
    const atmo = file.byName
      .get('Menu_atmo')
      ?.find((record): record is WaveSoundRec => record.kind === 'waveSound');

    expect(atmo?.fileName).toBe('Menu_atmo.wav');
    expect(atmo?.waveType).toBe(1);
    expect(atmo?.loop).toBe(false);
    expect(atmo?.soundLengthMs).toBe(15952);
    expect(atmo?.gain).toBe(1);
    expect(atmo?.pitch).toBe(1);
  });
});
