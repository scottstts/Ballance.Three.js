import { describe, expect, it } from 'vitest';
import { buildSourceSkyGeometry, GAMEPLAY_SKY_SOURCE, MENU_SKY_SOURCE } from './sky.ts';

describe('TT Sky procedural mesh (TT_Gravity_RT recovery)', () => {
  it('matches the shipped four-side plus bottom-fan topology with the 5pi/4 offset', () => {
    const geometry = buildSourceSkyGeometry(MENU_SKY_SOURCE);
    const positions = geometry.getAttribute('position');
    const uvs = geometry.getAttribute('uv');
    const index = geometry.getIndex();

    // Four sectors, each with four side and three bottom vertices.
    expect(positions.count).toBe(28);
    expect(uvs.count).toBe(28);
    expect(index?.count).toBe(36);
    expect(geometry.groups.map(({ start, count, materialIndex }) => [start, count, materialIndex])).toEqual([
      [0, 6, 0], [6, 3, 4],
      [9, 6, 1], [15, 3, 4],
      [18, 6, 2], [24, 3, 4],
      [27, 6, 3], [33, 3, 4],
    ]);

    // Sector angles carry the DLL's 5pi/4 offset (0x407B53D2): the first
    // sector spans 225..315 degrees, so its wall faces original -Z = port +Z
    // and every corner sits at (+-r/sqrt2, ., +-r/sqrt2).
    const radius = MENU_SKY_SOURCE.radius;
    const halfHeight = Math.SQRT2 * radius * 0.5;
    const corner = radius / Math.SQRT2;
    const expected = [
      [-corner, -halfHeight, corner],
      [corner, -halfHeight, corner],
      [corner, halfHeight, corner],
      [-corner, halfHeight, corner],
    ];
    for (let i = 0; i < 4; i++) {
      expect(positions.getX(i)).toBeCloseTo(expected[i][0], 3);
      expect(positions.getY(i)).toBeCloseTo(expected[i][1], 3);
      expect(positions.getZ(i)).toBeCloseTo(expected[i][2], 3);
    }
    // First sector wall midpoint faces port +Z (original -Z = the Back face).
    const midZ = (positions.getZ(0) + positions.getZ(1)) / 2;
    expect(midZ).toBeGreaterThan(0);
    expect(Math.abs((positions.getX(0) + positions.getX(1)) / 2)).toBeLessThan(1e-4);

    // Side UVs unchanged; bottom fan is (corner, center, next) with the
    // 0.70710 cap scale and mirrored-z-cancelled V.
    expect(Array.from(uvs.array.slice(0, 8))).toEqual([1, 1, 0, 1, 0, 0, 1, 0]);
    const capScale = 0.707099974155426;
    const bottomBase = 4;
    expect(uvs.getX(bottomBase)).toBeCloseTo((positions.getX(bottomBase) / radius) * capScale + 0.5, 6);
    expect(uvs.getY(bottomBase)).toBeCloseTo((positions.getZ(bottomBase) / radius) * capScale + 0.5, 6);
    expect(uvs.getX(bottomBase + 1)).toBeCloseTo(0.5, 6);
    expect(uvs.getY(bottomBase + 1)).toBeCloseTo(0.5, 6);
    expect(Array.from(index?.array.slice(0, 9) ?? [])).toEqual([2, 0, 1, 2, 3, 0, 4, 5, 6]);

    // Diagonal corners land on the 0/1 UV edges via the cap scale.
    expect((corner / radius) * capScale + 0.5).toBeCloseTo(1, 4);
    expect((-corner / radius) * capScale + 0.5).toBeCloseTo(0, 4);
  });

  it('keeps the quadratic chord height for the gameplay radius', () => {
    const geometry = buildSourceSkyGeometry(GAMEPLAY_SKY_SOURCE);
    const positions = geometry.getAttribute('position');
    let maxY = -Infinity;
    for (let i = 0; i < positions.count; i++) maxY = Math.max(maxY, positions.getY(i));
    expect(maxY).toBeCloseTo((Math.SQRT2 * GAMEPLAY_SKY_SOURCE.radius) / 2, 4);
  });
});
