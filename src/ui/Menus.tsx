/**
 * Menus rebuilt from the original UI assets and strings: Button01 capsule
 * sprites, Font_1 bitmap text, Cursor.tga, the translucent center band, and
 * the original screen set (Start/Highscore/Options+subscreens/Credits, the
 * pause and win/fail flows with their exact English strings).
 */
import { useEffect, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { CONTROL_ROWS, SCREEN_MODES, displayKey, type ControlSetting, type Settings } from '../game/settings.ts';
import { scoreCountStep } from '../game/score.ts';
import { defaultTable, useGameStore, type GamePhase } from '../game/store.ts';
import { menuAudio } from './menuAudio.ts';
import {
  CONFIRM_RECTS,
  CREDITS_FONT_SOURCE,
  CREDITS_TIMING,
  CREDITS_RECTS,
  HIGHSCORE_ENTRY_RECTS,
  HIGHSCORE_RECTS,
  LARGE_MENU_BUTTON_RECTS,
  LEVEL_BUTTON_RECTS,
  MENU_BACK_RECT,
  OPTIONS_RECTS,
  SCORE_RECTS,
  creditTextWait,
  menuBandRectStyle,
  type CreditBlock,
  type MenuRect,
} from './menuLayout.ts';
import { useOgui } from './useOgui.ts';
import type { Ogui } from './ogui.ts';

type ButtonPiece = 'buttonLarge' | 'buttonMedium' | 'levelButton' | 'confirmSmall';

/** capsule button built from the original atlas piece + bitmap-font label */
export function MenuButton({
  ogui,
  label,
  onClick,
  disabled,
  medium,
  piece: requestedPiece,
  style,
}: {
  ogui: Ogui;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  medium?: boolean;
  piece?: ButtonPiece;
  style?: CSSProperties;
}) {
  const [hover, setHover] = useState(false);
  const piece = requestedPiece ?? (medium ? 'buttonMedium' : 'buttonLarge');
  const compact = medium || piece !== 'buttonLarge';
  const img = ogui.piece[disabled ? `${piece}Disabled` : hover ? `${piece}Hover` : piece] ?? ogui.piece[piece];
  const text = ogui.text(label, compact ? 22 : 26);
  const activate = () => {
    if (disabled) return;
    menuAudio.click();
    onClick();
  };
  return (
    <div
      role="button"
      aria-label={label}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      className={`og-button${compact ? ' og-button-medium' : ''}${disabled ? ' og-disabled' : ''}`}
      style={{ backgroundImage: `url(${img})`, ...style }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') activate();
      }}
    >
      <img className="og-button-label" src={text.url} style={{ height: compact ? '45%' : '42%' }} alt="" draggable={false} />
    </div>
  );
}

/** the original center band over the 3D menu scene */
export function MenuBand({
  ogui,
  children,
  style,
  transparent = false,
}: {
  ogui: Ogui;
  children: ReactNode;
  style?: CSSProperties;
  transparent?: boolean;
}) {
  useEffect(() => {
    menuAudio.startAtmo();
    return () => {
      const p = useGameStore.getState().phase;
      if (p === 'loading' || p === 'playing') menuAudio.stopAtmo();
    };
  }, []);
  return (
    <div className="og-screen" style={{ cursor: `url(${ogui.cursor}) 1 1, auto`, ...style }}>
      <div className="og-source-stage">
        <div className={`og-band${transparent ? ' og-band-transparent' : ''}`}>{children}</div>
      </div>
    </div>
  );
}

function SourceButton({
  rect,
  ...props
}: Omit<ComponentProps<typeof MenuButton>, 'style'> & { rect: MenuRect }) {
  return <MenuButton {...props} style={menuBandRectStyle(rect)} />;
}

