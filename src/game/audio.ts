/**
 * Audio: original WAVs via Web Audio. Impact and rolling sounds follow the
 * original per-surface collision model (thresholds, delays, speed curves as
 * in the original's IVP collision/contact detectors); music plays the
 * level's theme variations with pauses.
 */
import * as THREE from 'three';
import { fetchGameBuffer } from '../engine/assets.ts';
import type { BallKind } from './constants.ts';
import { evalCurve } from './curve.ts';

export type Surface = 'stone' | 'wood' | 'metal' | 'dome';

const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

function hitFile(ball: BallKind, surface: Surface): string {
  if (ball === 'paper') return 'Hit_Paper.wav';
  if (surface === 'dome') return ball === 'stone' ? 'Hit_Stone_Kuppel.wav' : 'Hit_Wood_Dome.wav';
  return `Hit_${cap(ball)}_${cap(surface)}.wav`;
}

function rollFile(ball: BallKind, surface: Surface): string {
  if (ball === 'paper') return 'Roll_Paper.wav';
  return `Roll_${cap(ball)}_${cap(surface)}.wav`;
}

// original collision layer config: hits play between speed 5 and 30 (the
// dome caps at 15), then the layer sleeps 0.6s; rolling contact needs 0.5s
// on / 0.5s off to switch
const HIT_MIN_SPEED = 5;
const HIT_MAX_SPEED = 30;
const HIT_MAX_SPEED_DOME = 15;
const HIT_SLEEP = 0.6;
const ROLL_DELAY_END = 0.5;
const rollDelayStart = (ball: BallKind): number => (ball === 'paper' ? 0.8 : 0.5);

/** original roll volume curve, x = speed / per-ball reference speed */
const ROLL_VOLUME_KEYS: [number, number, number][] = [
  [0, 0, 3.1866],
  [0.0636, 0.1375, 0.8179],
  [0.4165, 0.41, 1.1629],
  [0.9, 0.8, 0.4121],
  [2, 1, 0],
];
const ROLL_SPEED_REF: Record<BallKind, number> = { wood: 9, paper: 12, stone: 15 };
const ROLL_PITCH_BASE = 0.6;
const ROLL_PITCH_FACTOR = 0.03;

const SURFACES: Surface[] = ['stone', 'wood', 'metal'];

interface RollContactState {
  touching: boolean;
  since: number;
  active: boolean;
}

/** per-level music theme (original assignment) */
export const LEVEL_THEMES: Record<number, number> = {
  1: 1, 2: 5, 3: 2, 4: 3, 5: 1, 6: 5, 7: 4, 8: 2, 9: 3, 10: 1, 11: 3, 12: 4,
};

export class AudioManager {
  readonly listener: THREE.AudioListener;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  /** always-playing roll loops keyed `${ball}:${surface}`, modulated only */
  private rollLoops = new Map<string, THREE.Audio>();
  private rollContacts = new Map<Surface, RollContactState>();
  private hitSleep = new Map<Surface, number>();
  private musicGain: GainNode | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private musicTimer: ReturnType<typeof setTimeout> | null = null;
  private musicMutedUntil = 0;
  private disposed = false;
  sfxVolume = 1;
  musicVolume = 1;

  constructor(camera: THREE.Camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    // browsers gate audio behind a user gesture
    const resume = () => {
      const ctx = this.listener.context;
      if (ctx.state === 'suspended') void ctx.resume();
    };
    window.addEventListener('keydown', resume);
    window.addEventListener('pointerdown', resume);
  }

  private load(name: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(name);
    if (!p) {
      p = fetchGameBuffer(`Sounds/${name}`)
        .then((buf) => this.listener.context.decodeAudioData(buf.slice(0)))
        .catch(() => null);
      this.buffers.set(name, p);
    }
    return p;
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = volume;
    if (this.musicGain) this.musicGain.gain.value = volume;
  }

