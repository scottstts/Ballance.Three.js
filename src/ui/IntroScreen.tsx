/**
 * The original startup sequence, approximated from Intro.nmo's assets:
 * black -> Atari publisher card -> Cyparade/Gravity logo drifting over the
 * intro clouds -> fade to the menu. Any key or click skips. (The original
 * Atari clip is an AVI the browser cannot decode; its title card stands in.)
 */
import { useEffect, useRef, useState } from 'react';
import { decodeImageFile } from '../engine/textures.ts';
import { useGameStore } from '../game/store.ts';
import { menuAudio } from './menuAudio.ts';

function toDataUrl(img: { rgba: Uint8ClampedArray; width: number; height: number }): string {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
  return c.toDataURL('image/png');
}

interface IntroAssets {
  atari: string | null;
  logo: string | null;
  clouds: string | null;
}

export default function IntroScreen() {
  const set = useGameStore((s) => s.set);
  const [assets, setAssets] = useState<IntroAssets | null>(null);
  const [stage, setStage] = useState<'black' | 'atari' | 'logo' | 'out'>('black');
  const done = useRef(false);

  useEffect(() => {
    let on = true;
    void (async () => {
      const grab = (path: string) =>
        decodeImageFile(path)
          .then(toDataUrl)
          .catch(() => null);
      const [atari, logo, clouds] = await Promise.all([
        grab('Textures/atari.bmp'),
        grab('Textures/Gravitylogo_intro.bmp'),
        grab('Textures/Wolken_intro.tga'),
      ]);
      if (on) setAssets({ atari, logo, clouds });
    })();
    return () => {
      on = false;
    };
  }, []);

  useEffect(() => {
    if (!assets) return;
    const finish = () => {
      if (done.current) return;
      done.current = true;
      setStage('out');
      setTimeout(() => useGameStore.getState().set({ phase: 'menu' }), 650);
    };
    const timers = [
      setTimeout(() => setStage('atari'), 400),
      setTimeout(() => setStage('logo'), 3100),
      setTimeout(finish, 8400),
    ];
    const skip = () => finish();
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
    menuAudio.introMusic();
    return () => {
      for (const t of timers) clearTimeout(t);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
  }, [assets, set]);

  return (
    <div className={`intro-screen${stage === 'out' ? ' intro-out' : ''}`}>
      {assets && stage === 'atari' && assets.atari && (
        <img className="intro-card" src={assets.atari} alt="" draggable={false} />
      )}
      {assets && stage === 'logo' && (
        <div className="intro-logo-stage">
          {assets.clouds && (
            <>
              <img className="intro-cloud intro-cloud-a" src={assets.clouds} alt="" draggable={false} />
              <img className="intro-cloud intro-cloud-b" src={assets.clouds} alt="" draggable={false} />
              <img className="intro-cloud intro-cloud-c" src={assets.clouds} alt="" draggable={false} />
            </>
          )}
          {assets.logo && <img className="intro-card intro-logo" src={assets.logo} alt="" draggable={false} />}
        </div>
      )}
    </div>
  );
}
