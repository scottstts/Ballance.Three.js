import { useEffect, useRef, useState } from 'react';
import { startGame, type GameHandle } from './game/game.ts';

export default function GameCanvas({ level }: { level: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let handle: GameHandle | null = null;
    let cancelled = false;
    startGame(canvas, level)
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
      {error && <div className="load-error">{error}</div>}
    </>
  );
}
