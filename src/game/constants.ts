/**
 * Faithful gameplay constants. Numeric values match the original game's
 * physics parameterization (as documented by the Ballance community's
 * reverse engineering of the original IVP-based physics).
 */

export const GRAVITY_Y = -20;
export const SIM_RATE = 66; // original physics PSI rate (Hz)
export const SIM_DT = 1 / SIM_RATE;

export type BallKind = 'paper' | 'wood' | 'stone';

export interface BallDef {
  kind: BallKind;
  /** entity name inside Balls.nmo */
  entityName: string;
  /** per-tick push impulse magnitude (IVP constant-force units) */
  force: number;
  friction: number;
  elasticity: number;
  mass: number;
  linearDamp: number;
  rotDamp: number;
  radius: number;
  piecesMinForce: number;
  piecesMaxForce: number;
}

export const BALL_DEFS: Record<BallKind, BallDef> = {
  wood: {
    kind: 'wood',
    entityName: 'Ball_Wood',
    force: 0.43,
    friction: 0.8,
    elasticity: 0.2,
    mass: 1.9,
    linearDamp: 0.9,
    rotDamp: 0.1,
    radius: 2,
    piecesMinForce: 1.5,
    piecesMaxForce: 3,
  },
  stone: {
    kind: 'stone',
    entityName: 'Ball_Stone',
    force: 0.92,
    friction: 0.5,
    elasticity: 0.1,
    mass: 10,
    linearDamp: 0.3,
    rotDamp: 0.1,
    radius: 2,
    piecesMinForce: 8,
    piecesMaxForce: 16,
  },
  paper: {
    kind: 'paper',
    entityName: 'Ball_Paper',
    force: 0.065,
    friction: 0.5,
    elasticity: 0.4,
    mass: 0.2,
    linearDamp: 1.3,
    rotDamp: 0.1,
    radius: 2,
    piecesMinForce: 0.3,
    piecesMaxForce: 1.3,
  },
};

/** Push force is a constant force; IVP applied it per-PSI, so scale by rate. */
export const FORCE_SCALE = SIM_RATE;

export interface FloorDef {
  friction: number;
  elasticity: number;
  /** sound surface: wood | metal | stone */
  surface: 'wood' | 'metal' | 'stone';
  /** floor's own impact sound (wooden flaps), volume = impact/10 */
  hitSound?: string;
}

export const FLOOR_GROUPS: Record<string, FloorDef> = {
  Phys_Floors: { friction: 0.7, elasticity: 0.3, surface: 'stone' },
  Phys_FloorWoods: { friction: 0.7, elasticity: 0.3, surface: 'wood' },
  Phys_FloorRails: { friction: 0.7, elasticity: 0.3, surface: 'metal' },
  Phys_FloorStopper: { friction: 0.7, elasticity: 0.5, surface: 'wood', hitSound: 'Hit_WoodenFlap.wav' },
};

/** Camera rig (original follow values). */
export const CAM_NORMAL_Y = 30;
export const CAM_NORMAL_Z = 17;
export const CAM_SPACE_Y = 55;
export const CAM_SPACE_Z = 8;
export const CAM_ROTATE_TIME = 0.3; // seconds per 90° step
export const CAM_LIFT_UP_TIME = 0.8; // original overview raise
export const CAM_LIFT_DOWN_TIME = 1.3; // original overview drop
export const CAM_FOLLOW_SPEED = 0.05;
export const CAM_FOV = 60;
