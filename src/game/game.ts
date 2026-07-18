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
import { CamRig } from './camera.ts';
import { FLOOR_GROUPS, SIM_DT, type BallKind } from './constants.ts';
import RAPIER from '@dimforge/rapier3d-compat';
import { BallShadow, FlameSystem, LightningSphere, ShatterSystem, TrafoAnim } from './effects.ts';
import { Input } from './input.ts';
import { LevelLogic } from './level.ts';
import { ModulManager, sectorLookup } from './moduls/manager.ts';
import { instantiatePrefab, loadPrefab } from './moduls/prefabs.ts';
import { modulFactories } from './moduls/registry.ts';
import { initRapier, PhysicsWorld } from './physics.ts';
import { PickupSystem } from './pickups.ts';
import { gameStore } from './store.ts';

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

const DEATH_DELAY = 2.0; // fall (~1s) + white fade before respawn
const POINT_TICK = 0.5; // seconds per -1 point
const TRAFO_TIME = 2.3; // original transformation animation length
const BIRTH_TIME = 1.0; // spawn lightning; control + countdown start after
const LIFE_BONUS = 200; // original: each remaining life is worth 200 points

export async function startGame(canvas: HTMLCanvasElement, level: number): Promise<GameHandle> {
  bootStage('rapier');
  await initRapier();

  // preserveDrawingBuffer keeps the last frame capturable (automation screenshots)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
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
  let balloonInstance: THREE.Object3D | null = null;
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
      if (group === 'PE_Levelende') balloonInstance = inst.root;
    }
  }
  for (const e of groupEntities(built, 'PR_Resetpoints')) e.object.visible = false;

  bootStage('ball');
  const spawn = logic.spawnFor(1);
  const spawnPos = spawn.position.clone();
  spawnPos.y += 4;
  const ball = await Ball.create(physics, scene, spawnPos);
  ball.teleport(spawnPos);

  bootStage('effects');
  const flames = new FlameSystem();
  await flames.init(built, scene);
  const lightning = new LightningSphere();
  await lightning.init();
  scene.add(lightning.mesh);
  const trafoAnim = new TrafoAnim();
  await trafoAnim.init();
  scene.add(trafoAnim.group);
  const shatter = new ShatterSystem(physics, scene);
  await shatter.init();
  const pickups = new PickupSystem();
  await pickups.init(built, scene);
  const ballShadow = new BallShadow();
  await ballShadow.init();
  scene.add(ballShadow.mesh);

  const rig = new CamRig(canvas.clientWidth / canvas.clientHeight);
  rig.resetTo(ball.position, spawn.yaw);

  const audio = new AudioManager(rig.camera);
  let skyLayerRef: THREE.Object3D | null = null;
  const applyVolumes = () => {
    const s = gameStore.getState().settings;
    audio.musicVolume = s.musicVolume;
    audio.sfxVolume = s.sfxVolume;
    if (skyLayerRef) skyLayerRef.visible = s.clouds;
  };
  applyVolumes();
  const unsubscribeSettings = gameStore.subscribe((s, prev) => {
    if (s.settings !== prev.settings) applyVolumes();
  });
  audio.startMusic(level);

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
          case 'trafo':
            // original: the ball snaps above the transformer, control locks,
            // the ring cage spins 2.3s, then the old ball bursts
            trafoAnim.start();
            pendingTrafo = {
              ball: ev.ball,
              timer: TRAFO_TIME,
              hold: ev.position.clone().add(new THREE.Vector3(0, 2, 0)),
            };
            break;
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

  const input = new Input();
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
  });

  let disposed = false;
  const onResize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    rig.camera.aspect = w / h;
    rig.camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  let simTicks = 0;
  let paused = false;
  let debug: GameDebug | null = null;
  let deathTimer = 0;
  let pointTimer = 0;
  let birthTimer = 0;
  let flapCooldown = 0;
  let pendingTrafo: { ball: BallKind; timer: number; hold: THREE.Vector3 } | null = null;
  let finishRise = 0;
  const balloonVisual = balloonInstance ?? groupEntities(built, 'PE_Levelende')[0]?.object ?? null;
  // simple sim-time one-shot timer queue
  const timers: { t: number; fn: () => void }[] = [];
  const after = (seconds: number, fn: () => void) => timers.push({ t: seconds, fn });
  // final-sector ambient from the balloon (Music_EndCheckpoint loop)
  const balloonAmbient = balloonVisual ? audio.createLoop('Music_EndCheckpoint.wav', balloonVisual, 0.9) : null;

  const startBirth = () => {
    birthTimer = BIRTH_TIME;
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
    ball.visual.visible = true;
    // original: the ball materializes exactly at the reset point
    const rp = logic.spawnFor(logic.currentSector);
    ball.setKind(logic.sectorBallKind);
    ball.teleport(rp.position);
    rig.resetTo(rp.position, rp.yaw);
    moduls.resetSector(logic.currentSector);
    s.set({ phase: 'playing', ballKind: logic.sectorBallKind, whiteFade: false });
    startBirth();
  };

  const die = () => {
    const s = gameStore.getState();
    // original fall: Misc_Fall plays, the ball keeps falling into the void,
    // the screen fades white, then the ball is reborn at the reset point
    trafoAnim.stop();
    lightning.stop();
    pendingTrafo = null;
    audio.play('Misc_Fall.wav', ball.position, 1, scene);
    const lives = s.lives - 1;
    if (lives <= 0) {
      s.set({ lives: 0 });
      // original: camera stops following after 1.5s and just watches the fall
      after(1.5, () => {
        rig.mode = 'lookOnly';
      });
      after(2.5, () => {
        audio.stopMusic();
        gameStore.getState().set({ phase: 'gameover' });
      });
      s.set({ phase: 'dead' });
      deathTimer = Infinity; // gameover timer takes over
    } else {
      s.set({ lives, phase: 'dead' });
      deathTimer = DEATH_DELAY;
      // original: camera freezes after ~1s while the sector resets
      after(1.0, () => {
        rig.mode = 'frozen';
        gameStore.getState().set({ whiteFade: true });
      });
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
      physics.step(); // the ball keeps falling into the void
      deathTimer -= SIM_DT;
      if (deathTimer <= 0) respawn();
      return;
    }
    if (s.phase === 'finished' && balloonVisual && finishRise < 45) {
      // balloon fly-off: buoyant rise that gently decays (original forces
      // taper 0.15 -> 0.10 -> 0 over ~43s), carrying the ball along
      finishRise += SIM_DT;
      const rate = Math.max(0.35, 3.1 * Math.exp(-finishRise / 16));
      const dy = SIM_DT * rate;
      balloonVisual.position.y += dy;
      balloonVisual.position.x += Math.sin(finishRise * 1.3) * 0.015;
      balloonVisual.rotation.y += SIM_DT * 0.1;
      balloonVisual.updateMatrix();
      const bt = ball.body.translation();
      ball.body.setTranslation({ x: bt.x, y: bt.y + dy, z: bt.z }, false);
      return;
    }
    if (s.phase !== 'playing') return; // paused/gameover freeze the sim

    // pending ball transformation: the ball is held centered above the
    // transformer while the ring cage spins, then the old ball bursts
    if (pendingTrafo) {
      pendingTrafo.timer -= SIM_DT;
      ball.body.setTranslation({ x: pendingTrafo.hold.x, y: pendingTrafo.hold.y, z: pendingTrafo.hold.z }, true);
      ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      if (pendingTrafo.timer <= 0) {
        const oldKind = ball.kind;
        shatter.burst(oldKind, ball.position);
        audio.play(`Pieces_${oldKind[0].toUpperCase()}${oldKind.slice(1)}.wav`, ball.position, 1, scene);
        ball.setKind(pendingTrafo.ball);
        s.set({ ballKind: pendingTrafo.ball });
        trafoAnim.stop();
        pendingTrafo = null;
      }
    }

    // birth lightning / trafo hold: no player control meanwhile
    if (birthTimer > 0 || pendingTrafo) {
      if (birthTimer > 0) {
        birthTimer -= SIM_DT;
        if (birthTimer <= 0) lightning.stop();
      }
      pushDir.set(0, 0, 0);
    } else {
      rig.pushDirection(input.state, pushDir);
    }
    ball.applyPush(pushDir);
    moduls.update(SIM_DT);
    const preVel = ball.body.linvel();
    physics.step();
    simTicks++;

    // impact sounds: collision-start events, volume from the contact-normal
    // approach speed (original: min 5, max 30, per-surface 0.6s sleep)
    physics.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
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
          s.set({ sector: ev.sector });
          moduls.setSector(ev.sector);
          flames.setSector(ev.sector);
          audio.play('Misc_Checkpoint.wav', pos, 1, scene);
          // entering the final sector: the balloon hums its ambient and the
          // background music stays out of the way (original: 70s mute)
          if (ev.sector === logic.sectorCount) {
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
          // camera: follow briefly, then hold position and watch the ascent
          after(0.6, () => {
            rig.mode = 'lookOnly';
          });
          // the final level ends with the UFO pickup, others with the balloon
          if (level === 12) {
            audio.play('Misc_UFO.wav', pos, 1, scene);
            audio.play('Misc_UFO_anim.wav', pos, 0.9, scene);
            audio.play('Music_LastFinal.wav', pos, 0.9, scene);
            after(5.5, () => audio.play('Music_Final.wav', ball.position, 0.9, scene));
          } else {
            audio.play('Music_Final.wav', pos, 0.9, scene);
          }
          // original: the win tally appears 6s after the pass
          after(6, () => gameStore.getState().set({ winScreen: true }));
          break;
        }
        case 'extraPoint': {
          // original: +100 at the center, then the six orbiters strike the
          // counter for +20 each as they fly in
          s.set({ points: gameStore.getState().points + 100 });
          pickups.collect(ev.name);
          audio.play('Extra_Start.wav', pos, 1, scene);
          for (let i = 0; i < 6; i++) {
            after(0.45 + i * 0.12, () => {
              gameStore.getState().set({ points: gameStore.getState().points + 20 });
              audio.playFlat('Extra_Hit.wav', 0.8);
            });
          }
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
    rig.update(frameDt, ball.position, input.state);
    const v = ball.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    audio.updateRoll(ball.kind, contactSurfaces(), speed, frameDt);
    const flameScale = renderer.domElement.height / (2 * Math.tan((rig.camera.fov * Math.PI) / 360));
    flames.update(frameDt, flameScale);
    pickups.update(frameDt, rig.camera.position);
    lightning.update(frameDt, ball.position);
    trafoAnim.update(frameDt, ball.position);
    shatter.update();
    {
      const bp = ball.position;
      const ray = new RAPIER.Ray({ x: bp.x, y: bp.y, z: bp.z }, { x: 0, y: -1, z: 0 });
      const hit = physics.world.castRay(ray, 60, true, undefined, undefined, ball.collider, ball.body);
      ballShadow.update(hit ? bp.y - hit.timeOfImpact : null, bp);
    }
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
          rig.update(SIM_DT, ball.position, input.state);
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
      moduls.dispose();
      input.detach(window);
      window.removeEventListener('resize', onResize);
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
