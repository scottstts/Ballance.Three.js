import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { loadNmo } from '../engine/assets.ts';
import { buildScene } from '../engine/sceneBuilder.ts';
import { addLightRig } from '../engine/viewer.ts';

/** The original 3D menu scene (MenuLevel.nmo) slowly orbiting behind the menu. */
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
    scene.background = new THREE.Color(0x232c40);
    scene.fog = new THREE.Fog(0x232c40, 500, 1800);
    addLightRig(scene);
    const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.6, 4000);

    const center = new THREE.Vector3();
    let radius = 120;
    void (async () => {
      const built = await buildScene(await loadNmo('3D Entities/MenuLevel.nmo'));
      if (disposed) return;
      scene.add(built.root);
      const box = new THREE.Box3().setFromObject(built.root);
      box.getCenter(center);
      radius = Math.max(120, box.getSize(new THREE.Vector3()).length() * 0.55);
    })();

    let t = 0;
    let last = performance.now();
    let raf = 0;
    const frame = () => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      t += dt * 0.1;
      camera.position.set(center.x + Math.sin(t) * radius, center.y + radius * 0.22, center.z + Math.cos(t) * radius);
      camera.lookAt(center);
      renderer.render(scene, camera);
    };
    frame();
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
