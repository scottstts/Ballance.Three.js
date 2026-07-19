/** Faithful gameplay constants decoded from the original game data and DLLs. */

export const GRAVITY_Y = -20;
export const SIM_RATE = 66; // original physics PSI rate (Hz)
export const SIM_DT = 1 / SIM_RATE;

/** Gameplay.nmo/Energy row 0, converted to seconds where appropriate. */
export const LEVEL_START_POINTS = 1000;
export const LEVEL_START_LIVES = 3;
export const POINT_COUNT_INTERVAL = 0.5;
export const LIFE_BONUS_POINTS = 200;

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
  },
  paper: {
    kind: 'paper',
    entityName: 'Ball_Paper',
    force: 0.065,
    friction: 0.5,
    elasticity: 0.4,
    mass: 0.2,
    linearDamp: 1.5,
    rotDamp: 0.1,
    radius: 2,
  },
};

/** SetPhysicsForce queues its authored value as one impulse per IVP PSI. */
export const FORCE_SCALE = SIM_RATE;

export interface FloorDef {
  friction: number;
  elasticity: number;
  /** sound surface: wood | metal | stone */
  surface: 'wood' | 'metal' | 'stone';
  /** floor's own impact sound (wooden flaps), volume = impact/10 */
  hitSound?: string;
}

/** Levelinit.nmo/Physicalize_Floors: exactly these three groups exist. */
export const FLOOR_GROUPS: Record<string, FloorDef> = {
  Phys_Floors: { friction: 0.7, elasticity: 0.3, surface: 'stone' },
  Phys_FloorRails: { friction: 0.7, elasticity: 0.3, surface: 'metal' },
  Phys_FloorStopper: { friction: 0.7, elasticity: 0.3, surface: 'wood', hitSound: 'Hit_WoodenFlap.wav' },
};

/** Camera.nmo's authored Cam_Pos translation after the Z handedness flip. */
export const CAM_SLOT_OFFSET: readonly [number, number, number] = [
  21.999879837036133,
  34.99972915649414,
  -0.000035961405956186354,
];
/** Camera.nmo's initial InGameCam world position after the Z handedness flip. */
export const CAM_INITIAL_POSITION: readonly [number, number, number] = [
  Math.fround(21.999588),
  34.99931335449219,
  -0.00004169824023847468,
];

/** Gameplay.nmo's two continuously-running TT Set Dynamic Position nodes. */
export const CAM_TARGET_FORCE: readonly [number, number, number] = [10, 10, 10];
export const CAM_TARGET_DAMPING: readonly [number, number, number] = [0, 0, 0];
export const CAM_POSITION_FORCE: readonly [number, number, number] = [5, 0.800000011920929, 5];
export const CAM_POSITION_OVERVIEW_FORCE: readonly [number, number, number] = [5, 2, 5];
export const CAM_POSITION_DAMPING: readonly [number, number, number] = [0.5, 0.30000001192092896, 0.5];
/** CamUp changes the controller offset Y to -50, placing the camera 50 units higher. */
export const CAM_OVERVIEW_OFFSET: readonly [number, number, number] = [0, -50, 0];

export const CAM_ROTATE_TIME = 0.25; // seconds per source-authored 90-degree step
export const CAM_FOV = 58;
export const CAM_NEAR = 3;
export const CAM_FAR = 1200;

/** Gameplay.nmo Deactivate Ball / New Ball timing, in seconds. */
export const BALL_OFF_DELAY = 1;
export const BALL_BIRTH_DELAY = 3;
export const DEATH_FADE_DURATION = 2;

/** Gameplay_Events end-flow timing, decoded from Gameplay.nmo's graphs. */
export const GAME_OVER_MENU_DELAY = 2;
/** Level_Finish reaches Counter inactive/Set Parent through a two-frame link. */
export const FINISH_HANDOFF_FRAME_DELAY = 2;
export const FINISH_HANDOFF_DELAY = FINISH_HANDOFF_FRAME_DELAY * SIM_DT;
export const FINISH_SKY_FADE_DURATION = 3;
export const FINISH_WAIT_DURATION = 10;
export const FINAL_FINISH_WAIT_DURATION = 23;
/** DirectInput scan codes 1, 28, and 57 in the source's `3 keys` graph. */
export const FINISH_SKIP_KEYS = ['Escape', 'Enter', 'Space'] as const;

export function finishMenuDelay(level: number): number {
  return FINISH_SKY_FADE_DURATION + (level < 12 ? FINISH_WAIT_DURATION : FINAL_FINISH_WAIT_DURATION);
}
