/**
 * Menus rebuilt from the original UI assets and strings: Button01 capsule
 * sprites, Font_1 bitmap text, Cursor.tga, the translucent center band, and
 * the original screen set (Start/Highscore/Options+subscreens/Credits, the
 * pause and win/fail flows with their exact English strings).
 */
import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  CONTROL_ROWS,
  SCREEN_MODES,
  displayKey,
  isSourceKey,
  type ControlSetting,
  type Settings,
} from '../game/settings.ts';
import {
  SOURCE_HIGHSCORE_NAME_MAX_LENGTH,
  highscoreQualifies,
  scoreCountStep,
} from '../game/score.ts';
import { startSourceFrameLoop } from '../game/frameLoop.ts';
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
  MENU_FONT_SOURCE,
  MENU_TEXT_SOURCE,
  OPTIONS_RECTS,
  SCORE_RECTS,
  creditTextWait,
  menuFontShadowOffset,
  menuBandRectStyle,
  type MenuFontRole,
  type CreditBlock,
  type MenuRect,
} from './menuLayout.ts';
import { useOgui } from './useOgui.ts';
import type { Ogui } from './ogui.ts';
import {
  nextSourceMenuIndex,
  sourceMenuInitialIndex,
  type SourceMenuInitialSelection,
} from './menuNavigation.ts';

type ButtonPiece = 'buttonLarge' | 'buttonMedium' | 'levelButton' | 'confirmSmall';

const MenuSourceSizeContext = createContext<readonly [number, number]>([640, 480]);

function sourceMenuSize(): readonly [width: number, height: number] {
  if (typeof window === 'undefined') return [0, 0];
  const width = Math.min(window.innerWidth, window.innerHeight * (4 / 3));
  return [width, width * (3 / 4)];
}

function useSourceMenuSize(): readonly [width: number, height: number] {
  const [size, setSize] = useState(sourceMenuSize);
  useEffect(() => {
    const update = () => setSize(sourceMenuSize());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return size;
}

function SourceMenuText({
  ogui,
  text,
  role,
  className,
}: {
  ogui: Ogui;
  text: string;
  role: MenuFontRole;
  className?: string;
}) {
  const sourceSize = useContext(MenuSourceSizeContext);
  const font = MENU_FONT_SOURCE[role];
  const image = ogui.text(text, 32, 'color' in font ? font.color : MENU_FONT_SOURCE.color, MENU_FONT_SOURCE.endColor, {
    scaleX: font.scale[0],
    scaleY: font.scale[1],
    screenWidth: sourceSize[0],
    screenHeight: sourceSize[1],
  });
  const [shadowX, shadowY] = menuFontShadowOffset();
  return (
    <img
      className={`og-source-font${className ? ` ${className}` : ''}`}
      src={image.url}
      style={{
        width: image.w,
        height: image.h,
        maxWidth: 'none',
        maxHeight: 'none',
        filter: `drop-shadow(${shadowX}px ${shadowY}px 0 ${MENU_FONT_SOURCE.shadowColor})`,
      }}
      alt=""
      draggable={false}
    />
  );
}

/** capsule button built from the original atlas piece + bitmap-font label */
export function MenuButton({
  ogui,
  label,
  onClick,
  disabled,
  medium,
  piece: requestedPiece,
  style,
  selected = false,
  onSelect,
  accessibleLabel,
}: {
  ogui: Ogui;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  medium?: boolean;
  piece?: ButtonPiece;
  style?: CSSProperties;
  selected?: boolean;
  onSelect?: () => void;
  accessibleLabel?: string;
}) {
  const [hover, setHover] = useState(false);
  const piece = requestedPiece ?? (medium ? 'buttonMedium' : 'buttonLarge');
  const compact = medium || piece !== 'buttonLarge';
  const selectionControlled = onSelect !== undefined;
  const highlighted = selectionControlled ? selected : hover || selected;
  const img = ogui.piece[disabled ? `${piece}Disabled` : highlighted ? `${piece}Hover` : piece] ?? ogui.piece[piece];
  const role: MenuFontRole = piece === 'levelButton' ? (disabled ? 'inactive' : 'row') : piece === 'confirmSmall' ? 'row' : 'primary';
  const activate = () => {
    if (disabled) return;
    menuAudio.click();
    onClick();
  };
  return (
    <div
      role="button"
      aria-label={accessibleLabel ?? label}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      className={`og-button${compact ? ' og-button-medium' : ''}${disabled ? ' og-disabled' : ''}`}
      style={{ backgroundImage: `url(${img})`, ...style }}
      onMouseEnter={() => {
        if (selectionControlled) {
          if (!disabled) onSelect();
        } else {
          setHover(true);
        }
      }}
      onMouseLeave={() => {
        if (!selectionControlled) setHover(false);
      }}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          activate();
        }
      }}
    >
      <SourceMenuText ogui={ogui} text={label} role={role} className="og-button-label" />
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
  const sourceSize = useSourceMenuSize();
  useEffect(() => {
    menuAudio.startAtmo();
    return () => {
      const p = useGameStore.getState().phase;
      if (p === 'loading' || p === 'playing') menuAudio.stopAtmo();
    };
  }, []);
  return (
    <MenuSourceSizeContext.Provider value={sourceSize}>
      <div className="og-screen" style={{ cursor: `url(${ogui.cursor}) 1 1, auto`, ...style }}>
        <div className="og-source-stage">
          <div className={`og-band${transparent ? ' og-band-transparent' : ''}`}>{children}</div>
        </div>
      </div>
    </MenuSourceSizeContext.Provider>
  );
}

