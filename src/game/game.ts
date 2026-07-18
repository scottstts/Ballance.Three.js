/**
 * Game orchestrator: loads a level, builds render + physics worlds, and runs
 * the fixed-step (66 Hz) simulation loop with sector/checkpoint/life rules.
 */
import * as THREE from 'three';
import { levelPath, loadNmo, skyLetter } from '../engine/assets.ts';
import { addLightRig, LEVEL_LIGHT_COLORS } from '../engine/viewer.ts';
import { buildScene, groupEntities, type BuiltScene } from '../engine/sceneBuilder.ts';
import { buildSky } from '../engine/sky.ts';
import { AudioManager, type Surface } from './audio.ts';
import { Ball } from './ball.ts';
import { BalloonPhysics } from './balloon.ts';
import { CamRig } from './camera.ts';
import {
  BALL_BIRTH_DELAY,
  BALL_OFF_DELAY,
  DEATH_FADE_DURATION,
  FLOOR_GROUPS,
  SIM_DT,
  type BallKind,
} from './constants.ts';
import RAPIER from '@dimforge/rapier3d-compat';
import { BallShadow, FlameSystem, LightningSphere, ShatterSystem, TRAFO_SOURCE, TrafoAnim } from './effects.ts';
import { prepareBalloonInstance, UfoFinale } from './finale.ts';
import { Input } from './input.ts';
import { LevelLogic } from './level.ts';
import { ModulManager, sectorLookup } from './moduls/manager.ts';
import { instantiatePrefab, loadPrefab, type PrefabInstance } from './moduls/prefabs.ts';
import { modulFactories } from './moduls/registry.ts';
import { initRapier, PhysicsWorld } from './physics.ts';
import { PickupSystem } from './pickups.ts';
import { screenMode } from './settings.ts';
import { gameStore } from './store.ts';
import { TutorialSystem, tutorialEligible } from './tutorial.ts';

export interface GameHandle {
  dispose(): void;
  debug: GameDebug | null;
}

/** Dev/testing hook: lets tools drive input and inspect state programmatically. */
export interface GameDebug {
  input: Input;
  ballPosition(): { x: number; y: number; z: number };
  ballVelocity(): { x: number; y: number; z: number };
  /** physics steps executed since boot */
  ticks(): number;
  /** freeze/unfreeze the real-time loop (for deterministic scripted runs) */
  setPaused(paused: boolean): void;
  /**
   * Synchronously simulate game time (66 Hz steps) regardless of tab
   * visibility/throttling, then render one frame. Deterministic test driver.
   */
  stepSeconds(seconds: number): void;
  /** teleport the ball (testing) */
  teleport(x: number, y: number, z: number): void;
  setVelocity(x: number, y: number, z: number): void;
  setLives(n: number): void;
  state(): { phase: string; lives: number; points: number; sector: number; ballKind: string };
  level: LevelLogic;
  scene: BuiltScene;
  three: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cameraTarget(): { x: number; y: number; z: number };
  cameraYaw(): number;
  audio(): Record<string, unknown>;
}

declare global {
  interface Window {
    __game?: GameDebug;
  }
}

const bootStage = (s: string): void => {
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__bootStage = s;
};

const POINT_TICK = 0.5; // seconds per -1 point
const LIFE_BONUS = 200; // original: each remaining life is worth 200 points