function SpriteButton({
  ogui,
  piece,
  rect,
  label,
  onClick,
  disabled,
}: {
  ogui: Ogui;
  piece: 'highscorePrevious' | 'highscoreNext' | 'arrowLeft' | 'arrowRight';
  rect: MenuRect;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const activate = () => {
    if (disabled) return;
    menuAudio.click();
    onClick();
  };
  return (
    <div
      role="button"
      aria-label={label}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      className={`og-sprite-button${disabled ? ' og-disabled' : ''}`}
      style={{
        ...menuBandRectStyle(rect),
        backgroundImage: `url(${
          ogui.piece[disabled ? `${piece}Disabled` : hover ? `${piece}Hover` : piece] ?? ogui.piece[piece]
        })`,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') activate();
      }}
    />
  );
}

export function MainMenu() {
  const set = useGameStore((s) => s.set);
  const [confirmExit, setConfirmExit] = useState(false);
  const ogui = useOgui();
  if (!ogui) return null;
  if (confirmExit) {
    return (
      <ConfirmScreen
        ogui={ogui}
        question="Do you want to quit the game?"
        onConfirm={() => window.close()}
        onCancel={() => setConfirmExit(false)}
      />
    );
  }
  return (
    <MenuBand ogui={ogui}>
      {[
        <SourceButton key="start" rect={LARGE_MENU_BUTTON_RECTS[0]} ogui={ogui} label="Start" onClick={() => set({ phase: 'levelselect' })} />,
        <SourceButton
          key="highscore"
          rect={LARGE_MENU_BUTTON_RECTS[1]}
          ogui={ogui}
          label="Highscore"
          onClick={() => set({ phase: 'highscore' })}
        />,
        <SourceButton key="options" rect={LARGE_MENU_BUTTON_RECTS[2]} ogui={ogui} label="Options" onClick={() => set({ phase: 'options' })} />,
        <SourceButton key="credits" rect={LARGE_MENU_BUTTON_RECTS[3]} ogui={ogui} label="Credits" onClick={() => set({ phase: 'credits' })} />,
        <SourceButton key="exit" rect={LARGE_MENU_BUTTON_RECTS[4]} ogui={ogui} label="Exit" onClick={() => setConfirmExit(true)} />,
      ]}
    </MenuBand>
  );
}

export function LevelSelect() {
  const { progress, loadLevel, set } = useGameStore();
  const ogui = useOgui();
  if (!ogui) return null;
  return (
    <MenuBand ogui={ogui}>
      {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
          <SourceButton
            key={n}
            rect={LEVEL_BUTTON_RECTS[n - 1]}
            ogui={ogui}
            piece="levelButton"
            label={`Level ${n}`}
            disabled={n > progress.unlocked}
            onClick={() => {
              menuAudio.levelLoad();
              loadLevel(n);
            }}
          />
        ))}
      <SourceButton rect={MENU_BACK_RECT} ogui={ogui} piece="buttonMedium" label="Back" onClick={() => set({ phase: 'menu' })} />
    </MenuBand>
  );
}

/** original: paged per-level top-10 tables (rank, name, points) */
export function HighscoreScreen({
  backPhase = 'menu',
  initialLevel = 1,
  exitLabel = 'Back',
  onExit,
}: {
  backPhase?: GamePhase;
  initialLevel?: number;
  exitLabel?: 'Back' | 'Next';
  onExit?: () => void;
}) {
  const { progress, set } = useGameStore();
  const maxLevel = Math.max(1, progress.unlocked);
  const [level, setLevel] = useState(Math.min(maxLevel, Math.max(1, initialLevel)));
  const ogui = useOgui();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'ArrowLeft') setLevel((current) => Math.max(1, current - 1));
      if (event.code === 'ArrowRight') setLevel((current) => Math.min(maxLevel, current + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [maxLevel]);
  if (!ogui) return null;
  const table = progress.tables[level] ?? defaultTable(level);
  return (
    <MenuBand ogui={ogui}>
      <div className="og-source-title" style={menuBandRectStyle(HIGHSCORE_RECTS.title)}>
        <img src={ogui.text(`Highscore Level ${level}`, 28).url} alt="" draggable={false} />
      </div>
      <SpriteButton ogui={ogui} piece="highscorePrevious" rect={HIGHSCORE_RECTS.previous} label="Previous level" disabled={level <= 1} onClick={() => setLevel(level - 1)} />
      <SpriteButton ogui={ogui} piece="highscoreNext" rect={HIGHSCORE_RECTS.next} label="Next level" disabled={level >= maxLevel} onClick={() => setLevel(level + 1)} />
      {table.map((e, i) => (
          <div
            key={i}
            className="og-source-score-row"
            style={{
              ...menuBandRectStyle(HIGHSCORE_RECTS.rows[i]),
              backgroundImage: `url(${ogui.piece.highscoreRow})`,
            }}
          >
            <img src={ogui.text(String(i + 1), 18).url} alt="" draggable={false} />
            <img className="og-score-name" src={ogui.text(e.name, 18).url} alt="" draggable={false} />
            <img src={ogui.text(String(e.score), 18).url} alt="" draggable={false} />
          </div>
        ))}
      <SourceButton
        rect={HIGHSCORE_RECTS.exit}
        ogui={ogui}
        piece="buttonMedium"
        label={exitLabel}
        onClick={() => (onExit ? onExit() : set({ phase: backPhase }))}
      />
    </MenuBand>
  );
}

