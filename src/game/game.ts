/**
 * Game orchestrator: loads a level, builds render + physics worlds, and runs
 * the fixed-step (66 Hz) simulation loop with sector/checkpoint/life rules.
 */
import * as THREE from 'three';
import { levelPath, loadNmo, skyLetter } from '../engine/assets.ts';
import { addLightRig } from '../engine/viewer.ts';
import { buildScene, groupEntities, type BuiltScene } from '../engine/sceneBuilder.ts';
import { buildSky } from '../engine/sky.ts';
import { AudioManager, type Surface } from './audio.ts';
import { Ball } from './ball.ts';
import { CamRig } from './camera.ts';
import { FLOOR_GROUPS, SIM_DT, type BallKind } from './constants.ts';
import { FlameSystem, LightningSphere, ShatterSystem } from './effects.ts';
import { Input } from './input.ts';
import { LevelLogic } from './level.ts';
import { ModulManager, sectorLookup } from './moduls/manager.ts';
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
}

declare global {
  interface Window {
    __game?: GameDebug;
  }
}

const bootStage = (s: string): void => {
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__bootStage = s;
};

const DEATH_DELAY = 2.2; // seconds between death and respawn (shatter plays)
const POINT_TICK = 0.5; // seconds per -1 point
const TRAFO_TIME = 2.3; // original transformation animation length

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
  scene.fog = new THREE.Fog(fogColor, 380, 1100);
  addLightRig(scene);

  bootStage('level-nmo');
  const file = await loadNmo(levelPath(level));
  bootStage('build-scene');
  const built: BuiltScene = await buildScene(file);
  scene.add(built.root);
  bootStage('sky');
  const builtSky = await buildSky(skyLetter(level), fogColor);
  const sky = builtSky.group;
  scene.add(sky);
  // fog matches the level sky's horizon; keep distances Ballance-like
  scene.fog = new THREE.Fog(builtSky.horizonColor, 380, 1100);
  renderer.setClearColor(builtSky.horizonColor);

  bootStage('colliders');
  const bootFlags = new URLSearchParams(window.location.search);
  const physics = new PhysicsWorld();
  const surfaceByCollider = bootFlags.has('nocolliders')
    ? new Map<number, Surface>()
    : buildStaticColliders(physics, built);
  const minY = computeMinY(built) - 30;

  const logic = new LevelLogic(built, minY);

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
  const shatter = new ShatterSystem(physics, scene);
  await shatter.init();
  const pickups = new PickupSystem();
  await pickups.init(built, scene);

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
            // original: lightning plays 2.3s before the ball morphs
            lightning.start();
            pendingTrafo = { ball: ev.ball, timer: TRAFO_TIME };
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
  bootStage('done');

  const rig = new CamRig(canvas.clientWidth / canvas.clientHeight);
  rig.resetTo(ball.position, spawn.yaw);

  const audio = new AudioManager(rig.camera);
  const applyVolumes = () => {
    const s = gameStore.getState().settings;
    audio.musicVolume = s.musicVolume;
    audio.sfxVolume = s.sfxVolume;
  };
  applyVolumes();
  const unsubscribeSettings = gameStore.subscribe((s, prev) => {
    if (s.settings !== prev.settings) applyVolumes();
  });
  audio.startMusic(level);

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
  let pendingTrafo: { ball: BallKind; timer: number } | null = null;
  let finishRise = 0;
  const balloonVisual = groupEntities(built, 'PE_Levelende')[0]?.object ?? null;

  // the original's slowly drifting cloud layer plane
  const skyLayer = built.entities.get('SkyLayer')?.object ?? null;
  if (skyLayer instanceof THREE.Mesh) {
    skyLayer.visible = true;
    const mats = Array.isArray(skyLayer.material) ? skyLayer.material : [skyLayer.material];
    for (const m of mats) {
      const map = (m as THREE.MeshPhongMaterial).map;
      if (map) {
        map.wrapS = THREE.RepeatWrapping;
        map.wrapT = THREE.RepeatWrapping;
      }
      m.transparent = true;
      m.opacity = Math.min((m as THREE.MeshPhongMaterial).opacity, 0.55);
      m.depthWrite = false;
    }
  }

  const respawn = () => {
    const s = gameStore.getState();
    shatter.clear();
    ball.visual.visible = true;
    const rp = logic.spawnFor(logic.currentSector);
    const pos = rp.position.clone();
    pos.y += 4;
    ball.setKind(logic.sectorBallKind);
    ball.teleport(pos);
    rig.resetTo(pos, rp.yaw);
    moduls.resetSector(logic.currentSector);
    s.set({ phase: 'playing', ballKind: logic.sectorBallKind });
  };

  const die = () => {
    const s = gameStore.getState();
    // original: the ball shatters into its piece meshes
    shatter.burst(ball.kind, ball.position);
    ball.visual.visible = false;
    lightning.stop();
    pendingTrafo = null;
    audio.play(`Pieces_${ball.kind[0].toUpperCase()}${ball.kind.slice(1)}.wav`, ball.position, 1, scene);
    const lives = s.lives - 1;
    if (lives <= 0) {
      s.set({ lives: 0, phase: 'gameover' });
    } else {
      s.set({ lives, phase: 'dead' });
      deathTimer = DEATH_DELAY;
    }
  };

  const simStep = () => {
    const s = gameStore.getState();
    if (s.phase === 'dead') {
      physics.step(); // pieces keep flying
      shatter.update();
      deathTimer -= SIM_DT;
      if (deathTimer <= 0) respawn();
      return;
    }
    if (s.phase === 'finished' && balloonVisual && finishRise < 12) {
      // balloon fly-off: the end balloon rises away with a light sway
      finishRise += SIM_DT;
      balloonVisual.position.y += SIM_DT * (2.5 + finishRise * 0.6);
      balloonVisual.position.x += Math.sin(finishRise * 1.3) * 0.02;
      balloonVisual.rotation.y += SIM_DT * 0.15;
      balloonVisual.updateMatrix();
      return;
    }
    if (s.phase !== 'playing') return; // paused/gameover freeze the sim

    // pending ball transformation (original: swap after the 2.3s lightning)
    if (pendingTrafo) {
      pendingTrafo.timer -= SIM_DT;
      if (pendingTrafo.timer <= 0) {
        ball.setKind(pendingTrafo.ball);
        s.set({ ballKind: pendingTrafo.ball });
        lightning.stop();
        pendingTrafo = null;
      }
    }

    rig.pushDirection(input.state, pushDir);
    ball.applyPush(pushDir);
    moduls.update(SIM_DT);
    physics.step();
    simTicks++;

    // impact sounds from contact force events
    physics.eventQueue.drainContactForceEvents((ev) => {
      const h1 = ev.collider1();
      const h2 = ev.collider2();
      const ballHandle = ball.collider.handle;
      if (h1 !== ballHandle && h2 !== ballHandle) return;
      const other = h1 === ballHandle ? h2 : h1;
      const surface = surfaceByCollider.get(other) ?? 'stone';
      const strength = ev.totalForceMagnitude() / (ball.def.mass * 900);
      if (strength > 0.1) {
        audio.hit(ball.kind, surface, ball.position, strength, scene);
      }
    });

    // point countdown
    pointTimer += SIM_DT;
    while (pointTimer >= POINT_TICK) {
      pointTimer -= POINT_TICK;
      if (s.points > 0) s.set({ points: s.points - 1 });
    }

    const pos = ball.position;
    if (logic.isOutOfWorld(pos)) {
      die();
      return;
    }
    for (const ev of logic.update(pos, ball.kind)) {
      switch (ev.kind) {
        case 'checkpoint':
          s.set({ sector: ev.sector });
          moduls.setSector(ev.sector);
          flames.extinguish(`PC_TwoFlames_${String(ev.sector - 1).padStart(2, '0')}`);
          audio.play('Music_EndCheckpoint.wav', pos, 0.8, scene);
          break;
        case 'finish':
          s.set({ phase: 'finished' });
          s.completeLevel(level, gameStore.getState().points);
          audio.stopMusic();
          audio.play('Music_Final.wav', pos, 0.9, scene);
          break;
        case 'extraPoint':
          s.set({ points: gameStore.getState().points + ev.amount });
          pickups.collect(ev.name);
          audio.play('Extra_Start.wav', pos, 1, scene);
          break;
        case 'extraLife':
          s.set({ lives: gameStore.getState().lives + 1 });
          pickups.collect(ev.name);
          audio.play('Extra_Life_Blob.wav', pos, 1, scene);
          break;
      }
    }
  };

  const contactSurface = (): Surface | null => {
    let found: Surface | null = null;
    physics.world.contactPairsWith(ball.collider, (other) => {
      if (found === null) found = surfaceByCollider.get(other.handle) ?? 'stone';
    });
    return found;
  };

  const present = (frameDt: number) => {
    ball.syncVisual();
    rig.update(frameDt, ball.position, input.state);
    const v = ball.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    audio.updateRoll(ball.kind, contactSurface(), speed, ball.position, scene, frameDt);
    flames.update(frameDt);
    pickups.update(frameDt);
    lightning.update(frameDt, ball.position);
    shatter.update();
    if (skyLayer instanceof THREE.Mesh) {
      const mats = Array.isArray(skyLayer.material) ? skyLayer.material : [skyLayer.material];
      for (const m of mats) {
        const map = (m as THREE.MeshPhongMaterial).map;
        if (map) map.offset.x = (map.offset.x + frameDt * 0.0035) % 1;
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

function buildStaticColliders(physics: PhysicsWorld, built: BuiltScene): Map<number, Surface> {
  const surfaceOf = soundSurfaceLookup(built);
  const byCollider = new Map<number, Surface>();
  for (const [groupName, def] of Object.entries(FLOOR_GROUPS)) {
    for (const e of groupEntities(built, groupName)) {
      if (e.object instanceof THREE.Mesh) {
        const collider = physics.addStaticMesh(e.object, def.friction, def.elasticity);
        if (collider) {
          byCollider.set(collider.handle, surfaceOf.get(e.rec.name) ?? def.surface);
        }
      }
    }
  }
  return byCollider;
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
