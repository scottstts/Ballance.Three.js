import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { BehaviorRec, NmoFile, ParameterRec } from '../formats/ck2/types.ts';
import { decodeCk2dCurve } from './curve.ts';
import {
  BALL_SHADOW_SOURCE,
  FLAME_PROXIMITY_SOURCE,
  FLAME_BIG,
  FLAME_SMALL,
  LIGHTNING_SOURCE,
  SHATTER_SOURCE,
  TRAFO_SOURCE,
  ballShadowFootprintWidth,
  type FlameSpec,
} from './effects.ts';
import type { ScaleableProximitySpec } from './proximity.ts';

const GAME_DIR = [
  fileURLToPath(new URL('../../Ballance_bin/Ballance', import.meta.url)),
  fileURLToPath(new URL('../../Ballance_bin/source1/Ballance', import.meta.url)),
].find(existsSync) ?? '';
const checkpointPath = join(GAME_DIR, '3D Entities/PH/PC_TwoFlames.nmo');
const startPath = join(GAME_DIR, '3D Entities/PH/PS_FourFlames.nmo');
const ballsPath = join(GAME_DIR, '3D Entities/Balls.nmo');
const animTrafoPath = join(GAME_DIR, '3D Entities/AnimTrafo.nmo');
const gameplayPath = join(GAME_DIR, '3D Entities/Gameplay.nmo');

function resolve(file: NmoFile, parameter: ParameterRec): ParameterRec {
  let current = parameter;
  const seen = new Set([current.index]);
  for (let depth = 0; depth < 32; depth++) {
    const nextIndex = current.sourceIndex >= 0 ? current.sourceIndex : current.sharedIndex;
    if (nextIndex < 0 || seen.has(nextIndex)) break;
    const next = file.objects[nextIndex];
    if (next?.kind !== 'parameter') break;
    seen.add(nextIndex);
    current = next;
  }
  return current;
}

function parameters(file: NmoFile, behavior: BehaviorRec): Map<string, ParameterRec> {
  return new Map(
    behavior.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .filter((record): record is ParameterRec => record?.kind === 'parameter')
      .map((parameter) => [parameter.name, resolve(file, parameter)]),
  );
}

function floatValue(parameter: ParameterRec | undefined): number {
  if (!parameter || parameter.valueBytes.length < 4) return Number.NaN;
  return new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset).getFloat32(0, true);
}

function intValue(parameter: ParameterRec | undefined): number {
  if (!parameter || parameter.valueBytes.length < 4) return Number.NaN;
  return new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset).getInt32(0, true);
}

function colorValue(parameter: ParameterRec | undefined): [number, number, number, number] {
  if (!parameter || parameter.valueBytes.length < 16) return [Number.NaN, Number.NaN, Number.NaN, Number.NaN];
  const view = new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset);
  return [0, 4, 8, 12].map((offset) => view.getFloat32(offset, true)) as [number, number, number, number];
}

function vectorValue(parameter: ParameterRec | undefined): [number, number, number] {
  if (!parameter || parameter.valueBytes.length < 12) return [Number.NaN, Number.NaN, Number.NaN];
  const view = new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset);
  return [view.getFloat32(0, true), view.getFloat32(4, true), view.getFloat32(8, true)];
}

function objectName(file: NmoFile, parameter: ParameterRec | undefined): string | undefined {
  return file.objects[parameter?.valueObjectIndex ?? -1]?.name;
}

function particleNode(file: NmoFile, scriptName: string): BehaviorRec {
  const script = file.objects.find(
    (record): record is BehaviorRec => record.kind === 'behavior' && record.name === scriptName,
  );
  const node = script?.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .find((record): record is BehaviorRec => record?.kind === 'behavior' && record.name === 'Point Particle System');
  if (!node) throw new Error(`missing source particle node for ${scriptName}`);
  return node;
}

function behavior(file: NmoFile, name: string): BehaviorRec {
  const result = file.objects.find((record): record is BehaviorRec => record.kind === 'behavior' && record.name === name);
  if (!result) throw new Error(`missing source behavior ${name}`);
  return result;
}

