import { useGameStore } from '../game/store.ts';

export default function Hud() {
  const { phase, lives, points, sector, sectorCount, level } = useGameStore();
  return (
    <div className="hud">
      <div className="hud-top">
        <div className="hud-lives">
          {Array.from({ length: Math.min(lives, 10) }, (_, i) => (
            <span key={i} className="hud-life" />
          ))}
        </div>
        <div className="hud-points">{points}</div>
      </div>
      <div className="hud-sector">
        Level {level} — Sector {sector}/{sectorCount}
      </div>
      {phase === 'dead' && <div className="hud-banner">Ball lost…</div>}
      {phase === 'finished' && <div className="hud-banner hud-banner-win">Level complete!</div>}
      {phase === 'gameover' && <div className="hud-banner hud-banner-over">Game over</div>}
    </div>
  );
}
