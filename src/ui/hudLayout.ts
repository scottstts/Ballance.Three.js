/**
 * Source-authored life HUD geometry.
 *
 * Camera.nmo stores CK2dEntity rectangles in normalized screen coordinates.
 * Gameplay.nmo keeps one permanent Interface_Life_Kugel at `ball.left`, then
 * creates `ActLifes` copies at one `ballOffsetX` step farther left. The small
 * Interface_Life_End hook follows the leftmost reserve ball.
 */

export type HudRect = readonly [left: number, top: number, right: number, bottom: number];

export const LIFE_HUD_SOURCE = {
  ball: [0.9495999813079834, 0.885418176651001, 0.9933501482009888, 0.9437516331672668] as HudRect,
  curl: [0.8906251192092896, 0.850002110004425, 0.9812502264976501, 0.977086067199707] as HudRect,
  hook: [0.9287999868392944, 0.881252110004425, 0.9522379040718079, 0.9437525272369385] as HudRect,
  ballOffsetX: 0.03869999945163727,
} as const;

function reserveCount(lives: number): number {
  return Math.max(0, Math.trunc(lives));
}

function moveRectX(rect: HudRect, left: number): HudRect {
  return [left, rect[1], left + rect[2] - rect[0], rect[3]];
}

/** The permanent current ball plus each stored reserve life, right to left. */
export function lifeBallRects(lives: number): HudRect[] {
  return Array.from({ length: reserveCount(lives) + 1 }, (_, index) =>
    moveRectX(LIFE_HUD_SOURCE.ball, LIFE_HUD_SOURCE.ball[0] - index * LIFE_HUD_SOURCE.ballOffsetX),
  );
}

/** Gameplay.nmo Calculator expression: `a-(b*c)`. */
export function lifeHookRect(lives: number): HudRect {
  const left = LIFE_HUD_SOURCE.hook[0] - reserveCount(lives) * LIFE_HUD_SOURCE.ballOffsetX;
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
