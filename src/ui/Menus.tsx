/**
 * Menus rebuilt from the original UI assets and strings: Button01 capsule
 * sprites, Font_1 bitmap text, Cursor.tga, the translucent center band, and
 * the original screen set (Start/Highscore/Options+subscreens/Credits, the
 * pause and win/fail flows with their exact English strings).
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CONTROL_ROWS, SCREEN_MODES, displayKey, type ControlSetting, type Settings } from '../game/settings.ts';
import { scoreCountStep } from '../game/score.ts';
import { defaultTable, useGameStore, type GamePhase } from '../game/store.ts';
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
      className={`og-button${medium ? ' og-button-medium' : ''}${disabled ? ' og-disabled' : ''}`}
      style={{ backgroundImage: `url(${img})` }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') activate();
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
        <MenuButton ogui={ogui} label="Exit" onClick={() => setConfirmExit(true)} />
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
export function HighscoreScreen({ backPhase = 'menu' }: { backPhase?: GamePhase }) {
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
        <MenuButton ogui={ogui} medium label="Back" onClick={() => set({ phase: backPhase })} />
      </div>
    </MenuBand>
  );
}

/** original Options: Graphics / Controls / Sound subscreens */
export function OptionsScreen({ backPhase = 'menu' }: { backPhase?: GamePhase }) {
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

  const yesNoRow = (label: string, value: boolean, apply: (v: boolean) => void) => (
    <div className="og-option-row">
      <img src={ogui.text(label, 22).url} alt="" draggable={false} />
      <div className="og-option-controls">
        <div
          role="button"
          aria-label={`${label}: ${value ? 'Yes' : 'No'}`}
          tabIndex={0}
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

  const keyRow = (setting: ControlSetting, action: string) => (
    <div
      role="button"
      aria-label={`${action}: ${listening === setting ? 'Press Key' : displayKey(settings[setting])}`}
      tabIndex={0}
      className={`og-key-row${listening === setting ? ' og-key-listening' : ''}`}
      style={barStyle(ogui)}
      onClick={() => {
        menuAudio.click();
        setListening(setting);
      }}
    >
      <img src={ogui.text(action, 18).url} alt="" draggable={false} />
      <img src={ogui.text(listening === setting ? 'Press Key' : displayKey(settings[setting]), 18).url} alt="" draggable={false} />
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
        <div className="og-stack og-options">
          <div className="og-option-row">
            <img src={ogui.text('Screen Resolution', 22).url} alt="" draggable={false} />
            <div className="og-option-controls">
              <div
                role="button"
                aria-label="Previous screen resolution"
                tabIndex={0}
                className="og-round"
                style={{ backgroundImage: `url(${ogui.piece.roundA})` }}
                onClick={() => {
                  menuAudio.click();
                  updateSettings({ screenMode: Math.max(0, settings.screenMode - 1) });
                }}
              />
              <div className="og-resolution" style={barStyle(ogui)}>
                <img
                  src={ogui.text(`${SCREEN_MODES[settings.screenMode].width}*${SCREEN_MODES[settings.screenMode].height}`, 18).url}
                  alt=""
                  draggable={false}
                />
              </div>
              <div
                role="button"
                aria-label="Next screen resolution"
                tabIndex={0}
                className="og-round"
                style={{ backgroundImage: `url(${ogui.piece.roundB})` }}
                onClick={() => {
                  menuAudio.click();
                  updateSettings({ screenMode: Math.min(SCREEN_MODES.length - 1, settings.screenMode + 1) });
                }}
              />
            </div>
          </div>
          {yesNoRow('Synch to Screen?', settings.syncToScreen, (value) => updateSettings({ syncToScreen: value }))}
          {yesNoRow('Clouds?', settings.clouds, (value) => updateSettings({ clouds: value }))}
        </div>
      )}
      {page === 'controls' && (
        <div className="og-score-list og-controls-list">
          {CONTROL_ROWS.map(({ setting, label }) => (
            <div key={setting}>{keyRow(setting, label)}</div>
          ))}
          {yesNoRow('Invert Rotation?', settings.invertCameraRotation, (value) =>
            updateSettings({ invertCameraRotation: value }),
          )}
        </div>
      )}
      {page === 'sound' && (
        <div className="og-stack og-options">
          <div className="og-option-row">
            <img src={ogui.text('Music Volume', 22).url} alt="" draggable={false} />
            <div className="og-option-controls">
              <div
                role="button"
                aria-label="Decrease music volume"
                tabIndex={0}
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
                role="button"
                aria-label="Increase music volume"
                tabIndex={0}
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
        <MenuButton ogui={ogui} label="Back" onClick={() => (page === 'root' ? set({ phase: backPhase }) : setPage('root'))} />
      </div>
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
    <MenuBand ogui={ogui} style={{ background: 'rgba(0, 0, 0, 0.3)' }}>
      <div className="og-confirm-question">
        <img src={ogui.text(question, 20).url} alt={question} draggable={false} />
      </div>
      <div className="og-stack og-stack-tight">
        <MenuButton ogui={ogui} label="OK" onClick={onConfirm} />
        <MenuButton ogui={ogui} label="Back" onClick={onCancel} />
      </div>
    </MenuBand>
  );
}

/** Menu_Credits_Strings from the original Menu.nmo. */
const CREDIT_BLOCKS = [
  ['Ballance', 'A Cyparade production\n\nAll rights reserved.\n Berlin 2004.'],
  ['for\nLISA MARIE', ''],
  ['Monamur Musikproduktion', 'Sound Design and Music'],
  ['Klaus Riech', 'Game Design\nProject Management\nArt Direction'],
  ['Mirco Nierenz', 'Lead Scripting\nSoftware Development'],
  ['Stephan Bludau', 'Technical Direction\nSoftware Development'],
  ['Britta Fahrenbruch', 'Lead Level Design\nGraphic Design'],
  ['Michael Herm', 'Sky Design\nGraphic Design'],
  ['Constantin Rahn', 'Interface Design'],
  ['Ulrich Weinberg', 'Producing'],
  ['Ruth Meiners', 'Lead Testing'],
  ['Level Design', 'Matthias Bauer\nBritta Fahrenbruch\nStanislav Funda\nMichael Herm\nJürgen Kisch\nJan Liebetrau\n Klaus Riech'],
  ['Testing', 'Dorothea Busche, Paul Cultus, Oliver Franzke, Robert Hoffman, Lars Krüger, Ruth Lemmen, Max "phAsEr" Ulbricht, Manni, Philipp, Beate Schulz and Mariano Spiegelberg.'],
  ['Translation', 'Annette Weinberg, Laura and Adrian Villalba-Weinberg, Giuseppe Littera, Virginie Delrieu-Meyer, Fabienne Chisloup, Klaus Riech, Tamara Lindner.'],
  ['Thanks to', 'Ralf Löwenhaupt (go Ralfi, go Ralfi)\nAndre Menzel\nLars Krüger\nConstantin Rahn\nVirtools support team\n\nspecial thanks to Panda!'],
  ['ATARI Europe', 'Jean Marcel Nicolaï\nHead of Operations'],
  ['Republishing Team', 'Rebecka Pernered\nRepublishing Director\n\nSébastien Chaudat\nRepublishing Team Leader\n\nDiane Delaye\nRepublishing Producer\n\nLudovic Bony\nLocalisation team Leader'],
  ['', 'Diane Delaye\nLocalisation Project Manager\n\nCaroline Fauchille\nPrinted Materials Team Leader\n\nSandrine Dubois\nPrinted Materials Project Manager\n\nVincent Hattenberger\nCopy Writer\n\nJenny Clark\nMAM Project Manager'],
  ['Quality Assurance Team', 'Lewis Glover\nQuality Director\n\nCarine Mawart\nQuality Control Project Manager\n\nLisa Charman\nCertification Project Manager'],
  ['', 'Pierre Marc Bissay\nProduct Planning Project Manager\n\nPhilippe Louvet\nEngineering Services Manager\n\nStéphane Entéric\nEngineering Services Expert\n\nEmeric Polin\nEngineering Services Expert'],
  ['Marketing', 'Martin Spiess\nEuropean Marketing Senior VP\n\nCyril Voiron\nEuropean Group Marketing Manager\n\nSarah Brind\nEuropean Product Manager'],
  ['Local Marketing', 'Spain\nDe La Pedraja Rodrigo\n\nGermany\nJens Hofmann\n\nUK\nBen Walker\n\nFrance\nLionel Arnaud\n\nBenelux\nSimone Goudsmit\n\nItaly\nGiorgia Jannelli'],
  ['Special Thanks', 'RelQ\nPrashanth "TheWizard" Kannan\nRohit "NTT" Agarwal\nGaurav "Mofo" Kudva\nGautam "Vieri" Kudva\nBabel/Absolute Quality\nJulien Amougou\nTake Off/Ace\nKBP\nSynthesis'],
] as const;

function wrapCredit(text: string, limit = 45): string[] {
  const output: string[] = [];
  for (const sourceLine of text.split('\n')) {
    if (sourceLine === '') {
      output.push('');
      continue;
    }
    let line = '';
    for (const word of sourceLine.split(' ')) {
      if (line !== '' && line.length + word.length + 1 > limit) {
        output.push(line);
        line = word;
      } else {
        line += `${line === '' ? '' : ' '}${word}`;
      }
    }
    output.push(line);
  }
  return output;
}

export function CreditsScreen() {
  const set = useGameStore((s) => s.set);
  const ogui = useOgui();
  if (!ogui) return null;
  return (
    <MenuBand ogui={ogui}>
      <div className="og-credits-viewport">
        <div className="og-credits-roll">
          {CREDIT_BLOCKS.map(([title, copy], blockIndex) => (
            <div className="og-credit-block" key={blockIndex}>
              {wrapCredit(title).map((line, lineIndex) =>
                line === '' ? (
                  <div className="og-credit-gap" key={`title-${lineIndex}`} />
                ) : (
                  <img className="og-credit-title" key={`title-${lineIndex}`} src={ogui.text(line, 20).url} alt={line} draggable={false} />
                ),
              )}
              {wrapCredit(copy).map((line, lineIndex) =>
                line === '' ? (
                  <div className="og-credit-gap" key={`copy-${lineIndex}`} />
                ) : (
                  <img className="og-credit-copy" key={`copy-${lineIndex}`} src={ogui.text(line, 14).url} alt={line} draggable={false} />
                ),
              )}
            </div>
          ))}
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
  const [confirm, setConfirm] = useState<'restart' | 'exit' | null>(null);
  const ogui = useOgui();
  if (!ogui) return null;
  if (confirm) {
    return (
      <ConfirmScreen
        ogui={ogui}
        question={confirm === 'restart' ? 'Do you want to restart the level?' : 'Do you want to exit the level?'}
        onConfirm={() => set({ phase: confirm === 'restart' ? 'loading' : 'menu', level })}
        onCancel={() => setConfirm(null)}
      />
    );
  }
  return (
    <MenuBand ogui={ogui} style={{ background: 'rgba(0, 0, 0, 0.25)' }}>
      <div className="og-stack og-pause-stack">
        <MenuButton ogui={ogui} label="Options" onClick={() => set({ phase: 'pauseOptions' })} />
        <MenuButton ogui={ogui} label="Restart Level" onClick={() => setConfirm('restart')} />
        <MenuButton ogui={ogui} label="Highscore" onClick={() => set({ phase: 'pauseHighscore' })} />
        <MenuButton ogui={ogui} label="Exit Level" onClick={() => setConfirm('exit')} />
        <MenuButton ogui={ogui} label="Back" onClick={() => set({ phase: 'playing' })} />
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
    const timer = setInterval(() => {
      current = Math.min(total, current + scoreCountStep(total - current));
      setShown(current);
      menuAudio.counter();
      if (current >= total) {
        clearInterval(timer);
        menuAudio.dong();
      }
    }, 1000 / 60);
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
