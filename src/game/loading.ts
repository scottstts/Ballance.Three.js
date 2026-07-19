import { SIM_DT } from './constants.ts';

/**
 * `base.cmo/Loading_Screen` source values. Its saved local `Sizefactor` is
 * already 4/9; activation adds one step immediately, then advances once for
 * each of the four remaining `Part_Loaded` messages.
 */
export const LOADING_SOURCE = {
  parts: 9,
  savedPart: 4,
  initialPart: 5,
  rect: [0, 0.9700004458427429, 0, 0.9700004458427429] as const,
  height: 0.029999999329447746,
  colorA: [1, 0.658823549747467, 0, 0.1568627506494522] as const,
  colorB: [1, 0.658823549747467, 0, 1] as const,
  completedLoadFrameDelay: 2,
} as const;

export interface LoadingBarState {
  part: number;
  progress: number;
  alpha: number;
}

export function loadingBarState(part: number): LoadingBarState {
  const clamped = Math.max(LOADING_SOURCE.initialPart, Math.min(LOADING_SOURCE.parts, Math.trunc(part)));
  const progress = clamped / LOADING_SOURCE.parts;
  const alpha = LOADING_SOURCE.colorA[3] + (LOADING_SOURCE.colorB[3] - LOADING_SOURCE.colorA[3]) * progress;
  return { part: clamped, progress, alpha };
}

/** The original `Loaded` broadcast leaves the object-load graph after two PSI frames. */
export function completedLoadHandoffDelayMs(): number {
  return LOADING_SOURCE.completedLoadFrameDelay * SIM_DT * 1000;
}