function SourceButton({
  rect,
  ...props
}: Omit<ComponentProps<typeof MenuButton>, 'style'> & { rect: MenuRect }) {
  return <MenuButton {...props} style={menuBandRectStyle(rect)} />;
}

type SourceButtonItem = Omit<ComponentProps<typeof SourceButton>, 'ogui' | 'selected' | 'onSelect'>;

function SourceButtonList({
  ogui,
  items,
  initial = 'first',
  axis = 'vertical',
  escape = 'last',
}: {
  ogui: Ogui;
  items: readonly SourceButtonItem[];
  initial?: SourceMenuInitialSelection;
  axis?: 'vertical' | 'horizontal';
  escape?: 'last' | 'none';
}) {
  const disabled = items.map((item) => item.disabled ?? false);
  const [selected, setSelected] = useState(() => sourceMenuInitialIndex(disabled, initial));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) return;
      const currentItems = items;
      const currentDisabled = currentItems.map((item) => item.disabled ?? false);
      const previous = axis === 'vertical' ? event.code === 'ArrowUp' : event.code === 'ArrowLeft';
      const next = axis === 'vertical' ? event.code === 'ArrowDown' : event.code === 'ArrowRight';
      if (previous || next) {
        event.preventDefault();
        setSelected((current) => nextSourceMenuIndex(currentDisabled, current, previous ? -1 : 1));
        return;
      }
      if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        const item = currentItems[selected];
        if (!item || item.disabled) return;
        event.preventDefault();
        menuAudio.click();
        item.onClick();
        return;
      }
      if (event.code === 'Escape' && escape === 'last') {
        const index = sourceMenuInitialIndex(currentDisabled, 'last');
        const item = currentItems[index];
        if (!item || item.disabled) return;
        event.preventDefault();
        menuAudio.click();
        item.onClick();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [axis, escape, items, selected]);

  return items.map((item, index) => (
    <SourceButton
      key={`${item.label}-${index}`}
      {...item}
      ogui={ogui}
      selected={selected === index}
      onSelect={() => setSelected(index)}
    />
  ));
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
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          activate();
        }
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
        question={MENU_TEXT_SOURCE.exitGameQuestion}
        onConfirm={() => window.close()}
        onCancel={() => setConfirmExit(false)}
      />
    );
  }
  return (
    <MenuBand ogui={ogui}>
      <SourceButtonList
        ogui={ogui}
        items={[
          { rect: LARGE_MENU_BUTTON_RECTS[0], label: MENU_TEXT_SOURCE.main[0], onClick: () => set({ phase: 'levelselect' }) },
          { rect: LARGE_MENU_BUTTON_RECTS[1], label: MENU_TEXT_SOURCE.main[1], onClick: () => set({ phase: 'highscore' }) },
          { rect: LARGE_MENU_BUTTON_RECTS[2], label: MENU_TEXT_SOURCE.main[2], onClick: () => set({ phase: 'options' }) },
          { rect: LARGE_MENU_BUTTON_RECTS[3], label: MENU_TEXT_SOURCE.main[4], onClick: () => set({ phase: 'credits' }) },
          { rect: LARGE_MENU_BUTTON_RECTS[4], label: MENU_TEXT_SOURCE.main[3], onClick: () => setConfirmExit(true) },
        ]}
      />
    </MenuBand>
  );
}

