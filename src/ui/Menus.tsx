import { useGameStore } from '../game/store.ts';

export function MainMenu() {
  const set = useGameStore((s) => s.set);
  return (
    <div className="menu-screen">
      <h1 className="menu-title">Ballance</h1>
      <div className="menu-buttons">
        <button onClick={() => set({ phase: 'levelselect' })}>Play</button>
      </div>
      <div className="menu-hint">Arrows roll · Shift+Arrows rotate camera · Space overview · Esc pause</div>
    </div>
  );
}

export function LevelSelect() {
  const { progress, set } = useGameStore();
  const start = (level: number) => set({ phase: 'loading', level });
  return (
    <div className="menu-screen">
      <h2 className="menu-subtitle">Select Level</h2>
      <div className="level-grid">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => {
          const locked = n > progress.unlocked;
          const score = progress.highscores[n];
          return (
            <button key={n} className="level-tile" disabled={locked} onClick={() => start(n)}>
              <span className="level-num">{locked ? '🔒' : n}</span>
              {score !== undefined && <span className="level-score">{score}</span>}
            </button>
          );
        })}
      </div>
      <div className="menu-buttons">
        <button onClick={() => set({ phase: 'menu' })}>Back</button>
      </div>
    </div>
  );
}

export function PauseOverlay() {
  const set = useGameStore((s) => s.set);
  const level = useGameStore((s) => s.level);
  return (
    <div className="menu-screen menu-overlay">
      <h2 className="menu-subtitle">Paused</h2>
      <div className="menu-buttons">
        <button onClick={() => set({ phase: 'playing' })}>Resume</button>
        <button onClick={() => set({ phase: 'loading', level })}>Restart Level</button>
        <button onClick={() => set({ phase: 'menu' })}>Main Menu</button>
      </div>
    </div>
  );
}

export function FinishedOverlay() {
  const { level, points, progress, set } = useGameStore();
  const nextUnlocked = level < 12 && progress.unlocked > level;
  return (
    <div className="menu-screen menu-overlay">
      <h2 className="menu-subtitle">Level {level} complete!</h2>
      <div className="finish-score">Score: {points}</div>
      <div className="menu-buttons">
        {nextUnlocked && <button onClick={() => set({ phase: 'loading', level: level + 1 })}>Next Level</button>}
        <button onClick={() => set({ phase: 'loading', level })}>Replay</button>
        <button onClick={() => set({ phase: 'menu' })}>Main Menu</button>
      </div>
    </div>
  );
}

export function GameOverOverlay() {
  const { level, set } = useGameStore();
  return (
    <div className="menu-screen menu-overlay">
      <h2 className="menu-subtitle">Game Over</h2>
      <div className="menu-buttons">
        <button onClick={() => set({ phase: 'loading', level })}>Try Again</button>
        <button onClick={() => set({ phase: 'menu' })}>Main Menu</button>
      </div>
    </div>
  );
}