/** original Options: Graphics / Controls / Sound subscreens */
export function OptionsScreen({ backPhase = 'menu', onExit }: { backPhase?: GamePhase; onExit?: () => void }) {
  const { settings, updateSettings, set } = useGameStore();
  const [page, setPage] = useState<'root' | 'graphics' | 'controls' | 'sound'>('root');
  const [listening, setListening] = useState<ControlSetting | null>(null);
  const ogui = useOgui();

  useEffect(() => {
    if (!listening) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.code !== 'Escape') {
        updateSettings({ [listening]: event.code } as Partial<Settings>);
      }
      setListening(null);
    };
    window.addEventListener('keydown', capture, true);
    return () => window.removeEventListener('keydown', capture, true);
  }, [listening, updateSettings]);

  useEffect(() => {
    menuAudio.setMusicVolume(settings.musicVolume);
  }, [settings.musicVolume]);

  if (!ogui) return null;
  const title = page === 'root' ? 'Options' : page === 'graphics' ? 'Graphics' : page === 'controls' ? 'Controls' : 'Sound';
  const field = (rect: MenuRect, label: string, active = false) => (
    <div
      className="og-source-option-field"
      style={{
        ...menuBandRectStyle(rect),
        backgroundImage: `url(${ogui.piece[active ? 'optionFieldHover' : 'optionField']})`,
      }}
    >
      <img src={ogui.text(label, 20).url} alt="" draggable={false} />
    </div>
  );
  const choice = (rect: MenuRect, label: 'Yes' | 'No', selected: boolean, apply: () => void) => (
    <SourceButton rect={rect} ogui={ogui} piece="confirmSmall" label={label} disabled={selected} onClick={apply} />
  );
  const leave = () => (page === 'root' ? (onExit ? onExit() : set({ phase: backPhase })) : setPage('root'));
  return (
    <MenuBand ogui={ogui}>
      <div className="og-source-title" style={menuBandRectStyle(OPTIONS_RECTS.title)}>
        <img src={ogui.text(title, 30).url} alt="" draggable={false} />
      </div>
      {page === 'root' && (
        <>
          <SourceButton rect={OPTIONS_RECTS.rootButtons[0]} ogui={ogui} label="Graphics" onClick={() => setPage('graphics')} />
          <SourceButton rect={OPTIONS_RECTS.rootButtons[1]} ogui={ogui} label="Controls" onClick={() => setPage('controls')} />
          <SourceButton rect={OPTIONS_RECTS.rootButtons[2]} ogui={ogui} label="Sound" onClick={() => setPage('sound')} />
        </>
      )}
      {page === 'graphics' && (
        <>
          {field(OPTIONS_RECTS.graphics.resolutionField, 'Screen Resolution', true)}
          <div className="og-source-field-value" style={menuBandRectStyle(OPTIONS_RECTS.graphics.resolutionText)}>
            <img
              src={ogui.text(`${SCREEN_MODES[settings.screenMode].width}*${SCREEN_MODES[settings.screenMode].height}`, 18).url}
              alt=""
              draggable={false}
            />
          </div>
          <SpriteButton
            ogui={ogui}
            piece="arrowLeft"
            rect={OPTIONS_RECTS.graphics.resolutionLeft}
            label="Previous screen resolution"
            disabled={settings.screenMode <= 0}
            onClick={() => updateSettings({ screenMode: settings.screenMode - 1 })}
          />
          <SpriteButton
            ogui={ogui}
            piece="arrowRight"
            rect={OPTIONS_RECTS.graphics.resolutionRight}
            label="Next screen resolution"
            disabled={settings.screenMode >= SCREEN_MODES.length - 1}
            onClick={() => updateSettings({ screenMode: settings.screenMode + 1 })}
          />
          {field(OPTIONS_RECTS.graphics.syncField, 'Synch to Screen?')}
          {choice(OPTIONS_RECTS.graphics.syncYes, 'Yes', settings.syncToScreen, () => updateSettings({ syncToScreen: true }))}
          {choice(OPTIONS_RECTS.graphics.syncNo, 'No', !settings.syncToScreen, () => updateSettings({ syncToScreen: false }))}
          {field(OPTIONS_RECTS.graphics.cloudsField, 'Clouds?')}
          {choice(OPTIONS_RECTS.graphics.cloudsYes, 'Yes', settings.clouds, () => updateSettings({ clouds: true }))}
          {choice(OPTIONS_RECTS.graphics.cloudsNo, 'No', !settings.clouds, () => updateSettings({ clouds: false }))}
        </>
      )}
      {page === 'controls' && (
        <>
          {CONTROL_ROWS.map(({ setting, label }, index) => (
            <div
              key={setting}
              role="button"
              aria-label={`${label}: ${listening === setting ? 'Press Key' : displayKey(settings[setting])}`}
              tabIndex={0}
              className={`og-source-key-field${listening === setting ? ' og-key-listening' : ''}`}
              style={{
                ...menuBandRectStyle(OPTIONS_RECTS.controls.fields[index]),
                backgroundImage: `url(${ogui.piece[listening === setting ? 'keyFieldHover' : 'keyField']})`,
              }}
              onClick={() => {
                menuAudio.click();
                setListening(setting);
              }}
            >
              <img src={ogui.text(label, 18).url} alt="" draggable={false} />
              <img src={ogui.text(listening === setting ? 'Press Key' : displayKey(settings[setting]), 18).url} alt="" draggable={false} />
            </div>
          ))}
          {field(OPTIONS_RECTS.controls.invertField, 'Invert Rotation?')}
          {choice(OPTIONS_RECTS.controls.invertYes, 'Yes', settings.invertCameraRotation, () => updateSettings({ invertCameraRotation: true }))}
          {choice(OPTIONS_RECTS.controls.invertNo, 'No', !settings.invertCameraRotation, () => updateSettings({ invertCameraRotation: false }))}
        </>
      )}
      {page === 'sound' && (
        <>
          {field(OPTIONS_RECTS.sound.field, 'Music Volume', true)}
          <div className="og-source-field-value" style={menuBandRectStyle(OPTIONS_RECTS.sound.text)}>
            <img src={ogui.text(String(Math.round(settings.musicVolume * 100)), 18).url} alt="" draggable={false} />
          </div>
          <SpriteButton
            ogui={ogui}
            piece="arrowLeft"
            rect={OPTIONS_RECTS.sound.left}
            label="Decrease music volume"
            disabled={settings.musicVolume <= 0}
            onClick={() => updateSettings({ musicVolume: Math.max(0, Math.round((settings.musicVolume - 0.1) * 10) / 10) })}
          />
          <SpriteButton
            ogui={ogui}
            piece="arrowRight"
            rect={OPTIONS_RECTS.sound.right}
            label="Increase music volume"
            disabled={settings.musicVolume >= 1}
            onClick={() => updateSettings({ musicVolume: Math.min(1, Math.round((settings.musicVolume + 0.1) * 10) / 10) })}
          />
        </>
      )}
      <SourceButton rect={OPTIONS_RECTS.back} ogui={ogui} piece="buttonMedium" label="Back" onClick={leave} />
    </MenuBand>
  );
}

