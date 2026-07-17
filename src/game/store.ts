/** Shared game state bridge between the engine loop and the React UI. */
import { create } from 'zustand';
import type { BallKind } from './constants.ts';

export type GamePhase = 'loading' | 'playing' | 'dead' | 'finished' | 'gameover';

export interface GameState {
  phase: GamePhase;
  level: number;
  lives: number;
  points: number;
  sector: number;
  sectorCount: number;
  ballKind: BallKind;
  set: (partial: Partial<GameState>) => void;
}

export const useGameStore = create<GameState>((set) => ({
  phase: 'loading',
  level: 1,
  lives: 3,
  points: 1000,
  sector: 1,
  sectorCount: 1,
  ballKind: 'wood',
  set: (partial) => set(partial),
}));

/** Imperative accessor for engine code (outside React). */
export const gameStore = useGameStore;
