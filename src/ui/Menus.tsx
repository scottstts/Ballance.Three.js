/**
 * Menus rebuilt from the original UI assets and strings: Button01 capsule
 * sprites, Font_1 bitmap text, Cursor.tga, the translucent center band, and
 * the original screen set (Start/Highscore/Options+subscreens/Credits, the
 * pause and win/fail flows with their exact English strings).
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { defaultTable, useGameStore } from '../game/store.ts';
import { menuAudio } from './menuAudio.ts';
import { useOgui } from './useOgui.ts';
import type { Ogui } from './ogui.ts';

/** clean list-row bar: the slider sprite's two halves, without its handle */
function barStyle(ogui: Ogui): CSSProperties {
  return {
    backgroundImage: `url(${ogui.piece.sliderR}), url(${ogui.piece.sliderL})`,
    backgroundPosition: 'right, left',
    backgroundSize: '50.5% 100%, 50.5% 100%',
    backgroundRepeat: 'no-repeat',
  };
}

/** capsule button built from the original atlas piece + bitmap-font label */
export function MenuButton({
  ogui,
  label,
  onClick,
  disabled,
  medium,
}: {
  ogui: Ogui;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  medium?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const piece = medium ? 'buttonMedium' : 'buttonLarge';
  const img = ogui.piece[hover && !disabled ? `${piece}Hover` : piece];
  const text = ogui.text(label, medium ? 22 : 26);
  return (
    <div
      className={`og-button${medium ? ' og-button-medium' : ''}${disabled ? ' og-disabled' : ''}`}
      style={{ backgroundImage: `url(${img})` }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => {
        if (disabled) return;
        menuAudio.click();
        onClick();
      }}
    >
      <img className="og-button-label" src={text.url} style={{ height: medium ? '45%' : '42%' }} alt="" draggable={false} />
    </div>
  );
}

/** the original center band over the 3D menu scene */
export function MenuBand({ ogui, children, style }: { ogui: Ogui; children: ReactNode; style?: CSSProperties }) {
  useEffect(() => {
    menuAudio.startAtmo();
    return () => {
      const p = useGameStore.getState().phase;
      if (p === 'loading' || p === 'playing') menuAudio.stopAtmo();
    };
  }, []);
  return (
    <div className="og-screen" style={{ cursor: `url(${ogui.cursor}) 1 1, auto`, ...style }}>
      <div className="og-band">{children}</div>
    </div>
  );
}

export function MainMenu() {
  const set = useGameStore((s) => s.set);
  const ogui = useOgui();
  if (!ogui) return null;
  return (
    <MenuBand ogui={ogui}>
      <div className="og-stack">
        <MenuButton ogui={ogui} label="Start" onClick={() => set({ phase: 'levelselect' })} />
        <MenuButton
          ogui={ogui}
          label="Highscore"
          onClick={() => {
            menuAudio.dong();
            set({ phase: 'highscore' });
          }}
        />
        <MenuButton ogui={ogui} label="Options" onClick={() => set({ phase: 'options' })} />
        <MenuButton ogui={ogui} label="Credits" onClick={() => set({ phase: 'credits' })} />
        <MenuButton ogui={ogui} label="Exit" onClick={() => window.close()} />
      </div>
    </MenuBand>
  );
}

export function LevelSelect() {
  const { progress, set } = useGameStore();
  const ogui = useOgui();
  if (!ogui) return null;
  return (
    <MenuBand ogui={ogui}>
      <div className="og-level-grid">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
          <MenuButton
            key={n}
            ogui={ogui}
            medium
            label={`Level ${n}`}
            disabled={n > progress.unlocked}
            onClick={() => {
              menuAudio.levelLoad();
              set({ phase: 'loading', level: n });
            }}
          />
        ))}
      </div>
      <div className="og-bottom">
        <MenuButton ogui={ogui} label="Back" onClick={() => set({ phase: 'menu' })} />
      </div>
    </MenuBand>
  );
}

