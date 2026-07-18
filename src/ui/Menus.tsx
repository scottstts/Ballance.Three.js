/**
 * Menus rebuilt from the original UI assets: Button01 capsule sprites,
 * Font_1 bitmap text, Cursor.tga, over the translucent center band —
 * matching the original menu screens (no extra text, no titles).
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useGameStore } from '../game/store.ts';
import { menuAudio } from './menuAudio.ts';
import { useOgui } from './useOgui.ts';
import type { Ogui } from './ogui.ts';

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

export function HighscoreScreen() {
  const { progress, set } = useGameStore();
  const ogui = useOgui();
  if (!ogui) return null;
  return (
    <MenuBand ogui={ogui}>
      <div className="og-title">
        <img src={ogui.text('Highscore', 30).url} alt="" draggable={false} />
      </div>
      <div className="og-score-list">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => {
          const score = progress.highscores[n];
          const row = ogui.text(`Level ${n}`, 20);
          const val = ogui.text(score !== undefined ? String(score) : '-', 20);
          return (
            <div key={n} className="og-score-row" style={{ backgroundImage: `url(${ogui.piece.slider})` }}>
              <img src={row.url} alt="" draggable={false} />
              <img src={val.url} alt="" draggable={false} />
            </div>
          );
        })}
      </div>
      <div className="og-bottom">
        <MenuButton ogui={ogui} label="Back" onClick={() => set({ phase: 'menu' })} />
      </div>
    </MenuBand>
  );
}

export function OptionsScreen() {
  const { settings, updateSettings, set } = useGameStore();
  const ogui = useOgui();
  if (!ogui) return null;
  const volRow = (label: string, value: number, apply: (v: number) => void) => (
    <div className="og-option-row">
      <img src={ogui.text(label, 22).url} alt="" draggable={false} />
      <div className="og-option-controls">
        <div
          className="og-round"
          style={{ backgroundImage: `url(${ogui.piece.roundA})` }}
          onClick={() => {
            menuAudio.click();
            apply(Math.max(0, Math.round((value - 0.1) * 10) / 10));
          }}
        />
        <div className="og-vol-bar" style={{ backgroundImage: `url(${ogui.piece.slider})` }}>
          <div className="og-vol-fill" style={{ width: `${value * 100}%` }} />
        </div>
        <div
          className="og-round"
          style={{ backgroundImage: `url(${ogui.piece.roundB})` }}
          onClick={() => {
            menuAudio.click();
            apply(Math.min(1, Math.round((value + 0.1) * 10) / 10));
          }}
        />
      </div>
    </div>
  );
  return (
    <MenuBand ogui={ogui}>
      <div className="og-title">
        <img src={ogui.text('Options', 30).url} alt="" draggable={false} />
      </div>
      <div className="og-stack og-options">
        {volRow('Music', settings.musicVolume, (v) => updateSettings({ musicVolume: v }))}
        {volRow('Sound', settings.sfxVolume, (v) => updateSettings({ sfxVolume: v }))}
      </div>
      <div className="og-bottom">
        <MenuButton ogui={ogui} label="Back" onClick={() => set({ phase: 'menu' })} />
      </div>
    </MenuBand>
  );
}

export function CreditsScreen() {
  const set = useGameStore((s) => s.set);
  const ogui = useOgui();
  if (!ogui) return null;
  const lines = [
    'Ballance',
    'An Atari and Cyparade game',
    '',
    'Web port',
    'Rebuilt from the original data files',
  ];
  return (
    <MenuBand ogui={ogui}>
      <div className="og-credits">
        {lines.map((l, i) =>
          l === '' ? (
            <div key={i} style={{ height: '3vh' }} />
          ) : (
            <img key={i} src={ogui.text(l, i === 0 ? 30 : 20).url} alt="" draggable={false} />
          ),
        )}
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
        <MenuButton ogui={ogui} label="Restart" onClick={() => set({ phase: 'loading', level })} />
        <MenuButton ogui={ogui} label="Exit" onClick={() => set({ phase: 'menu' })} />
      </div>
    </MenuBand>
  );
}

export function FinishedOverlay() {
  const { level, points, lives, progress, set } = useGameStore();
  const ogui = useOgui();
  // original win screen: Level Bonus / Time Points / Extra Lives tally up
  // one after another into the total, with the counter ticking
  const levelBonus = level * 100;
  const lifeBonus = lives * 200;
  const total = levelBonus + points + lifeBonus;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    menuAudio.highscoreMusic();
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
  }, [total]);
  if (!ogui) return null;
  const nextUnlocked = level < 12 && progress.unlocked > level;
  const row = (label: string, value: number) => (
    <div className="og-tally-row" style={{ backgroundImage: `url(${ogui.piece.slider})` }}>
      <img src={ogui.text(label, 20).url} alt="" draggable={false} />
      <img src={ogui.text(String(value), 20).url} alt="" draggable={false} />
    </div>
  );
  return (
    <MenuBand ogui={ogui} style={{ background: 'rgba(0, 0, 0, 0.25)' }}>
      <div className="og-title">
        <img src={ogui.text('Congratulations', 28).url} alt="" draggable={false} />
      </div>
      <div className="og-score-list">
        {row('Level Bonus', levelBonus)}
        {row('Time Points', points)}
        {row('Extra Lives', lifeBonus)}
        <div className="og-tally-row og-tally-total" style={{ backgroundImage: `url(${ogui.piece.slider})` }}>
          <img src={ogui.text('Total', 22).url} alt="" draggable={false} />
          <img src={ogui.text(String(shown), 22).url} alt="" draggable={false} />
        </div>
      </div>
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
          label="Replay"
          onClick={() => {
            menuAudio.levelLoad();
            set({ phase: 'loading', level });
          }}
        />
        <MenuButton ogui={ogui} label="Exit" onClick={() => set({ phase: 'menu' })} />
      </div>
    </MenuBand>
  );
}

export function GameOverOverlay() {
  const { level, set } = useGameStore();
  const ogui = useOgui();
  if (!ogui) return null;
  return (
    <MenuBand ogui={ogui} style={{ background: 'rgba(0, 0, 0, 0.35)' }}>
      <div className="og-title">
        <img src={ogui.text('Game Over', 30).url} alt="" draggable={false} />
      </div>
      <div className="og-stack">
        <MenuButton ogui={ogui} label="Try Again" onClick={() => set({ phase: 'loading', level })} />
        <MenuButton ogui={ogui} label="Exit" onClick={() => set({ phase: 'menu' })} />
      </div>
    </MenuBand>
  );
}
