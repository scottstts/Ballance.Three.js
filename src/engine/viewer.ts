/**
 * Dev viewer harness: renders a built level scene with the classic Ballance
 * lighting rig and free-fly inspection controls. Gameplay camera replaces
 * this later; the renderer/lighting setup stays.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadNmo, levelPath, skyLetter } from './assets.ts';
import { buildScene, groupEntities, type BuiltScene } from './sceneBuilder.ts';
import { buildSky } from './sky.ts';

export interface ViewerHandle {
  dispose(): void;
  scene: BuiltScene;
}

/**
 * Original global lighting, D3D fixed-function energy levels: materials
 * already add their own emissive lift, so total light stays near 1.
 */
export function addLightRig(scene: THREE.Scene): void {
  const ambient = new THREE.AmbientLight(0xfff4e8, 0.32);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff2e2, 0.95);
  sun.position.set(-0.45, 1, -0.3).multiplyScalar(100);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdde4f0, 0.18);
  fill.position.set(0.5, 0.4, 0.6).multiplyScalar(100);
  scene.add(fill);
}

export async function startViewer(canvas: HTMLCanvasElement, level: number): Promise<ViewerHandle> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const fogColor = new THREE.Color(0xbed7e3);
  scene.fog = new THREE.Fog(fogColor, 380, 1100);
  addLightRig(scene);

  const file = await loadNmo(levelPath(level));
  const built = await buildScene(file);
  scene.add(built.root);

  const sky = (await buildSky(skyLetter(level), fogColor)).group;
  scene.add(sky);

  const camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.6, 4000);
  // look at the level start if present
  const start = groupEntities(built, 'PS_Levelstart')[0];
  const target = start ? start.object.position.clone() : new THREE.Vector3();
  camera.position.copy(target).add(new THREE.Vector3(30, 25, 30));

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.update();

  let disposed = false;
  const onResize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  const renderLoop = () => {
    if (disposed) return;
    requestAnimationFrame(renderLoop);
    controls.update();
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
  };
  renderLoop();

  return {
    scene: built,
    dispose() {
      disposed = true;
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
    },
  };
}
