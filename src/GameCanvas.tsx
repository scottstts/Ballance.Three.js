import { useEffect, useRef, useState } from 'react';
import { startViewer, type ViewerHandle } from './engine/viewer.ts';

export default function GameCanvas({ level }: { level: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let handle: ViewerHandle | null = null;
    let cancelled = false;
    startViewer(canvas, level)
      .then((h) => {
        if (cancelled) h.dispose();
        else handle = h;
      })
      .catch((e: unknown) => setError(String(e)));
    return () => {
      cancelled = true;
      handle?.dispose();
    };
  }, [level]);

  return (
    <>
      <canvas ref={canvasRef} style={{ width: '100vw', height: '100vh', display: 'block' }} />
      {error && <div className="load-error">{error}</div>}
    </>
  );
}
