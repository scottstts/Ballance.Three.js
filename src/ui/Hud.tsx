/**
 * Original in-game HUD, composed from Camera.nmo's complete score/glow layers,
 * its bitmap-font digit rectangle, and the life balls between their wire hook
 * and end curl.
 */
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../game/store.ts';
import {
  HUD_SOURCE_ASPECT,
  hudRectStyle,
  LIFE_HUD_SOURCE,
  lifeBallRects,
  lifeHookRect,
  POINTS_HUD_SOURCE,
  pointShadowOffset,
} from './hudLayout.ts';
import { useOgui } from './useOgui.ts';

function sourceHudSize(): readonly [width: number, height: number] {
  if (typeof window === 'undefined') return [0, 0];
  const width = Math.min(window.innerWidth, window.innerHeight * HUD_SOURCE_ASPECT);
  return [width, width / HUD_SOURCE_ASPECT];
}

function useSourceHudSize(): readonly [width: number, height: number] {
  const [size, setSize] = useState(sourceHudSize);
  useEffect(() => {
    const update = () => setSize(sourceHudSize());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return size;
}

export default function Hud() {
  const { lives, points } = useGameStore();
  const ogui = useOgui();
  const previousPoints = useRef(points);
  const [pointGlow, setPointGlow] = useState(0);
  const [hudWidth, hudHeight] = useSourceHudSize();

  useEffect(() => {
    if (points > previousPoints.current) setPointGlow((value) => value + 1);
    previousPoints.current = points;
  }, [points]);

  if (!ogui) return null;
  const digits = ogui.text(String(points), POINTS_HUD_SOURCE.font.cellPixels, '#ffffff', '#000000', {
    scaleX: POINTS_HUD_SOURCE.font.scale[0],
    scaleY: POINTS_HUD_SOURCE.font.scale[1],
    spaceX: POINTS_HUD_SOURCE.font.space[0],
    screenWidth: POINTS_HUD_SOURCE.font.screenProportional ? hudWidth : undefined,
    screenHeight: POINTS_HUD_SOURCE.font.screenProportional ? hudHeight : undefined,
  });
  const [shadowX, shadowY] = pointShadowOffset();
  const shadowAlpha = POINTS_HUD_SOURCE.font.shadowColor[3] * 100;
  return (
    <div className="hud">
      <div className="hud-score">
        <img
          className="hud-score-background"
          style={hudRectStyle(POINTS_HUD_SOURCE.background)}
          src={ogui.piece.scoreBackground}
          alt=""
          draggable={false}
        />
        {pointGlow > 0 && (
          <img
            key={pointGlow}
            className="hud-score-glow"
            style={{
              ...hudRectStyle(POINTS_HUD_SOURCE.glow),
              animationDuration: `${POINTS_HUD_SOURCE.glowDurationMs}ms`,
            }}
            src={ogui.piece.scoreGlow}
            alt=""
            draggable={false}
          />
        )}
        <div className="hud-score-digits" style={hudRectStyle(POINTS_HUD_SOURCE.digits)}>
          <img
            style={{
              filter: `drop-shadow(${shadowX}px ${shadowY}px rgb(0 0 0 / ${shadowAlpha}%))`,
            }}
            src={digits.url}
            alt=""
            draggable={false}
          />
        </div>
      </div>
      <div className="hud-lifes">
        {lifeBallRects(lives).map((rect, index) => (
          <img
            key={index}
            className="hud-lifeball"
            style={hudRectStyle(rect)}
            src={ogui.piece.lifeBall}
            alt=""
            draggable={false}
          />
        ))}
        <img
          className="hud-lives-hook"
          style={hudRectStyle(lifeHookRect(lives))}
          src={ogui.piece.livesHook}
          alt=""
          draggable={false}
        />
        <img
          className="hud-lives-curl"
          style={hudRectStyle(LIFE_HUD_SOURCE.curl)}
          src={ogui.piece.livesCurl}
          alt=""
          draggable={false}
        />
      </div>
    </div>
  );
}