export function LevelSelect() {
  const { progress, loadLevel, set } = useGameStore();
  const ogui = useOgui();
  if (!ogui) return null;
  const items: SourceButtonItem[] = Array.from({ length: 12 }, (_, index) => {
    const level = index + 1;
    return {
      rect: LEVEL_BUTTON_RECTS[index],
      piece: 'levelButton',
      label: MENU_TEXT_SOURCE.levels[index],
      disabled: level > progress.unlocked,
      onClick: () => {
        menuAudio.levelLoad();
        loadLevel(level);
      },
    };
  });
  items.push({ rect: MENU_BACK_RECT, piece: 'buttonMedium', label: MENU_TEXT_SOURCE.back, onClick: () => set({ phase: 'menu' }) });
  return (
    <MenuBand ogui={ogui}>
      <SourceButtonList ogui={ogui} items={items} />
    </MenuBand>
  );
}

/** original: paged per-level top-10 tables (rank, name, points) */
export function HighscoreScreen({
  backPhase = 'menu',
  initialLevel = 1,
  exitLabel = MENU_TEXT_SOURCE.back,
  onExit,
}: {
  backPhase?: GamePhase;
  initialLevel?: number;
  exitLabel?: string;
  onExit?: () => void;
}) {
  const { progress, set } = useGameStore();
  const maxLevel = Math.max(1, progress.unlocked);
  const [level, setLevel] = useState(Math.min(maxLevel, Math.max(1, initialLevel)));
  const ogui = useOgui();
  const exit = useCallback(() => (onExit ? onExit() : set({ phase: backPhase })), [backPhase, onExit, set]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        const direction = event.code === 'ArrowLeft' ? -1 : 1;
        setLevel((current) => {
          const next = Math.max(1, Math.min(maxLevel, current + direction));
          if (next !== current) menuAudio.click();
          return next;
        });
        event.preventDefault();
      } else if (event.code === 'Escape' || event.code === 'Enter' || event.code === 'NumpadEnter') {
        event.preventDefault();
        menuAudio.click();
        exit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exit, maxLevel]);
  if (!ogui) return null;
  const table = progress.tables[level] ?? defaultTable(level);
  return (
    <MenuBand ogui={ogui}>
      <div className="og-source-title" style={menuBandRectStyle(HIGHSCORE_RECTS.title)}>
        <SourceMenuText ogui={ogui} text={`${MENU_TEXT_SOURCE.highscoreTitle}${level}`} role="primary" />
      </div>
      <SpriteButton ogui={ogui} piece="highscorePrevious" rect={HIGHSCORE_RECTS.previous} label="Previous level" disabled={level <= 1} onClick={() => setLevel(level - 1)} />
      <SpriteButton ogui={ogui} piece="highscoreNext" rect={HIGHSCORE_RECTS.next} label="Next level" disabled={level >= maxLevel} onClick={() => setLevel(level + 1)} />
      {table.map((e, i) => (
        <Fragment key={i}>
          <div
            className="og-source-score-row"
            style={{
              ...menuBandRectStyle(HIGHSCORE_RECTS.rows[i]),
              backgroundImage: `url(${ogui.piece.highscoreRow})`,
            }}
          >
            <SourceMenuText ogui={ogui} text={e.name} role="row" className="og-score-name" />
            <SourceMenuText ogui={ogui} text={String(e.score)} role="row" />
          </div>
          <div
            className="og-source-score-rank"
            style={{
              ...menuBandRectStyle(HIGHSCORE_RECTS.ranks[i]),
              backgroundImage: `url(${ogui.piece[`highscoreRank${i + 1}`]})`,
            }}
          />
        </Fragment>
        ))}
      <SourceButton
        rect={HIGHSCORE_RECTS.exit}
        ogui={ogui}
        piece="buttonMedium"
        label={exitLabel}
        onClick={exit}
      />
    </MenuBand>
  );
}

