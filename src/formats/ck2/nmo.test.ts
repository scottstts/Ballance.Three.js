import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LEVEL_LIGHT_COLORS, skyLetter, skyTranslation } from '../../engine/assets.ts';
import { materialToThree, SCENE_AMBIENT } from '../../engine/convert.ts';
import { GAMEPLAY_SKY_SOURCE, MENU_SKY_SOURCE } from '../../engine/sky.ts';
import { FLOOR_GROUPS } from '../../game/constants.ts';
import { decodeCk2dCurve, evalCurve } from '../../game/curve.ts';
import { decodeUfoPath } from '../../game/finale.ts';
import { SOURCE_FRAME_LIMIT_HZ } from '../../game/frameLoop.ts';
import { MODUL_PHYS } from '../../game/moduls/physTable.ts';
import { SCORE_COUNT_SPEED, scoreCountStep } from '../../game/score.ts';
import { DEFAULT_SETTINGS, SCREEN_MODES, SOURCE_KEYS, sourceKeyCode } from '../../game/settings.ts';
import { defaultTable } from '../../game/store.ts';
import { parseNmo } from './nmo.ts';
import { CKClassId } from './types.ts';

const GAME_DIR = [
  fileURLToPath(new URL('../../../Ballance_bin/Ballance', import.meta.url)),
  fileURLToPath(new URL('../../../Ballance_bin/source1/Ballance', import.meta.url)),
].find(existsSync) ?? '';
const hasGame = existsSync(GAME_DIR);

