import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseNmo } from '../formats/ck2/nmo.ts';
import type { BehaviorRec, NmoFile, ParameterRec } from '../formats/ck2/types.ts';
import { CamRig, DynamicPosition } from './camera.ts';
import {
  BALL_BIRTH_DELAY,
  BALL_OFF_DELAY,
  CAM_FAR,
  CAM_FOV,
  CAM_INITIAL_POSITION,
  CAM_NEAR,
  CAM_OVERVIEW_OFFSET,
  CAM_POSITION_DAMPING,
  CAM_POSITION_FORCE,
  CAM_POSITION_OVERVIEW_FORCE,
  CAM_ROTATE_TIME,
  CAM_SLOT_OFFSET,
  CAM_TARGET_DAMPING,
  CAM_TARGET_FORCE,
  DEATH_FADE_DURATION,
  FINAL_FINISH_WAIT_DURATION,
  FINISH_SKY_FADE_DURATION,
  FINISH_WAIT_DURATION,
  GAME_OVER_MENU_DELAY,
  finishMenuDelay,
} from './constants.ts';
import { decodeCk2dCurve } from './curve.ts';
import type { InputState } from './input.ts';

const GAME_DIR = [
  fileURLToPath(new URL('../../Ballance_bin/Ballance', import.meta.url)),
  fileURLToPath(new URL('../../Ballance_bin/source1/Ballance', import.meta.url)),
].find(existsSync) ?? '';
const cameraPath = join(GAME_DIR, '3D Entities/Camera.nmo');
const gameplayPath = join(GAME_DIR, '3D Entities/Gameplay.nmo');
const basePath = join(GAME_DIR, 'base.cmo');

const EMPTY_INPUT: InputState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  shift: false,
  space: false,
};

function behavior(file: NmoFile, name: string): BehaviorRec {
  const found = file.objects.find(
    (record): record is BehaviorRec => record.kind === 'behavior' && record.name === name,
  );
  if (!found) throw new Error(`missing source behavior ${name}`);
  return found;
}

function children(file: NmoFile, parent: string, name: string): BehaviorRec[] {
  return behavior(file, parent).referenceLists
    .flat()
    .map((index) => file.objects[index])
    .filter((record): record is BehaviorRec => record?.kind === 'behavior' && record.name === name);
}

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

function parameters(file: NmoFile, node: BehaviorRec): ParameterRec[] {
  return node.referenceLists
    .flat()
    .map((index) => file.objects[index])
    .filter((record): record is ParameterRec => record?.kind === 'parameter');
}

function parameter(file: NmoFile, node: BehaviorRec, name: string): ParameterRec {
  const found = parameters(file, node).find((entry) => entry.name === name);
  if (!found) throw new Error(`missing ${node.name}.${name}`);
  return resolve(file, found);
}

function floatValue(parameter: ParameterRec): number {
  return new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset).getFloat32(0, true);
}

function integerValue(parameter: ParameterRec): number {
  return new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset).getInt32(0, true);
}

describe('TT Set Dynamic Position runtime', () => {
  it('uses the original displacement recurrence and per-axis parameters', () => {
    const dynamic = new DynamicPosition(
      new THREE.Vector3(0, 10, -2),
      [5, 2, 10],
      [0.5, 0.25, 0],
      [0, -50, 1],
    );
    const target = new THREE.Vector3(10, 10, 2);

    dynamic.step(target, 0.1);
    expect(dynamic.value.toArray()).toEqual([5, 20, 1]);

    dynamic.step(target, 0.1);
    expect(dynamic.value.x).toBe(10);
    expect(dynamic.value.y).toBe(30.5);
    expect(dynamic.value.z).toBe(1);
  });

  it('reinitializes the damped displacement when the source node is toggled', () => {
    const dynamic = new DynamicPosition(new THREE.Vector3(), [1, 1, 1], [0.5, 0.5, 0.5]);
    const target = new THREE.Vector3(10, 0, 0);
    dynamic.step(target, 0.1);
    dynamic.reinitialize();
    dynamic.step(target, 0.1);
    expect(dynamic.value.x).toBeCloseTo(1.9, 8);
  });
});