/** original Options: Graphics / Controls / Sound subscreens */
export function OptionsScreen({ backPhase = 'menu', onExit }: { backPhase?: GamePhase; onExit?: () => void }) {
  const { settings: savedSettings, updateSettings, set } = useGameStore();
  const [page, setPage] = useState<'root' | 'graphics' | 'controls' | 'sound'>('root');
  const [listening, setListening] = useState<ControlSetting | null>(null);
  const [settings, setDraftSettings] = useState<Settings>(savedSettings);
  const [optionRow, setOptionRow] = useState(0);
  const ogui = useOgui();

  const previewSettings = (partial: Partial<Settings>) => {
    setDraftSettings((current) => ({ ...current, ...partial }));
  };

  const openPage = (next: 'graphics' | 'controls' | 'sound') => {
    setDraftSettings(savedSettings);
    setOptionRow(0);
    setPage(next);
  };

  const commitPage = () => {
    updateSettings(settings);
    setListening(null);
    setOptionRow(0);
    setPage('root');
  };

  useEffect(() => {
    if (!listening) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (isSourceKey(event.code)) {
        previewSettings({ [listening]: event.code } as Partial<Settings>);
        setListening(null);
      } else if (event.code === 'Escape') {
        setListening(null);
      }
    };
    window.addEventListener('keydown', capture, true);
    return () => window.removeEventListener('keydown', capture, true);
  }, [listening]);

  useEffect(() => {
    menuAudio.setMusicVolume(settings.musicVolume);
  }, [settings.musicVolume]);

  useEffect(() => {
    if (page === 'root' || listening) return;
    const count = page === 'graphics' ? 4 : page === 'controls' ? 8 : 2;
    const cancelCurrentPage = () => {
      setDraftSettings(savedSettings);
      setListening(null);
      setOptionRow(0);
      setPage('root');
    };
    const commitCurrentPage = () => {
      updateSettings(settings);
      setListening(null);
      setOptionRow(0);
      setPage('root');
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        event.preventDefault();
        setOptionRow((current) => (current + (event.code === 'ArrowUp' ? -1 : 1) + count) % count);
        return;
      }
      if (event.code === 'Escape') {
        event.preventDefault();
        menuAudio.click();
        cancelCurrentPage();
        return;
      }
      if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        if (page === 'controls' && optionRow < CONTROL_ROWS.length) {
          event.preventDefault();
          menuAudio.click();
          setListening(CONTROL_ROWS[optionRow].setting);
        } else if (
          (page === 'graphics' && optionRow === 3) ||
          (page === 'controls' && optionRow === 7) ||
          (page === 'sound' && optionRow === 1)
        ) {
          event.preventDefault();
          menuAudio.click();
          commitCurrentPage();
        }
        return;
      }
      if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return;
      const right = event.code === 'ArrowRight';
      if (page === 'graphics' && optionRow === 0) {
        event.preventDefault();
        const direction = right ? 1 : -1;
        const screenMode = Math.max(0, Math.min(SCREEN_MODES.length - 1, settings.screenMode + direction));
        if (screenMode !== settings.screenMode) {
          menuAudio.click();
          previewSettings({ screenMode });
        }
      } else if (page === 'graphics' && optionRow === 1) {
        event.preventDefault();
        menuAudio.click();
        previewSettings({ syncToScreen: !right });
      } else if (page === 'graphics' && optionRow === 2) {
        event.preventDefault();
        menuAudio.click();
        previewSettings({ clouds: !right });
      } else if (page === 'controls' && optionRow === 6) {
        event.preventDefault();
        menuAudio.click();
        previewSettings({ invertCameraRotation: !right });
      } else if (page === 'sound' && optionRow === 0) {
        event.preventDefault();
        const direction = right ? 0.1 : -0.1;
        const musicVolume = Math.max(0, Math.min(1, Math.round((settings.musicVolume + direction) * 10) / 10));
        if (musicVolume !== settings.musicVolume) {
          menuAudio.click();
          previewSettings({ musicVolume });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listening, optionRow, page, savedSettings, settings, updateSettings]);

  if (!ogui) return null;
  const title = page === 'root' ? MENU_TEXT_SOURCE.options : page === 'graphics' ? MENU_TEXT_SOURCE.graphics : page === 'controls' ? MENU_TEXT_SOURCE.controls : MENU_TEXT_SOURCE.sound;
  const field = (rect: MenuRect, label: string, active = false, onSelect?: () => void) => (
    <div
      className="og-source-option-field"
      style={{
        ...menuBandRectStyle(rect),
        backgroundImage: `url(${ogui.piece[active ? 'optionFieldHover' : 'optionField']})`,
      }}
      onMouseEnter={onSelect}
    >
      <SourceMenuText ogui={ogui} text={label} role="row" />
    </div>
  );
  const choice = (rect: MenuRect, label: 'Yes' | 'No', selected: boolean, apply: () => void) => (
    <SourceButton rect={rect} ogui={ogui} piece="confirmSmall" label={label} disabled={selected} onClick={apply} />
  );
  const leaveRoot = () => (onExit ? onExit() : set({ phase: backPhase }));
  return (
    <MenuBand ogui={ogui}>
      <div className="og-source-title" style={menuBandRectStyle(OPTIONS_RECTS.title)}>
        <SourceMenuText ogui={ogui} text={title} role="input" />
      </div>
      {page === 'root' && (
        <SourceButtonList
          ogui={ogui}
          items={[
            { rect: OPTIONS_RECTS.rootButtons[0], label: MENU_TEXT_SOURCE.graphics, onClick: () => openPage('graphics') },
            { rect: OPTIONS_RECTS.rootButtons[1], label: MENU_TEXT_SOURCE.controls, onClick: () => openPage('controls') },
            { rect: OPTIONS_RECTS.rootButtons[2], label: MENU_TEXT_SOURCE.sound, onClick: () => openPage('sound') },
            { rect: OPTIONS_RECTS.back, piece: 'buttonMedium', label: MENU_TEXT_SOURCE.back, onClick: leaveRoot },
          ]}
        />
      )}
      {page === 'graphics' && (
        <>
          {field(OPTIONS_RECTS.graphics.resolutionField, MENU_TEXT_SOURCE.screenResolution, optionRow === 0, () => setOptionRow(0))}
          <div className="og-source-field-value" style={menuBandRectStyle(OPTIONS_RECTS.graphics.resolutionText)}>
            {/* Create String joins the row with the serialized " * " delimiter. */}
            <SourceMenuText ogui={ogui} text={`${SCREEN_MODES[settings.screenMode].width} * ${SCREEN_MODES[settings.screenMode].height}`} role="row" />
          </div>
          <SpriteButton
            ogui={ogui}
            piece="arrowLeft"
            rect={OPTIONS_RECTS.graphics.resolutionLeft}
            label="Previous screen resolution"
            disabled={settings.screenMode <= 0}
            onClick={() => {
              setOptionRow(0);
              previewSettings({ screenMode: settings.screenMode - 1 });
            }}
          />
          <SpriteButton
            ogui={ogui}
            piece="arrowRight"
            rect={OPTIONS_RECTS.graphics.resolutionRight}
            label="Next screen resolution"
            disabled={settings.screenMode >= SCREEN_MODES.length - 1}
            onClick={() => {
              setOptionRow(0);
              previewSettings({ screenMode: settings.screenMode + 1 });
            }}
          />
          {field(OPTIONS_RECTS.graphics.syncField, MENU_TEXT_SOURCE.syncToScreen, optionRow === 1, () => setOptionRow(1))}
          {choice(OPTIONS_RECTS.graphics.syncYes, 'Yes', settings.syncToScreen, () => {
            setOptionRow(1);
            previewSettings({ syncToScreen: true });
          })}
          {choice(OPTIONS_RECTS.graphics.syncNo, 'No', !settings.syncToScreen, () => {
            setOptionRow(1);
            previewSettings({ syncToScreen: false });
          })}
          {field(OPTIONS_RECTS.graphics.cloudsField, MENU_TEXT_SOURCE.clouds, optionRow === 2, () => setOptionRow(2))}
          {choice(OPTIONS_RECTS.graphics.cloudsYes, 'Yes', settings.clouds, () => {
            setOptionRow(2);
            previewSettings({ clouds: true });
          })}
          {choice(OPTIONS_RECTS.graphics.cloudsNo, 'No', !settings.clouds, () => {
            setOptionRow(2);
            previewSettings({ clouds: false });
          })}
        </>
      )}
      {page === 'controls' && (
        <>
          {CONTROL_ROWS.map(({ setting, label }, index) => (
            <Fragment key={setting}>
              <div
                role="button"
                aria-label={`${label}: ${displayKey(settings[setting])}`}
                tabIndex={0}
                className={`og-source-key-field${listening === setting ? ' og-key-listening' : ''}`}
                style={{
                  ...menuBandRectStyle(OPTIONS_RECTS.controls.fields[index]),
                  backgroundImage: `url(${ogui.piece[listening === setting || optionRow === index ? 'keyFieldHover' : 'keyField']})`,
                }}
                onMouseEnter={() => setOptionRow(index)}
                onClick={() => {
                  menuAudio.click();
                  setOptionRow(index);
                  setListening(setting);
                }}
              >
                <SourceMenuText ogui={ogui} text={label} role="row" />
              </div>
              <div className="og-source-key-value" style={menuBandRectStyle(OPTIONS_RECTS.controls.values[index])}>
                <SourceMenuText ogui={ogui} text={displayKey(settings[setting])} role="row" />
              </div>
            </Fragment>
          ))}
          {field(OPTIONS_RECTS.controls.invertField, MENU_TEXT_SOURCE.invertRotation, optionRow === 6, () => setOptionRow(6))}
          {choice(OPTIONS_RECTS.controls.invertYes, 'Yes', settings.invertCameraRotation, () => {
            setOptionRow(6);
            previewSettings({ invertCameraRotation: true });
          })}
          {choice(OPTIONS_RECTS.controls.invertNo, 'No', !settings.invertCameraRotation, () => {
            setOptionRow(6);
            previewSettings({ invertCameraRotation: false });
          })}
        </>
      )}
      {page === 'sound' && (
        <>
          {field(OPTIONS_RECTS.sound.field, MENU_TEXT_SOURCE.musicVolume, optionRow === 0, () => setOptionRow(0))}
          <div className="og-source-field-value" style={menuBandRectStyle(OPTIONS_RECTS.sound.text)}>
            <SourceMenuText ogui={ogui} text={String(Math.round(settings.musicVolume * 100))} role="row" />
          </div>
          <SpriteButton
            ogui={ogui}
            piece="arrowLeft"
            rect={OPTIONS_RECTS.sound.left}
            label="Decrease music volume"
            disabled={settings.musicVolume <= 0}
            onClick={() => {
              setOptionRow(0);
              previewSettings({ musicVolume: Math.max(0, Math.round((settings.musicVolume - 0.1) * 10) / 10) });
            }}
          />
          <SpriteButton
            ogui={ogui}
            piece="arrowRight"
            rect={OPTIONS_RECTS.sound.right}
            label="Increase music volume"
            disabled={settings.musicVolume >= 1}
            onClick={() => {
              setOptionRow(0);
              previewSettings({ musicVolume: Math.min(1, Math.round((settings.musicVolume + 0.1) * 10) / 10) });
            }}
          />
        </>
      )}
      {page !== 'root' && (
        <SourceButton
          rect={OPTIONS_RECTS.back}
          ogui={ogui}
          piece="buttonMedium"
          label={MENU_TEXT_SOURCE.back}
          selected={optionRow === (page === 'graphics' ? 3 : page === 'controls' ? 7 : 1)}
          onSelect={() => setOptionRow(page === 'graphics' ? 3 : page === 'controls' ? 7 : 1)}
          onClick={commitPage}
        />
      )}
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
        <SourceMenuText ogui={ogui} text={question} role="row" />
      </div>
      <SourceButtonList
        ogui={ogui}
        axis="horizontal"
        initial="last"
        items={[
          { rect: CONFIRM_RECTS.yes, piece: 'confirmSmall', label: MENU_TEXT_SOURCE.confirm, accessibleLabel: 'Confirm', onClick: onConfirm },
          { rect: CONFIRM_RECTS.no, piece: 'confirmSmall', label: MENU_TEXT_SOURCE.cancel, accessibleLabel: 'Cancel', onClick: onCancel },
        ]}
      />
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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !['Escape', 'Enter', 'NumpadEnter'].includes(event.code)) return;
      event.preventDefault();
      menuAudio.click();
      set({ phase: 'menu' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [set]);
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
      <SourceButton rect={CREDITS_RECTS.back} ogui={ogui} piece="buttonMedium" label={MENU_TEXT_SOURCE.back} onClick={() => set({ phase: 'menu' })} />
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
        question={confirm === 'restart' ? MENU_TEXT_SOURCE.restartQuestion : MENU_TEXT_SOURCE.exitLevelQuestion}
        onConfirm={() => {
          // base.cmo's Exit Level / reset Level branches send Menu_Load first.
          menuAudio.levelLoad();
          if (confirm === 'restart') loadLevel(level);
          else set({ phase: 'menu', level });
        }}
        onCancel={() => setConfirm(null)}
      />
    );
  }
  return (
    <MenuBand ogui={ogui}>
      <SourceButtonList
        ogui={ogui}
        initial="last"
        items={[
          { rect: LARGE_MENU_BUTTON_RECTS[0], label: MENU_TEXT_SOURCE.restartLevel, onClick: () => setConfirm('restart') },
          { rect: LARGE_MENU_BUTTON_RECTS[1], label: MENU_TEXT_SOURCE.main[1], onClick: () => set({ phase: 'pauseHighscore' }) },
          { rect: LARGE_MENU_BUTTON_RECTS[2], label: MENU_TEXT_SOURCE.options, onClick: () => set({ phase: 'pauseOptions' }) },
          { rect: LARGE_MENU_BUTTON_RECTS[3], label: MENU_TEXT_SOURCE.exitLevel, onClick: () => setConfirm('exit') },
          { rect: MENU_BACK_RECT, piece: 'buttonMedium', label: MENU_TEXT_SOURCE.back, onClick: () => set({ phase: 'playing' }) },
        ]}
      />
    </MenuBand>
  );
}

