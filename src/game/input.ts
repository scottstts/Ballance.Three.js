/** Keyboard state matching the original control scheme. */

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
  private readonly onKey = (down: boolean) => (e: KeyboardEvent) => {
    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        this.state.forward = down;
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.state.back = down;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        this.state.left = down;
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.state.right = down;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.state.shift = down;
        break;
      case 'Space':
        this.state.space = down;
        break;
      default:
        return;
    }
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
  }
}
