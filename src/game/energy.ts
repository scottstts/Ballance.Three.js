import { POINT_COUNT_INTERVAL } from './constants.ts';

export interface PointCountdownState {
  points: number;
  /** Time accumulated toward the next source 500 ms subtraction. */
  remainder: number;
}

/**
 * Gameplay_Energy keeps TT_Timer running across ordinary play and pauses it on
 * Counter inactive/Pause Level without resetting the partial interval.
 */
export function advancePointCountdown(
  state: PointCountdownState,
  elapsed: number,
  active: boolean,
): PointCountdownState {
  if (!active || elapsed <= 0) return state;
  const accumulated = state.remainder + elapsed;
  const ticks = Math.floor(accumulated / POINT_COUNT_INTERVAL);
  return {
    points: Math.max(0, state.points - ticks),
    remainder: accumulated - ticks * POINT_COUNT_INTERVAL,
  };
}
