/**
 * Per-part physics parameters and joint layout of the original moduls
 * (numeric facts of the original game's physics tuning; see
 * docs/modul-physics.json and tools/extract-modul-physics.mjs).
 * Vectors are in prefab-local Virtools space; z is negated on use (LH->RH).
 */

export interface PartPhys {
  /** part name suffix within the prefab */
  suffix: string;
  fixed?: boolean;
  mass?: number;
  friction: number;
  elasticity: number;
  linearDamp?: number;
  rotDamp?: number;
  /** local mass-center shift (Virtools space) */
  shiftCom?: [number, number, number];
  /** start asleep until first contact (IVP "frozen") */
  startFrozen?: boolean;
  /** use trimesh collider (hollow/hooked shapes); default convex hull */
  trimesh?: boolean;
  /** sphere collider of this radius (loose balls) */
  sphereRadius?: number;
  /** sound surface when the ball hits this part */
  surface?: 'wood' | 'stone' | 'metal' | 'dome';
}

export interface HingeDef {
  /** dynamic part suffix */
  part: string;
  /** pin frame entity suffix providing the pivot position */
  pin: string;
  /** hinge axis in prefab-local space */
  axis: [number, number, number];
  /** other part suffix (undefined = world) */
  other?: string;
  /** spherical joint instead of revolute */
  spherical?: boolean;
}

export interface PrismaticDef {
  part: string;
  axis: [number, number, number];
  limits: [number, number];
  spring?: { stiffness: number; damping: number };
}

export interface ModulPhys {
  parts: PartPhys[];
  hinges?: HingeDef[];
  prismatics?: PrismaticDef[];
  /** alternating constant force (swing/sack style) */
  altForce?: { part: string; force: number; switchTime: number; delayTime?: number; axis: [number, number, number] };
}

const wood = { friction: 0.7, elasticity: 0.4 } as const;