function childBehaviors(file: NmoFile, scriptName: string, name: string): BehaviorRec[] {
  return behavior(file, scriptName).referenceLists
    .flat()
    .map((index) => file.objects[index])
    .filter((record): record is BehaviorRec => record?.kind === 'behavior' && record.name === name);
}

function expectSpec(file: NmoFile, scriptName: string, spec: FlameSpec): void {
  const source = parameters(file, particleNode(file, scriptName));
  expect(spec.emissionDelay).toBeCloseTo(floatValue(source.get('Emission Delay')) / 1000, 8);
  expect(spec.emission).toBe(intValue(source.get('Emission')));
  expect(spec.emissionVariance).toBe(intValue(source.get('Emission Variance')));
  expect(spec.life).toBeCloseTo(floatValue(source.get('Lifespan')) / 1000, 8);
  expect(spec.lifeVariance).toBeCloseTo(floatValue(source.get('Lifespan Variance')) / 1000, 8);
  expect(spec.speed).toBeCloseTo(floatValue(source.get('Speed')) * 1000, 6);
  expect(spec.speedVariance).toBeCloseTo(floatValue(source.get('Speed Variance')) * 1000, 6);
  expect(spec.yawVariance).toBeCloseTo(floatValue(source.get('Yaw Variance')), 8);
  expect(spec.pitchVariance).toBeCloseTo(floatValue(source.get('Pitch Variance')), 8);
  expect(spec.initialSize).toBeCloseTo(floatValue(source.get('Initial Size')), 8);
  expect(spec.initialSizeVariance).toBeCloseTo(floatValue(source.get('Initial Size Variance')), 8);
  expect(spec.endingSize).toBeCloseTo(floatValue(source.get('Ending Size')), 8);
  expect(spec.initialColor).toEqual(colorValue(source.get('Initial Color and Alpha')));
  expect(intValue(source.get('Maximum Number'))).toBe(50);
  expect(intValue(source.get('Evolutions'))).toBe(3); // Size | Color
  expect(intValue(source.get('Variances'))).toBe(29); // Speed | Lifespan | Emission | Initial Size
  expect(intValue(source.get('Source Blend'))).toBe(5); // Source Alpha
  expect(intValue(source.get('Destination Blend'))).toBe(2); // One
}

function expectProximity(file: NmoFile, node: BehaviorRec, spec: ScaleableProximitySpec): void {
  const source = parameters(file, node);
  expect(floatValue(source.get('Distance'))).toBe(spec.distance);
  expect(floatValue(source.get('Exactness min. Distance'))).toBe(spec.exactnessMinDistance);
  expect(floatValue(source.get('Exactness max. Distance'))).toBe(spec.exactnessMaxDistance);
  expect(intValue(source.get('Minimum Framedelay'))).toBe(spec.minimumFrameDelay);
  expect(intValue(source.get('Maximum Framedelay'))).toBe(spec.maximumFrameDelay);
  expect(intValue(source.get(''))).toBe(spec.initialFrameDelay);
  expect(intValue(source.get('Check Axis:'))).toBe(spec.axes);
  expect(intValue(source.get('Squared Distance?')) !== 0).toBe(spec.squaredDistance);
}

