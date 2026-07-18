import * as THREE from 'three';
import { evalCurve, type CurveKey } from './curve.ts';

/** Values serialized by Gameplay.nmo/Gameplay_Blitz and Light_Blitz. */
export const BLITZ_SOURCE = {
  initialDelay: 4,
  intervalMin: 10,
  intervalMax: 90,
  flashDuration: 0.2,
  thunderDelay: 0.15,
  position: [9.333419799804688, 14.812118530273438, -11.487898826599121] as const,
  direction: [-0.516514003276825, -0.7208626866340637, 0.46206220984458923] as const,
  range: 200,
  power: 1,
  colorCurve: [
    [0, 0, 3.505940645847021],
    [0.13503649830818176, 0.47342994809150696, 1.945395897343048],
    [0.24087591469287872, 0.46859902143478394, -2.64734303067272],
    [0.31386861205101013, 0, -2.3344752283517844],
    [0.4416058361530304, 0, 4.111403588489334],
    [0.55474454164505, 0.990338146686554, 2.3220339428489045],
    [0.8722627758979797, 1, -2.224202139449156],
    [1, 0, -7.828571461832947],
  ] satisfies CurveKey[],
} as const;

export interface BlitzDebugState {
  color: number;
  flashElapsed: number | null;
  nextFlash: number;
  thunderRemaining: number | null;
  visible: boolean;
}

/**
 * Gameplay_Blitz's independent ambient-light timer.
 *
 * The source starts with a four-second Delayer, then samples a new 10..90 s
 * Timer duration at every flash. Its light-color progression and the delayed
 * Donner message run concurrently while that next timer is already counting.
 */
export class BlitzSystem {
  readonly light = new THREE.DirectionalLight(0xffffff, BLITZ_SOURCE.power);
  private flashElapsed: number | null = null;
  private nextFlash: number = BLITZ_SOURCE.initialDelay;
  private readonly playThunder: () => void;
  private readonly random: () => number;
  private thunderRemaining: number | null = null;

  constructor(
    scene: THREE.Scene,
    playThunder: () => void,
    random: () => number = Math.random,
  ) {
    this.playThunder = playThunder;
    this.random = random;
    this.light.name = 'Light_Blitz';
    this.light.position.fromArray(BLITZ_SOURCE.position);
    this.light.target.position.copy(this.light.position).add(new THREE.Vector3().fromArray(BLITZ_SOURCE.direction));
    this.light.visible = false;
    scene.add(this.light, this.light.target);
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    let remaining = dt;

    // Consume exact event boundaries so deterministic/debug steps larger than
    // one behavior frame retain the source's relative flash/thunder timing.
    while (remaining > 1e-9) {
      const flashEnd = this.flashElapsed === null ? Infinity : BLITZ_SOURCE.flashDuration - this.flashElapsed;
      const thunder = this.thunderRemaining ?? Infinity;
      const step = Math.min(remaining, this.nextFlash, flashEnd, thunder);

      if (step > 0) {
        this.nextFlash -= step;
        if (this.flashElapsed !== null) this.flashElapsed += step;
        if (this.thunderRemaining !== null) this.thunderRemaining -= step;
        remaining -= step;
        this.applyColor();
      }

      let handled = false;
      if (this.nextFlash <= 1e-9) {
        this.startFlash();
        handled = true;
      }
      if (this.thunderRemaining !== null && this.thunderRemaining <= 1e-9) {
        this.thunderRemaining = null;
        this.playThunder();
        handled = true;
      }
      if (this.flashElapsed !== null && this.flashElapsed >= BLITZ_SOURCE.flashDuration - 1e-9) {
        this.flashElapsed = null;
        this.light.color.setRGB(0, 0, 0);
        this.light.visible = false;
        handled = true;
      }
      if (!handled && step <= 0) break;
    }
  }

  debugState(): BlitzDebugState {
    return {
      color: this.light.color.r,
      flashElapsed: this.flashElapsed,
      nextFlash: this.nextFlash,
      thunderRemaining: this.thunderRemaining,
      visible: this.light.visible,
    };
  }

  dispose(): void {
    this.light.removeFromParent();
    this.light.target.removeFromParent();
  }

  private startFlash(): void {
    const sample = THREE.MathUtils.clamp(this.random(), 0, 1);
    this.nextFlash = THREE.MathUtils.lerp(BLITZ_SOURCE.intervalMin, BLITZ_SOURCE.intervalMax, sample);
    this.flashElapsed = 0;
    this.thunderRemaining = BLITZ_SOURCE.thunderDelay;
    this.light.color.setRGB(0, 0, 0);
    this.light.visible = true;
  }

  private applyColor(): void {
    if (this.flashElapsed === null) return;
    const progression = this.flashElapsed / BLITZ_SOURCE.flashDuration;
    const value = evalCurve(BLITZ_SOURCE.colorCurve, progression);
    this.light.color.setRGB(value, value, value);
  }
}
