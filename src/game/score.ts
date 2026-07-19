/** Menu_Score_CountSpeed from the original Menu.nmo. */
export const SCORE_COUNT_SPEED: readonly { limit: number; step: number }[] = [
  { limit: 80, step: 1 },
  { limit: 500, step: 5 },
  { limit: 9999, step: 25 },
];

/** base.cmo/DB_Options row 0, column LastPlayer. */
export const SOURCE_DEFAULT_LAST_PLAYER = 'name';

/** Menu.nmo/Menu_HighscoreEntry/TT InputString `Max Size`. */
export const SOURCE_HIGHSCORE_NAME_MAX_LENGTH = 9;

/** base.cmo/Check Highscore uses Test mode 5: strict A > B. */
export function highscoreQualifies(score: number, cutoff: number): boolean {
  return score > cutoff;
}

/**
 * Serialized graph input is the accumulated displayed value, not the amount
 * left to count. The original counter therefore accelerates at 80 and 500.
 */
export function scoreCountStep(displayed: number): number {
  return SCORE_COUNT_SPEED.find(({ limit }) => displayed <= limit)?.step ?? SCORE_COUNT_SPEED.at(-1)?.step ?? 1;
}