describe.skipIf(!existsSync(checkpointPath) || !existsSync(startPath))('source-backed checkpoint/start flames', () => {
  const checkpoint = existsSync(checkpointPath) ? parseNmo(readFileSync(checkpointPath)) : null;
  const start = existsSync(startPath) ? parseNmo(readFileSync(startPath)) : null;

  it('matches the original small and big Point Particle System parameters', () => {
    if (!checkpoint) return;
    expectSpec(checkpoint, 'PC_TwoFlames_SmallFlameA script', FLAME_SMALL);
    expectSpec(checkpoint, 'PC_TwoFlames_CenterFlame script', FLAME_BIG);
  });

  it('retains every original emitter frame used for runtime placement and direction', () => {
    if (!checkpoint || !start) return;
    for (const name of ['PC_TwoFlames_Flame_SmallA', 'PC_TwoFlames_Flame_SmallB', 'PC_TwoFlames_Flame_Big']) {
      expect(checkpoint.byName.get(name)?.some((record) => record.kind === 'entity')).toBe(true);
    }
    for (const suffix of ['A', 'B', 'C', 'D']) {
      expect(start.byName.get(`PS_FourFlames_Flame_${suffix}`)?.some((record) => record.kind === 'entity')).toBe(true);
    }
  });

  it('matches every outer particle-script proximity gate', () => {
    if (!checkpoint || !start) return;
    const startNode = childBehaviors(start, 'PS_FourFlames_MF Script', 'TT Scaleable Proximity')[0];
    expectProximity(start, startNode, FLAME_PROXIMITY_SOURCE.start);

    const checkpointNodes = childBehaviors(checkpoint, 'PC_TwoFlames_MF Script', 'TT Scaleable Proximity');
    const outer = checkpointNodes.filter(
      (node) => floatValue(parameters(checkpoint, node).get('Distance')) === FLAME_PROXIMITY_SOURCE.checkpointBig.distance,
    );
    expect(outer).toHaveLength(2);
    const big = outer.find(
      (node) => intValue(parameters(checkpoint, node).get('Minimum Framedelay')) === 10,
    );
    const small = outer.find(
      (node) => intValue(parameters(checkpoint, node).get('Minimum Framedelay')) === 20,
    );
    if (!big || !small) throw new Error('missing source checkpoint outer proximity nodes');
    expectProximity(checkpoint, big, FLAME_PROXIMITY_SOURCE.checkpointBig);
    expectProximity(checkpoint, small, FLAME_PROXIMITY_SOURCE.checkpointSmall);
  });
});

describe.skipIf(!existsSync(ballsPath))('source-backed ball birth effect', () => {
  const file = existsSync(ballsPath) ? parseNmo(readFileSync(ballsPath)) : null;

  it('uses the original lightning mesh, material, textures, point light, and timing', () => {
    if (!file) return;
    const lightning = parameters(file, behavior(file, 'Rotate Lighting Sphere'));
    expect(LIGHTNING_SOURCE.rotationSpeed).toBeCloseTo(floatValue(lightning.get('X')), 7);
    expect(LIGHTNING_SOURCE.sphereDuration).toBeCloseTo(floatValue(lightning.get('Duration')) / 1000, 7);

    const scale = parameters(file, childBehaviors(file, 'Scale Lighting Sphere', 'Bezier Progression')[0]);
    expect(LIGHTNING_SOURCE.scaleDuration).toBeCloseTo(floatValue(scale.get('Duration')) / 1000, 7);
    expect(decodeCk2dCurve(scale.get('Progression Curve')?.valueBytes ?? new Uint8Array())).toHaveLength(2);

    const lightCurves = childBehaviors(file, 'Light  Anim', 'Bezier Progression').map((node) =>
      parameters(file, node),
    );
    expect(lightCurves.map((entry) => floatValue(entry.get('Duration'))).sort((a, b) => a - b)).toEqual([1500, 2500]);
    expect(
      decodeCk2dCurve(
        lightCurves.find((entry) => floatValue(entry.get('Duration')) === 2500)?.get('Progression Curve')
          ?.valueBytes ?? new Uint8Array(),
      ),
    ).toHaveLength(28);

    expect(file.byName.get('Ball_LightningSphere')?.some((record) => record.kind === 'entity')).toBe(true);
    const material = file.byName.get('Ball_LightningSphere')?.find((record) => record.kind === 'material');
    expect(material?.kind).toBe('material');
    if (material?.kind === 'material') {
      expect(material.sourceBlend).toBe(2);
      expect(material.destBlend).toBe(2);
      expect(material.zWrite).toBe(false);
    }
    for (const suffix of [1, 2, 3]) {
      expect(file.byName.get(`Ball_LightningSphere${suffix}`)?.some((record) => record.kind === 'texture')).toBe(true);
    }
    const light = file.byName.get('Ball_Lightning_PointLight')?.find((record) => record.kind === 'light');
    expect(light?.kind).toBe('light');
    if (light?.kind === 'light') {
      expect(light.lightType).toBe(1);
      expect(light.color).toEqual([0, 0, 0, 1]);
      expect([light.constAttenuation, light.linearAttenuation, light.quadAttenuation]).toEqual([0, 1, 0]);
      expect(light.range).toBe(20);
      expect(light.entity.worldMatrix[13]).toBe(9);
    }
  });

  it('matches the delayed six-frame spherical smoke burst', () => {
    if (!file) return;
    const source = parameters(file, childBehaviors(file, 'BallParticle_Frame script', 'SphericalParticleSystem')[0]);
    const smoke = LIGHTNING_SOURCE.smoke;
    expect(smoke.maxParticles).toBe(intValue(source.get('Maximum Number')));
    expect(smoke.emission).toBe(intValue(source.get('Emission')));
    expect(smoke.emissionVariance).toBe(intValue(source.get('Emission Variance')));
    expect(smoke.life).toBeCloseTo(floatValue(source.get('Lifespan')) / 1000, 7);
    expect(smoke.lifeVariance).toBeCloseTo(floatValue(source.get('Lifespan Variance')) / 1000, 7);
    expect(smoke.speed).toBeCloseTo(floatValue(source.get('Speed')) * 1000, 7);
    expect(smoke.speedVariance).toBeCloseTo(floatValue(source.get('Speed Variance')) * 1000, 7);
    expect(smoke.initialSize).toBe(floatValue(source.get('Initial Size')));
    expect(smoke.endingSize).toBe(floatValue(source.get('Ending Size')));
    expect([smoke.color, smoke.color, smoke.color, smoke.color]).toEqual(
      colorValue(source.get('Initial Color and Alpha')),
    );
    expect(intValue(source.get('Evolutions'))).toBe(3);
    expect(intValue(source.get('Variances'))).toBe(5);
    expect(intValue(source.get('Source Blend'))).toBe(5);
    expect(intValue(source.get('Destination Blend'))).toBe(2);

    const smokeScript = behavior(file, 'BallParticle_Frame script');
    const delayedOff = smokeScript.referenceLists
      .flat()
      .map((index) => file.objects[index])
      .find((record) => record?.kind === 'behaviorLink' && record.activationDelay === LIGHTNING_SOURCE.smokeFrames);
    expect(delayedOff?.kind).toBe('behaviorLink');
    const frame = file.byName.get('Ball_Particle_Frame')?.find((record) => record.kind === 'entity');
    expect(frame?.kind).toBe('entity');
    if (frame?.kind === 'entity') expect(smoke.radius).toBeCloseTo(frame.worldMatrix[0], 6);
    expect(LIGHTNING_SOURCE.smokeDelay).toBe(2.5);
  });
});