export const MODUL_PHYS: Record<string, ModulPhys> = {
  P_Modul_01: {
    parts: [
      { suffix: '_Rinne', fixed: true, ...wood, surface: 'wood' },
      { suffix: '_Filler', fixed: true, ...wood, surface: 'wood' },
      {
        suffix: '_Pusher',
        mass: 3,
        friction: 0.6,
        elasticity: 0.4,
        linearDamp: 0.1,
        rotDamp: 1,
        shiftCom: [-0.45, 0, 0],
        startFrozen: true,
        surface: 'wood',
      },
    ],
  },
  P_Modul_03: {
    parts: [
      {
        suffix: '_Floor',
        mass: 3.2,
        friction: 0.7,
        elasticity: 0,
        linearDamp: 1,
        rotDamp: 3,
        shiftCom: [0, -2, 0],
        startFrozen: true,
        surface: 'wood',
      },
      ...['_Wall01', '_Wall02', '_Wall03', '_Wall04', '_Wall05', '_Wall06', '_Wall07'].map(
        (suffix): PartPhys => ({
          suffix,
          mass: 2,
          friction: 0.4,
          elasticity: 0.01,
          linearDamp: 0.5,
          rotDamp: 1.5,
          shiftCom: [0.15, -1, 0.15],
          startFrozen: true,
          surface: 'wood',
        }),
      ),
      {
        suffix: '_Gate',
        mass: 2,
        friction: 0.4,
        elasticity: 0,
        linearDamp: 0.5,
        rotDamp: 1,
        shiftCom: [0.15, -1, 0.15],
        startFrozen: true,
        surface: 'wood',
      },
    ],
    prismatics: [{ part: '_Floor', axis: [0, 1, 0], limits: [-30, 30], spring: { stiffness: 15, damping: 0.1 } }],
  },
  P_Modul_08: {
    parts: [
      {
        suffix: '_Schaukel',
        mass: 10,
        ...wood,
        linearDamp: 0.4,
        rotDamp: 0.1,
        trimesh: true,
        surface: 'wood',
      },
      { suffix: '_Fix', fixed: true, ...wood, surface: 'wood' },
    ],
    hinges: [{ part: '_Schaukel', pin: '_HingeFrame', axis: [0, 0, 1] }],
    altForce: { part: '_Schaukel', force: 1.1, switchTime: 0.5, delayTime: 0.5, axis: [1, 0, 0] },
  },
  P_Modul_17: {
    parts: [
      {
        suffix: '_Dreharme',
        mass: 3,
        ...wood,
        linearDamp: 3,
        rotDamp: 0.005,
        trimesh: true,
        surface: 'wood',
      },
    ],
    hinges: [{ part: '_Dreharme', pin: '_HingeFrame', axis: [0, 1, 0] }],
  },
  P_Modul_19: {
    parts: [
      { suffix: '_Axis', fixed: true, ...wood, surface: 'wood' },
      {
        suffix: '_Flaps',
        mass: 3,
        ...wood,
        linearDamp: 1,
        rotDamp: 0.05,
        shiftCom: [-1, 1, 0],
        startFrozen: true,
        surface: 'wood',
      },
    ],
    hinges: [{ part: '_Flaps', pin: '_HingeFrame', axis: [0, 1, 0] }],
  },
  P_Modul_25: {
    parts: [
      { suffix: '_Hinge_Col_Left', fixed: true, ...wood, surface: 'wood' },
      { suffix: '_Hinge_Col_Right', fixed: true, ...wood, surface: 'wood' },
      { suffix: '_Hinge', fixed: true, ...wood, surface: 'wood' },
      { suffix: '_Stopper_Left', mass: 0.5, ...wood, linearDamp: 0.1, rotDamp: 0.1, surface: 'wood' },
      { suffix: '_Stopper_Right', mass: 0.5, ...wood, linearDamp: 0.1, rotDamp: 0.1, surface: 'wood' },
      {
        suffix: '_Bridge',
        mass: 3,
        friction: 0.7,
        elasticity: 1,
        linearDamp: 1,
        rotDamp: 0.05,
        shiftCom: [0, 2, 0],
        startFrozen: true,
        trimesh: true,
        surface: 'wood',
      },
    ],
    hinges: [{ part: '_Bridge', pin: '_HingeFrame', axis: [0, 0, 1] }],
  },
  P_Modul_26: {
    parts: [
      { suffix: '_Halter', fixed: true, ...wood, surface: 'wood' },
      { suffix: '_Rope', mass: 1, ...wood, linearDamp: 0.1, rotDamp: 0.1, surface: 'wood' },
      { suffix: '_Sack', mass: 10, ...wood, linearDamp: 0.1, rotDamp: 0.1, surface: 'wood' },
    ],
    hinges: [
      { part: '_Rope', pin: '_Balljoint_oben', axis: [0, 0, 1], spherical: true },
      { part: '_Sack', pin: '_Balljoint_unten', axis: [0, 0, 1], other: '_Rope', spherical: true },
    ],
    altForce: { part: '_Sack', force: 0.25, switchTime: 1.4, axis: [0, 0, 1] },
  },
  P_Modul_29: {
    parts: ['01', '02', '03', '04', '05', '06', '07', '08', '09'].map(
      (n): PartPhys => ({
        suffix: `_Platte${n}`,
        mass: 0.5,
        ...wood,
        linearDamp: 0.1,
        rotDamp: 0.3,
        startFrozen: true,
        surface: 'wood',
      }),
    ),
    // chain: world -HF01- P01 -HF02- P02 ... P09 -HF10- world
    hinges: [
      { part: '_Platte01', pin: '_HingeFrame01', axis: [0, 0, 1] },
      ...['02', '03', '04', '05', '06', '07', '08', '09'].map((n, i) => ({
        part: `_Platte${n}`,
        pin: `_HingeFrame${n}`,
        axis: [0, 0, 1] as [number, number, number],
        other: `_Platte${String(i + 1).padStart(2, '0')}`,
      })),
      { part: '_Platte09', pin: '_HingeFrame10', axis: [0, 0, 1] },
    ],
  },
  P_Modul_30: {
    parts: [
      {
        suffix: '_Wippe',
        mass: 3,
        ...wood,
        linearDamp: 1,
        rotDamp: 1,
        shiftCom: [0.5, 5, 0],
        startFrozen: true,
        trimesh: true,
        surface: 'wood',
      },
    ],
    hinges: [{ part: '_Wippe', pin: '_HingeFrame', axis: [0, 0, 1] }],
  },
  P_Modul_34: {
    parts: [
      { suffix: '_Slider_Frame01', fixed: true, friction: 0.5, elasticity: 0.4, surface: 'stone' },
      { suffix: '_Slider_Frame02', fixed: true, friction: 0.5, elasticity: 0.4, surface: 'stone' },
      {
        suffix: '_Schiebestein',
        mass: 1.6,
        friction: 0.5,
        elasticity: 0.4,
        linearDamp: 0.1,
        rotDamp: 0.1,
        startFrozen: true,
        surface: 'stone',
      },
      {
        suffix: '_Kiste',
        mass: 1.4,
        friction: 0.6,
        elasticity: 0.3,
        linearDamp: 0.1,
        rotDamp: 0.1,
        startFrozen: true,
        surface: 'wood',
      },
    ],
    prismatics: [{ part: '_Schiebestein', axis: [0, 0, 1], limits: [-1000, 1000] }],
  },
  P_Modul_37: {
    parts: [
      { suffix: '_Hinge', fixed: true, ...wood, surface: 'wood' },
      {
        suffix: '_Bridge',
        mass: 3,
        friction: 0.7,
        elasticity: 0.5,
        linearDamp: 1,
        rotDamp: 0.1,
        shiftCom: [5, 0.5, 0],
        startFrozen: true,
        surface: 'wood',
      },
    ],
    hinges: [{ part: '_Bridge', pin: '_HingeFrame', axis: [0, 0, 1] }],
  },
  P_Modul_41: {
    parts: [
      {
        suffix: 'Modul_41',
        mass: 1,
        ...wood,
        linearDamp: 0.1,
        rotDamp: 0.1,
        shiftCom: [0, -1, 0],
        surface: 'wood',
      },
    ],
    hinges: [{ part: 'Modul_41', pin: '_HingeFrame', axis: [0, 0, 1] }],
  },
  P_Box: {
    parts: [{ suffix: 'Box_MF', mass: 1, friction: 0.7, elasticity: 0.3, linearDamp: 0.1, rotDamp: 0.1, surface: 'wood' }],
  },
  // loose pushable balls placed on the course
  P_Ball_Paper: {
    // original physicalizes loose paper balls as their crumpled mesh (UseBall 0)
    parts: [
      {
        suffix: 'Paper_MF',
        mass: 0.2,
        friction: 0.5,
        elasticity: 0.4,
        linearDamp: 1.5,
        rotDamp: 0.1,
        surface: 'wood',
      },
    ],
  },
  P_Ball_Wood: {
    parts: [
      {
        suffix: 'Wood_MF',
        mass: 2,
        friction: 0.6,
        elasticity: 0.2,
        linearDamp: 0.6,
        rotDamp: 0.1,
        sphereRadius: 2,
        surface: 'wood',
      },
    ],
  },
  P_Ball_Stone: {
    parts: [
      {
        suffix: 'Stone_MF',
        mass: 10,
        friction: 0.8,
        elasticity: 0.1,
        linearDamp: 0.2,
        rotDamp: 0.1,
        sphereRadius: 2,
        surface: 'stone',
      },
    ],
  },
  P_Dome: {
    // the dome has its own hit-sound layer (Hit_Wood_Dome / Hit_Stone_Kuppel)
    parts: [{ suffix: 'Dome_MF', fixed: true, friction: 0.2, elasticity: 0.8, trimesh: true, surface: 'dome' }],
  },
};

/** fan updraft: per-PSI force applied to the ball while inside the wind volume */
export const MODUL18_FORCE = 0.1;
/** stone-only break trigger of the plank bridge */
export const MODUL29_TRIGGER_PLATE = '_Platte05';
