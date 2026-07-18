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

export interface ScoreEntry {
  name: string;
  score: number;
  date: string;
}

export interface Progress {
  /** highest unlocked level (1-12) */
  unlocked: number;
  /** best score per level (index 1..12) */
  highscores: Record<number, number>;
  /** per-level top-10 tables (original defaults: Mr. Default, 2004/8/8) */
  tables: Record<number, ScoreEntry[]>;
}

/** the original default leaderboard seeds */
export function defaultTable(level: number): ScoreEntry[] {
  const top = level === 12 ? 7000 : 4000;
  const bottom = level === 12 ? 3600 : 400;
  const step = (top - bottom) / 9;
  return Array.from({ length: 10 }, (_, i) => ({
    name: 'Mr. Default',
    score: Math.round((top - step * i) / 10) * 10,
    date: '2004/8/8',
  }));
}

export interface Settings {
  musicVolume: number;
  sfxVolume: number;
  /** original Graphics option: the drifting cloud layer on/off */
  clouds: boolean;
}

const STORAGE_KEY = 'ballance-save';

function loadSave(): { progress: Progress; settings: Settings } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as { progress?: Partial<Progress>; settings?: Partial<Settings> };
      return {
        progress: {
          unlocked: data.progress?.unlocked ?? 1,
          highscores: data.progress?.highscores ?? {},
          tables: data.progress?.tables ?? {},
        },
        settings: {
          musicVolume: data.settings?.musicVolume ?? 0.55,
          sfxVolume: data.settings?.sfxVolume ?? 1,
          clouds: data.settings?.clouds ?? true,
        },
      };
    }
  } catch {
    /* fresh save */
  }
  return { progress: { unlocked: 1, highscores: {}, tables: {} }, settings: { musicVolume: 0.55, sfxVolume: 1, clouds: true } };
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
  /** the win tally appears 6s after the finish trigger */
  winScreen: boolean;
  progress: Progress;
  settings: Settings;
  set: (partial: Partial<GameState>) => void;
  completeLevel: (level: number, score: number) => void;
  /** insert a named entry into the level's top-10 (original leaderboard) */
  submitScore: (level: number, name: string, score: number) => void;
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
  winScreen: false,
  progress: initial.progress,
  settings: initial.settings,
  set: (partial) => set(partial),
  completeLevel: (level, score) => {
    const { progress, settings } = get();
    const next: Progress = {
      ...progress,
      unlocked: Math.max(progress.unlocked, Math.min(12, level + 1)),
      highscores: { ...progress.highscores, [level]: Math.max(progress.highscores[level] ?? 0, score) },
    };
    persist(next, settings);
    set({ progress: next });
  },
  submitScore: (level, name, score) => {
    const { progress, settings } = get();
    const table = [...(progress.tables[level] ?? defaultTable(level))];
    const now = new Date();
    table.push({
      name: name.trim() === '' ? 'Player' : name.trim().slice(0, 16),
      score,
      date: `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`,
    });
    table.sort((a, b) => b.score - a.score);
    const next: Progress = { ...progress, tables: { ...progress.tables, [level]: table.slice(0, 10) } };
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
