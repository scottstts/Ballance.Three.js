import { describe, expect, it } from 'vitest';
import { buildSourceSkyGeometry, MENU_SKY_SOURCE } from './sky.ts';

describe('TT SkyAround procedural mesh', () => {
  it('matches the shipped four-side plus bottom-fan topology', () => {
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

    const halfHeight = Math.SQRT2 * MENU_SKY_SOURCE.radius * 0.5;
    expect(Array.from(positions.array.slice(0, 21))).toEqual([
      70, -halfHeight, 0,
      expect.closeTo(0, 5), -halfHeight, -70,
      expect.closeTo(0, 5), halfHeight, -70,
      70, halfHeight, 0,
      0, -halfHeight, 0,
      70, -halfHeight, 0,
      expect.closeTo(0, 5), -halfHeight, -70,
    ]);
    expect(Array.from(uvs.array.slice(0, 14))).toEqual([
      1, 1, 0, 1, 0, 0, 1, 0,
      0.5, 0.5, 1, 0.5, 0.5, 1,
    ]);
    expect(Array.from(index?.array.slice(0, 9) ?? [])).toEqual([2, 0, 1, 2, 3, 0, 6, 5, 4]);
  });
});