  /** looping positional effect bound to an object (fans etc.) */
  createLoop(name: string, target: THREE.Object3D, volume = 1): { setActive(on: boolean): void; dispose(): void } {
    let audio: THREE.PositionalAudio | null = null;
    let wanted = false;
    void this.load(name).then((buffer) => {
      if (!buffer || this.disposed) return;
      audio = new THREE.PositionalAudio(this.listener);
      audio.setBuffer(buffer);
      audio.setLoop(true);
      audio.setRefDistance(25);
      audio.setVolume(volume * this.sfxVolume);
      target.add(audio);
      if (wanted) audio.play();
    });
    return {
      setActive: (on: boolean) => {
        wanted = on;
        if (!audio) return;
        if (on && !audio.isPlaying) audio.play();
        else if (!on && audio.isPlaying) audio.stop();
      },
      dispose: () => {
        if (audio?.isPlaying) audio.stop();
        audio?.removeFromParent();
      },
    };
  }

  /** one-shot positional effect */
  play(name: string, position: THREE.Vector3, volume = 1, parent?: THREE.Object3D): void {
    void this.load(name).then((buffer) => {
      if (!buffer || this.disposed) return;
      const audio = new THREE.PositionalAudio(this.listener);
      audio.setBuffer(buffer);
      audio.setRefDistance(30);
      audio.setVolume(volume * this.sfxVolume);
      audio.position.copy(position);
      const holder = parent ?? this.listener.parent;
      holder?.add(audio);
      audio.play();
      audio.source?.addEventListener('ended', () => {
        audio.removeFromParent();
      });
    });
  }

  /**
   * Ball impact on a surface. `impactSpeed` is the contact-normal approach
   * speed; below the original threshold (5) nothing plays, and each surface
   * sleeps 0.6s after a hit, exactly like the original collision detector.
   */
  hit(ball: BallKind, surface: Surface, impactSpeed: number): void {
    if (impactSpeed < HIT_MIN_SPEED) return;
    if ((this.hitSleep.get(surface) ?? 0) > 0) return;
    this.hitSleep.set(surface, HIT_SLEEP);
    const max = surface === 'dome' ? HIT_MAX_SPEED_DOME : HIT_MAX_SPEED;
    const vol = THREE.MathUtils.clamp((impactSpeed - HIT_MIN_SPEED) / (max - HIT_MIN_SPEED), 0, 1);
    // ball sounds are flat (non-positional), as in the original
    this.playFlat(hitFile(ball, surface), vol);
  }

  /** flat (non-positional) one-shot */
  playFlat(name: string, volume = 1): void {
    void this.load(name).then((buffer) => {
      if (!buffer || this.disposed) return;
      const audio = new THREE.Audio(this.listener);
      audio.setBuffer(buffer);
      audio.setVolume(volume * this.sfxVolume);
      audio.play();
      audio.source?.addEventListener('ended', () => audio.disconnect());
    });
  }

  private ensureRollLoop(ball: BallKind, surface: Surface): THREE.Audio | null {
    const key = `${ball}:${surface}`;
    const existing = this.rollLoops.get(key);
    if (existing) return existing;
    const audio = new THREE.Audio(this.listener);
    audio.setLoop(true);
    audio.setVolume(0);
    this.rollLoops.set(key, audio);
    void this.load(rollFile(ball, surface)).then((buffer) => {
      if (!buffer || this.disposed) return;
      audio.setBuffer(buffer);
      audio.play();
    });
    return audio;
  }

