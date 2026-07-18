/**
 * Original-UI toolkit: the menu/HUD are rebuilt from the exact original
 * assets — the Button01 sprite atlases, the Font_1 bitmap font (cp1252 in a
 * 16x16 grid of 32px cells, uppercase + small-caps) and Cursor.tga.
 */
import { decodeImageFile, decodeTga } from '../engine/textures.ts';
import { fetchGameBuffer, loadNmo } from '../engine/assets.ts';
import { atlasCropFromUv, POINTS_HUD_SOURCE } from './hudLayout.ts';
import { CREDITS_LOGO_UV, decodeCreditBlocks, MENU_ATLAS_UV_SOURCE, type CreditBlock } from './menuLayout.ts';

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
  buttonLarge: { atlas: 'deselect', ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.buttonLarge), hover: true },
  buttonLargeDisabled: { atlas: 'special', ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.buttonLarge) },
  buttonMedium: { atlas: 'deselect', ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.buttonMedium), hover: true },
  buttonMediumDisabled: { atlas: 'special', ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.buttonMedium) },
  levelButton: { atlas: 'deselect', ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.levelButton), hover: true },
  levelButtonDisabled: { atlas: 'special', ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.levelButton) },
  highscoreRow: { atlas: 'special', ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.highscoreRow) },
  highscorePrevious: {
    atlas: 'deselect',
    ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.highscorePrevious),
    hover: true,
  },
  highscorePreviousDisabled: {
    atlas: 'special',
    ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.highscorePrevious),
  },
  highscoreNext: {
    atlas: 'deselect',
    ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.highscoreNext),
    hover: true,
  },
  highscoreNextDisabled: {
    atlas: 'special',
    ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.highscoreNext),
  },
  confirmSmall: { atlas: 'deselect', ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.confirmSmall), hover: true },
  confirmSmallDisabled: { atlas: 'special', ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.confirmSmall) },
  optionField: { atlas: 'deselect', ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.optionField), hover: true },
  keyField: { atlas: 'deselect', ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.keyField), hover: true },
  arrowLeft: { atlas: 'deselect', ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.arrowLeft), hover: true },
  arrowLeftDisabled: { atlas: 'special', ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.arrowLeft) },
  arrowRight: { atlas: 'deselect', ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.arrowRight), hover: true },
  arrowRightDisabled: { atlas: 'special', ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.arrowRight) },
  scoreHighlight: { atlas: 'special', ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.scoreHighlight) },
  scoreLine: { atlas: 'special', ...atlasCropFromUv(MENU_ATLAS_UV_SOURCE.scoreLine) },
  optionRow: { atlas: 'deselect', x: 3, y: 64, w: 159, h: 29, hover: true },
  slider: { atlas: 'deselect', x: 2, y: 102, w: 252, h: 28, hover: true },
  // the slider bar minus its center handle, split for clean list rows
  sliderL: { atlas: 'deselect', x: 2, y: 102, w: 112, h: 28 },
  sliderR: { atlas: 'deselect', x: 142, y: 102, w: 112, h: 28 },
  roundA: { atlas: 'deselect', x: 226, y: 198, w: 22, h: 23, hover: true },
  roundB: { atlas: 'deselect', x: 226, y: 226, w: 22, h: 23, hover: true },
  // Complete score layers recovered from Camera.nmo's CK2dEntity UVs.
  scoreBackground: { atlas: 'special', ...atlasCropFromUv(POINTS_HUD_SOURCE.backgroundUv) },
  scoreGlow: { atlas: 'special', ...atlasCropFromUv(POINTS_HUD_SOURCE.glowUv) },
  // Camera.nmo CK2dEntity UV endpoints, converted from multiples of 1/255
  // to inclusive atlas pixels.
  lifeBall: { atlas: 'special', x: 17, y: 135, w: 29, h: 29 },
  livesHook: { atlas: 'special', x: 1, y: 134, w: 15, h: 30 },
  livesCurl: { atlas: 'special', x: 47, y: 119, w: 58, h: 61 },
};

export interface TextImage {
  url: string;
  w: number;
  h: number;
}

export interface TextRenderOptions {
  /** independent TT font Scale multipliers relative to the requested cell */
  scaleX?: number;
  scaleY?: number;
  /** literal extra horizontal advance in render-target pixels */
  spaceX?: number;
  /** Interface.dll Text Properties bit 1: scale font UVs by the render target. */
  screenWidth?: number;
  screenHeight?: number;
}

export interface Ogui {
  /** data-URLs for atlas pieces, keyed `${piece}` and `${piece}Hover` */
  piece: Record<string, string>;
  cursor: string;
  credits: readonly CreditBlock[];
  /** render text in the original bitmap font at a given pixel height */
  text(text: string, px: number, color?: string, endColor?: string, options?: TextRenderOptions): TextImage;
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

function cropUv(src: HTMLCanvasElement, uv: readonly [number, number, number, number]): string {
  const lastX = src.width - 1;
  const lastY = src.height - 1;
  const left = Math.round(uv[0] * lastX);
  const top = Math.round(uv[1] * lastY);
  const right = Math.round(uv[2] * lastX);
  const bottom = Math.round(uv[3] * lastY);
  return crop(src, { x: left, y: top, w: right - left + 1, h: bottom - top + 1 });
}

const CELL = 32;

class FontRenderer {
  private canvas: HTMLCanvasElement;
  /** Exact M_FontData_01 glyph placement/advance values in texture pixels. */
  private metrics: { x: number; y: number; width: number; height: number; pre: number; post: number }[] = [];
  private cache = new Map<string, TextImage>();

