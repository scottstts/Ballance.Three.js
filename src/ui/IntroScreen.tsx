/** Source-authored startup sequence from base.cmo and Intro.nmo. */
import { useEffect, useRef, useState } from 'react';
import { decodeImageFile } from '../engine/textures.ts';
import { useGameStore } from '../game/store.ts';
import { menuAudio } from './menuAudio.ts';

function toDataUrl(img: { rgba: Uint8ClampedArray; width: number; height: number }): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')?.putImageData(
    new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height),
    0,
    0,
  );
  return canvas.toDataURL('image/png');
}

interface IntroAssets {
  atariMovie: string | null;
  atariFallback: string | null;
  logo: string | null;
  clouds: string | null;
}

type IntroStage = 'delay' | 'atari' | 'atariOut' | 'clouds' | 'out';

async function loadMovie(): Promise<string | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}game-derived/atari.apng`);
    if (!response.ok) return null;
    return URL.createObjectURL(await response.blob());
  } catch {
    return null;
  }
}

function AtariCard({ assets }: { assets: IntroAssets }) {
  const source = assets.atariMovie ?? assets.atariFallback;
  return source ? <img className="intro-atari" src={source} alt="" draggable={false} /> : null;
}

function CloudSprite({ className, source }: { className: string; source: string }) {
  return (
    <div className={`intro-cloud ${className}`}>
      <img src={source} alt="" draggable={false} />
    </div>
  );
}

function CloudStage({ assets }: { assets: IntroAssets }) {
  return (
    <div className="intro-cloud-stage">
      {assets.logo && <img className="intro-gravity-logo" src={assets.logo} alt="" draggable={false} />}
      {assets.clouds && (
        <>
          <CloudSprite className="intro-cloud-one" source={assets.clouds} />
          <CloudSprite className="intro-cloud-two" source={assets.clouds} />
        </>
      )}
      <div className="intro-mask intro-mask-left" />
      <div className="intro-mask intro-mask-top" />
      <div className="intro-mask intro-mask-right" />
      <div className="intro-mask intro-mask-bottom" />
    </div>
  );
}

export default function IntroScreen() {
  const set = useGameStore((state) => state.set);
  const [assets, setAssets] = useState<IntroAssets | null>(null);
  const [stage, setStage] = useState<IntroStage>('delay');
  const done = useRef(false);

  useEffect(() => {
    let active = true;
    let movieUrl: string | null = null;
    void (async () => {
      const grab = (path: string) => decodeImageFile(path).then(toDataUrl).catch(() => null);
      const [atariMovie, atariFallback, logo, clouds] = await Promise.all([
        loadMovie(),
        grab('Textures/atari.bmp'),
        grab('Textures/Gravitylogo_intro.bmp'),
        grab('Textures/Wolken_intro.tga'),
      ]);
      movieUrl = atariMovie;
      if (active) setAssets({ atariMovie, atariFallback, logo, clouds });
      else if (movieUrl) URL.revokeObjectURL(movieUrl);
    })();
    return () => {
      active = false;
      if (movieUrl) URL.revokeObjectURL(movieUrl);
    };
  }, []);

  useEffect(() => {
    if (!assets) return;
    // Intro.nmo: delay 1000; AVI 5000; cover 300; clouds/black reveal
    // 3000. base.cmo starts Theme_4_1 at t=6000. Intro_End covers in 300.
    const timers = [
      setTimeout(() => {
        setStage('atari');
        if (assets.atariMovie) menuAudio.atariIntro();
      }, 1000),
      setTimeout(() => {
        setStage('atariOut');
        menuAudio.introMusic();
      }, 6000),
      setTimeout(() => setStage('clouds'), 6300),
      setTimeout(() => setStage('out'), 9300),
      setTimeout(() => {
        if (done.current) return;
        done.current = true;
        set({ phase: 'menu' });
      }, 9600),
    ];
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [assets, set]);

  return (
    <div className="intro-screen" data-intro-stage={stage}>
      {assets && (stage === 'atari' || stage === 'atariOut') && <AtariCard assets={assets} />}
      {assets && (stage === 'clouds' || stage === 'out') && <CloudStage assets={assets} />}
      {stage !== 'delay' && <div className={`intro-black intro-black-${stage}`} />}
    </div>
  );
}
