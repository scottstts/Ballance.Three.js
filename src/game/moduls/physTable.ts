/**
 * Per-part physics parameters and joint layout of the original moduls
 * Decoded directly from the original PH/*.nmo Physicalize/joint behaviors;
 * tools/extract-source-physics.ts is the repeatable inspection path.
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
  /** authored convex collision CKMesh names (compound collider in list order) */
  collisionMeshes?: string[];
  /** original Enable Collision input; false still creates a jointable body */
  collisionEnabled?: boolean;
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
  /** axis in pin-frame local space; Virtools hinges use the frame's local Z */
  axis?: [number, number, number];
  /** other part suffix (undefined = world) */
  other?: string;
  /** spherical joint instead of revolute */
  spherical?: boolean;
  /** radians; absent when the source Limitations input is false */
  limits?: [number, number];
}

export interface PrismaticDef {
  part: string;
  /** authored axis reference points; direction is first -> second */
  points: [string, string];
  /** absent when the source Limitations input is false */
  limits?: [number, number];
}

export interface SpringDef {
  part: string;
  other?: string;
  anchor1: { ref: string; position: [number, number, number] };
  anchor2: { ref: string; position: [number, number, number] };
  length: number;
  stiffness: number;
  damping: number;
}

export interface ModulPhys {
  parts: PartPhys[];
  hinges?: HingeDef[];
  prismatics?: PrismaticDef[];
  springs?: SpringDef[];
  /** alternating constant force (swing/sack style) */
  altForce?: {
    part: string;
    force: number;
    switchTime: number;
    delayTime?: number;
    axis: [number, number, number];
    reference?: string;
    startState?: number;
  };
}

const wood = { friction: 0.7, elasticity: 0.4 } as const;

