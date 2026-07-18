import { describe, expect, it } from 'vitest';
import { SCORE_COUNT_SPEED, scoreCountStep } from './score.ts';

describe('source-authored score counter', () => {
  it('accelerates according to the accumulated displayed score', () => {
    expect(SCORE_COUNT_SPEED).toEqual([
      { limit: 80, step: 1 },
      { limit: 500, step: 5 },
      { limit: 9999, step: 25 },
    ]);
    expect(scoreCountStep(0)).toBe(1);
    expect(scoreCountStep(80)).toBe(1);
    expect(scoreCountStep(81)).toBe(5);
    expect(scoreCountStep(500)).toBe(5);
    expect(scoreCountStep(501)).toBe(25);
  });
});