function ConfirmScreen({
  ogui,
  question,
  onConfirm,
  onCancel,
}: {
  ogui: Ogui;
  question: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <MenuBand ogui={ogui}>
      <div className="og-source-confirm-question" style={menuBandRectStyle(CONFIRM_RECTS.question)}>
        <img src={ogui.text(question, 20).url} alt={question} draggable={false} />
      </div>
      <SourceButton rect={CONFIRM_RECTS.yes} ogui={ogui} piece="confirmSmall" label="Yes" onClick={onConfirm} />
      <SourceButton rect={CONFIRM_RECTS.no} ogui={ogui} piece="confirmSmall" label="No" onClick={onCancel} />
    </MenuBand>
  );
}

type CreditVisual =
  | { kind: 'text'; index: number; stage: 'in' | 'hold' | 'out' }
  | { kind: 'logo1' | 'logo2'; stage: 'in' | 'hold' | 'out' }
  | { kind: 'wait' };

function CreditTextLayer({ ogui, text, title }: { ogui: Ogui; text: string; title: boolean }) {
  const [scaleX, scaleY] = title ? CREDITS_FONT_SOURCE.titleScale : CREDITS_FONT_SOURCE.copyScale;
  return (
    <div className={`og-source-credit-layer ${title ? 'og-source-credit-title-layer' : 'og-source-credit-copy-layer'}`}>
      {text.split('\n').map((line, index) => (
        <div className="og-source-credit-line" key={index}>
          {line !== '' && (
            <img
              src={
                ogui.text(line, CREDITS_FONT_SOURCE.sourcePixelHeight, '#ffffff', '#000000', {
                  scaleX,
                  scaleY,
                }).url
              }
              alt=""
              draggable={false}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function creditTransition(visual: CreditVisual, credits: readonly CreditBlock[]): { delay: number; next: CreditVisual } {
  if (visual.kind === 'text') {
    if (visual.stage === 'in') {
      return { delay: CREDITS_TIMING.textFadeIn, next: { ...visual, stage: 'hold' } };
    }
    if (visual.stage === 'hold') {
      return { delay: creditTextWait(credits[visual.index], visual.index), next: { ...visual, stage: 'out' } };
    }
    if (visual.index + 1 < credits.length) {
      return {
        delay: CREDITS_TIMING.textFadeOut,
        next: { kind: 'text', index: visual.index + 1, stage: 'in' },
      };
    }
    return { delay: CREDITS_TIMING.textFadeOut, next: { kind: 'logo1', stage: 'in' } };
  }
  if (visual.kind === 'logo1') {
    if (visual.stage === 'in') return { delay: CREDITS_TIMING.logo1FadeIn, next: { ...visual, stage: 'hold' } };
    if (visual.stage === 'hold') return { delay: CREDITS_TIMING.logo1Wait, next: { ...visual, stage: 'out' } };
    return { delay: CREDITS_TIMING.logo1FadeOut, next: { kind: 'logo2', stage: 'in' } };
  }
  if (visual.kind === 'logo2') {
    if (visual.stage === 'in') return { delay: CREDITS_TIMING.logo2FadeIn, next: { ...visual, stage: 'hold' } };
    if (visual.stage === 'hold') return { delay: CREDITS_TIMING.logo2Wait, next: { ...visual, stage: 'out' } };
    return { delay: CREDITS_TIMING.logo2FadeOut, next: { kind: 'wait' } };
  }
  return { delay: CREDITS_TIMING.repeatWait, next: { kind: 'text', index: 0, stage: 'in' } };
}

export function CreditsScreen() {
  const set = useGameStore((s) => s.set);
  const ogui = useOgui();
  const [visual, setVisual] = useState<CreditVisual>({ kind: 'text', index: 0, stage: 'in' });
  useEffect(() => {
    if (!ogui || ogui.credits.length === 0) return;
    const transition = creditTransition(visual, ogui.credits);
    const timer = window.setTimeout(() => setVisual(transition.next), transition.delay);
    return () => window.clearTimeout(timer);
  }, [ogui, visual]);
  if (!ogui) return null;
  const fadeDuration =
    visual.kind === 'text'
      ? visual.stage === 'in'
        ? CREDITS_TIMING.textFadeIn
        : CREDITS_TIMING.textFadeOut
      : visual.kind === 'logo1'
        ? visual.stage === 'in'
          ? CREDITS_TIMING.logo1FadeIn
          : CREDITS_TIMING.logo1FadeOut
        : visual.kind === 'logo2'
          ? visual.stage === 'in'
            ? CREDITS_TIMING.logo2FadeIn
            : CREDITS_TIMING.logo2FadeOut
          : 0;
  const textVisual = visual.kind === 'text' ? visual : null;
  const block = textVisual ? ogui.credits[textVisual.index] : null;
  const fadeClass =
    visual.kind === 'wait'
      ? ''
      : visual.stage === 'in'
        ? ' og-source-credit-fade-in'
        : visual.stage === 'out'
          ? ' og-source-credit-fade-out'
          : '';
  return (
    <MenuBand ogui={ogui}>
      {block && (
        <div
          key={`text-${textVisual?.index}-${textVisual?.stage}`}
          className={`og-source-credit${fadeClass}`}
          style={{ ...menuBandRectStyle(CREDITS_RECTS.text), animationDuration: `${fadeDuration}ms` }}
        >
          <CreditTextLayer ogui={ogui} text={block.title} title />
          <CreditTextLayer ogui={ogui} text={block.copy} title={false} />
        </div>
      )}
      {(visual.kind === 'logo1' || visual.kind === 'logo2') && (
        <img
          key={`${visual.kind}-${visual.stage}`}
          className={`og-source-credit-logo${fadeClass}`}
          style={{
            ...menuBandRectStyle(CREDITS_RECTS[visual.kind]),
            animationDuration: `${fadeDuration}ms`,
          }}
          src={ogui.piece[visual.kind === 'logo1' ? 'creditLogo1' : 'creditLogo2']}
          alt=""
          draggable={false}
        />
      )}
      <SourceButton rect={CREDITS_RECTS.back} ogui={ogui} piece="buttonMedium" label="Back" onClick={() => set({ phase: 'menu' })} />
    </MenuBand>
  );
}

export function PauseOverlay() {
  const set = useGameStore((s) => s.set);
  const loadLevel = useGameStore((s) => s.loadLevel);
  const level = useGameStore((s) => s.level);
  const [confirm, setConfirm] = useState<'restart' | 'exit' | null>(null);
  const ogui = useOgui();
  if (!ogui) return null;
  if (confirm) {
    return (
      <ConfirmScreen
        ogui={ogui}
        question={confirm === 'restart' ? 'Do you want to restart the level?' : 'Do you want to exit the level?'}
        onConfirm={() => (confirm === 'restart' ? loadLevel(level) : set({ phase: 'menu', level }))}
        onCancel={() => setConfirm(null)}
      />
    );
  }
  return (
    <MenuBand ogui={ogui}>
      <SourceButton rect={LARGE_MENU_BUTTON_RECTS[0]} ogui={ogui} label="Restart Level" onClick={() => setConfirm('restart')} />
      <SourceButton rect={LARGE_MENU_BUTTON_RECTS[1]} ogui={ogui} label="Highscore" onClick={() => set({ phase: 'pauseHighscore' })} />
      <SourceButton rect={LARGE_MENU_BUTTON_RECTS[2]} ogui={ogui} label="Options" onClick={() => set({ phase: 'pauseOptions' })} />
      <SourceButton rect={LARGE_MENU_BUTTON_RECTS[3]} ogui={ogui} label="Exit Level" onClick={() => setConfirm('exit')} />
      <SourceButton rect={MENU_BACK_RECT} ogui={ogui} piece="buttonMedium" label="Back" onClick={() => set({ phase: 'playing' })} />
    </MenuBand>
  );
}

const SCORE_LABELS = ['Level Bonus', 'Time Points', 'Extra Lives', 'Score'] as const;

function waitFor(ms: number, cancelled: () => boolean, interrupted?: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const started = performance.now();
    const tick = () => {
      if (cancelled()) return resolve(false);
      if (interrupted?.()) return resolve(true);
      if (performance.now() - started >= ms) return resolve(false);
      window.setTimeout(tick, Math.min(25, ms));
    };
    tick();
  });
}

function SourceScorePanel({
  ogui,
  level,
  points,
  initialLives,
  onDone,
}: {
  ogui: Ogui;
  level: number;
  points: number;
  initialLives: number;
  onDone: () => void;
}) {
  const setStore = useGameStore((state) => state.set);
  const levelBonus = level * 100;
  const lifeBonus = initialLives * 200;
  const total = levelBonus + points + lifeBonus;
  const [values, setValues] = useState<readonly number[]>([0, 0, 0, 0]);
  const [highlight, setHighlight] = useState(0);
  const [opacity, setOpacity] = useState(0);
  const fastRequested = useRef(false);
  const waitSkipRequested = useRef(false);
  const phase = useRef<'tally' | 'wait'>('tally');
  const done = useRef(onDone);

  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!['Escape', 'Enter', 'Space'].includes(event.code)) return;
      if (phase.current === 'tally') fastRequested.current = true;
      else waitSkipRequested.current = true;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    const shouldFast = () => fastRequested.current;
    const run = async () => {
      setOpacity(1);
      if (await waitFor(200, isCancelled, shouldFast)) return fastFinish();
      if (await waitFor(1000, isCancelled, shouldFast)) return fastFinish();
      setValues([levelBonus, 0, 0, 0]);
      menuAudio.dong();
      if (await waitFor(1000, isCancelled, shouldFast)) return fastFinish();

      setHighlight(1);
      let displayedPoints = 0;
      while (displayedPoints < points && !cancelled) {
        if (fastRequested.current) return fastFinish();
        displayedPoints = Math.min(points, displayedPoints + scoreCountStep(displayedPoints));
        const current = displayedPoints;
        setValues([levelBonus, current, 0, 0]);
        menuAudio.counter();
        await waitFor(1000 / 60, isCancelled);
      }
      if (cancelled) return;
      menuAudio.dong();
      if (await waitFor(1000, isCancelled, shouldFast)) return fastFinish();

      setHighlight(2);
      for (let remaining = initialLives; remaining > 0; remaining--) {
        if (await waitFor(610, isCancelled, shouldFast)) return fastFinish();
        if (cancelled) return;
        const counted = initialLives - remaining + 1;
        setValues([levelBonus, points, counted * 200, 0]);
        setStore({ lives: remaining - 1 });
        menuAudio.dong();
      }
      if (await waitFor(1000, isCancelled, shouldFast)) return fastFinish();

      setHighlight(3);
      setValues([levelBonus, points, lifeBonus, total]);
      menuAudio.dong();
      await finishWait();
    };

    const fastFinish = async () => {
      if (cancelled) return;
      fastRequested.current = false;
      setHighlight(3);
      setValues([levelBonus, points, lifeBonus, total]);
      setStore({ lives: 0 });
      menuAudio.dong();
      await finishWait();
    };

    const finishWait = async () => {
      if (cancelled) return;
      phase.current = 'wait';
      waitSkipRequested.current = false;
      await waitFor(4000, isCancelled, () => waitSkipRequested.current);
      if (cancelled) return;
      setOpacity(0);
      await waitFor(200, isCancelled);
      if (!cancelled) done.current();
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [initialLives, levelBonus, lifeBonus, points, setStore, total]);

  const highlightHeight = SCORE_RECTS.highlight[3] - SCORE_RECTS.highlight[1];
  const highlightRect: MenuRect = [
    SCORE_RECTS.highlight[0],
    SCORE_RECTS.highlightPositions[highlight][1],
    SCORE_RECTS.highlight[2],
    SCORE_RECTS.highlightPositions[highlight][1] + highlightHeight,
  ];
  return (
    <MenuBand ogui={ogui} transparent>
      <div className="og-source-score" style={{ opacity }}>
        <div className="og-source-score-field" style={menuBandRectStyle(SCORE_RECTS.field)} />
        <div
          className="og-source-score-highlight"
          style={{
            ...menuBandRectStyle(highlightRect),
            WebkitMaskImage: `url(${ogui.piece.scoreHighlight})`,
            maskImage: `url(${ogui.piece.scoreHighlight})`,
          }}
        />
        <div className="og-source-score-line" style={menuBandRectStyle(SCORE_RECTS.line)} />
        {SCORE_LABELS.map((label, index) => (
          <div key={label} className="og-source-score-text og-source-score-label" style={menuBandRectStyle(SCORE_RECTS.labels[index])}>
            <img src={ogui.text(label, index === 3 ? 22 : 20).url} alt="" draggable={false} />
          </div>
        ))}
        {values.map((value, index) => (
          <div key={index} className="og-source-score-text og-source-score-value" style={menuBandRectStyle(SCORE_RECTS.values[index])}>
            <img src={ogui.text(String(value), index === 3 ? 22 : 20).url} alt="" draggable={false} />
          </div>
        ))}
      </div>
    </MenuBand>
  );
}

function HighscoreEntry({ ogui, level, total, onDone }: { ogui: Ogui; level: number; total: number; onDone: () => void }) {
  const submitScore = useGameStore((state) => state.submitScore);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    menuAudio.highscoreMusic();
    inputRef.current?.focus();
  }, []);
  const submit = () => {
    submitScore(level, name, total);
    menuAudio.dong();
    onDone();
  };
  return (
    <MenuBand ogui={ogui}>
      <div className="og-source-entry-title" style={menuBandRectStyle(HIGHSCORE_ENTRY_RECTS.title)}>
        <img src={ogui.text('New highscore entry!', 22).url} alt="" draggable={false} />
      </div>
      <input
        ref={inputRef}
        aria-label="Highscore name"
        className="og-source-entry-input"
        style={menuBandRectStyle(HIGHSCORE_ENTRY_RECTS.name)}
        value={name}
        maxLength={16}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') submit();
        }}
      />
      <SourceButton rect={HIGHSCORE_ENTRY_RECTS.confirm} ogui={ogui} piece="buttonMedium" label="OK" onClick={submit} />
    </MenuBand>
  );
}