describe('source-authored camera rig', () => {
  it('starts with Camera.nmo projection and hierarchy positions', () => {
    const rig = new CamRig(4 / 3);
    expect(rig.camera.fov).toBe(CAM_FOV);
    expect(rig.camera.near).toBe(CAM_NEAR);
    expect(rig.camera.far).toBe(CAM_FAR);
    expect(rig.camera.position.toArray()).toEqual([...CAM_INITIAL_POSITION]);
  });

  it('follows the ball through the 10-per-second target controller', () => {
    const rig = new CamRig(4 / 3);
    rig.update(0.05, new THREE.Vector3(10, 4, -2), EMPTY_INPUT);
    expect(rig.targetPosition.toArray()).toEqual([5, 2, -1]);
  });

  it('uses the source orientation for movement and completes a quarter turn in 250 ms', () => {
    const rig = new CamRig(4 / 3);
    rig.resetTo(new THREE.Vector3());
    expect(rig.pushDirection({ ...EMPTY_INPUT, forward: true }).toArray()).toEqual([-1, 0, 0]);
    expect(rig.pushDirection({ ...EMPTY_INPUT, right: true }).toArray()).toEqual([0, 0, -1]);

    rig.update(CAM_ROTATE_TIME, new THREE.Vector3(), { ...EMPTY_INPUT, shift: true, left: true });
    expect(rig.yaw).toBeCloseTo(Math.PI / 2, 10);
    const forward = rig.pushDirection({ ...EMPTY_INPUT, forward: true });
    expect(forward.x).toBeCloseTo(0, 10);
    expect(forward.z).toBeCloseTo(-1, 10);
  });

  it('switches the vertical force and -50 offset immediately while overview is held', () => {
    const rig = new CamRig(4 / 3);
    rig.resetTo(new THREE.Vector3());
    const normalY = rig.camera.position.y;
    rig.update(0.1, new THREE.Vector3(), { ...EMPTY_INPUT, space: true });
    expect(rig.camera.position.y).toBeCloseTo(normalY + 10, 8);
  });
});