const SCORE_LABELS = MENU_TEXT_SOURCE.scoreLabels;

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

function waitForMenuFrame(cancelled: () => boolean, interrupted: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const stop = startSourceFrameLoop(
      () => {
        stop();
        resolve(cancelled() || interrupted());
      },
      () => useGameStore.getState().settings.syncToScreen,
      false,
    );
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
        if (await waitForMenuFrame(isCancelled, shouldFast)) return fastFinish();
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
            <SourceMenuText ogui={ogui} text={label} role="utility" />
          </div>
        ))}
        {values.map((value, index) => (
          <div key={index} className="og-source-score-text og-source-score-value" style={menuBandRectStyle(SCORE_RECTS.values[index])}>
            <SourceMenuText ogui={ogui} text={String(value)} role="utility" />
          </div>
        ))}
      </div>
    </MenuBand>
  );
}

function HighscoreEntry({ ogui, level, total, onDone }: { ogui: Ogui; level: number; total: number; onDone: () => void }) {
  const submitScore = useGameStore((state) => state.submitScore);
  const lastPlayer = useGameStore((state) => state.lastPlayer);
  const [name, setName] = useState(lastPlayer);
  const [caret, setCaret] = useState(lastPlayer.length);
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
        <SourceMenuText ogui={ogui} text={MENU_TEXT_SOURCE.highscoreEntry} role="primary" />
      </div>
      <div className="og-source-entry-score" style={menuBandRectStyle(HIGHSCORE_ENTRY_RECTS.score)}>
        <SourceMenuText ogui={ogui} text={`${total} ${MENU_TEXT_SOURCE.points}`} role="primary" />
      </div>
      <div className="og-source-entry-field" style={menuBandRectStyle(HIGHSCORE_ENTRY_RECTS.name)}>
        <div className="og-source-entry-value" aria-hidden="true">
          {name.slice(0, caret) && <SourceMenuText ogui={ogui} text={name.slice(0, caret)} role="input" />}
          <span className="og-source-entry-caret" />
          {name.slice(caret) && <SourceMenuText ogui={ogui} text={name.slice(caret)} role="input" />}
        </div>
        <input
          ref={inputRef}
          aria-label="Highscore name"
          className="og-source-entry-input-proxy"
          value={name}
          maxLength={SOURCE_HIGHSCORE_NAME_MAX_LENGTH}
          onChange={(event) => {
            setName(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') submit();
          }}
        />
      </div>
      <SourceButton rect={HIGHSCORE_ENTRY_RECTS.confirm} ogui={ogui} piece="buttonMedium" label={MENU_TEXT_SOURCE.confirm} onClick={submit} />
    </MenuBand>
  );
}