/** original: paged per-level top-10 tables (rank, name, points) */
export function HighscoreScreen() {
  const { progress, set } = useGameStore();
  const [level, setLevel] = useState(1);
  const ogui = useOgui();
  if (!ogui) return null;
  const table = progress.tables[level] ?? defaultTable(level);
  return (
    <MenuBand ogui={ogui}>
      <div className="og-title">
        <img src={ogui.text(`Highscore Level ${level}`, 28).url} alt="" draggable={false} />
      </div>
      <div className="og-score-list">
        {table.map((e, i) => (
          <div key={i} className="og-score-row" style={barStyle(ogui)}>
            <img src={ogui.text(String(i + 1), 18).url} alt="" draggable={false} />
            <img className="og-score-name" src={ogui.text(e.name, 18).url} alt="" draggable={false} />
            <img src={ogui.text(String(e.score), 18).url} alt="" draggable={false} />
          </div>
        ))}
      </div>
      <div className="og-bottom og-bottom-row">
        <MenuButton
          ogui={ogui}
          medium
          label="Next"
          onClick={() => setLevel(level >= Math.max(1, progress.unlocked) ? 1 : level + 1)}
        />
        <MenuButton ogui={ogui} medium label="Back" onClick={() => set({ phase: 'menu' })} />
      </div>
    </MenuBand>
  );
}

/** original Options: Graphics / Controls / Sound subscreens */
export function OptionsScreen() {
  const { settings, updateSettings, set } = useGameStore();
  const [page, setPage] = useState<'root' | 'graphics' | 'controls' | 'sound'>('root');
  const ogui = useOgui();
  if (!ogui) return null;

  const yesNoRow = (label: string, value: boolean, apply: (v: boolean) => void) => (
    <div className="og-option-row">
      <img src={ogui.text(label, 22).url} alt="" draggable={false} />
      <div className="og-option-controls">
        <div
          className="og-yesno"
          style={{ backgroundImage: `url(${ogui.piece[value ? 'optionRowHover' : 'optionRow']})` }}
          onClick={() => {
            menuAudio.click();
            apply(!value);
          }}
        >
          <img src={ogui.text(value ? 'Yes' : 'No', 18).url} alt="" draggable={false} />
        </div>
      </div>
    </div>
  );

  const keyRow = (action: string, key: string) => (
    <div className="og-key-row" style={barStyle(ogui)}>
      <img src={ogui.text(action, 18).url} alt="" draggable={false} />
      <img src={ogui.text(key, 18).url} alt="" draggable={false} />
    </div>
  );

  return (
    <MenuBand ogui={ogui}>
      <div className="og-title">
        <img
          src={
            ogui.text(page === 'root' ? 'Options' : page === 'graphics' ? 'Graphics' : page === 'controls' ? 'Controls' : 'Sound', 30)
              .url
          }
          alt=""
          draggable={false}
        />
      </div>
      {page === 'root' && (
        <div className="og-stack og-stack-tight">
          <MenuButton ogui={ogui} label="Graphics" onClick={() => setPage('graphics')} />
          <MenuButton ogui={ogui} label="Controls" onClick={() => setPage('controls')} />
          <MenuButton ogui={ogui} label="Sound" onClick={() => setPage('sound')} />
        </div>
      )}
      {page === 'graphics' && (
        <div className="og-stack og-options">{yesNoRow('Clouds?', settings.clouds, (v) => updateSettings({ clouds: v }))}</div>
      )}
      {page === 'controls' && (
        <div className="og-score-list">
          {keyRow('Forward', 'Up')}
          {keyRow('Backward', 'Down')}
          {keyRow('Left', 'Left')}
          {keyRow('Right', 'Right')}
          {keyRow('Overview', 'Space')}
          {keyRow('Rotation', 'Shift')}
        </div>
      )}
      {page === 'sound' && (
        <div className="og-stack og-options">
          <div className="og-option-row">
            <img src={ogui.text('Music Volume', 22).url} alt="" draggable={false} />
            <div className="og-option-controls">
              <div
                className="og-round"
                style={{ backgroundImage: `url(${ogui.piece.roundA})` }}
                onClick={() => {
                  menuAudio.click();
                  updateSettings({ musicVolume: Math.max(0, Math.round((settings.musicVolume - 0.1) * 10) / 10) });
                }}
              />
              <div className="og-vol-bar" style={{ backgroundImage: `url(${ogui.piece.slider})` }}>
                <div className="og-vol-fill" style={{ width: `${settings.musicVolume * 100}%` }} />
              </div>
              <div
                className="og-round"
                style={{ backgroundImage: `url(${ogui.piece.roundB})` }}
                onClick={() => {
                  menuAudio.click();
                  updateSettings({ musicVolume: Math.min(1, Math.round((settings.musicVolume + 0.1) * 10) / 10) });
                }}
              />
            </div>
          </div>
        </div>
      )}
      <div className="og-bottom">
        <MenuButton ogui={ogui} label="Back" onClick={() => (page === 'root' ? set({ phase: 'menu' }) : setPage('root'))} />
      </div>
    </MenuBand>
  );
}