export async function startGame(canvas: HTMLCanvasElement, level: number): Promise<GameHandle> {
  bootStage('rapier');
  await initRapier();

  // preserveDrawingBuffer keeps the last frame capturable (automation screenshots)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  const initialMode = screenMode(gameStore.getState().settings);
  renderer.setSize(initialMode.width, initialMode.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(0xbed7e3);
  // original gameplay has no fog; the single white light is tinted per level
  addLightRig(scene, LEVEL_LIGHT_COLORS[level] ?? 0xffffff);

  bootStage('level-nmo');
  const file = await loadNmo(levelPath(level));
  bootStage('build-scene');
  const built: BuiltScene = await buildScene(file);
  scene.add(built.root);
  bootStage('sky');
  const builtSky = await buildSky(skyLetter(level), fogColor);
  const sky = builtSky.group;
  scene.add(sky);
  renderer.setClearColor(builtSky.horizonColor);

  bootStage('colliders');
  const bootFlags = new URLSearchParams(window.location.search);
  const physics = new PhysicsWorld();
  const { surfaceByCollider, floorHitByCollider } = bootFlags.has('nocolliders')
    ? { surfaceByCollider: new Map<number, Surface>(), floorHitByCollider: new Map<number, string>() }
    : buildStaticColliders(physics, built);
  const minY = computeMinY(built) - 30;

  const logic = new LevelLogic(built, minY);

  // the level file only carries gray placement dummies for the scenery
  // pieces; the textured versions live in PH/*.nmo (as the original loads)
  bootStage('scenery');
  let balloonInstance: PrefabInstance | null = null;
  for (const { group, prefab } of [
    { group: 'PC_Checkpoints', prefab: 'PC_TwoFlames' },
    { group: 'PS_Levelstart', prefab: 'PS_FourFlames' },
    { group: 'PE_Levelende', prefab: 'PE_Balloon' },
  ]) {
    const placements = groupEntities(built, group);
    if (placements.length === 0) continue;
    const p = await loadPrefab(prefab);
    for (const e of placements) {
      e.object.visible = false;
      const inst = instantiatePrefab(p, e.object.matrix);
      scene.add(inst.root);
      if (group === 'PE_Levelende') balloonInstance = inst;
    }
  }
  for (const e of groupEntities(built, 'PR_Resetpoints')) e.object.visible = false;
  const balloonVisual = balloonInstance ? prepareBalloonInstance(balloonInstance) : null;
  const ufoFinale = level === 12 && balloonInstance ? new UfoFinale(await loadPrefab('PE_Balloon'), balloonInstance) : null;

  bootStage('ball');
  const spawn = logic.spawnFor(1);
  const spawnPos = spawn.position.clone();
  const ball = await Ball.create(physics, scene, spawnPos);
  ball.teleport(spawnPos);

  bootStage('effects');
  const flames = new FlameSystem();
  await flames.init(built, scene);
  const lightning = new LightningSphere();
  await lightning.init();
  scene.add(lightning.group);
  const trafoAnim = new TrafoAnim();
  await trafoAnim.init();
  scene.add(trafoAnim.group);
  const shatter = new ShatterSystem(physics, scene);
  await shatter.init();
  const pickups = new PickupSystem();
  await pickups.init(built, scene);
  const ballShadow = new BallShadow(physics);
  await ballShadow.init();
  scene.add(ballShadow.mesh);

  const rig = new CamRig(4 / 3);
  const input = new Input(() => gameStore.getState().settings);

  const audio = new AudioManager(rig.camera);
  shatter.setSoundPlayer((name, volume) => audio.playFlat(name, volume));
  let skyLayerRef: THREE.Object3D | null = null;
  const applyVolumes = () => {
    const s = gameStore.getState().settings;
    audio.setMusicVolume(s.musicVolume);
    audio.sfxVolume = 1;
    const mode = screenMode(s);
    renderer.setSize(mode.width, mode.height, false);
    if (skyLayerRef) skyLayerRef.visible = s.clouds;
  };
  applyVolumes();
  const unsubscribeSettings = gameStore.subscribe((s, prev) => {
    if (s.settings !== prev.settings) {
      input.clear();
      applyVolumes();
    }
  });
  audio.startMusic(level);

  const balloonPhysics = balloonInstance
    ? new BalloonPhysics(balloonInstance, {
        physics,
        scene,
        ball,
        registerSurface: (handle, surface) => surfaceByCollider.set(handle, surface),
        attachLoop: (name, target, volume) => audio.createLoop(name, target, volume),
        emit: () => {},
      })
    : null;
  if (import.meta.env.DEV && (bootFlags.has('finish') || bootFlags.has('wakeballoon'))) balloonPhysics?.wake();

  const tutorial = tutorialEligible(level, bootFlags)
    ? await TutorialSystem.create(scene, () => audio.playFlat('Hit_Stone_Kuppel.wav', 1))
    : null;

  bootStage('moduls');
  const onlyModuls = bootFlags.get('moduls')?.split(',');
  const activeFactories = onlyModuls ? modulFactories.filter((f) => onlyModuls.includes(f.groupName)) : modulFactories;
  const moduls = await ModulManager.create(
    bootFlags.has('nomoduls') ? emptyScene(built) : built,
    {
      physics,
      scene,
      ball,
      registerSurface: (handle, surface) => surfaceByCollider.set(handle, surface),
      attachLoop: (name, target, volume) => audio.createLoop(name, target, volume),
      emit: (ev) => {
        const s = gameStore.getState();
        switch (ev.kind) {
          case 'extraPoint':
            s.set({ points: gameStore.getState().points + ev.amount });
            break;
          case 'extraLife':
            s.set({ lives: gameStore.getState().lives + 1 });
            break;
          case 'trafo': {
            if (pendingTrafo) break;
            // The source unphysicalizes the old ball and TT Set Dynamic
            // Position pulls it toward (Trafo - Offset), with Offset Y=-3.
            ev.sourceMain.updateWorldMatrix(true, false);
            const pullTarget = new THREE.Vector3(
              -TRAFO_SOURCE.pullOffset[0],
              -TRAFO_SOURCE.pullOffset[1],
              TRAFO_SOURCE.pullOffset[2],
            ).applyMatrix4(ev.sourceMain.matrixWorld);
            trafoAnim.start(ev.ball, ev.sourceMain, ev.sourceShadow);
            ball.collider.setEnabled(false);
            ball.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
            pendingTrafo = {
              ball: ev.ball,
              elapsed: 0,
              target: pullTarget,
              previous: ball.position,
              exploded: false,
            };
            break;
          }
          case 'sound':
            audio.play(ev.name, ev.position, ev.volume ?? 1, scene);
            break;
        }
      },
    },
    activeFactories,
    sectorLookup(built),
  );
  moduls.setSector(1);
  flames.setSector(1);
  bootStage('done');

  input.attach(window);

  const store = gameStore.getState();
  store.set({
    phase: 'playing',
    level,
    lives: 3,
    points: 1000,
    sector: 1,
    sectorCount: logic.sectorCount,
    ballKind: 'wood',
    whiteFade: false,
    tutorialChapter: tutorial?.chapter ?? null,
    tutorialVisible: tutorial?.active ?? false,
  });
  if (import.meta.env.DEV && bootFlags.has('finish')) {
    logic.currentSector = logic.sectorCount;
    moduls.setSector(logic.sectorCount);
    flames.setSector(logic.sectorCount);
    const end = groupEntities(built, 'PE_Levelende')[0];
    if (end) {
      // Start above the physical platform so the deterministic helper enters
      // the authored proximity without spawning inside its compound hull.
      ball.teleport(end.object.position.clone().add(new THREE.Vector3(0, 5, 0)));
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(end.object.quaternion);
      rig.resetTo(end.object.position, Math.atan2(-forward.x, -forward.z));
    }
  }

  let disposed = false;
  let simTicks = 0;
  let paused = false;
  let debug: GameDebug | null = null;
  let deathTimer = 0;
  let pointTimer = 0;
  let birthTimer = 0;
  let flapCooldown = 0;
  let pendingTrafo: {
    ball: BallKind;
    elapsed: number;
    target: THREE.Vector3;
    previous: THREE.Vector3;
    exploded: boolean;
  } | null = null;
  // simple sim-time one-shot timer queue
  const timers: { t: number; fn: () => void }[] = [];
  const after = (seconds: number, fn: () => void) => timers.push({ t: seconds, fn });
  let finishSkyFade = -1;
  // final-sector ambient from the balloon (Music_EndCheckpoint loop)
  const balloonAmbient = balloonVisual ? audio.createLoop('Music_EndCheckpoint.wav', balloonVisual, 0.9) : null;
  const ufoLoop = ufoFinale && balloonInstance ? audio.createLoop('Misc_UFO.wav', balloonInstance.root, 1) : null;

  const startBirth = () => {
    birthTimer = BALL_BIRTH_DELAY;
    ball.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    ball.collider.setEnabled(false);
    ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    lightning.start();
    audio.play('Misc_Lightning.wav', ball.position, 1, scene);
  };
  audio.play('Misc_StartLevel.wav', ball.position, 1, scene);
  startBirth();

  // the original's slowly drifting cloud layer plane
  const skyLayer = built.entities.get('SkyLayer')?.object ?? null;
  if (skyLayer instanceof THREE.Mesh) {
    skyLayerRef = skyLayer;
    skyLayer.visible = gameStore.getState().settings.clouds;
    const mats = Array.isArray(skyLayer.material) ? skyLayer.material : [skyLayer.material];
    for (const m of mats) {
      const pm = m as THREE.MeshPhongMaterial;
      if (pm.map) {
        pm.map.wrapS = THREE.RepeatWrapping;
        pm.map.wrapT = THREE.RepeatWrapping;
        // the cloud texture supplies its own translucency (alphaMap reads
        // the green channel — luminance for the grayscale cloud image)
        pm.alphaMap = pm.map;
      }
      pm.transparent = true;
      pm.depthWrite = false;
    }
  }
  const skyLayerColors = skyLayer instanceof THREE.Mesh ? skyLayer.geometry.getAttribute('color') : null;
  const setSkyLayerFilter = (value: number) => {
    if (!(skyLayerColors instanceof THREE.BufferAttribute)) return;
    for (let index = 0; index < skyLayerColors.count; index++) {
      skyLayerColors.setXYZ(index, value, value, value);
    }
    skyLayerColors.needsUpdate = true;
  };
  // Levelinit.nmo/init SkyLayer sets the prelit filtering color to 200/255.
  setSkyLayerFilter(0.7843137979507446);
  // the layer follows the camera horizontally (UV-compensated) so its edge
  // can never come into view, keeping the authored cloud density
  const skyLayerSize = new THREE.Vector2(1, 1);
  if (skyLayer instanceof THREE.Mesh) {
    skyLayer.geometry.computeBoundingBox();
    const bb = skyLayer.geometry.boundingBox;
    if (bb) {
      skyLayerSize.set(
        Math.max(1, (bb.max.x - bb.min.x) * skyLayer.scale.x),
        Math.max(1, (bb.max.z - bb.min.z) * skyLayer.scale.z),
      );
    }
  }

  const respawn = () => {
    const s = gameStore.getState();
    shatter.clear();
    logic.resetAfterFall();
    pickups.resetAfterFall();
    ball.visual.visible = true;
    // original: the ball materializes exactly at the reset point
    const rp = logic.spawnFor(logic.currentSector);
    ball.setKind(logic.sectorBallKind);
    ball.teleport(rp.position);
    rig.rebindTarget();
    moduls.resetSector(logic.currentSector);
    s.set({ phase: 'playing', ballKind: logic.sectorBallKind });
    startBirth();
    // The two-second source curve is at full white while the ball is swapped;
    // its second half reveals the stationary three-second birth sequence.
    after(DEATH_FADE_DURATION - BALL_OFF_DELAY, () => gameStore.getState().set({ whiteFade: false }));
  };

  const die = () => {
    const s = gameStore.getState();
    // original fall: Misc_Fall plays, the ball keeps falling into the void,
    // the screen fades white, then the ball is reborn at the reset point
    trafoAnim.stop();
    lightning.stop();
    if (pendingTrafo) {
      ball.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      ball.collider.setEnabled(true);
      ball.visual.visible = true;
    }
    pendingTrafo = null;
    audio.play('Misc_Fall.wav', ball.position, 1, scene);
    const lives = s.lives - 1;
    s.set({ whiteFade: true });
    if (lives <= 0) {
      s.set({ lives: 0 });
      rig.setNavigationActive(false);
      after(BALL_OFF_DELAY, () => {
        ball.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        ball.collider.setEnabled(false);
        ball.visual.visible = false;
      });
      after(DEATH_FADE_DURATION, () => gameStore.getState().set({ whiteFade: false }));
      // Gameplay_Events detaches Cam_Pos after its 2000 ms Game Over delay.
      after(DEATH_FADE_DURATION, () => rig.detachSlot());
      after(2.5, () => {
        audio.stopMusic();
        gameStore.getState().set({ phase: 'gameover' });
      });
      s.set({ phase: 'dead' });
      deathTimer = Infinity; // gameover timer takes over
    } else {
      s.set({ lives, phase: 'dead' });
      deathTimer = BALL_OFF_DELAY;
    }
  };

  const simStep = () => {
    const s = gameStore.getState();
    for (let i = timers.length - 1; i >= 0; i--) {
      timers[i].t -= SIM_DT;
      if (timers[i].t <= 0) {
        const { fn } = timers[i];
        timers.splice(i, 1);
        fn();
      }
    }
    if (s.phase === 'dead') {
      shatter.advance(SIM_DT);
      physics.step(); // the ball keeps falling into the void
      deathTimer -= SIM_DT;
      if (deathTimer <= 0) respawn();
      return;
    }
    if (s.phase === 'finished') {
      balloonPhysics?.update();
      shatter.advance(SIM_DT);
      let carryPosition: THREE.Vector3 | null = null;
      if (ufoFinale?.active) {
        const ufo = ufoFinale.update(SIM_DT, ball.position);
        if (ufo.playAnimationSound) audio.play('Misc_UFO_anim.wav', ufoFinale.ballCarryPosition(), 0.9, scene);
        if (ufo.enteredHyperspace) ufoLoop?.setActive(false);
        if (ufo.carryBall) {
          carryPosition = ufoFinale.ballCarryPosition();
          ball.body.setTranslation(carryPosition, false);
          ball.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
          ball.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
        }
      }
      physics.step();
      simTicks++;
      balloonPhysics?.syncVisuals();
      if (carryPosition) {
        ball.body.setTranslation(carryPosition, false);
        ball.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
        ball.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      }
      return;
    }
    if (s.phase !== 'playing') return; // paused/gameover freeze the sim

    tutorial?.update(SIM_DT, ball.position, input);
    if (tutorial?.frozen) {
      // CK's tutorial writes the global physics time factor to zero. Keep
      // rigid-body velocities intact and simply do not advance the world.
      simTicks++;
      return;
    }

    // Gameplay.nmo's trafo sequence: the unphysicalized old ball follows the
    // TT Set Dynamic Position spring for 1350 ms, bursts at 2350 ms, then the
    // new ball is physicalized 150 ms later. AnimTrafo closes independently.
    if (pendingTrafo) {
      pendingTrafo.elapsed += SIM_DT;
      if (pendingTrafo.elapsed <= TRAFO_SOURCE.pullDuration) {
        const current = ball.position;
        const next = current
          .clone()
          .addScaledVector(pendingTrafo.target.clone().sub(current), TRAFO_SOURCE.pullForce * SIM_DT)
          .addScaledVector(current.clone().sub(pendingTrafo.previous), TRAFO_SOURCE.pullDamping);
        pendingTrafo.previous.copy(current);
        ball.body.setTranslation({ x: next.x, y: next.y, z: next.z }, true);
      }
      ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      if (!pendingTrafo.exploded && pendingTrafo.elapsed >= TRAFO_SOURCE.explosionTime) {
        const oldKind = ball.kind;
        // Fadeout Manager's 20 s timer started when the trafo was entered,
        // 2350 ms before this explosion graph is activated.
        shatter.burst(oldKind, ball.position, pendingTrafo.elapsed);
        ball.visual.visible = false;
        pendingTrafo.exploded = true;
      }
      if (pendingTrafo.elapsed >= TRAFO_SOURCE.newBallTime) {
        const position = ball.position;
        ball.setKind(pendingTrafo.ball);
        ball.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        ball.collider.setEnabled(true);
        ball.teleport(position);
        s.set({ ballKind: pendingTrafo.ball });
        pendingTrafo = null;
      }
    }

    // birth lightning / trafo hold: no player control meanwhile
    if (birthTimer > 0 || pendingTrafo) {
      if (birthTimer > 0) {
        birthTimer -= SIM_DT;
        if (birthTimer <= 0) {
          birthTimer = 0;
          ball.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
          ball.collider.setEnabled(true);
          ball.body.wakeUp();
        }
      }
      pushDir.set(0, 0, 0);
    } else {
      rig.pushDirection(input.state, pushDir);
    }
    ball.applyPush(pushDir);
    balloonPhysics?.update();
    moduls.update(SIM_DT);
    shatter.advance(SIM_DT);
    const preVel = ball.body.linvel();
    physics.step();
    simTicks++;

    // impact sounds: collision-start events, volume from the contact-normal
    // approach speed (original: min 5, max 30, per-surface 0.6s sleep)
    physics.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      shatter.handleCollision(h1, h2);
      const ballHandle = ball.collider.handle;
      if (h1 !== ballHandle && h2 !== ballHandle) return;
      const other = h1 === ballHandle ? h2 : h1;
      const surface = surfaceByCollider.get(other) ?? 'stone';
      const otherCollider = physics.world.getCollider(other);
      let impact = 0;
      if (otherCollider) {
        physics.world.contactPair(ball.collider, otherCollider, (manifold) => {
          const n = manifold.normal();
          impact = Math.max(impact, Math.abs(preVel.x * n.x + preVel.y * n.y + preVel.z * n.z));
        });
      }
      if (impact === 0) {
        // no manifold (grazing/CCD): fall back to the velocity change
        const v = ball.body.linvel();
        impact = Math.hypot(v.x - preVel.x, v.y - preVel.y, v.z - preVel.z);
      }
      audio.hit(ball.kind, surface, impact);
      // flap floors bang with their own sound on top of the ball's
      const floorHit = floorHitByCollider.get(other);
      if (floorHit && impact > 0.4 && flapCooldown <= 0) {
        flapCooldown = 0.25;
        audio.playFlat(floorHit, THREE.MathUtils.clamp(impact / 10, 0.08, 1));
      }
    });
    flapCooldown -= SIM_DT;

    // point countdown (held while the birth lightning plays)
    if (birthTimer <= 0) {
      pointTimer += SIM_DT;
      while (pointTimer >= POINT_TICK) {
        pointTimer -= POINT_TICK;
        if (s.points > 0) s.set({ points: s.points - 1 });
      }
    }

    const pos = ball.position;
    if (logic.isOutOfWorld(pos)) {
      die();
      return;
    }
    for (const ev of logic.update(pos, ball.kind)) {
      switch (ev.kind) {
        case 'checkpoint': {
          // Pursuing +20 balls are tied to the current section. Source2's
          // manual explicitly warns that they vanish at a checkpoint.
          pickups.checkpoint();
          s.set({ sector: ev.sector });
          moduls.setSector(ev.sector);
          flames.setSector(ev.sector);
          audio.play('Misc_Checkpoint.wav', pos, 1, scene);
          // entering the final sector: the balloon hums its ambient and the
          // background music stays out of the way (original: 70s mute)
          if (ev.sector === logic.sectorCount) {
            balloonPhysics?.wake();
            balloonAmbient?.setActive(true);
            audio.muteMusicFor(70);
          }
          break;
        }
        case 'finish': {
          s.set({ phase: 'finished', winScreen: false });
          const finalScore = level * 100 + gameStore.getState().points + gameStore.getState().lives * LIFE_BONUS;
          s.completeLevel(level, finalScore);
          balloonAmbient?.setActive(false);
          audio.stopMusic();
          balloonPhysics?.launch();
          // Gameplay_Events turns navigation off and reparents Cam_Pos to null:
          // its world slot freezes while InGameCam keeps looking at Cam_Target.
          rig.setNavigationActive(false);
          rig.detachSlot();
          rig.setClippingPlanes(3, 2500);
          finishSkyFade = 0;
          // the final level ends with the UFO pickup, others with the balloon
          if (level === 12) {
            ufoFinale?.start();
            ufoLoop?.setActive(true);
            audio.play('Music_LastFinal.wav', pos, 0.9, scene);
            after(5.5, () => audio.play('Music_Final.wav', ball.position, 0.9, scene));
          } else {
            audio.play('Music_Final.wav', pos, 0.9, scene);
          }
          // original: the win tally appears 6s after the pass
          if (!(import.meta.env.DEV && bootFlags.has('nowinscreen'))) {
            after(6, () => gameStore.getState().set({ winScreen: true }));
          }
          break;
        }
        case 'extraPoint': {
          // TT Extra emits Activated for the +100 center. Its six +20 Hit
          // outputs occur only when dispersed satellites catch the ball.
          s.set({ points: gameStore.getState().points + 100 });
          pickups.collect(ev.name);
          audio.play('Extra_Start.wav', pos, 1, scene);
          break;
        }
        case 'extraLife':
          pickups.collect(ev.name);
          audio.play('Extra_Life_Blob.wav', pos, 1, scene);
          after(0.317, () => {
            gameStore.getState().set({ lives: gameStore.getState().lives + 1 });
            audio.playFlat('Misc_extraball.wav', 1);
          });
          break;
      }
    }
    for (const _hit of pickups.updateSimulation(SIM_DT, pos)) {
      gameStore.getState().set({ points: gameStore.getState().points + 20 });
      audio.playFlat('Extra_Hit.wav', 0.8);
    }
  };

  const touchingSurfaces = new Set<Surface>();
  const contactSurfaces = (): Set<Surface> => {
    touchingSurfaces.clear();
    physics.world.contactPairsWith(ball.collider, (other) => {
      const s = surfaceByCollider.get(other.handle);
      if (s) touchingSurfaces.add(s);
    });
    return touchingSurfaces;
  };

  const present = (frameDt: number) => {
    ball.syncVisual();
    rig.update(frameDt, ball.position, input.state, gameStore.getState().settings.invertCameraRotation);
    if (finishSkyFade >= 0) {
      finishSkyFade = Math.min(3, finishSkyFade + frameDt);
      // Gameplay_Events/fadeout Sky linearly filters SkyLayer from 200/255
      // to black over exactly 3000 ms.
      setSkyLayerFilter(0.7843137979507446 * (1 - finishSkyFade / 3));
    }
    const v = ball.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    audio.updateRoll(ball.kind, contactSurfaces(), speed, frameDt);
    const flameScale = renderer.domElement.height / (2 * Math.tan((rig.camera.fov * Math.PI) / 360));
    flames.update(frameDt, flameScale);
    pickups.update(frameDt, flameScale);
    lightning.update(frameDt, ball.position, flameScale);
    trafoAnim.update(frameDt);
    shatter.update();
    ballShadow.update(ball.position, ball.visual, ball.collider, ball.body);
    if (skyLayer instanceof THREE.Mesh) {
      const dx = rig.camera.position.x - skyLayer.position.x;
      const dz = rig.camera.position.z - skyLayer.position.z;
      skyLayer.position.x += dx;
      skyLayer.position.z += dz;
      skyLayer.updateMatrix();
      const mats = Array.isArray(skyLayer.material) ? skyLayer.material : [skyLayer.material];
      for (const m of mats) {
        const map = (m as THREE.MeshPhongMaterial).map;
        if (map) {
          // keep the clouds world-anchored while the plane tracks the camera,
          // plus the original 0.008/s drift on both axes
          map.offset.x = (map.offset.x + (dx / skyLayerSize.x) * map.repeat.x + frameDt * 0.008) % 1;
          map.offset.y = (map.offset.y + (dz / skyLayerSize.y) * map.repeat.y + frameDt * 0.008) % 1;
        }
      }
    }
    sky.position.copy(rig.camera.position);
    renderer.render(scene, rig.camera);
    if (import.meta.env.DEV) {
      canvas.dataset.gameDebug = JSON.stringify({
        input: input.debugState(),
        tutorial: tutorial?.debugState() ?? null,
        balloon: balloonPhysics?.debugState() ?? null,
      });
    }
  };

  let accumulator = 0;
  let last = performance.now();
  const pushDir = new THREE.Vector3();

  const frame = () => {
    const now = performance.now();
    let frameDt = (now - last) / 1000;
    last = now;
    // avoid spiral of death, but allow full catch-up in throttled hidden tabs
    frameDt = Math.min(frameDt, document.hidden ? 1.5 : 0.25);
    if (paused) return;

    accumulator += frameDt;
    while (accumulator >= SIM_DT) {
      accumulator -= SIM_DT;
      simStep();
    }
    present(frameDt);
  };
  const loop = () => {
    if (disposed) return;
    requestAnimationFrame(loop);
    frame();
  };
  loop();
  // rAF stalls in hidden tabs; keep simulating/rendering so automation and
  // background tabs stay live (accumulator is wall-clock based, so safe).
  const hiddenDriver = setInterval(() => {
    if (!disposed && document.hidden) frame();
  }, 16);

  if (import.meta.env.DEV) {
    debug = {
      input,
      ballPosition: () => ball.body.translation(),
      ballVelocity: () => ball.body.linvel(),
      ticks: () => simTicks,
      setPaused: (p) => {
        paused = p;
        last = performance.now();
        accumulator = 0;
      },
      stepSeconds: (seconds) => {
        const steps = Math.round(seconds / SIM_DT);
        for (let i = 0; i < steps; i++) {
          simStep();
          rig.update(SIM_DT, ball.position, input.state, gameStore.getState().settings.invertCameraRotation);
        }
        present(SIM_DT);
      },
      teleport: (x, y, z) => ball.teleport(new THREE.Vector3(x, y, z)),
      setVelocity: (x, y, z) => ball.body.setLinvel({ x, y, z }, true),
      setLives: (n) => gameStore.getState().set({ lives: n }),
      state: () => {
        const s = gameStore.getState();
        return { phase: s.phase, lives: s.lives, points: s.points, sector: s.sector, ballKind: s.ballKind };
      },
      level: logic,
      scene: built,
      three: scene,
      camera: rig.camera,
      cameraTarget: () => rig.targetPosition,
      cameraYaw: () => rig.yaw,
      audio: () => audio.debugState(),
    };
  }

  return {
    debug,
    dispose() {
      disposed = true;
      clearInterval(hiddenDriver);
      unsubscribeSettings();
      audio.dispose();
      shatter.clear();
      ballShadow.dispose();
      balloonPhysics?.dispose();
      moduls.dispose();
      tutorial?.dispose();
      input.detach(window);
      ball.dispose();
      renderer.dispose();
    },
  };
}

