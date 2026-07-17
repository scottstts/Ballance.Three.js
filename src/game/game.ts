/**
 * Game orchestrator: loads a level, builds render + physics worlds, and runs
 * the fixed-step (66 Hz) simulation loop with the chase camera.
 */
import * as THREE from 'three';
import { levelPath, loadNmo, skyLetter } from '../engine/assets.ts';
import { addLightRig } from '../engine/viewer.ts';
import { buildScene, groupEntities, type BuiltScene } from '../engine/sceneBuilder.ts';
import { buildSky } from '../engine/sky.ts';
import { Ball } from './ball.ts';
import { CamRig } from './camera.ts';
import { FLOOR_GROUPS, SIM_DT } from './constants.ts';
import { Input } from './input.ts';
import { initRapier, PhysicsWorld } from './physics.ts';

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

export async function startGame(canvas: HTMLCanvasElement, level: number): Promise<GameHandle> {
  bootStage('rapier');
  await initRapier();
  bootStage('rapier-done');

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
  const sky = await buildSky(skyLetter(level), fogColor);
  scene.add(sky);

  bootStage('colliders');
  const physics = new PhysicsWorld();
  buildStaticColliders(physics, built);

  // spawn at level start
  const startEnt = groupEntities(built, 'PS_Levelstart')[0];
  const spawnPos = startEnt ? startEnt.object.position.clone() : new THREE.Vector3();
  spawnPos.y += 4;

  bootStage('ball');
  const ball = await Ball.create(physics, scene, spawnPos);
  ball.teleport(spawnPos);
  bootStage('done');

  const rig = new CamRig(canvas.clientWidth / canvas.clientHeight);
  rig.resetTo(ball.position);

  const input = new Input();
  input.attach(window);

  // fall boundary: below the lowest collider by a margin
  const minY = computeMinY(built) - 30;

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

  let accumulator = 0;
  let last = performance.now();
  const pushDir = new THREE.Vector3();

  const simStep = () => {
    rig.pushDirection(input.state, pushDir);
    ball.applyPush(pushDir);
    physics.step();
    simTicks++;
    if (ball.position.y < minY) {
      ball.teleport(spawnPos);
      rig.resetTo(ball.position);
    }
  };

  const present = (frameDt: number) => {
    ball.syncVisual();
    rig.update(frameDt, ball.position, input.state);
    sky.position.copy(rig.camera.position);
    renderer.render(scene, rig.camera);
  };

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
      scene: built,
      three: scene,
    };
  }

  return {
    debug,
    dispose() {
      disposed = true;
      clearInterval(hiddenDriver);
      input.detach(window);
      window.removeEventListener('resize', onResize);
      ball.dispose();
      renderer.dispose();
    },
  };
}

function buildStaticColliders(physics: PhysicsWorld, built: BuiltScene): void {
  for (const [groupName, def] of Object.entries(FLOOR_GROUPS)) {
    for (const e of groupEntities(built, groupName)) {
      if (e.object instanceof THREE.Mesh) {
        physics.addStaticMesh(e.object, def.friction, def.elasticity);
      }
    }
  }
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
