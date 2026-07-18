/**
 * Original-UI toolkit: the menu/HUD are rebuilt from the exact original
 * assets — the Button01 sprite atlases, the Font_1 bitmap font (cp1252 in a
 * 16x16 grid of 32px cells, uppercase + small-caps) and Cursor.tga.
 */
import { decodeImageFile, decodeTga } from '../engine/textures.ts';
import { fetchGameBuffer } from '../engine/assets.ts';

interface Decoded {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Atlas = 'deselect' | 'select' | 'special';

interface PieceDef extends Rect {
  atlas: Atlas;
  /** also emit a Hover variant cropped from the select atlas */
  hover?: boolean;
}

/** piece rectangles inside the Button01 atlases */
const PIECES: Record<string, PieceDef> = {
  // menu capsules (deselect = silver, select = amber hover)
  buttonLarge: { atlas: 'deselect', x: 2, y: 1, w: 252, h: 62, hover: true },
  buttonMedium: { atlas: 'deselect', x: 60, y: 191, w: 164, h: 63, hover: true },
  optionRow: { atlas: 'deselect', x: 3, y: 64, w: 159, h: 29, hover: true },
  slider: { atlas: 'deselect', x: 2, y: 102, w: 252, h: 28, hover: true },
  roundA: { atlas: 'deselect', x: 226, y: 198, w: 22, h: 23, hover: true },
  roundB: { atlas: 'deselect', x: 226, y: 226, w: 22, h: 23, hover: true },
  // in-game HUD (special atlas): score plate + its under-swoosh, both with
  // amber flash variants, and the lives wire pieces + silver ball
  scorePlate: { atlas: 'special', x: 105, y: 185, w: 135, h: 44 },
  scoreSwoosh: { atlas: 'special', x: 82, y: 199, w: 176, h: 52 },
  scorePlateAmber: { atlas: 'special', x: 130, y: 129, w: 110, h: 36 },
  scoreSwooshAmber: { atlas: 'special', x: 111, y: 142, w: 142, h: 41 },
  lifeBall: { atlas: 'special', x: 16, y: 134, w: 31, h: 31 },
  livesHook: { atlas: 'special', x: 0, y: 133, w: 16, h: 33 },
  livesCurl: { atlas: 'special', x: 46, y: 119, w: 60, h: 63 },
};

export interface TextImage {
  url: string;
  w: number;
  h: number;
}

export interface Ogui {
  /** data-URLs for atlas pieces, keyed `${piece}` and `${piece}Hover` */
  piece: Record<string, string>;
  cursor: string;
  /** render text in the original bitmap font at a given pixel height */
  text(text: string, px: number, color?: string): TextImage;
}

function toCanvas(img: Decoded): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
  }
  return c;
}

function crop(src: HTMLCanvasElement, r: Rect): string {
  const c = document.createElement('canvas');
  c.width = r.w;
  c.height = r.h;
  c.getContext('2d')?.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return c.toDataURL('image/png');
}

const CELL = 32;

class FontRenderer {
  private canvas: HTMLCanvasElement;
  /** per-code ink bounds [x0, width] within the 32px cell */
  private metrics: [number, number][] = [];
  private cache = new Map<string, TextImage>();

  constructor(img: Decoded) {
    this.canvas = toCanvas(img);
    for (let code = 0; code < 256; code++) {
      const cx = (code % 16) * CELL;
      const cy = Math.floor(code / 16) * CELL;
      let x0 = CELL;
      let x1 = -1;
      for (let x = 0; x < CELL; x++) {
        for (let y = 0; y < CELL; y++) {
          const a = img.rgba[((cy + y) * img.width + cx + x) * 4 + 3];
          if (a > 24) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
          }
        }
      }
      this.metrics[code] = x1 < 0 ? [0, 0] : [x0, x1 - x0 + 1];
    }
  }

  text(str: string, px: number, color = '#ffffff'): TextImage {
    const key = `${str}|${px}|${color}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const scale = px / CELL;
    const gap = 3;
    const space = 10;
    let wCells = 0;
    for (const ch of str) {
      const code = ch.codePointAt(0) ?? 32;
      const [, w] = this.metrics[code] ?? [0, 0];
      wCells += (code === 32 || w === 0 ? space : w + gap);
    }
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(wCells * scale));
    c.height = Math.ceil(px * 1.05);
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      let x = 0;
      for (const ch of str) {
        const code = ch.codePointAt(0) ?? 32;
        const [x0, w] = this.metrics[code] ?? [0, 0];
        if (code === 32 || w === 0) {
          x += space * scale;
          continue;
        }
        const cx = (code % 16) * CELL + x0;
        const cy = Math.floor(code / 16) * CELL;
        ctx.drawImage(this.canvas, cx, cy, w, CELL, x, 0, w * scale, px);
        x += (w + gap) * scale;
      }
      if (color !== '#ffffff') {
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, c.width, c.height);
      }
    }
    const out = { url: c.toDataURL('image/png'), w: c.width, h: c.height };
    this.cache.set(key, out);
    return out;
  }
}

let oguiPromise: Promise<Ogui> | null = null;

export function loadOgui(): Promise<Ogui> {
  oguiPromise ??= (async () => {
    const [deselect, select, special, font, cursorImg] = await Promise.all([
      decodeImageFile('Textures/Button01_deselect.tga'),
      decodeImageFile('Textures/Button01_select.tga'),
      decodeImageFile('Textures/Button01_special.tga'),
      decodeImageFile('Textures/Font_1.tga'),
      fetchGameBuffer('Textures/Cursor.tga').then((b) => decodeTga(new Uint8Array(b))),
    ]);
    const atlases: Record<Atlas, HTMLCanvasElement> = {
      deselect: toCanvas(deselect),
      select: toCanvas(select),
      special: toCanvas(special),
    };
    const piece: Record<string, string> = {};
    for (const [name, def] of Object.entries(PIECES)) {
      piece[name] = crop(atlases[def.atlas], def);
      if (def.hover) piece[`${name}Hover`] = crop(atlases.select, def);
    }
    const fontRenderer = new FontRenderer(font);
    const cursorCanvas = toCanvas(cursorImg);
    return {
      piece,
      cursor: cursorCanvas.toDataURL('image/png'),
      text: (t, px, color) => fontRenderer.text(t, px, color),
    };
  })();
  return oguiPromise;
}
