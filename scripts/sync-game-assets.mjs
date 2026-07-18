/**
 * Materialize the browser-owned runtime asset set from the read-only original.
 *
 * Usage: npm run sync:assets
 *
 * NMO, WAV, TGA, and text files remain byte-identical. BMP textures are
 * losslessly repacked as PNG (the runtime maps `.bmp` requests to `.bmp.png`)
 * so the deployable tree is much smaller without changing decoded pixels.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = [
  join(root, 'Ballance_bin/Ballance'),
  join(root, 'Ballance_bin/source1/Ballance'),
].find(existsSync);

if (!source) throw new Error('Original Ballance tree not found; expected Ballance_bin/source1/Ballance');

const output = join(root, 'public/game');
const derivedOutput = join(root, 'public/game-derived');
const marker = join(output, '_manifest.json');

if (existsSync(output)) {
  if (!existsSync(marker)) throw new Error(`Refusing to replace unrecognized directory: ${output}`);
  rmSync(output, { recursive: true });
}
mkdirSync(output, { recursive: true });
mkdirSync(derivedOutput, { recursive: true });

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const decodedRgbaSha256 = (path) => {
  const result = spawnSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    path,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-',
  ], { maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`ffmpeg could not decode ${path}: ${result.stderr?.toString() ?? ''}`);
  }
  return createHash('sha256').update(result.stdout).digest('hex');
};
const portable = (path) => path.split(sep).join('/');
const bundledPath = (sourceRelative) => {
  const normalized = portable(sourceRelative).toLowerCase();
  return normalized.endsWith('.bmp') ? `${normalized}.png` : normalized;
};

const manifest = [];

function filesUnder(path) {
  const result = [];
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      if (name.startsWith('.') || name === '_marker_') continue;
      const child = join(current, name);
      if (statSync(child).isDirectory()) walk(child);
      else result.push(child);
    }
  };
  walk(path);
  return result;
}

function emitExact(path) {
  const sourceRelative = portable(relative(source, path));
  const destinationRelative = bundledPath(sourceRelative);
  const destination = join(output, destinationRelative);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(path, destination);
  manifest.push({
    source: sourceRelative,
    bundled: destinationRelative,
    encoding: 'source-exact',
    sha256: sha256(path),
    bytes: statSync(destination).size,
  });
}

function emitBmpAsPng(path) {
  const sourceRelative = portable(relative(source, path));
  const destinationRelative = bundledPath(sourceRelative);
  const destination = join(output, destinationRelative);
  mkdirSync(dirname(destination), { recursive: true });
  const result = spawnSync('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-i',
    path,
    '-frames:v',
    '1',
    '-compression_level',
    '9',
    destination,
  ]);
  if (result.status !== 0 || !existsSync(destination)) {
    throw new Error(`ffmpeg could not losslessly repack ${sourceRelative}: ${result.stderr?.toString() ?? ''}`);
  }
  const sourceDecodedSha256 = decodedRgbaSha256(path);
  const bundledDecodedSha256 = decodedRgbaSha256(destination);
  if (sourceDecodedSha256 !== bundledDecodedSha256) {
    throw new Error(`Decoded pixels changed while repacking ${sourceRelative}`);
  }
  manifest.push({
    source: sourceRelative,
    bundled: destinationRelative,
    encoding: 'lossless-png',
    sourceSha256: sha256(path),
    sha256: sha256(destination),
    decodedRgbaSha256: sourceDecodedSha256,
    bytes: statSync(destination).size,
  });
}

for (const path of filesUnder(join(source, '3D Entities'))) {
  if (path.toLowerCase().endsWith('.nmo')) emitExact(path);
}
for (const path of filesUnder(join(source, 'Sounds'))) {
  if (path.toLowerCase().endsWith('.wav')) emitExact(path);
}
for (const path of filesUnder(join(source, 'Text'))) {
  if (path.toLowerCase().endsWith('.txt')) emitExact(path);
}
for (const path of filesUnder(join(source, 'Textures'))) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.bmp')) emitBmpAsPng(path);
  else if (lower.endsWith('.tga')) emitExact(path);
}

const atariInput = join(source, 'Textures/atari.avi');
const atariOutput = join(derivedOutput, 'atari.apng');
const atariResult = spawnSync('ffmpeg', [
  '-y',
  '-v',
  'error',
  '-i',
  atariInput,
  '-an',
  '-plays',
  '0',
  '-f',
  'apng',
  atariOutput,
]);
if (atariResult.status !== 0 || !existsSync(atariOutput)) {
  throw new Error(`ffmpeg could not decode ${basename(atariInput)}: ${atariResult.stderr?.toString() ?? ''}`);
}
const atariDecodedSha256 = decodedRgbaSha256(atariInput);
if (atariDecodedSha256 !== decodedRgbaSha256(atariOutput)) {
  throw new Error(`Decoded frames changed while repacking ${basename(atariInput)}`);
}

manifest.sort((a, b) => a.source.localeCompare(b.source));
writeFileSync(
  marker,
  `${JSON.stringify(
    {
      authority: 'Ballance_bin/source1/Ballance',
      policy: 'NMO/WAV/TGA/TXT source-exact; BMP losslessly repacked as PNG',
      assets: manifest,
      derived: {
        source: 'Textures/atari.avi',
        bundled: 'game-derived/atari.apng',
        encoding: 'lossless-apng',
        sourceSha256: sha256(atariInput),
        sha256: sha256(atariOutput),
        decodedRgbaSha256: atariDecodedSha256,
        bytes: statSync(atariOutput).size,
      },
    },
    null,
    2,
  )}\n`,
);

const bytes = manifest.reduce((sum, asset) => sum + asset.bytes, 0) + statSync(atariOutput).size;
console.log(`Bundled ${manifest.length} source assets (${(bytes / 1024 / 1024).toFixed(1)} MiB).`);
