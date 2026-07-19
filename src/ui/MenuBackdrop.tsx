import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { loadNmo } from '../engine/assets.ts';
import { buildScene } from '../engine/sceneBuilder.ts';
import { buildSky, MENU_SKY_SOURCE } from '../engine/sky.ts';
import { addLightRig } from '../engine/viewer.ts';
import { Flame } from '../game/effects.ts';
import { decodeImageFile } from '../engine/textures.ts';
import {
  decodeMenuCameraSource,
  menuCameraProgress,
  sampleMenuCameraPath,
  type MenuCameraSource,
} from './menuCamera.ts';
import {
  applyMenuStoneAnimation,
  decodeMenuStoneAnimationSource,
  type MenuStoneAnimationSource,
} from './menuStoneAnimation.ts';

/**
 * The original 3D menu scene (MenuLevel.nmo) behind the menu, framed by the
 * original Cam_MenuLevel camera, under the level-1 sky, with the four
 * decorative flames burning like in the original menu.
 */
export default function MenuBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const fogColor = new THREE.Color(0xbed7e3);
    addLightRig(scene);
    const camera = new THREE.PerspectiveCamera(54.4322227, 4 / 3, 20, 550);
    camera.position.set(0, 40, 95);
    const camTarget = new THREE.Vector3();
    let cameraSource: MenuCameraSource | null = null;
    let cameraElapsed = 0;
    let stoneAnimation: MenuStoneAnimationSource | null = null;
    let stoneBall: THREE.Object3D | null = null;
    let stoneElapsed = 0;

    const flames: Flame[] = [];
    void (async () => {
      const file = await loadNmo('3D Entities/MenuLevel.nmo');
      const decodedCamera = decodeMenuCameraSource(file);
      const built = await buildScene(file);
      if (disposed) return;
      scene.add(built.root);
      built.root.updateMatrixWorld(true);
      cameraSource = decodedCamera;
      camera.fov = decodedCamera.fieldOfViewDegrees;
      camera.aspect = decodedCamera.aspectRatio;
      camera.near = decodedCamera.nearPlane;
      camera.far = decodedCamera.farPlane;
      camera.updateProjectionMatrix();
      camTarget.copy(decodedCamera.target);
      sampleMenuCameraPath(decodedCamera, 0, camera.position);
      camera.lookAt(camTarget);
      stoneAnimation = decodeMenuStoneAnimationSource(file);
      stoneBall = built.entities.get('I_Ball_Stone')?.object ?? null;
      if (stoneBall) applyMenuStoneAnimation(stoneAnimation, 0, stoneBall);
      // the original day menu uses the C sky with warm linear fog 100-800
      const sky = await buildSky('C', fogColor, MENU_SKY_SOURCE);
      if (disposed) return;
      scene.add(sky.group);
      scene.fog = new THREE.Fog(0xd3c894, 100, 800);
      renderer.setClearColor(sky.horizonColor);

      // the four decorative flames on the menu checkpoint platform
      const tex = await decodeImageFile('Textures/Particle_Flames.bmp').then((img) => {
        const d = img.rgba;
        for (let i = 0; i < d.length; i += 4) d[i + 3] = Math.max(d[i], d[i + 1], d[i + 2]);
        const t = new THREE.DataTexture(new Uint8Array(img.rgba.buffer), img.width, img.height, THREE.RGBAFormat);
        t.flipY = false;
        t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
        return t;
      }).catch(() => null);
      if (disposed) return;
      for (const name of ['FourFlames_Flame_A', 'FourFlames_Flame_B', 'FourFlames_Flame_C', 'FourFlames_Flame_D']) {
        const e = built.entities.get(name);
        if (!e) continue;
        const flame = new Flame(tex, false);
        flame.origin.setFromMatrixPosition(e.object.matrixWorld);
        scene.add(flame.points);
        flames.push(flame);
      }
    })();

    let last = performance.now();
    let raf = 0;
    const frame = () => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      // MenuLevel_Init loops a 44-second Bezier Progression into Position On
      // Curve, targeting Cam_MenuLevel without follow or bank.
      if (cameraSource) {
        cameraElapsed += dt;
        sampleMenuCameraPath(cameraSource, menuCameraProgress(cameraSource, cameraElapsed), camera.position);
      }
      if (stoneAnimation && stoneBall) {
        stoneElapsed += dt;
        applyMenuStoneAnimation(stoneAnimation, stoneElapsed, stoneBall);
      }
      camera.lookAt(camTarget);
      for (const obj of scene.children) {
        if (obj.name === 'sky') obj.position.copy(camera.position);
      }
      const uScale = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
      for (const f of flames) f.update(dt, uScale);
      renderer.render(scene, camera);
    };
    frame();
    const onResize = () => {
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      camera.aspect = cameraSource?.aspectRatio ?? 4 / 3;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="menu-backdrop" />;
}
