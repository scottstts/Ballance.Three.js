/**
 * Presentation scheduler matching Menu.nmo's `Time Settings` block.
 *
 * The shipped graph maps "Synch to Screen?" to Virtools frame-rate mode 2
 * (Synchronize to Screen). When disabled it selects mode 3 (Limit) with a
 * 60 FPS limit. Browser `requestAnimationFrame` is the direct synchronized
 * equivalent; a deadline-corrected timer is the closest available unsynced
 * limiter.
 */
export const SOURCE_FRAME_LIMIT_HZ = 60;
export const SOURCE_FRAME_LIMIT_MS = 1000 / SOURCE_FRAME_LIMIT_HZ;

export function startSourceFrameLoop(
  callback: () => void,
  synchronized: () => boolean,
  immediate = true,
): () => void {
  let active = true;
  let animationFrame = 0;
  let timer = 0;
  let nextLimitedFrame = 0;

  const schedule = () => {
    if (!active) return;
    if (synchronized()) {
      nextLimitedFrame = 0;
      animationFrame = window.requestAnimationFrame(tick);
      return;
    }

    const now = performance.now();
    if (nextLimitedFrame < now - SOURCE_FRAME_LIMIT_MS) nextLimitedFrame = now;
    nextLimitedFrame += SOURCE_FRAME_LIMIT_MS;
    timer = window.setTimeout(tick, Math.max(0, nextLimitedFrame - now));
  };

  const tick = () => {
    if (!active) return;
    callback();
    schedule();
  };

  if (immediate) tick();
  else schedule();

  return () => {
    active = false;
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    if (timer) window.clearTimeout(timer);
  };
}
