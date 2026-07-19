/** Original options exposed by DB_Options and Menu.nmo. */

export interface ControlBindings {
  keyForward: string;
  keyBackward: string;
  keyLeft: string;
  keyRight: string;
  keyRotateCamera: string;
  keyLiftCamera: string;
}

export interface Settings extends ControlBindings {
  musicVolume: number;
  /** Original "Synch to Screen?" toggle (off by default). */
  syncToScreen: boolean;
  /** Index into the original 4:3 screen-mode table. */
  screenMode: number;
  clouds: boolean;
  invertCameraRotation: boolean;
}

export interface ScreenMode {
  mode: number;
  width: number;
  height: number;
  bpp: number;
}

export interface SourceKeyEntry {
  /** Browser physical-key identifier corresponding to the Virtools scan code. */
  code: string;
  /** English column of Language.nmo/all_keys, including its authored casing. */
  label: string;
}

/**
 * Language.nmo/all_keys in Virtools scan-code order. DB_Options stores the
 * zero-based row index (for example 68 = Up and 39 = left Shift).
 */
export const SOURCE_KEYS: readonly SourceKeyEntry[] = [
  { code: 'Digit1', label: '1' },
  { code: 'Digit2', label: '2' },
  { code: 'Digit3', label: '3' },
  { code: 'Digit4', label: '4' },
  { code: 'Digit5', label: '5' },
  { code: 'Digit6', label: '6' },
  { code: 'Digit7', label: '7' },
  { code: 'Digit8', label: '8' },
  { code: 'Digit9', label: '9' },
  { code: 'Digit0', label: '0' },
  { code: 'Minus', label: 'ß' },
  { code: 'Equal', label: '´' },
  { code: 'Backspace', label: 'back' },
  { code: 'Tab', label: 'tab' },
  { code: 'KeyQ', label: 'Q' },
  { code: 'KeyW', label: 'W' },
  { code: 'KeyE', label: 'E' },
  { code: 'KeyR', label: 'R' },
  { code: 'KeyT', label: 'T' },
  { code: 'KeyY', label: 'Z' },
  { code: 'KeyU', label: 'U' },
  { code: 'KeyI', label: 'I' },
  { code: 'KeyO', label: 'O' },
  { code: 'KeyP', label: 'P' },
  { code: 'BracketLeft', label: 'ü' },
  { code: 'BracketRight', label: '+' },
  { code: 'ControlLeft', label: 'ctrl' },
  { code: 'KeyA', label: 'A' },
  { code: 'KeyS', label: 'S' },
  { code: 'KeyD', label: 'D' },
  { code: 'KeyF', label: 'F' },
  { code: 'KeyG', label: 'G' },
  { code: 'KeyH', label: 'H' },
  { code: 'KeyJ', label: 'J' },
  { code: 'KeyK', label: 'K' },
  { code: 'KeyL', label: 'L' },
  { code: 'Semicolon', label: 'ö' },
  { code: 'Quote', label: 'ä' },
  { code: 'Backquote', label: '^' },
  { code: 'ShiftLeft', label: 'Shift' },
  { code: 'Backslash', label: '#' },
  { code: 'KeyZ', label: 'Y' },
  { code: 'KeyX', label: 'X' },
  { code: 'KeyC', label: 'C' },
  { code: 'KeyV', label: 'V' },
  { code: 'KeyB', label: 'B' },
  { code: 'KeyN', label: 'N' },
  { code: 'KeyM', label: 'M' },
  { code: 'Comma', label: ',' },
  { code: 'Period', label: '.' },
  { code: 'Slash', label: '-' },
  { code: 'ShiftRight', label: 'right shift' },
  { code: 'AltLeft', label: 'alternate' },
  { code: 'Space', label: 'space' },
  { code: 'Numpad7', label: '7 (num)' },
  { code: 'Numpad8', label: '8  (num)' },
  { code: 'Numpad9', label: '9  (num)' },
  { code: 'NumpadSubtract', label: '-  (num)' },
  { code: 'Numpad4', label: '4  (num)' },
  { code: 'Numpad5', label: '5  (num)' },
  { code: 'Numpad6', label: '6  (num)' },
  { code: 'NumpadAdd', label: '+  (num)' },
  { code: 'Numpad1', label: '1  (num)' },
  { code: 'Numpad2', label: '2  (num)' },
  { code: 'Numpad3', label: '3 (num)' },
  { code: 'Numpad0', label: '0  (num)' },
  { code: 'NumpadDecimal', label: ',  (num)' },
  { code: 'IntlBackslash', label: '<' },
  { code: 'ArrowUp', label: 'Up' },
  { code: 'ArrowDown', label: 'Down' },
  { code: 'ArrowLeft', label: 'Left' },
  { code: 'ArrowRight', label: 'Right' },
];

const sourceKeyByCode = new Map(SOURCE_KEYS.map((entry, index) => [entry.code, { ...entry, index }]));

export function sourceKeyCode(code: string): number | null {
  return sourceKeyByCode.get(code)?.index ?? null;
}

export function isSourceKey(code: string): boolean {
  return sourceKeyByCode.has(code);
}

/** Dummy_ScreenModes from Menu.nmo, populated by the renderer at runtime. */
export const SCREEN_MODES: readonly ScreenMode[] = [
  { mode: 54, width: 640, height: 480, bpp: 16 },
  { mode: 64, width: 800, height: 600, bpp: 16 },
  { mode: 74, width: 1024, height: 768, bpp: 16 },
  { mode: 84, width: 1152, height: 864, bpp: 16 },
  { mode: 104, width: 1280, height: 960, bpp: 16 },
  { mode: 138, width: 1600, height: 1200, bpp: 16 },
];

/**
 * DB_Options defaults translated from Virtools key codes to KeyboardEvent
 * codes — EXCEPT movement: the shipped defaults are the four arrows
 * (rows 68..71), but this port deliberately ships WASD as its one approved
 * deviation from the original. All keys remain remappable through the
 * source 72-key whitelist.
 */
export const DEFAULT_SETTINGS: Readonly<Settings> = {
  musicVolume: 1,
  syncToScreen: false,
  screenMode: 0,
  keyForward: 'KeyW',
  keyBackward: 'KeyS',
  keyLeft: 'KeyA',
  keyRight: 'KeyD',
  keyRotateCamera: 'ShiftLeft',
  keyLiftCamera: 'Space',
  invertCameraRotation: false,
  clouds: true,
};

/** The unmodified shipped DB_Options movement defaults (the four arrows). */
export const SOURCE_DEFAULT_MOVEMENT_KEYS = {
  keyForward: 'ArrowUp',
  keyBackward: 'ArrowDown',
  keyLeft: 'ArrowLeft',
  keyRight: 'ArrowRight',
} as const;

export type ControlSetting = keyof ControlBindings;

export const CONTROL_ROWS: readonly { setting: ControlSetting; label: string }[] = [
  { setting: 'keyForward', label: 'Forward' },
  { setting: 'keyBackward', label: 'Backward' },
  { setting: 'keyLeft', label: 'Left' },
  { setting: 'keyRight', label: 'Right' },
  { setting: 'keyLiftCamera', label: 'Overview' },
  { setting: 'keyRotateCamera', label: 'Rotation' },
];

export function screenMode(settings: Pick<Settings, 'screenMode'>): ScreenMode {
  return SCREEN_MODES[settings.screenMode] ?? SCREEN_MODES[0];
}

export function displayKey(code: string): string {
  const source = sourceKeyByCode.get(code);
  if (source) return source.label;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}