  /**
   * Continuous rolling, following the original contact detector: a surface
   * only becomes audible after 0.5s of sustained contact (0.8s for paper)
   * and only goes silent after 0.5s without contact, so momentary bounces
   * (rails!) never restart the loop. The loops themselves play forever and
   * are only volume/pitch modulated.
   */
  updateRoll(ball: BallKind, touching: ReadonlySet<Surface>, speed: number, dt: number): void {
    for (const [k, v] of this.hitSleep) {
      if (v > 0) this.hitSleep.set(k, v - dt);
    }
    const vol = Math.min(1, evalCurve(ROLL_VOLUME_KEYS, speed / ROLL_SPEED_REF[ball]));
    const pitch = Math.min(1, ROLL_PITCH_BASE + speed * ROLL_PITCH_FACTOR);
    for (const surface of SURFACES) {
      let st = this.rollContacts.get(surface);
      if (!st) {
        st = { touching: false, since: 0, active: false };
        this.rollContacts.set(surface, st);
      }
      const now = touching.has(surface);
      if (now !== st.touching) {
        st.touching = now;
        st.since = 0;
      } else {
        st.since += dt;
      }
      if (now && !st.active && st.since >= rollDelayStart(ball)) st.active = true;
      else if (!now && st.active && st.since >= ROLL_DELAY_END) st.active = false;

      const loop = this.ensureRollLoop(ball, surface);
      if (loop) {
        loop.setVolume(st.active ? vol * this.sfxVolume : 0);
        if (st.active) loop.setPlaybackRate(pitch);
      }
    }
    // a trafo swaps the ball: silence the other balls' loops
    for (const [key, loop] of this.rollLoops) {
      if (!key.startsWith(`${ball}:`)) loop.setVolume(0);
    }
  }

  /**
   * Music scheduler, following the original: theme tracks and atmo tracks
   * alternate on 10-30s intervals — after each track there is a 20-30s lull
   * (10-20s for atmos), ~70% of slots play an atmo (at half-to-full volume),
   * and the same theme variation never repeats back to back.
   */
  startMusic(level: number): void {
    this.stopMusic();
    const theme = LEVEL_THEMES[level] ?? 1;
    const ctx = this.listener.context;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.musicGain.connect(ctx.destination);
    let lastVariation = 0;
    const playNext = () => {
      if (this.disposed || !this.musicGain) return;
      if (performance.now() < this.musicMutedUntil) {
        this.musicTimer = setTimeout(playNext, 5000);
        return;
      }
      const isAtmo = Math.random() > 0.3;
      let file: string;
      let gain = 1;
      if (isAtmo) {
        file = `Music_Atmo_${1 + Math.floor(Math.random() * 3)}.wav`;
        gain = 0.5 + Math.random() * 0.5;
      } else {
        let variation = 1 + Math.floor(Math.random() * 3);
        if (variation === lastVariation) variation = (variation % 3) + 1;
        lastVariation = variation;
        file = `Music_Theme_${theme}_${variation}.wav`;
      }
      void this.load(file).then((buffer) => {
        if (!buffer || this.disposed || !this.musicGain) return;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const g = ctx.createGain();
        g.gain.value = gain;
        src.connect(g);
        g.connect(this.musicGain);
        src.start();
        this.musicSource = src;
        src.onended = () => {
          this.musicSource = null;
          const gap = isAtmo ? 10000 + Math.random() * 10000 : 20000 + Math.random() * 10000;
          this.musicTimer = setTimeout(playNext, gap);
        };
      });
    };
    playNext();
  }

  /** keep the scheduler quiet for a while (final-sector balloon ambient) */
  muteMusicFor(seconds: number): void {
    this.musicMutedUntil = performance.now() + seconds * 1000;
    try {
      this.musicSource?.stop();
    } catch {
      /* already stopped */
    }
    this.musicSource = null;
  }

  stopMusic(): void {
    if (this.musicTimer) clearTimeout(this.musicTimer);
    this.musicTimer = null;
    try {
      this.musicSource?.stop();
    } catch {
      /* already stopped */
    }
    this.musicSource = null;
    this.musicGain?.disconnect();
    this.musicGain = null;
  }

  /** dev/testing: current roll contact states and loop volumes */
  debugState(): Record<string, unknown> {
    const contacts: Record<string, unknown> = {};
    for (const [s, st] of this.rollContacts) {
      contacts[s] = { touching: st.touching, active: st.active, since: Number(st.since.toFixed(2)) };
    }
    const loops: Record<string, number> = {};
    for (const [k, loop] of this.rollLoops) loops[k] = Number(loop.getVolume().toFixed(3));
    return { contacts, loops };
  }

  dispose(): void {
    this.disposed = true;
    this.stopMusic();
    for (const loop of this.rollLoops.values()) {
      if (loop.isPlaying) loop.stop();
      loop.disconnect();
    }
    this.rollLoops.clear();
  }
}
