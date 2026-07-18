/**
 * Original PE_Balloon IVP assembly: 18 physical bodies, 17 hinges, two
 * sliders, one spring, and the authored constant forces. The values and
 * topology come directly from PE_Balloon.nmo behavior graphs.
 */
import * as THREE from 'three';
import { FORCE_SCALE } from './constants.ts';
import { Modul, type DynamicPart, type ModulContext } from './moduls/base.ts';
import type { PartPhys } from './moduls/physTable.ts';
import type { PrefabInstance } from './moduls/prefabs.ts';

const WOOD = { friction: 0.7, elasticity: 0.4, surface: 'wood' as const };

const PLATE_PHYS: PartPhys = {
  suffix: '',
  mass: 0.5,
  ...WOOD,
  linearDamp: 0.1,
  rotDamp: 0.1,
  shiftCom: [0, 0, 0],
  startFrozen: true,
};

const FLOATING_PHYS: PartPhys = {
  suffix: '',
  mass: 0.2,
  friction: 0.7,
  elasticity: 0.4,
  linearDamp: 1,
  rotDamp: 1,
  shiftCom: [0, 0, 0],
  startFrozen: true,
  collisionEnabled: false,
};

export interface BalloonBodyDef {
  part: string;
  physicalize: PartPhys;
}

export interface BalloonHingeDef {
  target: string;
  other?: string;
  pin: string;
}

export interface BalloonSliderDef {
  target: string;
  other?: string;
  points: [string, string];
  limits?: [number, number];
}

export interface ForceDef {
  part: string;
  reference: string;
  direction: [number, number, number];
  value: number;
}

export const BALLOON_BODIES: BalloonBodyDef[] = [
  {
    part: '_Platform',
    physicalize: {
      suffix: '_Platform',
      mass: 4,
      ...WOOD,
      linearDamp: 0.1,
      rotDamp: 0.1,
      shiftCom: [0, 2, 0],
      startFrozen: true,
      collisionMeshes: [
        'PE_Balloon_Col_01_Mesh',
        'PE_Balloon_Col_02_Mesh',
        'PE_Balloon_Col_03_Mesh',
        'PE_Balloon_Col_04_Mesh',
        'PE_Balloon_Col_05_Mesh',
        'PE_Balloon_Col_06_Mesh',
      ],
    },
  },
  {
    part: '_Box_slide',
    physicalize: {
      suffix: '_Box_slide',
      mass: 4,
      ...WOOD,
      linearDamp: 1,
      rotDamp: 1,
      shiftCom: [0, 0, 0],
      startFrozen: true,
      collisionEnabled: false,
      collisionMeshes: ['Box_slide_Mesh'],
    },
  },
  ...Array.from({ length: 8 }, (_, index): BalloonBodyDef => ({
    part: `_Platte${String(index + 1).padStart(2, '0')}`,
    physicalize: PLATE_PHYS,
  })),
  ...Array.from({ length: 4 }, (_, index): BalloonBodyDef[] => {
    const suffix = String(index + 1).padStart(2, '0');
    return [
      { part: `_Ballon_Seil${suffix}`, physicalize: FLOATING_PHYS },
      { part: `_Ballon${suffix}`, physicalize: FLOATING_PHYS },
    ];
  }).flat(),
];

export const BALLOON_HINGES: BalloonHingeDef[] = [
  { target: '_Platform', other: '_Platte01', pin: '_Hinge01' },
  ...Array.from({ length: 7 }, (_, index): BalloonHingeDef => ({
    target: `_Platte${String(index + 1).padStart(2, '0')}`,
    other: `_Platte${String(index + 2).padStart(2, '0')}`,
    pin: `_Hinge${String(index + 2).padStart(2, '0')}`,
  })),
  { target: '_Platte08', pin: '_Hinge09' },
  ...Array.from({ length: 4 }, (_, index): BalloonHingeDef[] => {
    const suffix = String(index + 1).padStart(2, '0');
    return [
      { target: '_Platform', other: `_Ballon_Seil${suffix}`, pin: `_Ballon${suffix}_hinge_a` },
      { target: `_Ballon_Seil${suffix}`, other: `_Ballon${suffix}`, pin: `_Ballon${suffix}_hinge_b` },
    ];
  }).flat(),
];

export const BALLOON_SLIDERS: BalloonSliderDef[] = [
  {
    target: '_Box_slide',
    points: ['_Slideframe_close', '_Slideframe_far'],
    limits: [-30000, 0],
  },
  {
    target: '_Platform',
    other: '_Box_slide',
    points: ['_Slideframe_high', '_Slideframe_low'],
  },
];

export const BALLOON_SPRING = {
  target: '_Platform',
  other: '_Box_slide',
  anchor1: '_Slideframe_high',
  anchor2: '_Slideframe_low',
  length: 15,
  stiffness: 20,
  damping: 0.6,
} as const;

