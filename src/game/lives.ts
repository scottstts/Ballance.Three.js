export interface FallLifeOutcome {
  gameOver: boolean;
  lives: number;
}

/**
 * Gameplay.nmo/Deactivate Ball tests ActLifes before its subtraction Op.
 * A zero reserve count therefore ends the game; a positive count is consumed
 * and the current ball is respawned.
 */
export function fallLifeOutcome(lives: number): FallLifeOutcome {
  const reserves = Math.max(0, Math.trunc(lives));
  return reserves === 0 ? { gameOver: true, lives: 0 } : { gameOver: false, lives: reserves - 1 };
}