/** Sound ID groups map entities to their sound surface: 01=stone 02=wood 03=metal. */
function soundSurfaceLookup(built: BuiltScene): Map<string, Surface> {
  const bySoundId: Record<string, Surface> = { '01': 'stone', '02': 'wood', '03': 'metal' };
  const map = new Map<string, Surface>();
  for (const [id, surface] of Object.entries(bySoundId)) {
    const group = built.groups.get(`Sound_RollID_${id}`);
    if (!group) continue;
    for (const idx of group.memberIndices) {
      const name = built.file.objects[idx]?.name;
      if (name) map.set(name, surface);
    }
  }
  return map;
}

function buildStaticColliders(
  physics: PhysicsWorld,
  built: BuiltScene,
): { surfaceByCollider: Map<number, Surface>; floorHitByCollider: Map<number, string> } {
  const surfaceOf = soundSurfaceLookup(built);
  const surfaceByCollider = new Map<number, Surface>();
  const floorHitByCollider = new Map<number, string>();
  for (const [groupName, def] of Object.entries(FLOOR_GROUPS)) {
    for (const e of groupEntities(built, groupName)) {
      if (e.object instanceof THREE.Mesh) {
        const collider = physics.addStaticMesh(e.object, def.friction, def.elasticity);
        if (collider) {
          surfaceByCollider.set(collider.handle, surfaceOf.get(e.rec.name) ?? def.surface);
          if (def.hitSound) floorHitByCollider.set(collider.handle, def.hitSound);
        }
      }
    }
  }
  return { surfaceByCollider, floorHitByCollider };
}

/** debug: a scene view with no groups, so no moduls get created */
function emptyScene(built: BuiltScene): BuiltScene {
  return { ...built, groups: new Map() };
}

function computeMinY(built: BuiltScene): number {
  let minY = Infinity;
  const box = new THREE.Box3();
  for (const groupName of Object.keys(FLOOR_GROUPS)) {
    for (const e of groupEntities(built, groupName)) {
      if (e.object instanceof THREE.Mesh) {
        box.setFromObject(e.object);
        if (box.min.y < minY) minY = box.min.y;
      }
    }
  }
  return Number.isFinite(minY) ? minY : -100;
}

export type { BallKind };