describe.skipIf(!existsSync(ballsPath))('source-backed ball shadow', () => {
  const file = existsSync(ballsPath) ? parseNmo(readFileSync(ballsPath)) : null;

  it('uses the TT Simple Shadow texture, footprint scale, and hard height limit', () => {
    if (!file) return;
    const source = parameters(file, behavior(file, 'TT Simple Shadow'));
    expect(BALL_SHADOW_SOURCE.sizeScale).toBe(floatValue(source.get('Size Scale')));
    expect(BALL_SHADOW_SOURCE.maxHeight).toBe(floatValue(source.get('Maximum Height')));
    const texture = file.objects[source.get('Texture')?.valueObjectIndex ?? -1];
    expect(texture?.kind).toBe('texture');
    expect(texture?.name).toBe('HardShadow');
    if (texture?.kind === 'texture') {
      expect(texture.fileNames).toContain('HardShadow.bmp');
      expect(BALL_SHADOW_SOURCE.texture.endsWith(texture.fileNames[0])).toBe(true);
    }
  });

  it('derives the projected width from each original ball mesh bounding box', () => {
    if (!file) return;
    for (const name of ['Ball_Wood', 'Ball_Stone', 'Ball_Paper']) {
      const entity = file.byName.get(name)?.find((record) => record.kind === 'entity');
      expect(entity?.kind).toBe('entity');
      if (entity?.kind !== 'entity') continue;
      const mesh = file.objects[entity.meshIndex];
      expect(mesh?.kind).toBe('mesh');
      if (mesh?.kind !== 'mesh') continue;
      let minX = Infinity;
      let maxX = -Infinity;
      for (let i = 0; i < mesh.vertexCount; i++) {
        minX = Math.min(minX, mesh.positions[i * 3]);
        maxX = Math.max(maxX, mesh.positions[i * 3]);
      }
      expect(ballShadowFootprintWidth(maxX - minX)).toBeCloseTo((maxX - minX) * 1.2999999523162842, 7);
    }
  });
});