function EndMenu({ ogui, level }: { ogui: Ogui; level: number }) {
  const set = useGameStore((state) => state.set);
  const loadLevel = useGameStore((state) => state.loadLevel);
  const [subscreen, setSubscreen] = useState<'menu' | 'highscore' | 'options'>('menu');
  if (subscreen === 'highscore') {
    return <HighscoreScreen initialLevel={level} onExit={() => setSubscreen('menu')} />;
  }
  if (subscreen === 'options') {
    return <OptionsScreen onExit={() => setSubscreen('menu')} />;
  }
  return (
    <MenuBand ogui={ogui}>
      <SourceButton rect={LARGE_MENU_BUTTON_RECTS[0]} ogui={ogui} label="Restart Level" onClick={() => loadLevel(level)} />
      <SourceButton rect={LARGE_MENU_BUTTON_RECTS[1]} ogui={ogui} label="Highscore" onClick={() => setSubscreen('highscore')} />
      <SourceButton rect={LARGE_MENU_BUTTON_RECTS[2]} ogui={ogui} label="Options" onClick={() => setSubscreen('options')} />
      <SourceButton rect={LARGE_MENU_BUTTON_RECTS[3]} ogui={ogui} label="Home" onClick={() => set({ phase: 'menu' })} />
      <SourceButton
        rect={LARGE_MENU_BUTTON_RECTS[4]}
        ogui={ogui}
        label="Next Level"
        disabled={level >= 12}
        onClick={() => loadLevel(level + 1)}
      />
    </MenuBand>
  );
}

