import { useEffect } from 'react';
import GameCanvas from './GameCanvas.tsx';
import { useGameStore } from './game/store.ts';
import Hud from './ui/Hud.tsx';
import IntroScreen from './ui/IntroScreen.tsx';
import MenuBackdrop from './ui/MenuBackdrop.tsx';
import TutorialOverlay from './ui/TutorialOverlay.tsx';
import {
  CreditsScreen,
  FinishedOverlay,
  GameOverOverlay,
  HighscoreScreen,
  LevelSelect,
  MainMenu,
  OptionsScreen,
  PauseOverlay,
} from './ui/Menus.tsx';

const IN_GAME = new Set([
  'loading',
  'playing',
  'paused',
  'dead',
  'finished',
  'gameover',
  'pauseOptions',
  'pauseHighscore',
]);

export default function App() {
  const phase = useGameStore((s) => s.phase);
  const level = useGameStore((s) => s.level);
  const runId = useGameStore((s) => s.runId);
  const whiteFade = useGameStore((s) => s.whiteFade);
  const winScreen = useGameStore((s) => s.winScreen);
  const set = useGameStore((s) => s.set);
  const loadLevel = useGameStore((s) => s.loadLevel);

  // dev shortcut: ?level=N boots straight into a level
  useEffect(() => {
    const n = Number(new URLSearchParams(window.location.search).get('level'));
    if (n >= 1 && n <= 12) loadLevel(n);
  }, [loadLevel]);

  // Esc toggles pause while in-game
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      const p = useGameStore.getState().phase;
      if (p === 'playing') set({ phase: 'paused' });
      else if (p === 'paused') set({ phase: 'playing' });
      else if (p === 'pauseOptions' || p === 'pauseHighscore') set({ phase: 'paused' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [set]);

  const inGame = IN_GAME.has(phase);
  const inMenus = ['menu', 'levelselect', 'highscore', 'options', 'credits'].includes(phase);
  return (
    <div className="game-frame">
      {inGame && <GameCanvas key={`level-${level}-run-${runId}`} level={level} />}
      {inGame && phase !== 'loading' && <Hud />}
      {inGame && <TutorialOverlay />}
      {inMenus && <MenuBackdrop />}
      {phase === 'intro' && <IntroScreen />}
      {phase === 'menu' && <MainMenu />}
      {phase === 'levelselect' && <LevelSelect />}
      {phase === 'highscore' && <HighscoreScreen />}
      {phase === 'options' && <OptionsScreen />}
      {phase === 'pauseHighscore' && <HighscoreScreen backPhase="paused" />}
      {phase === 'pauseOptions' && <OptionsScreen backPhase="paused" />}
      {phase === 'credits' && <CreditsScreen />}
      {phase === 'paused' && <PauseOverlay />}
      {phase === 'finished' && winScreen && <FinishedOverlay />}
      {phase === 'gameover' && <GameOverOverlay />}
      {inGame && <div className={`white-fade${whiteFade ? ' white-fade-on' : ''}`} />}
    </div>
  );
}
