/**
 * Decodes original texture files (BMP via native browser decode, TGA via a
 * small decoder) into THREE textures, applying Virtools color-key transparency.
 */
import * as THREE from 'three';
import { fetchGameBuffer } from './assets.ts';
import type { TextureRec } from '../formats/ck2/types.ts';

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA, top-down row order */
  rgba: Uint8ClampedArray;
}

export async function decodeImageFile(relPath: string): Promise<DecodedImage> {
  const buf = await fetchGameBuffer(relPath);
  const ext = relPath.split('.').pop()?.toLowerCase();
  if (ext === 'tga') return decodeTga(new Uint8Array(buf));
  return decodeViaBrowser(buf, ext === 'bmp' ? 'image/bmp' : `image/${ext}`);
}

async function decodeViaBrowser(buf: ArrayBuffer, mime: string): Promise<DecodedImage> {
  const bitmap = await createImageBitmap(new Blob([buf], { type: mime }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return { width: data.width, height: data.height, rgba: data.data };
}

/** Minimal TGA decoder: types 1/2/9/10, 8/16/24/32bpp, honoring origin flag. */
export function decodeTga(bytes: Uint8Array): DecodedImage {
  const idLength = bytes[0];
  const colorMapType = bytes[1];
  const imageType = bytes[2];
  const cmFirst = bytes[3] | (bytes[4] << 8);
  const cmLength = bytes[5] | (bytes[6] << 8);
  const cmDepth = bytes[7];
  const width = bytes[12] | (bytes[13] << 8);
  const height = bytes[14] | (bytes[15] << 8);
  const bpp = bytes[16];
  const descriptor = bytes[17];
  const topDown = (descriptor & 0x20) !== 0;

  let off = 18 + idLength;
  const cmBytes = Math.ceil(cmDepth / 8);
  const colorMap = bytes.subarray(off, off + cmLength * cmBytes);
  off += colorMapType === 1 ? cmLength * cmBytes : 0;

  const rle = imageType === 9 || imageType === 10;
  const pixByte = Math.ceil(bpp / 8);
  const count = width * height;
  const raw = new Uint8Array(count * pixByte);
  if (rle) {
    let p = 0;
    while (p < raw.length) {
      const header = bytes[off++];
      const n = (header & 0x7f) + 1;
      if (header & 0x80) {
        for (let i = 0; i < n; i++) {
          raw.set(bytes.subarray(off, off + pixByte), p);
          p += pixByte;
        }
        off += pixByte;
      } else {
        raw.set(bytes.subarray(off, off + n * pixByte), p);
        p += n * pixByte;
        off += n * pixByte;
      }
    }
  } else {
    raw.set(bytes.subarray(off, off + count * pixByte));
  }

  const rgba = new Uint8ClampedArray(count * 4);
  const putPixel = (i: number, b: number, g: number, r: number, a: number) => {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = a;
  };
  for (let i = 0; i < count; i++) {
    const s = i * pixByte;
    if (imageType === 1 || imageType === 9) {
      const idx = (raw[s] - cmFirst) * cmBytes;
      if (cmBytes >= 3) putPixel(i, colorMap[idx], colorMap[idx + 1], colorMap[idx + 2], cmBytes === 4 ? colorMap[idx + 3] : 255);
    } else if (pixByte === 4) {
      putPixel(i, raw[s], raw[s + 1], raw[s + 2], raw[s + 3]);
    } else if (pixByte === 3) {
      putPixel(i, raw[s], raw[s + 1], raw[s + 2], 255);
    } else if (pixByte === 2) {
      const v = raw[s] | (raw[s + 1] << 8);
      putPixel(i, (v & 0x1f) << 3, ((v >> 5) & 0x1f) << 3, ((v >> 10) & 0x1f) << 3, v & 0x8000 ? 255 : 0);
    } else {
      putPixel(i, raw[s], raw[s], raw[s], 255);
    }
  }
  if (!topDown) {
    const flipped = new Uint8ClampedArray(count * 4);
    const stride = width * 4;
    for (let y = 0; y < height; y++) {
      flipped.set(rgba.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
    }
    return { width, height, rgba: flipped };
  }
  return { width, height, rgba };
}

function applyColorKey(img: DecodedImage, keyColor: number): void {
  const kr = (keyColor >>> 16) & 0xff;
  const kg = (keyColor >>> 8) & 0xff;
  const kb = keyColor & 0xff;
  const d = img.rgba;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] === kr && d[i + 1] === kg && d[i + 2] === kb) d[i + 3] = 0;
  }
}

const textureCache = new Map<string, Promise<THREE.Texture>>();

/** Build a THREE texture for a parsed CKTexture record. */
export function loadCkTexture(rec: TextureRec): Promise<THREE.Texture> | null {
  const fileName = rec.fileNames.find(Boolean);
  const embedded = rec.embedded.find(Boolean);
  const cacheKey = (fileName ?? rec.name).toLowerCase() + (rec.transparent ? `#k${rec.transparentColor}` : '');
  const cached = textureCache.get(cacheKey);
  if (cached) return cached;

  let imgPromise: Promise<DecodedImage>;
  if (fileName) {
    imgPromise = decodeImageFile(`Textures/${fileName}`);
  } else if (embedded) {
    if (embedded.ext === 'tga') {
      imgPromise = Promise.resolve(decodeTga(embedded.bytes));
    } else {
      const copy = new Uint8Array(embedded.bytes);
      imgPromise = decodeViaBrowser(copy.buffer, `image/${embedded.ext}`);
    }
  } else if (rec.raw) {
    const raw = rec.raw;
    imgPromise = Promise.resolve({ width: raw.width, height: raw.height, rgba: new Uint8ClampedArray(raw.rgba) });
  } else {
    return null;
  }

  const p = imgPromise.then((img) => {
    if (rec.transparent) applyColorKey(img, rec.transparentColor);
    const tex = new THREE.DataTexture(new Uint8Array(img.rgba.buffer), img.width, img.height, THREE.RGBAFormat);
    // D3D-style texcoords: v=0 is the top row; keep memory order, don't flip
    tex.flipY = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  });
  textureCache.set(cacheKey, p);
  return p;
}
