import { useGameStore } from '../game/store.ts';

/**
 * Original in-game HUD: score in a metallic wire frame bottom-left,
 * silver life balls in a wire cradle bottom-right.
 */
export default function Hud() {
  const { phase, lives, points } = useGameStore();
  return (
    <div className="hud">
      <div className="hud-score">
        <svg className="hud-score-frame" viewBox="0 0 240 90" aria-hidden>
          <path
            d="M14 62 q-8 0 -8 8 q0 8 8 8 h176 q22 0 22 -22"
            fill="none"
            stroke="#e8e2d2"
            strokeWidth="4"
            strokeLinecap="round"
            opacity="0.9"
          />
          <rect x="26" y="8" width="186" height="52" rx="10" fill="rgba(20,18,14,0.25)" stroke="#efe9d9" strokeWidth="5" />
          <rect x="31" y="13" width="176" height="42" rx="7" fill="none" stroke="rgba(90,80,60,0.55)" strokeWidth="2" />
        </svg>
        <span className="hud-score-digits">{points}</span>
      </div>
      <div className="hud-lifes">
        <svg className="hud-lifes-frame" viewBox="0 0 250 80" aria-hidden>
          <path
            d="M6 52 q-4 14 12 14 h180 M232 66 q16 0 16 -16 v-24 q0 -16 -16 -16 h-10"
            fill="none"
            stroke="#e8e2d2"
            strokeWidth="5"
            strokeLinecap="round"
            opacity="0.9"
          />
        </svg>
        <div className="hud-life-balls">
          {Array.from({ length: Math.min(lives, 8) }, (_, i) => (
            <span key={i} className="hud-lifeball" />
          ))}
        </div>
      </div>
      {phase === 'dead' && <div className="hud-banner">&nbsp;</div>}
    </div>
  );
}