describe.skipIf(!hasGame)('parseNmo on original game files', () => {
  it('parses Level_01.NMO structure', () => {
    const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/Level/Level_01.NMO')));
    expect(file.info.fileVersion).toBe(8);
    expect(file.objects.length).toBe(file.info.objectCount);
    expect(file.objects.length).toBeGreaterThan(100);

    // semantic groups must exist
    const groupNames = file.groups.map((g) => g.name);
    expect(groupNames).toContain('Sector_01');
    expect(groupNames).toContain('Phys_Floors');
    expect(groupNames).toContain('PS_Levelstart');
    expect(groupNames).toContain('PE_Levelende');

    // groups must reference valid member objects
    const sector1 = file.groups.find((g) => g.name === 'Sector_01')!;
    expect(sector1.memberIndices.length).toBeGreaterThan(0);
    for (const idx of sector1.memberIndices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(file.objects.length);
    }

    // entities must have meshes with geometry
    const floors = file.groups.find((g) => g.name === 'Phys_Floors')!;
    let checkedMeshes = 0;
    for (const idx of floors.memberIndices) {
      const obj = file.objects[idx];
      if (obj.kind !== 'entity' || obj.meshIndex < 0) continue;
      const mesh = file.objects[obj.meshIndex];
      expect(mesh.kind).toBe('mesh');
      if (mesh.kind === 'mesh') {
        expect(mesh.vertexCount).toBeGreaterThan(0);
        expect(mesh.faceCount).toBeGreaterThan(0);
        expect(mesh.positions.length).toBe(mesh.vertexCount * 3);
        expect(mesh.faceIndices.length).toBe(mesh.faceCount * 3);
        // face indices in range
        for (let i = 0; i < mesh.faceIndices.length; i++) {
          expect(mesh.faceIndices[i]).toBeLessThan(mesh.vertexCount);
        }
        checkedMeshes++;
      }
    }
    expect(checkedMeshes).toBeGreaterThan(0);

    // world matrices must be finite and affine
    for (const e of file.entities) {
      for (let i = 0; i < 16; i++) expect(Number.isFinite(e.worldMatrix[i])).toBe(true);
      expect(e.worldMatrix[15]).toBe(1);
    }
  });

  it('parses all 12 levels without throwing', () => {
    for (let n = 1; n <= 12; n++) {
      const name = `Level_${String(n).padStart(2, '0')}.NMO`;
      const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/Level', name)));
      expect(file.objects.length).toBeGreaterThan(50);
      expect(file.groups.length).toBeGreaterThan(5);
    }
  });

  it('parses compressed files (Balls.nmo, whole-compressed)', () => {
    const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/Balls.nmo')));
    expect(file.objects.length).toBeGreaterThan(0);
    const names = file.objects.map((o) => o.name);
    expect(names.some((n) => n.includes('Ball_Paper'))).toBe(true);
    expect(names.some((n) => n.includes('Ball_Wood'))).toBe(true);
    expect(names.some((n) => n.includes('Ball_Stone'))).toBe(true);
  });

  it('reads texture filename references', () => {
    const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/Level/Level_01.NMO')));
    const textures = file.objects.filter((o) => o.kind === 'texture');
    expect(textures.length).toBeGreaterThan(0);
    const withNames = textures.filter((t) => t.kind === 'texture' && t.fileNames.some((f) => f.length > 0));
    expect(withNames.length).toBeGreaterThan(0);
  });

  it('reads materials referencing textures', () => {
    const file = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/Level/Level_01.NMO')));
    const materials = file.objects.filter((o) => o.kind === 'material');
    expect(materials.length).toBeGreaterThan(0);
    const textured = materials.filter((m) => m.kind === 'material' && m.textureIndex >= 0);
    expect(textured.length).toBeGreaterThan(0);
    for (const m of textured) {
      if (m.kind !== 'material') continue;
      expect(file.objects[m.textureIndex].classId).toBe(CKClassId.Texture);
    }

    const floorWood = file.byName.get('Floor_Wood')?.find((record) => record.kind === 'material');
    expect(floorWood?.kind).toBe('material');
    if (floorWood?.kind === 'material') {
      const material = materialToThree(floorWood, { prelit: false, texture: null });
      expect(material).toBeInstanceOf(THREE.MeshPhongMaterial);
      if (material instanceof THREE.MeshPhongMaterial) {
        expect(material.emissive.r).toBeCloseTo(floorWood.emissive[0] + floorWood.ambient[0] * SCENE_AMBIENT, 8);
        expect(material.specular.r).toBeCloseTo(floorWood.specular[0], 8);
        expect(material.shininess).toBeCloseTo(floorWood.specularPower, 8);
      }
    }
  });

  it('decodes the original Extra Life and Extra Point CKSprite3D assets', () => {
    const life = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/PH/P_Extra_Life.nmo')));
    const lifeBall = life.byName.get('P_Extra_Life_SilverBall')?.find((record) => record.kind === 'sprite3d');
    expect(lifeBall?.kind).toBe('sprite3d');
    if (lifeBall?.kind === 'sprite3d') {
      expect(lifeBall.classId).toBe(CKClassId.Sprite3d);
      expect(lifeBall.size).toEqual([0.5, 0.5]);
      expect(lifeBall.parentIndex).toBe(409);
      expect(lifeBall.materialIndex).toBe(407);
      expect(life.objects[lifeBall.parentIndex]?.name).toBe('P_Extra_Life_Sphere');
      expect(life.objects[lifeBall.materialIndex]?.name).toBe('P_Extra_Life_SilverBall');
    }

    const point = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/PH/P_Extra_Point.nmo')));
    const pointBalls = point.objects
      .filter((record) => record.kind === 'sprite3d' && /^P_Extra_Point_Ball\d$/.test(record.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    expect(pointBalls).toHaveLength(7);
    for (let index = 0; index < pointBalls.length; index++) {
      const ball = pointBalls[index];
      if (ball.kind !== 'sprite3d') continue;
      expect(ball.classId).toBe(CKClassId.Sprite3d);
      expect(ball.materialIndex).toBe(528);
      expect(ball.size).toEqual(index === 0 ? [0.5, 0.5] : [0.25, 0.25]);
    }
  });

  it('retains complete structured CK2dCurve parameter values', () => {
    const life = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/PH/P_Extra_Life.nmo')));
    const scaleCurve = life.objects[294];
    const bobCurve = life.objects[320];
    expect(scaleCurve.kind).toBe('parameter');
    expect(bobCurve.kind).toBe('parameter');
    if (scaleCurve.kind === 'parameter' && bobCurve.kind === 'parameter') {
      expect(scaleCurve.valueVersion).toBe(0);
      expect(scaleCurve.valueBytes.byteLength).toBe(115 * 4);
      expect(bobCurve.valueVersion).toBe(0);
      expect(bobCurve.valueBytes.byteLength).toBe(63 * 4);

      const scaleKeys = decodeCk2dCurve(scaleCurve.valueBytes);
      const bobKeys = decodeCk2dCurve(bobCurve.valueBytes);
      expect(scaleKeys).toHaveLength(7);
      expect(scaleKeys.map(([time, value]) => [time, value])).toEqual([
        [0, 1],
        [0.17883211374282837, 0.014492753893136978],
        [0.36496350169181824, 0.9468598961830139],
        [0.569343090057373, 0.21256038546562195],
        [0.7299270033836365, 0.8502415418624878],
        [0.8868613243103027, 0.40096619725227356],
        [1, 1],
      ]);
      expect(bobKeys.map(([time, value]) => [time, value])).toEqual([
        [0, 0],
        [0.5, 1],
        [1, 0],
      ]);
      // Saved runtime state in the original graph: Progression=.928 produced
      // these two values. This locks the tangent interpretation as well as keys.
      expect(evalCurve(scaleKeys, 0.9279999732971191)).toBeCloseTo(0.5305692553520203, 4);
      expect(evalCurve(bobKeys, 0.9279999732971191)).toBeCloseTo(0.2856872081756592, 4);
    }
  });

  it('reads the original Tutorial and Language data arrays', () => {
    const tutorial = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/Tutorial.nmo')));
    const tutorialArray = tutorial.byName.get('TutorialArray')?.[0];
    expect(tutorialArray?.kind).toBe('dataArray');
    if (tutorialArray?.kind === 'dataArray') {
      expect(tutorialArray.columns.map((column) => column.name)).toEqual(['TutorialID', 'TutorialText', 'TutorialStatus']);
      expect(tutorialArray.rows).toHaveLength(11);
      expect(tutorialArray.rows.map((row) => row[0])).toEqual(Array.from({ length: 11 }, (_, index) => index));
    }
    const tutorialText = tutorial.byName.get('Tutorial_Interface')?.[0];
    const tutorialBack = tutorial.byName.get('Tutorial_Interface_Back')?.[0];
    expect(tutorialText?.kind).toBe('entity2d');
    expect(tutorialBack?.kind).toBe('entity2d');
    if (tutorialText?.kind === 'entity2d') {
      expect(tutorialText.rect).toEqual([
        0.24332548677921295,
        0.7479535341262817,
        0.7330737113952637,
        0.9889520406723022,
      ]);
    }
    if (tutorialBack?.kind === 'entity2d') {
      expect(tutorialBack.materialIndex).toBe(50);
      expect(tutorialBack.rect[3]).toBeCloseTo(1);
    }

    const language = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/Language.nmo')));
    const languageArray = language.byName.get('language')?.[0];
    expect(languageArray?.kind).toBe('dataArray');
    if (languageArray?.kind === 'dataArray') {
      expect(languageArray.columns.map((column) => column.name)).toEqual([
        'description',
        'german',
        'english',
        'spanish',
        'italian',
        'french',
      ]);
      expect(languageArray.rows.some((row) => row[2] === 'Start')).toBe(true);
      expect(languageArray.rows.some((row) => row[2] === 'Do you want to restart the level?')).toBe(true);
    }
  });

  it('decodes authored behavior graphs, links, IO, and typed parameters', () => {
    const gameplay = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/Gameplay.nmo')));
    expect(gameplay.messageTypes[9]).toBe('Checkpoint reached');
    expect(gameplay.messageTypes[11]).toBe('Level_Finish');
    expect(gameplay.messageTypes[12]).toBe('Game Over');
    expect(gameplay.messageTypes[20]).toBe('Counter inactive');
    const finishMessage = gameplay.objects[5310];
    expect(finishMessage.kind).toBe('parameter');
    if (finishMessage.kind === 'parameter') {
      expect(finishMessage.managerGuid).toEqual([0x466a0fac, 0]);
      expect(finishMessage.managerInt).toBe(11);
      expect(finishMessage.valueVersion).toBe(0);
      expect(finishMessage.valueBytes).toHaveLength(0);
    }
    const light = gameplay.byName.get('Light_Ingame')?.[0];
    expect(light?.kind).toBe('light');
    if (light?.kind === 'light') {
      expect(light.entity.worldMatrix[12]).toBeCloseTo(-5.1707215, 6);
      expect(light.entity.worldMatrix[13]).toBeCloseTo(15.2553339, 6);
      expect(light.entity.worldMatrix[14]).toBeCloseTo(3.6059473, 6);
      expect(light.lightType).toBe(3);
      expect(light.active).toBe(true);
      expect(light.specularFlag).toBe(true);
      expect(light.constAttenuation).toBe(1);
      expect(light.linearAttenuation).toBe(0);
      expect(light.quadAttenuation).toBe(0);
      expect(light.range).toBe(1000);
    }
    const tutorial = gameplay.byName.get('Gameplay_Tutorial')?.[0];
    expect(tutorial?.kind).toBe('behavior');
    if (tutorial?.kind === 'behavior') {
      expect(tutorial.referenceLists.map((list) => list.length)).toEqual([10, 12, 14, 1]);
      expect(tutorial.referenceLists[0].map((index) => gameplay.objects[index].classId)).toEqual(
        Array(10).fill(CKClassId.Behavior),
      );
      expect(tutorial.referenceLists[1].map((index) => gameplay.objects[index].classId)).toEqual(
        Array(12).fill(CKClassId.BehaviorLink),
      );
      expect(tutorial.referenceLists[2].map((index) => gameplay.objects[index].classId)).toEqual(
        Array(14).fill(CKClassId.ParameterLocal),
      );
      expect(tutorial.trailingData).toEqual([]);
    }

    const link = gameplay.objects[10577];
    expect(link.kind).toBe('behaviorLink');
    if (link.kind === 'behaviorLink') {
      expect(link.activationDelay).toBe(1);
      expect(link.currentDelay).toBe(1);
      expect(link.outputIndex).toBe(7496);
      expect(link.inputIndex).toBe(10444);
    }
    const output = gameplay.objects[7496];
    const input = gameplay.objects[10444];
    expect(output.kind === 'behaviorIo' ? output.flags : -1).toBe(2);
    expect(input.kind === 'behaviorIo' ? input.flags : -1).toBe(1);

    const timeFactor = gameplay.objects[10725];
    expect(timeFactor.kind).toBe('parameter');
    if (timeFactor.kind === 'parameter') {
      expect(timeFactor.typeGuid).toEqual([0x54b4422b, 0x730f0f4f]);
      expect(new DataView(timeFactor.valueBytes.buffer, timeFactor.valueBytes.byteOffset).getFloat32(0, true)).toBe(500);
    }

    const tutorialId = gameplay.objects[7498];
    expect(tutorialId.kind).toBe('parameter');
    if (tutorialId.kind === 'parameter') {
      expect(tutorialId.typeGuid).toEqual([0x5a5716fd, 0x44e276d7]);
      expect(tutorialId.sourceIndex).toBe(6678);
    }
  });

  it('locks both TT SkyAround instances to their serialized source values', () => {
    const readSky = (relativePath: string) => {
      const file = parseNmo(readFileSync(join(GAME_DIR, relativePath)));
      const behavior = file.byName.get('TT Sky')?.find((record) => record.kind === 'behavior');
      expect(behavior?.kind).toBe('behavior');
      if (behavior?.kind !== 'behavior') throw new Error(`TT Sky missing from ${relativePath}`);
      expect(behavior.headerData.slice(1, 3)).toEqual([0x36691920, 0x3b261630]);

      const resolveParameter = (listIndex: number, name: string) => {
        const index = behavior.referenceLists[listIndex].find((candidate) => file.objects[candidate]?.name === name);
        let record = index === undefined ? undefined : file.objects[index];
        for (let depth = 0; record?.kind === 'parameter' && depth < 8; depth++) {
          const next = record.sourceIndex >= 0 ? record.sourceIndex : record.sharedIndex;
          if (next < 0) break;
          record = file.objects[next];
        }
        expect(record?.kind).toBe('parameter');
        if (record?.kind !== 'parameter') throw new Error(`${name} missing from ${relativePath}`);
        return record;
      };
      const number = (listIndex: number, name: string) => {
        const record = resolveParameter(listIndex, name);
        const view = new DataView(record.valueBytes.buffer, record.valueBytes.byteOffset, record.valueBytes.byteLength);
        return view.getFloat32(0, true);
      };
      const integer = (listIndex: number, name: string) => {
        const record = resolveParameter(listIndex, name);
        const view = new DataView(record.valueBytes.buffer, record.valueBytes.byteOffset, record.valueBytes.byteLength);
        return view.getInt32(0, true);
      };

      return {
        inputNames: behavior.referenceLists[0].map((index) => file.objects[index].name),
        distortion: number(0, 'Distortion'),
        radius: number(0, 'Radius'),
        quadraticSideFaces: integer(0, 'Quadratic SideFaces?') !== 0,
        sideFaceHeight: number(0, 'or SideFace-Heigth'),
        yPosition: number(0, 'Y-Position of Sky'),
        sideMaterialCount: integer(1, 'Side Materials'),
        topMaterial: integer(1, 'Top Material') !== 0,
        bottomMaterial: integer(1, 'Bottom Material') !== 0,
      };
    };

    const menu = readSky('3D Entities/MenuLevel.nmo');
    const gameplay = readSky('3D Entities/Gameplay.nmo');
    expect(menu.inputNames.slice(7)).toEqual([
      '1.Side-Mat',
      '2.Side-Mat',
      '3.Side-Mat',
      '4.Side-Mat',
      'Bottom Mat',
    ]);
    expect(menu).toMatchObject(MENU_SKY_SOURCE);
    expect(gameplay).toMatchObject(GAMEPLAY_SKY_SOURCE);
  });

  it('retains the original UFO path and behavior embedded in PE_Balloon', () => {
    const balloon = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/PH/PE_Balloon.nmo')));
    const ufo = balloon.byName.get('UFO')?.[0];
    const hyperspace = balloon.byName.get('Hyperspace')?.[0];
    const path = balloon.byName.get('PE_UFO_Pos&Time')?.[0];
    expect(ufo?.kind).toBe('behavior');
    expect(hyperspace?.kind).toBe('behavior');
    expect(path?.kind).toBe('dataArray');
    if (ufo?.kind === 'behavior') expect(ufo.referenceLists.map((list) => list.length)).toEqual([23, 33, 55, 1, 1]);
    if (hyperspace?.kind === 'behavior') {
      expect(hyperspace.referenceLists.map((list) => list.length)).toEqual([7, 9, 18, 1]);
    }
    if (path?.kind === 'dataArray') {
      expect(path.rows).toHaveLength(13);
      expect(path.columns.map((column) => column.name)).toEqual([
        'Target Position',
        'Force',
        'Damping',
        'Waiting Time',
        'Referential',
        'Start Anim?',
      ]);
      expect(path.rows[0].slice(1, 3)).toEqual([0.05000000074505806, 0.800000011920929]);
      expect(path.rows[6].slice(1, 3)).toEqual([3, 0.699999988079071]);
    }
    const decodedPath = decodeUfoPath(balloon);
    expect(decodedPath).toHaveLength(13);
    expect(decodedPath.map((step) => step.waitSeconds)).toEqual([3, 2, 1, 1, 1, 0.5, 0.5, 2, 0.5, 0.5, 3, 2, 1.8]);
    expect(decodedPath.map((step) => step.relativeToBall)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(decodedPath[0].position.toArray()).toEqual([-500, -30, 50]);
    expect(decodedPath[5].startAnimation).toBe(true);
    expect(decodedPath[12].position.toArray()).toEqual([-2000, 0, -0]);
    expect(balloon.byName.get('PE_UFO_Body')?.[0]?.kind).toBe('entity');
    expect(balloon.byName.get('Misc_Ufo')?.[0]?.kind).toBe('texture');
    const dynamicTarget = balloon.objects[1418];
    expect(dynamicTarget.kind).toBe('parameter');
    if (dynamicTarget.kind === 'parameter') expect(dynamicTarget.valueObjectIndex).toBe(1798);
    const animation = balloon.byName.get('UFO_Animation')?.[0];
    expect(animation?.kind).toBe('keyedAnimation');
    if (animation?.kind === 'keyedAnimation') {
      expect(animation.animationIndices).toHaveLength(8);
      for (const index of animation.animationIndices) {
        const track = balloon.objects[index];
        expect(track.kind).toBe('objectAnimation');
        if (track.kind === 'objectAnimation') {
          expect(track.length).toBe(100);
          expect(track.rotationControllerType).toBe(0x45b52a02);
          expect(track.rotationKeys.map((key) => key.time)).toEqual([0, 35, 59, 70, 75, 100]);
        }
      }
    }
    const arm = balloon.byName.get('PE_UFO_Arm_A_03')?.find((record) => record.kind === 'entity');
    expect(arm?.kind).toBe('entity');
    if (arm?.kind === 'entity') expect(arm.parentIndex).toBe(1798);
  });

  it('keeps decoded level, floor, loose-ball, and highscore defaults in sync', () => {
    const levelinit = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/Levelinit.nmo')));
    const allLevel = levelinit.byName.get('AllLevel')?.[0];
    expect(allLevel?.kind).toBe('dataArray');
    if (allLevel?.kind === 'dataArray') {
      expect(allLevel.rows.map((row) => row[3])).toEqual([
        'Sky_L',
        'Sky_E',
        'Sky_A',
        'Sky_F',
        'Sky_C',
        'Sky_H',
        'Sky_D',
        'Sky_G',
        'Sky_K',
        'Sky_B',
        'Sky_J',
        'Sky_I',
      ]);
      expect(Array.from({ length: 12 }, (_, index) => `Sky_${skyLetter(index + 1)}`)).toEqual(
        allLevel.rows.map((row) => row[3]),
      );

      const floats = (objectIndex: unknown): number[] => {
        const parameter = levelinit.objects[Number(objectIndex)];
        expect(parameter?.kind).toBe('parameter');
        if (parameter?.kind !== 'parameter') return [];
        const view = new DataView(
          parameter.valueBytes.buffer,
          parameter.valueBytes.byteOffset,
          parameter.valueBytes.byteLength,
        );
        return Array.from(
          { length: parameter.valueBytes.byteLength / 4 },
          (_, index) => view.getFloat32(index * 4, true),
        );
      };
      for (let index = 0; index < allLevel.rows.length; index++) {
        const light = floats(allLevel.rows[index][4]);
        const lightHex =
          ((Math.round(light[0] * 255) << 16) |
            (Math.round(light[1] * 255) << 8) |
            Math.round(light[2] * 255)) >>>
          0;
        expect(LEVEL_LIGHT_COLORS[index + 1] ?? 0xffffff).toBe(lightHex);

        const translation = floats(allLevel.rows[index][5]);
        expect(skyTranslation(index + 1)[0]).toBeCloseTo(translation[0], 7);
        expect(skyTranslation(index + 1)[1]).toBeCloseTo(translation[1], 7);
      }
    }

    const floors = levelinit.byName.get('Physicalize_Floors')?.[0];
    expect(floors?.kind).toBe('dataArray');
    if (floors?.kind === 'dataArray') {
      const stopper = floors.rows.find((row) => row[0] === 'Phys_FloorStopper');
      expect(FLOOR_GROUPS.Phys_FloorStopper.friction).toBeCloseTo(Number(stopper?.[1]));
      expect(FLOOR_GROUPS.Phys_FloorStopper.elasticity).toBeCloseTo(Number(stopper?.[2]));
    }

    const balls = levelinit.byName.get('Physicalize_Balls')?.[0];
    expect(balls?.kind).toBe('dataArray');
    if (balls?.kind === 'dataArray') {
      const stone = balls.rows.find((row) => row[0] === 'P_Ball_Stone');
      expect(MODUL_PHYS.P_Ball_Stone.parts[0].friction).toBeCloseTo(Number(stone?.[2]));
    }

    const base = parseNmo(readFileSync(join(GAME_DIR, 'base.cmo')));
    const levelChunk = base.chunks[0];
    const renderSettings = levelChunk.data.findIndex(
      (value, index) => value === 0x00080000 && levelChunk.data[index + 3] === 0x000f0f0f,
    );
    expect(renderSettings).toBeGreaterThanOrEqual(0);
    expect(Array.from(levelChunk.data.slice(renderSettings + 2, renderSettings + 11))).toEqual([
      0xff808080,
      0x000f0f0f,
      0,
      0,
      0x3f800000,
      0x42c80000,
      0x3f800000,
      0xffffffff,
      0xffffffff,
    ]);
    expect(SCENE_AMBIENT).toBe(15 / 255);
    const level1 = base.byName.get('DB_Highscore_Lv01')?.[0];
    const level12 = base.byName.get('DB_Highscore_Lv12')?.[0];
    expect(level1?.kind).toBe('dataArray');
    expect(level12?.kind).toBe('dataArray');
    if (level1?.kind === 'dataArray') expect(defaultTable(1).map(({ name, score }) => [name, score])).toEqual(level1.rows);
    if (level12?.kind === 'dataArray') expect(defaultTable(12).map(({ name, score }) => [name, score])).toEqual(level12.rows);

    const dbOptions = base.byName.get('DB_Options')?.[0];
    expect(dbOptions?.kind).toBe('dataArray');
    if (dbOptions?.kind === 'dataArray') {
      const row = dbOptions.rows[0];
      expect(DEFAULT_SETTINGS.musicVolume).toBe(row[0]);
      expect(Number(DEFAULT_SETTINGS.syncToScreen)).toBe(row[1]);
      expect(sourceKeyCode(DEFAULT_SETTINGS.keyForward)).toBe(row[2]);
      expect(sourceKeyCode(DEFAULT_SETTINGS.keyBackward)).toBe(row[3]);
      expect(sourceKeyCode(DEFAULT_SETTINGS.keyLeft)).toBe(row[4]);
      expect(sourceKeyCode(DEFAULT_SETTINGS.keyRight)).toBe(row[5]);
      expect(sourceKeyCode(DEFAULT_SETTINGS.keyRotateCamera)).toBe(row[6]);
      expect(sourceKeyCode(DEFAULT_SETTINGS.keyLiftCamera)).toBe(row[7]);
      expect(Number(DEFAULT_SETTINGS.invertCameraRotation)).toBe(row[8]);
      expect(Number(DEFAULT_SETTINGS.clouds)).toBe(row[10]);
    }

    const language = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/Language.nmo')));
    const allKeys = language.byName.get('all_keys')?.[0];
    expect(allKeys?.kind).toBe('dataArray');
    if (allKeys?.kind === 'dataArray') {
      expect(SOURCE_KEYS).toHaveLength(allKeys.rows.length);
      expect(SOURCE_KEYS.map(({ label }, index) => [index + 1, label])).toEqual(
        allKeys.rows.map((row) => [row[0], row[2]]),
      );
    }

    const menu = parseNmo(readFileSync(join(GAME_DIR, '3D Entities/Menu.nmo')));
    const updateSettings = menu.byName
      .get('Update Settings')
      ?.find((record) => record.kind === 'behavior');
    expect(updateSettings?.kind).toBe('behavior');
    if (updateSettings?.kind === 'behavior') {
      const timeSettings = updateSettings.referenceLists
        .flat()
        .map((index) => menu.objects[index])
        .filter((record) => record?.kind === 'behavior' && record.name === 'Time Settings');
      expect(timeSettings).toHaveLength(2);
      const sourceInt = (behavior: (typeof timeSettings)[number], name: string): number => {
        let parameter = behavior.referenceLists
          .flat()
          .map((index) => menu.objects[index])
          .find((record) => record?.kind === 'parameter' && record.name === name);
        const seen = new Set<number>();
        while (parameter?.kind === 'parameter' && !seen.has(parameter.index)) {
          seen.add(parameter.index);
          const nextIndex = parameter.sourceIndex >= 0 ? parameter.sourceIndex : parameter.sharedIndex;
          if (nextIndex < 0 || menu.objects[nextIndex]?.kind !== 'parameter') break;
          parameter = menu.objects[nextIndex];
        }
        expect(parameter?.kind).toBe('parameter');
        if (parameter?.kind !== 'parameter') return Number.NaN;
        return new DataView(parameter.valueBytes.buffer, parameter.valueBytes.byteOffset).getInt32(0, true);
      };
      // BuildingBlocksAddons1.dll declares Free=1, Synchronize to Screen=2,
      // Limit=3. The two branches select synchronized and 60 FPS limited.
      expect(timeSettings.map((behavior) => sourceInt(behavior, 'Frame Rate')).sort()).toEqual([2, 3]);
      expect(timeSettings.map((behavior) => sourceInt(behavior, 'Frame Limit Value'))).toEqual([
        SOURCE_FRAME_LIMIT_HZ,
        SOURCE_FRAME_LIMIT_HZ,
      ]);
    }
    const countSpeed = menu.byName.get('Menu_Score_CountSpeed')?.[0];
    expect(countSpeed?.kind).toBe('dataArray');
    if (countSpeed?.kind === 'dataArray') {
      expect(SCORE_COUNT_SPEED.map(({ limit, step }) => [limit, step])).toEqual(countSpeed.rows);
      for (const { limit, step } of SCORE_COUNT_SPEED) expect(scoreCountStep(limit)).toBe(step);
    }
    const screenModes = menu.byName.get('Dummy_ScreenModes')?.[0];
    expect(screenModes?.kind).toBe('dataArray');
    if (screenModes?.kind === 'dataArray') {
      expect(SCREEN_MODES.map(({ mode, width, height, bpp }) => [mode, width, height, bpp])).toEqual(screenModes.rows);
    }
    const credits = menu.byName.get('Menu_Credits_Strings')?.[0];
    expect(credits?.kind).toBe('dataArray');
    if (credits?.kind === 'dataArray') expect(credits.rows).toHaveLength(23);
  });
});