function EndMenu({ ogui, level }: { ogui: Ogui; level: number }) {
  const set = useGameStore((state) => state.set);
  const loadLevel = useGameStore((state) => state.loadLevel);
  const [subscreen, setSubscreen] = useState<'menu' | 'highscore' | 'options'>('menu');
  const [confirmRestart, setConfirmRestart] = useState(false);
  if (subscreen === 'highscore') {
    return <HighscoreScreen initialLevel={level} onExit={() => setSubscreen('menu')} />;
  }
  if (subscreen === 'options') {
    return <OptionsScreen onExit={() => setSubscreen('menu')} />;
  }
  // Menu_End/Restart Level owns its own serialized YesNo ? composite.
  if (confirmRestart) {
    return (
      <ConfirmScreen
        ogui={ogui}
        question={MENU_TEXT_SOURCE.restartQuestion}
        onConfirm={() => {
          menuAudio.levelLoad();
          loadLevel(level);
        }}
        onCancel={() => setConfirmRestart(false)}
      />
    );
  }
  return (
    <MenuBand ogui={ogui}>
      <SourceButtonList
        ogui={ogui}
        initial="last"
        items={[
          { rect: LARGE_MENU_BUTTON_RECTS[0], label: MENU_TEXT_SOURCE.restartLevel, onClick: () => setConfirmRestart(true) },
          { rect: LARGE_MENU_BUTTON_RECTS[1], label: MENU_TEXT_SOURCE.main[1], onClick: () => setSubscreen('highscore') },
          { rect: LARGE_MENU_BUTTON_RECTS[2], label: MENU_TEXT_SOURCE.options, onClick: () => setSubscreen('options') },
          { rect: LARGE_MENU_BUTTON_RECTS[3], label: MENU_TEXT_SOURCE.home, onClick: () => set({ phase: 'menu' }) },
          {
            rect: LARGE_MENU_BUTTON_RECTS[4],
            label: MENU_TEXT_SOURCE.nextLevel,
            disabled: level >= 12,
            onClick: () => {
              // Load Level shares base.cmo's Menu_Load click machinery.
              menuAudio.levelLoad();
              loadLevel(level + 1);
            },
          },
        ]}
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
      qualifies: highscoreQualifies(total, (progress.tables[level] ?? defaultTable(level)).at(-1)!.score),
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
    return <HighscoreScreen initialLevel={level} exitLabel={MENU_TEXT_SOURCE.next} onExit={() => setFlow('end')} />;
  }
  return <EndMenu ogui={ogui} level={level} />;
}

export function GameOverOverlay() {
  const { level, loadLevel, set } = useGameStore();
  const ogui = useOgui();
  if (!ogui) return null;
  return (
    <MenuBand ogui={ogui}>
      <SourceButtonList
        ogui={ogui}
        escape="none"
        items={[
          {
            rect: LARGE_MENU_BUTTON_RECTS[0],
            label: MENU_TEXT_SOURCE.restartLevel,
            onClick: () => {
              menuAudio.levelLoad();
              loadLevel(level);
            },
          },
          { rect: LARGE_MENU_BUTTON_RECTS[1], label: MENU_TEXT_SOURCE.home, onClick: () => set({ phase: 'menu' }) },
        ]}
      />
    </MenuBand>
  );
}
