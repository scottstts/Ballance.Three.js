/** Shared game state bridge between the engine loop and the React UI. */
import { create } from 'zustand';
import type { BallKind } from './constants.ts';

export type GamePhase =
  | 'menu'
  | 'levelselect'
  | 'highscore'
  | 'options'
  | 'credits'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'dead'
  | 'finished'
  | 'gameover';

export interface Progress {
  /** highest unlocked level (1-12) */
  unlocked: number;
  /** best score per level (index 1..12) */
  highscores: Record<number, number>;
}

export interface Settings {
  musicVolume: number;
  sfxVolume: number;
}

const STORAGE_KEY = 'ballance-save';

function loadSave(): { progress: Progress; settings: Settings } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as { progress?: Partial<Progress>; settings?: Partial<Settings> };
      return {
        progress: { unlocked: data.progress?.unlocked ?? 1, highscores: data.progress?.highscores ?? {} },
        settings: { musicVolume: data.settings?.musicVolume ?? 0.55, sfxVolume: data.settings?.sfxVolume ?? 1 },
      };
    }
  } catch {
    /* fresh save */
  }
  return { progress: { unlocked: 1, highscores: {} }, settings: { musicVolume: 0.55, sfxVolume: 1 } };
}

function persist(progress: Progress, settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ progress, settings }));
  } catch {
    /* storage unavailable */
  }
}

export interface GameState {
  phase: GamePhase;
  level: number;
  lives: number;
  points: number;
  sector: number;
  sectorCount: number;
  ballKind: BallKind;
  /** white screen fade during the fall-death transition */
  whiteFade: boolean;
  progress: Progress;
  settings: Settings;
  set: (partial: Partial<GameState>) => void;
  completeLevel: (level: number, score: number) => void;
  updateSettings: (s: Partial<Settings>) => void;
}

const initial = loadSave();

export const useGameStore = create<GameState>((set, get) => ({
  phase: 'menu',
  level: 1,
  lives: 3,
  points: 1000,
  sector: 1,
  sectorCount: 1,
  ballKind: 'wood',
  whiteFade: false,
  progress: initial.progress,
  settings: initial.settings,
  set: (partial) => set(partial),
  completeLevel: (level, score) => {
    const { progress, settings } = get();
    const next: Progress = {
      unlocked: Math.max(progress.unlocked, Math.min(12, level + 1)),
      highscores: { ...progress.highscores, [level]: Math.max(progress.highscores[level] ?? 0, score) },
    };
    persist(next, settings);
    set({ progress: next });
  },
  updateSettings: (s) => {
    const { progress, settings } = get();
    const next = { ...settings, ...s };
    persist(progress, next);
    set({ settings: next });
  },
}));

/** Imperative accessor for engine code (outside React). */
export const gameStore = useGameStore;