  constructor(img: Decoded, originalMetrics: number[][]) {
    this.canvas = toCanvas(img);
    for (let code = 0; code < 256; code++) {
      const authored = originalMetrics[code];
      if (authored?.length >= 6) {
        this.metrics[code] = {
          x: Math.round(authored[0] * img.width),
          y: Math.round(authored[1] * img.height),
          width: Math.round(authored[2] * img.width),
          pre: Math.round(authored[3] * img.width),
          post: Math.round(authored[4] * img.width),
          height: Math.round(authored[5] * img.height),
        };
        continue;
      }
      // Only code 255 is absent from the original 255-row table.
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
      this.metrics[code] = {
        x: cx + (x1 < 0 ? 0 : x0),
        y: cy,
        width: x1 < 0 ? 0 : x1 - x0 + 1,
        height: CELL,
        pre: 0,
        post: 3,
      };
    }
  }

  text(str: string, px: number, color = '#ffffff', endColor?: string, options: TextRenderOptions = {}): TextImage {
    const scaleX =
      (options.screenWidth === undefined ? px / CELL : options.screenWidth / this.canvas.width) *
      (options.scaleX ?? 1);
    const scaleY =
      (options.screenHeight === undefined ? px / CELL : options.screenHeight / this.canvas.height) *
      (options.scaleY ?? 1);
    const spaceX = options.spaceX ?? 0;
    const key = `${str}|${px}|${color}|${endColor ?? ''}|${scaleX}|${scaleY}|${spaceX}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const characters = [...str];
    let width = 0;
    for (const ch of characters) {
      const code = ch.codePointAt(0) ?? 32;
      const metric = this.metrics[code] ?? this.metrics[32];
      width += (metric.pre + metric.width + metric.post) * scaleX;
    }
    width += Math.max(0, characters.length - 1) * spaceX;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(width));
    // Preserve the menu renderer's small descender pad; the HUD path supplies
    // an authored Y scale and therefore uses the exact scaled cell height.
    c.height = Math.max(1, Math.ceil(options.scaleY === undefined ? px * 1.05 : CELL * scaleY));
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      let x = 0;
      for (const [index, ch] of characters.entries()) {
        const code = ch.codePointAt(0) ?? 32;
        const metric = this.metrics[code] ?? this.metrics[32];
        x += metric.pre * scaleX;
        if (metric.width > 0) {
          ctx.drawImage(
            this.canvas,
            metric.x,
            metric.y,
            metric.width,
            metric.height,
            x,
            0,
            metric.width * scaleX,
            metric.height * scaleY,
          );
        }
        x += (metric.width + metric.post) * scaleX;
        if (index < characters.length - 1) x += spaceX;
      }
      if (color !== '#ffffff' || endColor) {
        ctx.globalCompositeOperation = 'source-in';
        if (endColor) {
          const gradient = ctx.createLinearGradient(0, 0, 0, c.height);
          gradient.addColorStop(0, color);
          gradient.addColorStop(1, endColor);
          ctx.fillStyle = gradient;
        } else {
          ctx.fillStyle = color;
        }
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
    const [deselect, select, special, font, logo, cursorImg, menu] = await Promise.all([
      decodeImageFile('Textures/Button01_deselect.tga'),
      decodeImageFile('Textures/Button01_select.tga'),
      decodeImageFile('Textures/Button01_special.tga'),
      decodeImageFile('Textures/Font_1.tga'),
      decodeImageFile('Textures/Logo.bmp'),
      fetchGameBuffer('Textures/Cursor.tga').then((b) => decodeTga(new Uint8Array(b))),
      loadNmo('3D Entities/Menu.nmo'),
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
    const logoCanvas = toCanvas(logo);
    piece.creditLogo1 = cropUv(logoCanvas, CREDITS_LOGO_UV.logo1);
    piece.creditLogo2 = cropUv(logoCanvas, CREDITS_LOGO_UV.logo2);
    const fontData = menu.byName.get('M_FontData_01')?.[0];
    const metrics = fontData?.kind === 'dataArray' ? fontData.rows.map((row) => row.map(Number)) : [];
    const fontRenderer = new FontRenderer(font, metrics);
    const cursorCanvas = toCanvas(cursorImg);
    return {
      piece,
      cursor: cursorCanvas.toDataURL('image/png'),
      credits: decodeCreditBlocks(menu),
      text: (t, px, color, endColor, options) => fontRenderer.text(t, px, color, endColor, options),
    };
  })();
  return oguiPromise;
}
