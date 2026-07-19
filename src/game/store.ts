/** Shared game state bridge between the engine loop and the React UI. */
import { create } from 'zustand';
import { LEVEL_START_LIVES, LEVEL_START_POINTS, type BallKind } from './constants.ts';
import { SOURCE_DEFAULT_LAST_PLAYER, SOURCE_HIGHSCORE_NAME_MAX_LENGTH } from './score.ts';
import { DEFAULT_SETTINGS, isSourceKey, SCREEN_MODES, type Settings } from './settings.ts';

export type { Settings } from './settings.ts';

export type GamePhase =
  | 'intro'
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
  | 'gameover'
  | 'pauseOptions'
  | 'pauseHighscore';

export interface ScoreEntry {
  name: string;
  score: number;
}

export interface Progress {
  /** highest unlocked level (1-12) */
  unlocked: number;
  /** best score per level (index 1..12) */
  highscores: Record<number, number>;
  /** per-level top-10 tables */
  tables: Record<number, ScoreEntry[]>;
}

/** the original default leaderboard seeds */
export function defaultTable(level: number): ScoreEntry[] {
  const isLastLevel = level === 12;
  const top = isLastLevel ? 7000 : 4000;
  return Array.from({ length: 10 }, (_, i) => ({
    name: isLastLevel ? 'Mrs. Default' : 'Mr. Default',
    score: top - i * 400,
  }));
}

const STORAGE_KEY = 'ballance-save';

function loadSettings(saved: Partial<Settings> | undefined): Settings {
  const key = (value: unknown, fallback: string) =>
    typeof value === 'string' && isSourceKey(value) ? value : fallback;
  const volume = typeof saved?.musicVolume === 'number' ? saved.musicVolume : DEFAULT_SETTINGS.musicVolume;
  const mode = typeof saved?.screenMode === 'number' ? Math.trunc(saved.screenMode) : DEFAULT_SETTINGS.screenMode;
  return {
    musicVolume: Math.max(0, Math.min(1, volume)),
    syncToScreen: saved?.syncToScreen ?? DEFAULT_SETTINGS.syncToScreen,
    screenMode: Math.max(0, Math.min(SCREEN_MODES.length - 1, mode)),
    keyForward: key(saved?.keyForward, DEFAULT_SETTINGS.keyForward),
    keyBackward: key(saved?.keyBackward, DEFAULT_SETTINGS.keyBackward),
    keyLeft: key(saved?.keyLeft, DEFAULT_SETTINGS.keyLeft),
    keyRight: key(saved?.keyRight, DEFAULT_SETTINGS.keyRight),
    keyRotateCamera: key(saved?.keyRotateCamera, DEFAULT_SETTINGS.keyRotateCamera),
    keyLiftCamera: key(saved?.keyLiftCamera, DEFAULT_SETTINGS.keyLiftCamera),
    invertCameraRotation: saved?.invertCameraRotation ?? DEFAULT_SETTINGS.invertCameraRotation,
    clouds: saved?.clouds ?? DEFAULT_SETTINGS.clouds,
  };
}

function sourcePlayerName(value: unknown): string {
  return typeof value === 'string'
    ? value.slice(0, SOURCE_HIGHSCORE_NAME_MAX_LENGTH)
    : SOURCE_DEFAULT_LAST_PLAYER;
}

function loadSave(): { progress: Progress; settings: Settings; lastPlayer: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as {
        progress?: Partial<Progress>;
        settings?: Partial<Settings>;
        lastPlayer?: unknown;
      };
      return {
        progress: {
          unlocked: data.progress?.unlocked ?? 1,
          highscores: data.progress?.highscores ?? {},
          tables: data.progress?.tables ?? {},
        },
        settings: loadSettings(data.settings),
        lastPlayer: sourcePlayerName(data.lastPlayer),
      };
    }
  } catch {
    /* fresh save */
  }
  return {
    progress: { unlocked: 1, highscores: {}, tables: {} },
    settings: { ...DEFAULT_SETTINGS },
    lastPlayer: SOURCE_DEFAULT_LAST_PLAYER,
  };
}

function persist(progress: Progress, settings: Settings, lastPlayer: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ progress, settings, lastPlayer }));
  } catch {
    /* storage unavailable */
  }
}

export interface GameState {
  phase: GamePhase;
  /** increments for every authored Load/Reset/Next Level message */
  runId: number;
  level: number;
  lives: number;
  points: number;
  sector: number;
  sectorCount: number;
  ballKind: BallKind;
  /** white screen fade during the fall-death transition */
  whiteFade: boolean;
  /** Menu_Score is activated by the source-authored End Level handoff. */
  winScreen: boolean;
  /** Authored level-1 tutorial row currently shown, or null when inactive. */
  tutorialChapter: number | null;
  /** Tutorial.nmo's independently animated lower-screen backing panel. */
  tutorialPanelVisible: boolean;
  tutorialVisible: boolean;
  progress: Progress;
  settings: Settings;
  /** DB_Options.LastPlayer, used to reset the next authored name entry. */
  lastPlayer: string;
  set: (partial: Partial<GameState>) => void;
  loadLevel: (level: number) => void;
  completeLevel: (level: number, score: number) => void;
  /** insert a named entry into the level's top-10 (original leaderboard) */
  submitScore: (level: number, name: string, score: number) => void;
  updateSettings: (s: Partial<Settings>) => void;
}

const initial = loadSave();

export const useGameStore = create<GameState>((set, get) => ({
  phase: 'intro',
  runId: 0,
  level: 1,
  lives: LEVEL_START_LIVES,
  points: LEVEL_START_POINTS,
  sector: 1,
  sectorCount: 1,
  ballKind: 'wood',
  whiteFade: false,
  winScreen: false,
  tutorialChapter: null,
  tutorialPanelVisible: false,
  tutorialVisible: false,
  progress: initial.progress,
  settings: initial.settings,
  lastPlayer: initial.lastPlayer,
  set: (partial) => set(partial),
  loadLevel: (level) =>
    set((state) => ({
      phase: 'loading',
      level: Math.max(1, Math.min(12, Math.trunc(level))),
      runId: state.runId + 1,
    })),
  completeLevel: (level, score) => {
    const { progress, settings, lastPlayer } = get();
    const next: Progress = {
      ...progress,
      unlocked: Math.max(progress.unlocked, Math.min(12, level + 1)),
      highscores: { ...progress.highscores, [level]: Math.max(progress.highscores[level] ?? 0, score) },
    };
    persist(next, settings, lastPlayer);
    set({ progress: next });
  },
  submitScore: (level, name, score) => {
    const { progress, settings } = get();
    const lastPlayer = name.slice(0, SOURCE_HIGHSCORE_NAME_MAX_LENGTH);
    const table = [...(progress.tables[level] ?? defaultTable(level))];
    table.push({
      name: lastPlayer,
      score,
    });
    table.sort((a, b) => b.score - a.score);
    const next: Progress = { ...progress, tables: { ...progress.tables, [level]: table.slice(0, 10) } };
    persist(next, settings, lastPlayer);
    set({ progress: next, lastPlayer });
  },
  updateSettings: (s) => {
    const { progress, settings, lastPlayer } = get();
    const next = { ...settings, ...s };
    persist(progress, next, lastPlayer);
    set({ settings: next });
  },
}));

/** Imperative accessor for engine code (outside React). */
export const gameStore = useGameStore;
