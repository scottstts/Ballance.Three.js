/**
 * Source-authored in-game HUD geometry.
 *
 * Camera.nmo stores CK2dEntity rectangles in normalized screen coordinates.
 * Camera.nmo's Interface_Life_Kugel is a hidden copy template. Gameplay.nmo
 * subtracts one `ballOffsetX` step before placing the first visible copy, then
 * continues left for the current attempt plus every reserve. The small
 * Interface_Life_End hook follows the leftmost visible ball.
 *
 * The score frame and its glow are complete atlas regions, not separately
 * positioned plate/wire fragments. Gameplay_Energy renders the point string
 * right-aligned inside `digits` with the exact TT font properties below.
 */

export type HudRect = readonly [left: number, top: number, right: number, bottom: number];

/** Camera.nmo's authored render aspect; HUD pixels are projected inside it. */
export const HUD_SOURCE_ASPECT = 4 / 3;

export const LIFE_HUD_SOURCE = {
  ball: [0.9495999813079834, 0.885418176651001, 0.9933501482009888, 0.9437516331672668] as HudRect,
  curl: [0.8906251192092896, 0.850002110004425, 0.9812502264976501, 0.977086067199707] as HudRect,
  hook: [0.9287999868392944, 0.881252110004425, 0.9522379040718079, 0.9437525272369385] as HudRect,
  ballOffsetX: 0.03869999945163727,
  fadeDurationMs: 300,
  hookMoveDurationMs: 300,
} as const;

export const POINTS_HUD_SOURCE = {
  background: [
    0.014999999664723873, 0.8700007796287537, 0.23500002920627594, 0.9800010323524475,
  ] as HudRect,
  backgroundUv: [0.3255000114440918, 0.7300000190734863, 1, 0.980400025844574] as HudRect,
  glow: [
    0.014999999664723873, 0.8700007796287537, 0.23499995470046997, 0.980000913143158,
  ] as HudRect,
  glowUv: [0.4350000023841858, 0.5080000162124634, 0.9950000047683716, 0.7129999995231628] as HudRect,
  digits: [
    0.04999997839331627, 0.8841684460639954, 0.20374992489814758, 0.9341685771942139,
  ] as HudRect,
  font: {
    cellPixels: 32,
    texturePixels: [512, 512] as const,
    screenProportional: true,
    space: [1.5, 1] as const,
    scale: [0.800000011920929, 0.8999999761581421] as const,
    color: [1, 1, 1, 1] as const,
    endColor: [0, 0, 0, 1] as const,
    shadowColor: [0, 0, 0, 0.3921568989753723] as const,
    shadowAngle: 2.356194496154785,
    shadowDistance: 2,
    shadowSize: [0.800000011920929, 0.8999999761581421] as const,
    alignment: 2,
    margins: [2, 2, 2, 2] as const,
  },
  glowDurationMs: 500,
} as const;

export interface AtlasCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** CK texture UVs address pixel centres from 0 through `size - 1`. */
export function atlasCropFromUv(uv: HudRect, size = 256): AtlasCrop {
  const lastPixel = size - 1;
  const left = Math.round(uv[0] * lastPixel);
  const top = Math.round(uv[1] * lastPixel);
  const right = Math.round(uv[2] * lastPixel);
  const bottom = Math.round(uv[3] * lastPixel);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/** Interface.dll computes the TT shadow as (-cos(angle), sin(angle)) * distance. */
export function pointShadowOffset(): readonly [x: number, y: number] {
  const { shadowAngle, shadowDistance } = POINTS_HUD_SOURCE.font;
  return [-Math.cos(shadowAngle) * shadowDistance, Math.sin(shadowAngle) * shadowDistance];
}

function reserveCount(lives: number): number {
  return Math.max(0, Math.trunc(lives));
}

function moveRectX(rect: HudRect, left: number): HudRect {
  return [left, rect[1], left + rect[2] - rect[0], rect[3]];
}

/** The hidden template's copies: current attempt plus each reserve, right to left. */
export function lifeBallRects(lives: number): HudRect[] {
  return Array.from({ length: reserveCount(lives) + 1 }, (_, index) =>
    moveRectX(LIFE_HUD_SOURCE.ball, LIFE_HUD_SOURCE.ball[0] - (index + 1) * LIFE_HUD_SOURCE.ballOffsetX),
  );
}

/** The hook follows the inclusive Counter's final copy, one step beyond the reserve count. */
export function lifeHookRect(lives: number): HudRect {
  const left = LIFE_HUD_SOURCE.hook[0] - (reserveCount(lives) + 1) * LIFE_HUD_SOURCE.ballOffsetX;
  return moveRectX(LIFE_HUD_SOURCE.hook, left);
}

export function hudRectStyle(rect: HudRect): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  return {
    left: `${rect[0] * 100}%`,
    top: `${rect[1] * 100}%`,
    width: `${(rect[2] - rect[0]) * 100}%`,
    height: `${(rect[3] - rect[1]) * 100}%`,
  };
}