/** the original credit roll (from the menu data), scrolling upward */
const CREDIT_LINES = [
  ['Ballance', 30],
  ['A Cyparade production', 20],
  ['All rights reserved. Berlin 2004', 16],
  ['for LISA MARIE', 16],
  ['', 0],
  ['Sound Design and Music', 16],
  ['Klaus Riech', 20],
  ['', 0],
  ['Lead Scripting', 16],
  ['Mirco Nierenz', 20],
  ['', 0],
  ['Technical Direction', 16],
  ['Stephan Bludau', 20],
  ['', 0],
  ['Lead Level Design', 16],
  ['Britta Fahrenbruch', 20],
  ['', 0],
  ['Sky Design', 16],
  ['Michael Herm', 20],
  ['', 0],
  ['Interface Design', 16],
  ['Constantin Rahn', 20],
  ['', 0],
  ['Producing', 16],
  ['Ulrich Weinberg', 20],
  ['', 0],
  ['Lead Testing', 16],
  ['Ruth Meiners', 20],
  ['', 0],
  ['special thanks to Panda!', 16],
] as const;

export function CreditsScreen() {
  const set = useGameStore((s) => s.set);
  const ogui = useOgui();
  if (!ogui) return null;
  return (
    <MenuBand ogui={ogui}>
      <div className="og-credits-viewport">
        <div className="og-credits-roll">
          {CREDIT_LINES.map(([line, px], i) =>
            line === '' ? <div key={i} style={{ height: '3.2vh' }} /> : <img key={i} src={ogui.text(line, px).url} alt="" draggable={false} />,
          )}
        </div>
      </div>
      <div className="og-bottom">
        <MenuButton ogui={ogui} label="Back" onClick={() => set({ phase: 'menu' })} />
      </div>
    </MenuBand>
  );
}

export function PauseOverlay() {
  const set = useGameStore((s) => s.set);
  const level = useGameStore((s) => s.level);
  const ogui = useOgui();
  if (!ogui) return null;
  return (
    <MenuBand ogui={ogui} style={{ background: 'rgba(0, 0, 0, 0.25)' }}>
      <div className="og-stack">
        <MenuButton ogui={ogui} label="Continue" onClick={() => set({ phase: 'playing' })} />
        <MenuButton ogui={ogui} label="Restart Level" onClick={() => set({ phase: 'loading', level })} />
        <MenuButton ogui={ogui} label="Exit Level" onClick={() => set({ phase: 'menu' })} />
      </div>
    </MenuBand>
  );
}

