/** Keyboard state matching the original control scheme. */

import type { ControlBindings } from './settings.ts';

export interface InputState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  shift: boolean;
  space: boolean;
}

export class Input {
  readonly state: InputState = { forward: false, back: false, left: false, right: false, shift: false, space: false };
  private readonly bindings: () => ControlBindings;
  private readonly pressed = new Set<string>();

  constructor(bindings: () => ControlBindings) {
    this.bindings = bindings;
  }

  private readonly onKey = (down: boolean) => (e: KeyboardEvent) => {
    const eventCodes = new Set([e.code, e.key].filter(Boolean));
    if (down && !e.repeat) this.pressed.add(e.code || e.key);
    const keys = this.bindings();
    let handled = false;
    const setIf = (code: string, apply: (value: boolean) => void) => {
      if (!eventCodes.has(code)) return;
      apply(down);
      handled = true;
    };
    setIf(keys.keyForward, (value) => (this.state.forward = value));
    setIf(keys.keyBackward, (value) => (this.state.back = value));
    setIf(keys.keyLeft, (value) => (this.state.left = value));
    setIf(keys.keyRight, (value) => (this.state.right = value));
    setIf(keys.keyRotateCamera, (value) => (this.state.shift = value));
    setIf(keys.keyLiftCamera, (value) => (this.state.space = value));
    if (!handled) return;
    e.preventDefault();
  };

  private downHandler = this.onKey(true);
  private upHandler = this.onKey(false);

  attach(target: Window): void {
    target.addEventListener('keydown', this.downHandler);
    target.addEventListener('keyup', this.upHandler);
  }

  detach(target: Window): void {
    target.removeEventListener('keydown', this.downHandler);
    target.removeEventListener('keyup', this.upHandler);
    this.clear();
  }

  clear(): void {
    this.state.forward = false;
    this.state.back = false;
    this.state.left = false;
    this.state.right = false;
    this.state.shift = false;
    this.state.space = false;
    this.pressed.clear();
  }

  /** One-shot key-down edge used by authored tutorial/menu scripts. */
  consumePressed(code: string): boolean {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  consumeControlPressed(control: keyof ControlBindings): boolean {
    return this.consumePressed(this.bindings()[control]);
  }

  debugState(): { state: InputState; pressed: string[]; bindings: ControlBindings } {
    return { state: { ...this.state }, pressed: [...this.pressed], bindings: { ...this.bindings() } };
  }
}