describe.skipIf(!existsSync(animTrafoPath) || !existsSync(gameplayPath))('source-backed ball transformation', () => {
  const anim = existsSync(animTrafoPath) ? parseNmo(readFileSync(animTrafoPath)) : null;
  const gameplay = existsSync(gameplayPath) ? parseNmo(readFileSync(gameplayPath)) : null;

  it('evaluates the original ring, bar, shadow, and flash graph', () => {
    if (!anim) return;
    const progression = (script: string) => parameters(anim, childBehaviors(anim, script, 'Bezier Progression')[0]);
    const open = progression('Ring_Open');
    const travel = progression('Up ´n Down');
    const close = progression('Ring_Close');
    expect(TRAFO_SOURCE.openDuration).toBeCloseTo(floatValue(open.get('Duration')) / 1000, 8);
    expect(TRAFO_SOURCE.travelDuration).toBeCloseTo(floatValue(travel.get('Duration')) / 1000, 8);
    expect(TRAFO_SOURCE.closeDuration).toBeCloseTo(floatValue(close.get('Duration')) / 1000, 8);
    expect(decodeCk2dCurve(open.get('Progression Curve')?.valueBytes ?? new Uint8Array())).toHaveLength(3);
    const travelCurve = decodeCk2dCurve(travel.get('Progression Curve')?.valueBytes ?? new Uint8Array());
    expect(travelCurve).toHaveLength(4);
    expect(travelCurve.at(-1)?.[1]).toBe(0); // restores bars and shadow before close
    expect(decodeCk2dCurve(close.get('Progression Curve')?.valueBytes ?? new Uint8Array())).toHaveLength(2);

    expect(TRAFO_SOURCE.ringOffset).toEqual(
      vectorValue(parameters(anim, childBehaviors(anim, 'Ring_Open', 'Interpolator')[0]).get('B')),
    );
    expect(TRAFO_SOURCE.barsOffset).toEqual(
      vectorValue(parameters(anim, childBehaviors(anim, 'Up ´n Down', 'Interpolator')[0]).get('B')),
    );
    const flashDelay = parameters(anim, childBehaviors(anim, 'FlashAnim', 'Delayer')[0]);
    expect(TRAFO_SOURCE.flashStep).toBeCloseTo(floatValue(flashDelay.get('Time to Wait')) / 1000, 8);
    const flashSelector = parameters(anim, childBehaviors(anim, 'FlashAnim', 'Parameter Selector')[0]);
    expect(TRAFO_SOURCE.flashScroll).toBe(floatValue(flashSelector.get('pIn 0')));
    expect(floatValue(flashSelector.get('pIn 1'))).toBe(-TRAFO_SOURCE.flashScroll);

    const main = behavior(anim, 'AnimTrafo_MF Script');
    expect(
      main.referenceLists
        .flat()
        .map((index) => anim.objects[index])
        .some((record) => record?.kind === 'behaviorLink' && record.activationDelay === 1),
    ).toBe(true);
  });

  it('uses Gameplay.nmo pull, explosion, replacement, and proximity values', () => {
    if (!gameplay) return;
    const dynamic = parameters(gameplay, childBehaviors(gameplay, 'dephysic Ball', 'TT Set Dynamic Position')[0]);
    expect(TRAFO_SOURCE.pullForce).toBe(floatValue(dynamic.get('Force X')));
    expect(TRAFO_SOURCE.pullDamping).toBe(floatValue(dynamic.get('Damping X')));
    expect(TRAFO_SOURCE.pullOffset).toEqual([
      floatValue(dynamic.get('Offset X')),
      floatValue(dynamic.get('Offset Y')),
      floatValue(dynamic.get('Offset Z')),
    ]);
    const pullDelay = parameters(gameplay, childBehaviors(gameplay, 'dephysic Ball', 'Delayer')[0]);
    expect(TRAFO_SOURCE.pullDuration).toBeCloseTo(floatValue(pullDelay.get('Time to Wait')) / 1000, 8);

    const managerDelays = childBehaviors(gameplay, 'Trafo Manager', 'Delayer')
      .map((node) => floatValue(parameters(gameplay, node).get('Time to Wait')) / 1000)
      .sort((a, b) => a - b);
    expect(managerDelays).toEqual([0.15, 1]);
    expect(TRAFO_SOURCE.explosionTime).toBeCloseTo(TRAFO_SOURCE.pullDuration + managerDelays[1], 8);
    expect(TRAFO_SOURCE.newBallTime).toBeCloseTo(TRAFO_SOURCE.explosionTime + managerDelays[0], 8);
    const proximity = parameters(gameplay, childBehaviors(gameplay, 'Trafo Manager', 'Test')[0]);
    expect(TRAFO_SOURCE.triggerDistance).toBe(floatValue(proximity.get('B')));
  });
});

