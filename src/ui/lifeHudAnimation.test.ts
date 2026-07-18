import { describe, expect, it } from 'vitest';
import {
  advanceLifeHudTransition,
  beginLifeHudTransition,
  initialLifeHudAnimation,
  lifeHudVisualState,
} from './lifeHudAnimation.ts';

describe('life HUD animation sequence', () => {
  it('moves the hook before fading in a newly added reserve', () => {
    let state = beginLifeHudTransition(initialLifeHudAnimation(3), 4);
    expect(lifeHudVisualState(state)).toMatchObject({
      ballLives: 4,
      hookLives: 3,
      animatedBallIndex: 4,
      ballAnimation: 'hidden',
      hookMoving: false,
    });

    state = advanceLifeHudTransition(state);
    expect(lifeHudVisualState(state)).toMatchObject({ hookLives: 4, ballAnimation: 'hidden', hookMoving: true });

    state = advanceLifeHudTransition(state);
    expect(lifeHudVisualState(state)).toMatchObject({ hookLives: 4, ballAnimation: 'fadeIn', hookMoving: false });

    state = advanceLifeHudTransition(state);
    expect(state).toEqual({ committedLives: 4, phase: 'idle' });
  });

  it('fades the leftmost reserve before moving the hook right', () => {
    let state = beginLifeHudTransition(initialLifeHudAnimation(3), 2);
    expect(lifeHudVisualState(state)).toMatchObject({
      ballLives: 3,
      hookLives: 3,
      animatedBallIndex: 3,
      ballAnimation: 'fadeOut',
      hookMoving: false,
    });

    state = advanceLifeHudTransition(state);
    expect(lifeHudVisualState(state)).toMatchObject({ ballLives: 2, hookLives: 3, hookMoving: false });

    state = advanceLifeHudTransition(state);
    expect(lifeHudVisualState(state)).toMatchObject({ ballLives: 2, hookLives: 2, hookMoving: true });

    state = advanceLifeHudTransition(state);
    expect(state).toEqual({ committedLives: 2, phase: 'idle' });
  });

  it('serializes multi-reserve changes one source step at a time', () => {
    let state = initialLifeHudAnimation(0);
    for (let expected = 1; expected <= 3; expected++) {
      state = beginLifeHudTransition(state, 3);
      state = advanceLifeHudTransition(state);
      state = advanceLifeHudTransition(state);
      state = advanceLifeHudTransition(state);
      expect(state).toEqual({ committedLives: expected, phase: 'idle' });
    }
  });
});
