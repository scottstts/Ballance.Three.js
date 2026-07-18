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

/** Dummy_ScreenModes from Menu.nmo, populated by the renderer at runtime. */
export const SCREEN_MODES: readonly ScreenMode[] = [
  { mode: 54, width: 640, height: 480, bpp: 16 },
  { mode: 64, width: 800, height: 600, bpp: 16 },
  { mode: 74, width: 1024, height: 768, bpp: 16 },
  { mode: 84, width: 1152, height: 864, bpp: 16 },
  { mode: 104, width: 1280, height: 960, bpp: 16 },
  { mode: 138, width: 1600, height: 1200, bpp: 16 },
];

/** DB_Options defaults translated from Virtools key codes to KeyboardEvent.code. */
export const DEFAULT_SETTINGS: Readonly<Settings> = {
  musicVolume: 1,
  syncToScreen: false,
  screenMode: 0,
  keyForward: 'ArrowUp',
  keyBackward: 'ArrowDown',
  keyLeft: 'ArrowLeft',
  keyRight: 'ArrowRight',
  keyRotateCamera: 'ShiftLeft',
  keyLiftCamera: 'Space',
  invertCameraRotation: false,
  clouds: true,
};

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
  const known: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    Space: 'Space',
  };
  if (known[code]) return known[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}