export function FinishedOverlay() {
  const { level, points, lives, progress } = useGameStore();
  const ogui = useOgui();
  const [score] = useState(() => {
    const total = level * 100 + points + lives * 200;
    return {
      initialLives: lives,
      total,
      qualifies: total > (progress.tables[level] ?? defaultTable(level)).at(-1)!.score,
    };
  });
  const [flow, setFlow] = useState<'score' | 'entry' | 'highscore' | 'end'>('score');
  if (!ogui) return null;
  if (flow === 'score') {
    return (
      <SourceScorePanel
        ogui={ogui}
        level={level}
        points={points}
        initialLives={score.initialLives}
        onDone={() => setFlow(score.qualifies ? 'entry' : 'end')}
      />
    );
  }
  if (flow === 'entry') {
    return <HighscoreEntry ogui={ogui} level={level} total={score.total} onDone={() => setFlow('highscore')} />;
  }
  if (flow === 'highscore') {
    return <HighscoreScreen initialLevel={level} exitLabel="Next" onExit={() => setFlow('end')} />;
  }
  return <EndMenu ogui={ogui} level={level} />;
}

export function GameOverOverlay() {
  const { level, loadLevel, set } = useGameStore();
  const ogui = useOgui();
  if (!ogui) return null;
  return (
    <MenuBand ogui={ogui}>
      <SourceButton
        rect={LARGE_MENU_BUTTON_RECTS[0]}
        ogui={ogui}
        label="Restart Level"
        onClick={() => {
          menuAudio.levelLoad();
          loadLevel(level);
        }}
      />
      <SourceButton rect={LARGE_MENU_BUTTON_RECTS[1]} ogui={ogui} label="Home" onClick={() => set({ phase: 'menu' })} />
    </MenuBand>
  );
}
