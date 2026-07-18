/**
 * Original in-game HUD, composed from the original sprite pieces:
 * bottom-left the score plate with its under-swoosh wire and bitmap-font
 * digits, bottom-right the life balls between the wire hook and end curl.
 */
import { useGameStore } from '../game/store.ts';
import { hudRectStyle, LIFE_HUD_SOURCE, lifeBallRects, lifeHookRect } from './hudLayout.ts';
import { useOgui } from './useOgui.ts';

export default function Hud() {
  const { lives, points } = useGameStore();
  const ogui = useOgui();
  if (!ogui) return null;
  const digits = ogui.text(String(points), 44);
  return (
    <div className="hud">
      <div className="hud-score">
        <img className="hud-score-swoosh" src={ogui.piece.scoreSwoosh} alt="" draggable={false} />
        <div className="hud-score-plate" style={{ backgroundImage: `url(${ogui.piece.scorePlate})` }}>
          <img className="hud-score-digits" src={digits.url} alt="" draggable={false} />
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