describe.skipIf(!existsSync(ballsPath) || !existsSync(gameplayPath))('source-backed ball shatter', () => {
  const balls = existsSync(ballsPath) ? parseNmo(readFileSync(ballsPath)) : null;
  const gameplay = existsSync(gameplayPath) ? parseNmo(readFileSync(gameplayPath)) : null;

  it('retains every authored piece in source group order and its initial transform', () => {
    if (!balls) return;
    for (const [kind, title] of [
      ['wood', 'Wood'],
      ['stone', 'Stone'],
      ['paper', 'Paper'],
    ] as const) {
      const group = balls.groups.find((entry) => entry.name === `Ball_${title}_Pieces`);
      expect(group?.memberIndices).toHaveLength(SHATTER_SOURCE.kinds[kind].count);
      for (const index of group?.memberIndices ?? []) {
        const piece = balls.objects[index];
        expect(piece?.kind).toBe('entity');
        if (piece?.kind === 'entity') {
          expect(piece.name).toMatch(new RegExp(`^Ball_${title}_piece\\d\\d$`));
          expect(Array.from(piece.worldMatrix)).not.toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
        }
      }
    }
  });

  it('uses the exact per-kind Physicalize and local Physics Impulse parameters', () => {
    if (!balls) return;
    for (const [kind, graph] of [
      ['wood', 'Wood Explosion'],
      ['stone', 'Stone Explosion'],
      ['paper', 'Paper Explosion'],
    ] as const) {
      const source = SHATTER_SOURCE.kinds[kind];
      const physicalize = parameters(balls, childBehaviors(balls, graph, 'Physicalize')[0]);
      expect(floatValue(physicalize.get('Elasticity'))).toBe(source.restitution);
      expect(floatValue(physicalize.get('Linear Speed Dampening'))).toBe(source.linearDamping);
      expect(floatValue(physicalize.get('Rot Speed Dampening'))).toBe(source.angularDamping);
      expect(intValue(physicalize.get('Automatic Calculate Mass Center'))).toBe(0);
      expect(vectorValue(physicalize.get('Shift Mass Center'))).toEqual([0, 0, 0]);

      const impulse = parameters(balls, childBehaviors(balls, graph, 'Physics Impulse')[0]);
      expect(vectorValue(impulse.get('Position'))).toEqual(source.impulsePoint);
      expect(vectorValue(impulse.get('Direction'))).toEqual(source.impulseDirection);
      expect(intValue(impulse.get('2 pos instead of dir ?'))).toBe(0);
      expect(intValue(impulse.get('Constant Force ?'))).toBe(0);
    }

    const wood = parameters(balls, childBehaviors(balls, 'Wood Explosion', 'Physicalize')[0]);
    expect(floatValue(wood.get('Friction'))).toBe(SHATTER_SOURCE.kinds.wood.friction[0]);
    expect(floatValue(wood.get('Mass'))).toBe(SHATTER_SOURCE.kinds.wood.mass[0]);
    const stone = parameters(balls, childBehaviors(balls, 'Stone Explosion', 'Physicalize')[0]);
    expect(floatValue(stone.get('Friction'))).toBe(SHATTER_SOURCE.kinds.stone.friction[0]);
    expect(floatValue(stone.get('Mass'))).toBe(SHATTER_SOURCE.kinds.stone.mass[0]);
  });

  it('recovers every original random range rather than the unrelated game-ball constants', () => {
    if (!balls) return;
    const ranges = (graph: string) =>
      childBehaviors(balls, graph, 'Random')
        .map((node) => {
          const values = parameters(balls, node);
          return [floatValue(values.get('Min')), floatValue(values.get('Max'))] as [number, number];
        })
        .sort((a, b) => a[0] - b[0]);
    expect(ranges('Wood Explosion')).toEqual([SHATTER_SOURCE.kinds.wood.impulse]);
    expect(ranges('Stone Explosion')).toEqual([SHATTER_SOURCE.kinds.stone.impulse]);
    expect(ranges('Paper Explosion')).toEqual([
      SHATTER_SOURCE.kinds.paper.mass,
      SHATTER_SOURCE.kinds.paper.impulse,
      SHATTER_SOURCE.kinds.paper.friction,
    ]);
  });

  it('runs paper wind until the 20-second reset, then the exact two-second fade', () => {
    if (!balls || !gameplay) return;
    const timers = childBehaviors(gameplay, 'Fadeout Manager', 'Timer');
    expect(timers).toHaveLength(3);
    for (const timer of timers) {
      expect(floatValue(parameters(gameplay, timer).get('Duration')) / 1000).toBe(SHATTER_SOURCE.resetDelay);
    }
    for (const title of ['Wood', 'Stone', 'Paper']) {
      const fade = parameters(balls, childBehaviors(balls, `Fade ${title} Pieces`, 'Bezier Progression')[0]);
      expect(floatValue(fade.get('Duration')) / 1000).toBe(SHATTER_SOURCE.fadeDuration);
      expect(decodeCk2dCurve(fade.get('Progression Curve')?.valueBytes ?? new Uint8Array())).toHaveLength(2);
    }

    const wind = childBehaviors(balls, 'Wind', 'SetPhysicsForce');
    expect(wind).toHaveLength(SHATTER_SOURCE.kinds.paper.count);
    for (const force of wind) {
      const values = parameters(balls, force);
      expect(vectorValue(values.get('Direction'))).toEqual(SHATTER_SOURCE.paperWindDirection);
      expect(floatValue(values.get('Force Value'))).toBe(SHATTER_SOURCE.paperWindForce);
    }
  });

  it('matches the three-second monitored-piece collision sound scripts', () => {
    if (!balls) return;
    for (const [kind, title] of [
      ['wood', 'Wood'],
      ['stone', 'Stone'],
    ] as const) {
      const graph = `${title}-Collision Sound`;
      const delay = parameters(balls, childBehaviors(balls, graph, 'Delayer')[0]);
      expect(floatValue(delay.get('Time to Wait')) / 1000).toBe(SHATTER_SOURCE.collisionSoundDuration);
      const detectors = childBehaviors(balls, graph, 'PhysicsCollDetection');
      const monitored = behavior(balls, graph).referenceLists
        .flat()
        .map((index) => balls.objects[index])
        .filter((record): record is ParameterRec => record?.kind === 'parameter' && record.name === 'Target (3D Entity)')
        .map((parameter) => objectName(balls, resolve(balls, parameter)))
        .map((name) => Number(name?.slice(-2)));
      expect(monitored.sort((a, b) => a - b)).toEqual(
        [...SHATTER_SOURCE.kinds[kind].monitoredPieces].sort((a, b) => a - b),
      );
      for (const detector of detectors) {
        const values = parameters(balls, detector);
        expect(floatValue(values.get('Min Speed m/s'))).toBe(SHATTER_SOURCE.collisionMinSpeed);
        expect(floatValue(values.get('Max Speed m/s'))).toBe(SHATTER_SOURCE.collisionMaxSpeed);
        expect(floatValue(values.get('Sleep afterwards'))).toBe(SHATTER_SOURCE.collisionCooldown);
      }
    }
    expect(childBehaviors(balls, 'Ball_CollSound_Pieces', 'Wave Player')).toHaveLength(1);
  });
});
