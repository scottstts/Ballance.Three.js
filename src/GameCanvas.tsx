import { useEffect, useRef, useState } from 'react';
import { startGame, type GameHandle } from './game/game.ts';
import { LOADING_SOURCE } from './game/loading.ts';
import LoadingScreen from './ui/LoadingScreen.tsx';

export default function GameCanvas({ level, showLoading }: { level: number; showLoading: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingPart, setLoadingPart] = useState<number>(LOADING_SOURCE.initialPart);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let handle: GameHandle | null = null;
    let cancelled = false;
    setLoadingPart(LOADING_SOURCE.initialPart);
    startGame(canvas, level, (part) => {
      if (!cancelled) setLoadingPart(part);
    })
      .then((h) => {
        if (cancelled) {
          h.dispose();
          return;
        }
        handle = h;
        if (h.debug) window.__game = h.debug;
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      cancelled = true;
      if (handle?.debug && window.__game === handle.debug) window.__game = undefined;
      handle?.dispose();
    };
  }, [level]);

  return (
    <>
      <canvas ref={canvasRef} className="game-canvas" />
      {showLoading && !error && <LoadingScreen part={loadingPart} />}
      {error && <div className="load-error">{error}</div>}
    </>
  );
}