describe.skipIf(!existsSync(cameraPath) || !existsSync(gameplayPath))('camera binary authority', () => {
  const camera = existsSync(cameraPath) ? parseNmo(readFileSync(cameraPath)) : null;
  const gameplay = existsSync(gameplayPath) ? parseNmo(readFileSync(gameplayPath)) : null;

  it('matches Camera.nmo transforms and raw target-camera projection', () => {
    if (!camera) return;
    const camPos = camera.byName.get('Cam_Pos')?.find((record) => record.kind === 'entity');
    const inGameCam = camera.byName.get('InGameCam')?.find((record) => record.kind === 'entity');
    expect(camPos?.kind).toBe('entity');
    expect(inGameCam?.kind).toBe('entity');
    if (camPos?.kind !== 'entity' || inGameCam?.kind !== 'entity') return;
    expect(CAM_SLOT_OFFSET).toEqual([camPos.worldMatrix[12], camPos.worldMatrix[13], -camPos.worldMatrix[14]]);
    expect(CAM_INITIAL_POSITION).toEqual([
      inGameCam.worldMatrix[12],
      inGameCam.worldMatrix[13],
      -inGameCam.worldMatrix[14],
    ]);

    const chunk = camera.chunks[inGameCam.index];
    expect(chunk.seekIdentifier(0x0fc00000)).toBe(24);
    expect(chunk.u32()).toBe(1); // perspective
    expect(THREE.MathUtils.radToDeg(chunk.f32())).toBeCloseTo(CAM_FOV, 5);
    expect(chunk.f32()).toBe(1); // orthographic zoom, retained by CKCamera
    expect(chunk.u32()).toBe(0x00030004); // 4:3
    expect(chunk.f32()).toBe(CAM_NEAR);
    expect(chunk.f32()).toBe(CAM_FAR);
  });

  it('matches both Gameplay.nmo dynamic controllers and CamUp selectors', () => {
    if (!gameplay) return;
    const dynamic = children(gameplay, 'Gameplay_Ingame', 'TT Set Dynamic Position');
    expect(dynamic).toHaveLength(2);
    const byObject = new Map(dynamic.map((node) => [parameter(gameplay, node, 'Object').name, node]));
    const cameraNode = byObject.get('Cam_Pos Frame');
    const targetNode = byObject.get('BallPos_Frame');
    expect(cameraNode).toBeDefined();
    expect(targetNode).toBeDefined();
    if (!cameraNode || !targetNode) return;

    const axes = ['X', 'Y', 'Z'] as const;
    expect(axes.map((axis) => floatValue(parameter(gameplay, targetNode, `Force ${axis}`)))).toEqual([
      ...CAM_TARGET_FORCE,
    ]);
    expect(axes.map((axis) => floatValue(parameter(gameplay, targetNode, `Damping ${axis}`)))).toEqual([
      ...CAM_TARGET_DAMPING,
    ]);
    expect(axes.map((axis) => floatValue(parameter(gameplay, cameraNode, `Force ${axis}`)))).toEqual([
      ...CAM_POSITION_FORCE,
    ]);
    expect(axes.map((axis) => floatValue(parameter(gameplay, cameraNode, `Damping ${axis}`)))).toEqual([
      ...CAM_POSITION_DAMPING,
    ]);

    const selectors = children(gameplay, 'Cam Navigation', 'Parameter Selector');
    const values = selectors.map((node) =>
      parameters(gameplay, node)
        .filter((entry) => entry.name.startsWith('pIn '))
        .map((entry) => floatValue(resolve(gameplay, entry))),
    );
    expect(values).toContainEqual([CAM_OVERVIEW_OFFSET[1], 0]);
    expect(values).toContainEqual([CAM_POSITION_OVERVIEW_FORCE[1], CAM_POSITION_FORCE[1]]);
  });

  it('matches the 250 ms two-key Cam Navigation curve', () => {
    if (!gameplay) return;
    const progression = children(gameplay, 'Cam Navigation', 'Bezier Progression')[0];
    expect(floatValue(parameter(gameplay, progression, 'Duration')) / 1000).toBe(CAM_ROTATE_TIME);
    const curve = decodeCk2dCurve(parameter(gameplay, progression, 'Progression Curve').valueBytes);
    expect(curve).toHaveLength(2);
    expect(curve[0]).toEqual([0, 0, -0.045643847435712814]);
    expect(curve[1][0]).toBe(1);
    expect(curve[1][1]).toBe(1);
    expect(curve[1][2]).toBeCloseTo(1.1345752907327005, 6);
  });

  it('retains the source death pulse, Ball Off, and unphysicalized birth timing', () => {
    if (!gameplay) return;
    const fade = children(gameplay, 'Deactivate Ball', 'Überblendung')[0];
    expect(floatValue(parameter(gameplay, fade, 'Duration')) / 1000).toBe(DEATH_FADE_DURATION);
    const fadeCurve = decodeCk2dCurve(parameter(gameplay, fade, 'Curve').valueBytes);
    expect(fadeCurve.map(([time, value]) => [time, value])).toEqual([
      [0, 0],
      [0.4000000059604645, 1],
      [0.6000000238418579, 1],
      [1, 0],
    ]);

    const ballOff = children(gameplay, 'Deactivate Ball', 'Delayer')[0];
    expect(floatValue(parameter(gameplay, ballOff, 'Time to Wait')) / 1000).toBe(BALL_OFF_DELAY);
    const birth = children(gameplay, 'New Ball', 'Delayer')[0];
    expect(floatValue(parameter(gameplay, birth, 'Time to Wait')) / 1000).toBe(BALL_BIRTH_DELAY);
  });

  it('retains the exact Game Over and End Level wait graphs', () => {
    if (!gameplay) return;
    const gameOverDelays = children(gameplay, 'Gameplay_Events', 'Delayer').map(
      (node) => floatValue(parameter(gameplay, node, 'Time to Wait')) / 1000,
    );
    expect(gameOverDelays).toContain(GAME_OVER_MENU_DELAY);

    const fade = children(gameplay, 'fadeout Sky', 'Linear Progression')[0];
    expect(floatValue(parameter(gameplay, fade, 'Duration')) / 1000).toBe(FINISH_SKY_FADE_DURATION);

    const waitSelector = children(gameplay, 'Wait', 'Parameter Selector')[0];
    const waits = parameters(gameplay, waitSelector)
      .filter((entry) => entry.name.startsWith('pIn '))
      .map((entry) => floatValue(resolve(gameplay, entry)) / 1000);
    expect(waits).toEqual([FINISH_WAIT_DURATION, FINAL_FINISH_WAIT_DURATION]);

    const rowCount = children(gameplay, 'Wait', 'Op')[0];
    expect(parameter(gameplay, rowCount, 'p1').name).toBe('AllLevel Array');
    const lessThan = children(gameplay, 'Wait', 'Test')[0];
    expect(integerValue(parameter(gameplay, lessThan, 'Test'))).toBe(3);
    expect(finishMenuDelay(1)).toBe(13);
    expect(finishMenuDelay(12)).toBe(26);

    const skipKeys = children(gameplay, '3 keys', 'Key Event')
      .map((node) => integerValue(parameter(gameplay, node, 'Key Waited')))
      .sort((a, b) => a - b);
    expect(skipKeys).toEqual([1, 28, 57]); // Escape, Enter, Space
  });

  it('detaches the source Cam_Pos slot while its target controller keeps following', () => {
    const rig = new CamRig(4 / 3);
    const origin = new THREE.Vector3();
    rig.resetTo(origin);
    rig.setNavigationActive(false);
    rig.detachSlot();
    const fixedSlot = rig.slotPosition.clone();

    const movedBall = new THREE.Vector3(100, 20, -30);
    for (let index = 0; index < 30; index++) rig.update(1 / 60, movedBall, EMPTY_INPUT);

    expect(rig.isSlotAttached).toBe(false);
    expect(rig.slotPosition.toArray()).toEqual(fixedSlot.toArray());
    expect(rig.targetPosition.distanceTo(movedBall)).toBeLessThan(0.5);
    expect(rig.camera.position.distanceTo(fixedSlot)).toBeLessThan(0.5);
  });

  it('source finish and Game Over branches both reparent Cam_Pos to null', () => {
    if (!gameplay) return;
    const events = gameplay.byName.get('Gameplay_Events')?.find((entry) => entry.kind === 'behavior');
    expect(events?.kind).toBe('behavior');
    if (events?.kind !== 'behavior') return;
    const setParents = events.referenceLists
      .flat()
      .map((index) => gameplay.objects[index])
      .filter((entry): entry is BehaviorRec => entry?.kind === 'behavior' && entry.name === 'Set Parent');
    expect(setParents).toHaveLength(2);
    for (const node of setParents) {
      const targetInput = gameplay.objects[node.headerData.at(-2) ?? -1];
      const target = targetInput?.kind === 'parameter' ? resolve(gameplay, targetInput) : null;
      const parentInput = parameters(gameplay, node).find((entry) => entry.name === 'Parent');
      const parent = parentInput ? resolve(gameplay, parentInput) : null;
      expect(target?.name).toBe('Cam_Pos Frame');
      expect(parent?.valueObjectIndex).toBe(-1);
      expect(parent?.valueBytes).toHaveLength(0);
    }
  });
});

describe.skipIf(!existsSync(basePath))('base end-flow authority', () => {
  const base = existsSync(basePath) ? parseNmo(readFileSync(basePath)) : null;

  it('routes Dead to Menu_Dead and End Level to Menu_Score', () => {
    if (!base) return;
    const switcher = children(base, 'Event_handler', 'Switch On Message')[0];
    const messages = parameters(base, switcher)
      .filter((entry) => entry.name.startsWith('Message '))
      .map((entry) => {
        const value = resolve(base, entry);
        return value.managerInt === null ? null : base.messageTypes[value.managerInt];
      });
    expect(messages).toContain('Dead');
    expect(messages).toContain('End Level');

    const scriptParameters = [
      ...children(base, 'Event_handler', 'Activate Script'),
      ...children(base, 'Event_handler', 'Execute Script'),
    ]
      .flatMap((node) => parameters(base, node))
      .filter((entry) => entry.name === 'Script')
      .map((entry) => resolve(base, entry).name);
    expect(scriptParameters).toContain('Menu_Dead Script');
    expect(scriptParameters).toContain('Menu_Score Script');
  });
});