export const BALLOON_FORCES: ForceDef[] = [1, 2, 3, 4].flatMap((number) => {
  const suffix = String(number).padStart(2, '0');
  return [
    {
      part: `_Ballon${suffix}`,
      reference: `_Ballon${suffix}_hinge_b`,
      direction: [0, 1, 0] as [number, number, number],
      value: 0.3,
    },
    {
      part: `_Ballon_Seil${suffix}`,
      reference: `_Ballon${suffix}_hinge_b`,
      direction: [-0.2, 0, 0] as [number, number, number],
      value: 0.3,
    },
  ];
});

export const BALLOON_LAUNCH_FORCE: ForceDef = {
  part: '_Box_slide',
  reference: '_Box_slide',
  direction: [-1, 0, 1],
  value: 0.2,
};

export class BalloonPhysics extends Modul {
  private awake = false;
  private launched = false;
  private bridgeRootJoint: ReturnType<BalloonPhysics['makeHinge']> | null = null;

  constructor(instance: PrefabInstance, ctx: ModulContext) {
    super('PE_Balloon', Number.MAX_SAFE_INTEGER, instance, ctx);

    for (const body of BALLOON_BODIES) this.addBody(body.part, body.physicalize);

    // Platform -> eight-plank bridge -> world. The source Break input removes
    // the first Platform/Platte01 hinge when the finish force is created.
    for (const hinge of BALLOON_HINGES) {
      const joint = this.connect(hinge.target, hinge.other, hinge.pin);
      if (hinge.pin === '_Hinge01') this.bridgeRootJoint = joint;
    }

    for (const slider of BALLOON_SLIDERS) {
      const target = this.findDynamic(slider.target);
      const other = slider.other ? (this.findDynamic(slider.other) ?? null) : null;
      const first = this.partWorldPosition(slider.points[0]);
      const second = this.partWorldPosition(slider.points[1]);
      if (target && first && second) this.makePrismatic(target, second.sub(first).normalize(), slider.limits, other);
    }
    const springTarget = this.findDynamic(BALLOON_SPRING.target);
    const springOther = this.findDynamic(BALLOON_SPRING.other) ?? null;
    const springAnchor1 = this.partWorldPosition(BALLOON_SPRING.anchor1);
    const springAnchor2 = this.partWorldPosition(BALLOON_SPRING.anchor2);
    if (springTarget && springOther && springAnchor1 && springAnchor2) {
      this.makeSpring(
        springTarget,
        springOther,
        springAnchor1,
        springAnchor2,
        BALLOON_SPRING.length,
        BALLOON_SPRING.stiffness,
        BALLOON_SPRING.damping,
      );
    }
  }

  wake(): void {
    if (this.awake) return;
    this.awake = true;
    this.findDynamic('_Platform')?.body.wakeUp();
  }

  launch(): void {
    this.wake();
    this.launched = true;
    if (this.bridgeRootJoint) {
      this.removeJoint(this.bridgeRootJoint);
      this.bridgeRootJoint = null;
    }
  }

  override update(): void {
    this.syncVisuals();
    if (!this.awake) return;
    for (const force of BALLOON_FORCES) this.applySourceForce(force);
    if (this.launched) this.applySourceForce(BALLOON_LAUNCH_FORCE);
  }

  syncVisuals(): void {
    for (const part of this.dynamicParts) this.syncPart(part);
  }

  debugState(): Record<string, { position: [number, number, number]; velocity: [number, number, number] }> {
    return Object.fromEntries(
      this.dynamicParts.map((part) => {
        const position = part.body.translation();
        const velocity = part.body.linvel();
        return [
          part.name,
          {
            position: [position.x, position.y, position.z],
            velocity: [velocity.x, velocity.y, velocity.z],
          },
        ];
      }),
    );
  }

  private addBody(suffix: string, physicalize: PartPhys): DynamicPart | null {
    const object = this.part(suffix);
    if (!(object instanceof THREE.Mesh)) return null;
    return this.makeDynamicPart(object, { ...physicalize, suffix });
  }

  private connect(target: string, other: string | undefined, pin: string) {
    const part = this.findDynamic(target);
    const otherPart = other ? (this.findDynamic(other) ?? null) : null;
    const position = this.partWorldPosition(pin);
    const axis = this.referenceWorldDirection(pin, [0, 0, 1]);
    return part && position && axis ? this.makeHinge(part, position, axis, otherPart) : null;
  }

  private applySourceForce(force: ForceDef): void {
    const part = this.findDynamic(force.part);
    const direction = this.referenceWorldVector(force.reference, force.direction);
    if (!part || !direction) return;
    part.body.resetForces(false);
    direction.multiplyScalar(force.value * FORCE_SCALE);
    part.body.addForce(direction, true);
  }
}