export function FinishedOverlay() {
  const { level, points, lives, progress, submitScore, set } = useGameStore();
  const ogui = useOgui();
  // original win screen: Level Bonus / Time Points / Extra Lives tally into
  // the total (Score:), then the highscore name entry if the table is beaten
  const levelBonus = level * 100;
  const lifeBonus = lives * 200;
  const total = levelBonus + points + lifeBonus;
  const [shown, setShown] = useState(0);
  const [entryDone, setEntryDone] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const table = progress.tables[level] ?? defaultTable(level);
  const qualifies = total > table[table.length - 1].score;
  const tallyDone = shown >= total;
  useEffect(() => {
    let current = 0;
    const step = Math.max(5, Math.round(total / 60));
    const timer = setInterval(() => {
      current = Math.min(total, current + step);
      setShown(current);
      if (current % 4 === 0) menuAudio.counter();
      if (current >= total) {
        clearInterval(timer);
        menuAudio.dong();
      }
    }, 30);
    return () => clearInterval(timer);
  }, [total, level]);
  useEffect(() => {
    if (tallyDone && qualifies) menuAudio.highscoreMusic();
  }, [tallyDone, qualifies]);
  useEffect(() => {
    if (tallyDone && qualifies && !entryDone) inputRef.current?.focus();
  }, [tallyDone, qualifies, entryDone]);
  if (!ogui) return null;
  const nextUnlocked = level < 12 && progress.unlocked > level;
  const row = (label: string, value: number) => (
    <div className="og-tally-row" style={barStyle(ogui)}>
      <img src={ogui.text(label, 20).url} alt="" draggable={false} />
      <img src={ogui.text(String(value), 20).url} alt="" draggable={false} />
    </div>
  );
  return (
    <MenuBand ogui={ogui} style={{ background: 'rgba(0, 0, 0, 0.25)' }}>
      <div className="og-score-list og-score-list-win">
        {row('Level Bonus:', levelBonus)}
        {row('Time Points:', points)}
        {row('Extra Lives:', lifeBonus)}
        <div className="og-tally-row og-tally-total" style={barStyle(ogui)}>
          <img src={ogui.text('Score:', 22).url} alt="" draggable={false} />
          <img src={ogui.text(String(shown), 22).url} alt="" draggable={false} />
        </div>
      </div>
      {tallyDone && qualifies && !entryDone && (
        <div className="og-entry">
          <img src={ogui.text('New highscore entry!', 22).url} alt="" draggable={false} />
          <input
            ref={inputRef}
            className="og-entry-input"
            value={name}
            maxLength={16}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                submitScore(level, name, total);
                setEntryDone(true);
                menuAudio.dong();
              }
            }}
          />
        </div>
      )}
      {(tallyDone && (!qualifies || entryDone)) && (
        <div className="og-stack og-stack-tight">
          {nextUnlocked && (
            <MenuButton
              ogui={ogui}
              label="Next Level"
              onClick={() => {
                menuAudio.levelLoad();
                set({ phase: 'loading', level: level + 1 });
              }}
            />
          )}
          <MenuButton
            ogui={ogui}
            label="Restart Level"
            onClick={() => {
              menuAudio.levelLoad();
              set({ phase: 'loading', level });
            }}
          />
          <MenuButton ogui={ogui} label="Home" onClick={() => set({ phase: 'menu' })} />
        </div>
      )}
    </MenuBand>
  );
}

export function GameOverOverlay() {
  const { level, set } = useGameStore();
  const ogui = useOgui();
  if (!ogui) return null;
  return (
    <MenuBand ogui={ogui} style={{ background: 'rgba(0, 0, 0, 0.35)' }}>
      <div className="og-stack" style={{ marginTop: '28vh' }}>
        <MenuButton
          ogui={ogui}
          label="Restart Level"
          onClick={() => {
            menuAudio.levelLoad();
            set({ phase: 'loading', level });
          }}
        />
        <MenuButton ogui={ogui} label="Home" onClick={() => set({ phase: 'menu' })} />
      </div>
    </MenuBand>
  );
}