export const MODUL_PHYS: Record<string, ModulPhys> = {
  P_Modul_01: {
    parts: [
      {
        suffix: '_Rinne',
        fixed: true,
        ...wood,
        shiftCom: [0, 0, 0],
        collisionMeshes: [
          'P_Modul_01_Rinne_01_Mesh',
          'P_Modul_01_Rinne_02_Mesh',
          'P_Modul_01_Rinne_03_Mesh',
        ],
        surface: 'wood',
      },
      {
        suffix: '_Filler',
        fixed: true,
        ...wood,
        shiftCom: [0, 0, 0],
        collisionMeshes: ['P_Modul_01_Filler_Mesh'],
        surface: 'wood',
      },
      {
        suffix: '_Pusher',
        mass: 3,
        friction: 0.6,
        elasticity: 0.4,
        linearDamp: 0.1,
        rotDamp: 1,
        shiftCom: [0, 0, 0],
        startFrozen: true,
        collisionMeshes: ['P_Modul_01_Col01_Mesh', 'P_Modul_01_Col02_Mesh', 'P_Modul_01_Col03_Mesh'],
        surface: 'wood',
      },
    ],
  },
  P_Modul_03: {
    parts: [
      {
        suffix: '_Floor',
        mass: 3,
        friction: 0.7,
        elasticity: 0,
        linearDamp: 1,
        rotDamp: 3,
        shiftCom: [0, 0, 0],
        startFrozen: true,
        collisionMeshes: ['P_Modul_03_Floor_Mesh'],
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
          shiftCom: [0, 0, 0],
          startFrozen: true,
          collisionMeshes: ['P_Modul_03_Wall_Coll_Mesh'],
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
        shiftCom: [0, 0, 0],
        startFrozen: true,
        collisionMeshes: [
          'P_Modul_03_Gate_Coll01_Mesh',
          'P_Modul_03_Gate_Coll02_Mesh',
          'P_Modul_03_Gate_Coll03_Mesh',
        ],
        surface: 'wood',
      },
    ],
    prismatics: [{ part: '_Floor', points: ['_frame_low', '_frame_high'] }],
    springs: [
      {
        part: '_Floor',
        anchor1: { ref: '_frame_low', position: [0, 0, 0] },
        anchor2: { ref: '_frame_high', position: [0, 0, 0] },
        length: 0,
        stiffness: 15,
        damping: 0.1,
      },
    ],
  },
  P_Modul_08: {
    parts: [
      {
        suffix: '_Schaukel',
        mass: 10,
        ...wood,
        linearDamp: 0.4,
        rotDamp: 0.1,
        shiftCom: [0, 0, 0],
        startFrozen: true,
        collisionMeshes: [
          'P_Modul_08_Col1_Mesh',
          'P_Modul_08_Col2_Mesh',
          'P_Modul_08_Col3_Mesh',
          'P_Modul_08_Col4_Mesh',
          'P_Modul_08_Col5_Mesh',
          'P_Modul_08_Col6_Mesh',
        ],
        surface: 'wood',
      },
    ],
    hinges: [{ part: '_Schaukel', pin: '_HingeFrame' }],
    altForce: {
      part: '_Schaukel',
      force: 1.1,
      switchTime: 0.5,
      delayTime: 0.5,
      axis: [0, 0, 1],
      reference: '_Fix',
      startState: 1,
    },
  },
  P_Modul_17: {
    parts: [
      {
        suffix: '_Dreharme',
        mass: 3,
        ...wood,
        linearDamp: 3,
        rotDamp: 0.005,
        shiftCom: [0, 0, 0],
        collisionMeshes: ['P_Modul_17_Col01_Mesh', 'P_Modul_17_Col02_Mesh', 'P_Modul_17_Col03_Mesh'],
        surface: 'wood',
      },
    ],
    hinges: [{ part: '_Dreharme', pin: '_HingeFrame' }],
    springs: [
      {
        part: '_Dreharme',
        anchor1: { ref: '_HingeFrame', position: [0, 4, 0] },
        anchor2: { ref: '_Dreharme', position: [0, 0, -4] },
        length: 0,
        stiffness: 0.32,
        damping: 0.1,
      },
    ],
  },
  P_Modul_19: {
    parts: [
      {
        suffix: '_Flaps',
        mass: 3,
        ...wood,
        linearDamp: 1,
        rotDamp: 0.05,
        shiftCom: [1, 1, 0],
        startFrozen: true,
        collisionMeshes: [
          'P_Modul_19_Col1_Mesh',
          'P_Modul_19_Col2_Mesh',
          'P_Modul_19_Col3_Mesh',
          'P_Modul_19_Col4_Mesh',
        ],
        surface: 'wood',
      },
    ],
    hinges: [{ part: '_Flaps', pin: '_HingeFrame' }],
  },
  P_Modul_25: {
    parts: [
      {
        suffix: '_Bridge',
        mass: 3,
        friction: 0.7,
        elasticity: 1,
        linearDamp: 1,
        rotDamp: 0.05,
        shiftCom: [-2.5, 0.2, 0],
        startFrozen: true,
        collisionMeshes: ['P_Modul_25_Col01_Mesh', 'P_Modul_25_Col02_Mesh'],
        surface: 'wood',
      },
    ],
    hinges: [{ part: '_Bridge', pin: '_HingeFrame' }],
  },
  P_Modul_26: {
    parts: [
      {
        suffix: '_Rope',
        mass: 1,
        ...wood,
        linearDamp: 0.1,
        rotDamp: 0.1,
        shiftCom: [0, 0, 0],
        collisionEnabled: false,
        collisionMeshes: ['P_Modul_26_Rope_Mesh'],
        surface: 'wood',
      },
      {
        suffix: '_Sack',
        mass: 10,
        ...wood,
        linearDamp: 0.1,
        rotDamp: 0.1,
        shiftCom: [0, 0, 0],
        collisionMeshes: ['P_Modul_26_Sack_Mesh'],
        surface: 'wood',
      },
    ],
    hinges: [
      { part: '_Rope', pin: '_Balljoint_oben', spherical: true },
      { part: '_Rope', pin: '_Balljoint_unten', other: '_Sack', spherical: true },
    ],
    altForce: {
      part: '_Sack',
      force: 0.25,
      switchTime: 1.5,
      axis: [0, 0, 1],
      reference: '_Halter',
      startState: 0,
    },
  },
  P_Modul_29: {
    parts: ['01', '02', '03', '04', '05', '06', '07', '08', '09'].map(
      (n): PartPhys => ({
        suffix: `_Platte${n}`,
        mass: n === '09' ? 1 : 0.5,
        ...wood,
        linearDamp: 0.1,
        rotDamp: 0.3,
        shiftCom: [0, 0, 0],
        startFrozen: true,
        surface: 'wood',
      }),
    ),
    // chain: world -HF01- P01 -HF02- P02 ... P09 -HF10- world
    hinges: [
      { part: '_Platte01', pin: '_HingeFrame01' },
      ...['02', '03', '04', '05', '06', '07', '08', '09'].map((n, i) => ({
        part: `_Platte${n}`,
        pin: `_HingeFrame${n}`,
        other: `_Platte${String(i + 1).padStart(2, '0')}`,
      })),
      { part: '_Platte09', pin: '_HingeFrame10' },
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
        shiftCom: [0, 4, 0],
        startFrozen: true,
        collisionMeshes: ['P_Modul_30_Col1_Mesh', 'P_Modul_30_Col2_Mesh'],
        surface: 'wood',
      },
    ],
    hinges: [{ part: '_Wippe', pin: '_HingeFrame' }],
  },
  P_Modul_34: {
    parts: [
      {
        suffix: '_Schiebestein',
        mass: 1.6,
        friction: 0.5,
        elasticity: 0.4,
        linearDamp: 0.1,
        rotDamp: 0.1,
        shiftCom: [0, 0, 0],
        startFrozen: true,
        surface: 'stone',
      },
      {
        suffix: '_Kiste',
        mass: 1.4,
        friction: 0.8,
        elasticity: 0.4,
        linearDamp: 0.1,
        rotDamp: 0.1,
        shiftCom: [0, 0, 0],
        startFrozen: true,
        surface: 'wood',
      },
    ],
    prismatics: [{ part: '_Schiebestein', points: ['_Slider_Frame01', '_Slider_Frame02'] }],
  },
  P_Modul_37: {
    parts: [
      {
        suffix: '_Bridge',
        mass: 3,
        friction: 0.7,
        elasticity: 1,
        linearDamp: 1,
        rotDamp: 0.05,
        shiftCom: [-7.5, 0, 0],
        startFrozen: true,
        collisionMeshes: ['P_Modul_37_Col1_Mesh', 'P_Modul_37_Col2_Mesh', 'P_Modul_37_Col3_Mesh'],
        surface: 'wood',
      },
    ],
    hinges: [{ part: '_Bridge', pin: '_HingeFrame' }],
  },
  P_Modul_41: {
    parts: [
      {
        suffix: 'Modul_41',
        mass: 1,
        ...wood,
        linearDamp: 0.1,
        rotDamp: 0.1,
        shiftCom: [0, 0, 0],
        collisionMeshes: ['P_Modul_41_Col1_Mesh', 'P_Modul_41_Col2_Mesh'],
        surface: 'wood',
      },
    ],
    hinges: [{ part: 'Modul_41', pin: '_HingeFrame' }],
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
        friction: 0.7,
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
