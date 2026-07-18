import { useEffect } from 'react';
import GameCanvas from './GameCanvas.tsx';
import { useGameStore } from './game/store.ts';
import Hud from './ui/Hud.tsx';
import MenuBackdrop from './ui/MenuBackdrop.tsx';
import { FinishedOverlay, GameOverOverlay, LevelSelect, MainMenu, PauseOverlay } from './ui/Menus.tsx';

const IN_GAME = new Set(['loading', 'playing', 'paused', 'dead', 'finished', 'gameover']);

export default function App() {
  const phase = useGameStore((s) => s.phase);
  const level = useGameStore((s) => s.level);
  const set = useGameStore((s) => s.set);

  // dev shortcut: ?level=N boots straight into a level
  useEffect(() => {
    const n = Number(new URLSearchParams(window.location.search).get('level'));
    if (n >= 1 && n <= 12) set({ phase: 'loading', level: n });
  }, [set]);

  // Esc toggles pause while in-game
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      const p = useGameStore.getState().phase;
      if (p === 'playing') set({ phase: 'paused' });
      else if (p === 'paused') set({ phase: 'playing' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [set]);

  const inGame = IN_GAME.has(phase);
  const inMenus = phase === 'menu' || phase === 'levelselect';
  return (
    <>
      {inGame && <GameCanvas key={`level-${level}`} level={level} />}
      {inGame && <Hud />}
      {inMenus && <MenuBackdrop />}
      {phase === 'menu' && <MainMenu />}
      {phase === 'levelselect' && <LevelSelect />}
      {phase === 'paused' && <PauseOverlay />}
      {phase === 'finished' && <FinishedOverlay />}
      {phase === 'gameover' && <GameOverOverlay />}
    </>
  );
}
