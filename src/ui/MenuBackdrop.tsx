import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { loadNmo } from '../engine/assets.ts';
import { buildScene } from '../engine/sceneBuilder.ts';
import { buildSky } from '../engine/sky.ts';
import { addLightRig } from '../engine/viewer.ts';
import { Flame } from '../game/effects.ts';
import { decodeImageFile } from '../engine/textures.ts';

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
    // original menu camera: orbits the dome at -10 deg/s from the authored
    // start (0, 40, -95), always looking at the dome
    const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.6, 4000);
    camera.position.set(0, 40, 95);
    const camTarget = new THREE.Vector3(0, 14, 0);
    let orbitRadius = 95;
    let orbitHeight = 40;

    const flames: Flame[] = [];
    void (async () => {
      const built = await buildScene(await loadNmo('3D Entities/MenuLevel.nmo'));
      if (disposed) return;
      scene.add(built.root);
      built.root.updateMatrixWorld(true);
      // the original day menu uses the C sky with warm linear fog 100-800
      const sky = await buildSky('C', fogColor);
      if (disposed) return;
      scene.add(sky.group);
      scene.fog = new THREE.Fog(0xd3c894, 100, 800);
      renderer.setClearColor(sky.horizonColor);

      // the orbit centers on the dome, like the original camera controller
      const dome = built.entities.get('I_Dome_MF') ?? built.entities.get('Cam_MenuLevel_Target');
      if (dome) {
        camTarget.setFromMatrixPosition(dome.object.matrixWorld);
        const cam = built.entities.get('Cam_MenuLevel');
        if (cam) {
          const camPos = new THREE.Vector3().setFromMatrixPosition(cam.object.matrixWorld);
          orbitRadius = Math.hypot(camPos.x - camTarget.x, camPos.z - camTarget.z);
          orbitHeight = camPos.y;
        }
      }

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
    let t = Math.PI; // authored start: behind the dome at (0, 40, -95) in LH
    const frame = () => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      // original: RotateAround(dome, up, -10 deg/s)
      t -= dt * (10 * Math.PI) / 180;
      camera.position.set(
        camTarget.x + Math.sin(t) * orbitRadius,
        orbitHeight,
        camTarget.z + Math.cos(t) * orbitRadius,
      );
      camera.lookAt(camTarget);
      for (const obj of scene.children) {
        if (obj.name === 'sky') obj.position.copy(camera.position);
      }
      const uScale = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
      for (const f of flames) f.update(dt, uScale);
      renderer.render(scene, camera);
    };
    frame();
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__menuCam = (r: number, h: number, ty: number, tt?: number) => {
        orbitRadius = r;
        orbitHeight = h;
        camTarget.y = ty;
        if (tt !== undefined) t = tt;
      };
    }
    const onResize = () => {
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
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
