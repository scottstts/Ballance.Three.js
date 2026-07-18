import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { gameAssetUrl } from './assets.ts';

interface ManifestAsset {
  source: string;
  bundled: string;
  encoding: 'source-exact' | 'lossless-png';
  sha256: string;
  decodedRgbaSha256?: string;
}

interface RuntimeManifest {
  authority: string;
  assets: ManifestAsset[];
  derived: { bundled: string; sha256: string; decodedRgbaSha256: string };
}

const manifestPath = fileURLToPath(new URL('../../public/game/_manifest.json', import.meta.url));
const publicDir = dirname(dirname(manifestPath));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RuntimeManifest;
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

describe('deployable runtime assets', () => {
  it('maps case-insensitive source paths into the static lower-case tree', () => {
    expect(gameAssetUrl('3D Entities/Level/Level_01.NMO')).toMatch(/\/game\/3d%20entities\/level\/level_01\.nmo$/);
    expect(gameAssetUrl('Textures\\Sky\\Sky_A_Back.bmp')).toMatch(
      /\/game\/textures\/sky\/sky_a_back\.bmp\.png$/,
    );
    expect(gameAssetUrl('Sounds/Misc_Lightning.wav')).toMatch(/\/game\/sounds\/misc_lightning\.wav$/);
  });

  it('ships all levels, source-backed prefabs, sounds, textures, and text', () => {
    expect(manifest.authority).toBe('Ballance_bin/source1/Ballance');
    expect(manifest.assets).toHaveLength(317);
    for (let level = 1; level <= 12; level++) {
      expect(manifest.assets.some((asset) => asset.bundled === `3d entities/level/level_${String(level).padStart(2, '0')}.nmo`)).toBe(
        true,
      );
    }
    expect(manifest.assets.filter((asset) => asset.bundled.startsWith('3d entities/ph/'))).toHaveLength(26);
    expect(manifest.assets.filter((asset) => asset.bundled.startsWith('sounds/'))).toHaveLength(62);
    expect(manifest.assets.filter((asset) => asset.encoding === 'lossless-png')).toHaveLength(184);
    expect(
      manifest.assets
        .filter((asset) => asset.encoding === 'lossless-png')
        .every((asset) => /^[0-9a-f]{64}$/.test(asset.decodedRgbaSha256 ?? '')),
    ).toBe(true);
    expect(manifest.assets.filter((asset) => asset.bundled.startsWith('textures/') && asset.bundled.endsWith('.tga'))).toHaveLength(
      16,
    );
  });

  it('matches every committed asset to its generation manifest', () => {
    for (const asset of manifest.assets) {
      const path = join(publicDir, 'game', asset.bundled);
      expect(existsSync(path), asset.bundled).toBe(true);
      expect(digest(path), asset.bundled).toBe(asset.sha256);
    }
    const atari = join(publicDir, manifest.derived.bundled);
    expect(existsSync(atari)).toBe(true);
    expect(digest(atari)).toBe(manifest.derived.sha256);
    expect(manifest.derived.decodedRgbaSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
