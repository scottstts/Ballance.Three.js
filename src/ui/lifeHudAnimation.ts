/** Gameplay.nmo/Gameplay_Energy's serialized life-counter transition order. */

export type LifeHudPhase =
  | 'idle'
  | 'addPrepare'
  | 'addMove'
  | 'addFade'
  | 'removeFade'
  | 'removePrepare'
  | 'removeMove';

export interface LifeHudAnimationState {
  committedLives: number;
  phase: LifeHudPhase;
}

export interface LifeHudVisualState {
  ballLives: number;
  hookLives: number;
  animatedBallIndex: number | null;
  ballAnimation: 'hidden' | 'fadeIn' | 'fadeOut' | null;
  hookMoving: boolean;
}

export function normalizeLifeCount(lives: number): number {
  return Math.max(0, Math.trunc(lives));
}

export function initialLifeHudAnimation(lives: number): LifeHudAnimationState {
  return { committedLives: normalizeLifeCount(lives), phase: 'idle' };
}

/** Begin one source-authored step toward the latest reserve count. */
export function beginLifeHudTransition(
  state: LifeHudAnimationState,
  targetLives: number,
): LifeHudAnimationState {
  if (state.phase !== 'idle') return state;
  const target = normalizeLifeCount(targetLives);
  if (target > state.committedLives) return { ...state, phase: 'addPrepare' };
  if (target < state.committedLives) return { ...state, phase: 'removeFade' };
  return state;
}

/** Advance at a render boundary (prepare) or after an authored 300 ms stage. */
export function advanceLifeHudTransition(state: LifeHudAnimationState): LifeHudAnimationState {
  switch (state.phase) {
    case 'addPrepare':
      return { ...state, phase: 'addMove' };
    case 'addMove':
      return { ...state, phase: 'addFade' };
    case 'addFade':
      return { committedLives: state.committedLives + 1, phase: 'idle' };
    case 'removeFade':
      return { ...state, phase: 'removePrepare' };
    case 'removePrepare':
      return { ...state, phase: 'removeMove' };
    case 'removeMove':
      return { committedLives: Math.max(0, state.committedLives - 1), phase: 'idle' };
    case 'idle':
      return state;
  }
}

export function lifeHudVisualState(state: LifeHudAnimationState): LifeHudVisualState {
  const current = state.committedLives;
  switch (state.phase) {
    case 'addPrepare':
      return {
        ballLives: current + 1,
        hookLives: current,
        animatedBallIndex: current + 1,
        ballAnimation: 'hidden',
        hookMoving: false,
      };
    case 'addMove':
      return {
        ballLives: current + 1,
        hookLives: current + 1,
        animatedBallIndex: current + 1,
        ballAnimation: 'hidden',
        hookMoving: true,
      };
    case 'addFade':
      return {
        ballLives: current + 1,
        hookLives: current + 1,
        animatedBallIndex: current + 1,
        ballAnimation: 'fadeIn',
        hookMoving: false,
      };
    case 'removeFade':
      return {
        ballLives: current,
        hookLives: current,
        animatedBallIndex: current,
        ballAnimation: 'fadeOut',
        hookMoving: false,
      };
    case 'removePrepare':
      return {
        ballLives: Math.max(0, current - 1),
        hookLives: current,
        animatedBallIndex: null,
        ballAnimation: null,
        hookMoving: false,
      };
    case 'removeMove':
      return {
        ballLives: Math.max(0, current - 1),
        hookLives: Math.max(0, current - 1),
        animatedBallIndex: null,
        ballAnimation: null,
        hookMoving: true,
      };
    case 'idle':
      return {
        ballLives: current,
        hookLives: current,
        animatedBallIndex: null,
        ballAnimation: null,
        hookMoving: false,
      };
  }
}
