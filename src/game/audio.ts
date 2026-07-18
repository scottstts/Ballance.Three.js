/**
 * Audio: original WAVs via Web Audio. Impact and rolling sounds follow the
 * original per-surface collision model (thresholds, delays, speed curves as
 * in the original's IVP collision/contact detectors). Music reproduces the
 * two independent Sound.nmo schedulers and its final-sector state machine.
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

/** Exact values serialized by Sound.nmo/Music_Manager. Seconds unless noted. */
export const MUSIC_SOURCE = {
  atmoDelayMin: 0,
  atmoDelayMax: 15,
  themeActivationDelay: 7,
  themeDelayMin: 0,
  themeDelayMax: 50,
  fadeDuration: 1,
  lastStageEnterDistance: 200,
  lastStageExitDistance: 250,
  lastStageMinFrameDelay: 5,
  lastStageMaxFrameDelay: 20,
} as const;

export type MusicVariation = 1 | 2 | 3;

/** Sound.nmo Random Switch: three equal coefficients, repeats permitted. */
export function musicVariation(random: number): MusicVariation {
  return (Math.min(2, Math.floor(THREE.MathUtils.clamp(random, 0, 0.999999999) * 3)) + 1) as MusicVariation;
}

/** Play EndMusic selects one mutually-exclusive wave by CurrentLevel==maxLevel. */
export function levelFinalMusic(level: number): 'Music_Final.wav' | 'Music_LastFinal.wav' {
  return level === 12 ? 'Music_LastFinal.wav' : 'Music_Final.wav';
}

/** TT Scaleable Proximity chooses an inclusive integer frame delay. */
export function lastStageFrameDelay(random: number): number {
  const span = MUSIC_SOURCE.lastStageMaxFrameDelay - MUSIC_SOURCE.lastStageMinFrameDelay + 1;
  return MUSIC_SOURCE.lastStageMinFrameDelay + Math.min(span - 1, Math.floor(THREE.MathUtils.clamp(random, 0, 1) * span));
}

type MusicChannel = 'atmo' | 'theme';

export class AudioManager {
  readonly listener: THREE.AudioListener;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  /** always-playing roll loops keyed `${ball}:${surface}`, modulated only */
  private rollLoops = new Map<string, THREE.Audio>();
  private rollContacts = new Map<Surface, RollContactState>();
  private hitSleep = new Map<Surface, number>();
  private musicGain: GainNode | null = null;
  private atmoSource: AudioBufferSourceNode | null = null;
  private themeSource: AudioBufferSourceNode | null = null;
  private finalSource: AudioBufferSourceNode | null = null;
  private lastStageSource: AudioBufferSourceNode | null = null;
  private atmoTimer: ReturnType<typeof setTimeout> | null = null;
  private themeTimer: ReturnType<typeof setTimeout> | null = null;
  private themeActivationTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeStopTimer: ReturnType<typeof setTimeout> | null = null;
  private musicGeneration = 0;
  private musicActive = false;
  private themeActive = false;
  private musicFadingOut = false;
  private theme = 1;
  private lastStage = false;
  private lastStageNear = false;
  private lastStageCheckFrames = 0;
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
    if (this.musicGain && !this.musicFadingOut) {
      const now = this.listener.context.currentTime;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setValueAtTime(volume, now);
    }
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
   * Start Sound.nmo's two independent schedulers. Atmospheres wait a fresh
   * uniform 0..15 s before every play. The theme graph is enabled after 7 s,
   * then independently waits 0..50 s. Both selectors are equal-weight and
   * explicitly allow the same variation twice in succession.
   */
  startMusic(level: number): void {
    this.stopMusic();
    if (this.disposed) return;
    this.musicActive = true;
    this.themeActive = false;
    this.musicFadingOut = false;
    this.theme = LEVEL_THEMES[level] ?? 1;
    const generation = this.musicGeneration;
    const ctx = this.listener.context;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.setValueAtTime(0, ctx.currentTime);
    this.musicGain.gain.linearRampToValueAtTime(this.musicVolume, ctx.currentTime + MUSIC_SOURCE.fadeDuration);
    this.musicGain.connect(ctx.destination);
    this.scheduleMusic('atmo', generation);
    this.themeActivationTimer = setTimeout(() => {
      this.themeActivationTimer = null;
      if (!this.musicActive || generation !== this.musicGeneration) return;
      this.themeActive = true;
      this.scheduleMusic('theme', generation);
    }, MUSIC_SOURCE.themeActivationDelay * 1000);

    // Virtools has already loaded these CKWaveSound objects before the graph
    // starts. Begin browser decoding eagerly so a zero-delay draw stays close.
    for (let variation = 1; variation <= 3; variation++) {
      void this.load(`Music_Atmo_${variation}.wav`);
      void this.load(`Music_Theme_${this.theme}_${variation}.wav`);
    }
  }

  private scheduleMusic(channel: MusicChannel, generation: number): void {
    if (!this.musicActive || generation !== this.musicGeneration) return;
    if (channel === 'theme' && !this.themeActive) return;
    const min = channel === 'atmo' ? MUSIC_SOURCE.atmoDelayMin : MUSIC_SOURCE.themeDelayMin;
    const max = channel === 'atmo' ? MUSIC_SOURCE.atmoDelayMax : MUSIC_SOURCE.themeDelayMax;
    const timer = setTimeout(() => {
      if (channel === 'atmo') this.atmoTimer = null;
      else this.themeTimer = null;
      if (!this.musicActive || generation !== this.musicGeneration) return;
      if (channel === 'theme' && !this.themeActive) return;
      const variation = musicVariation(Math.random());
      const file = channel === 'atmo'
        ? `Music_Atmo_${variation}.wav`
        : `Music_Theme_${this.theme}_${variation}.wav`;
      this.playScheduledMusic(channel, file, generation);
    }, (min + Math.random() * (max - min)) * 1000);
    if (channel === 'atmo') this.atmoTimer = timer;
    else this.themeTimer = timer;
  }

  private playScheduledMusic(channel: MusicChannel, file: string, generation: number): void {
    void this.load(file).then((buffer) => {
      if (!buffer || !this.musicGain || !this.musicActive || generation !== this.musicGeneration) {
        this.scheduleMusic(channel, generation);
        return;
      }
      if (channel === 'theme' && !this.themeActive) return;
      const source = this.listener.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.musicGain);
      if (channel === 'atmo') this.atmoSource = source;
      else this.themeSource = source;
      source.onended = () => {
        if (channel === 'atmo' && this.atmoSource === source) this.atmoSource = null;
        if (channel === 'theme' && this.themeSource === source) this.themeSource = null;
        this.scheduleMusic(channel, generation);
      };
      source.start();
    });
  }

  /** Last Checkpoint: stop only the theme graph and begin the flat loop. */
  enterLastStage(): void {
    this.lastStage = true;
    this.themeActive = false;
    this.clearTimer('themeTimer');
    this.stopSource('themeSource');
    this.lastStageNear = true;
    this.lastStageCheckFrames = lastStageFrameDelay(Math.random());
    this.setLastStageLoop(true);
  }

  /** Apply TT Scaleable Proximity's exact 200/250-unit hysteresis. */
  updateLastStageDistance(distance: number): void {
    if (!this.lastStage) return;
    this.lastStageCheckFrames--;
    if (this.lastStageCheckFrames > 0) return;
    this.lastStageCheckFrames = lastStageFrameDelay(Math.random());
    if (this.lastStageNear && distance > MUSIC_SOURCE.lastStageExitDistance) {
      this.lastStageNear = false;
      this.setLastStageLoop(false);
    } else if (!this.lastStageNear && distance < MUSIC_SOURCE.lastStageEnterDistance) {
      this.lastStageNear = true;
      this.setLastStageLoop(true);
    }
  }

  private setLastStageLoop(on: boolean): void {
    if (!on) {
      this.stopSource('lastStageSource');
      return;
    }
    if (this.lastStageSource || !this.musicGain || !this.musicActive) return;
    const generation = this.musicGeneration;
    void this.load('Music_EndCheckpoint.wav').then((buffer) => {
      if (
        !buffer ||
        !this.musicGain ||
        !this.musicActive ||
        !this.lastStage ||
        !this.lastStageNear ||
        generation !== this.musicGeneration
      ) return;
      const source = this.listener.context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(this.musicGain);
      this.lastStageSource = source;
      source.start();
    });
  }

  stopLastStageAmbient(): void {
    this.lastStageNear = false;
    this.stopSource('lastStageSource');
  }

  /** Level_Finish: play exactly one source-selected end wave. */
  playLevelFinal(level: number): void {
    this.stopSource('finalSource');
    const generation = this.musicGeneration;
    void this.load(levelFinalMusic(level)).then((buffer) => {
      if (!buffer || !this.musicGain || generation !== this.musicGeneration) return;
      const source = this.listener.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.musicGain);
      this.finalSource = source;
      source.onended = () => {
        if (this.finalSource === source) this.finalSource = null;
      };
      source.start();
    });
  }

  /** End Music message: source-authored one-second group fade. */
  endMusic(): void {
    if (!this.musicGain) return;
    this.musicActive = false;
    this.themeActive = false;
    this.musicFadingOut = true;
    this.clearTimer('atmoTimer');
    this.clearTimer('themeTimer');
    this.clearTimer('themeActivationTimer');
    const now = this.listener.context.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
    this.musicGain.gain.linearRampToValueAtTime(0, now + MUSIC_SOURCE.fadeDuration);
    this.fadeStopTimer = setTimeout(() => {
      this.fadeStopTimer = null;
      this.stopMusic();
    }, MUSIC_SOURCE.fadeDuration * 1000);
  }

  private clearTimer(field: 'atmoTimer' | 'themeTimer' | 'themeActivationTimer' | 'fadeStopTimer'): void {
    const timer = this[field];
    if (timer) clearTimeout(timer);
    this[field] = null;
  }

  private stopSource(field: 'atmoSource' | 'themeSource' | 'finalSource' | 'lastStageSource'): void {
    const source = this[field];
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
    source.disconnect();
    this[field] = null;
  }

  /** Immediate graph teardown (level disposal), unlike End Music's fade. */
  stopMusic(): void {
    this.musicGeneration++;
    this.musicActive = false;
    this.themeActive = false;
    this.musicFadingOut = false;
    this.lastStage = false;
    this.lastStageNear = false;
    this.lastStageCheckFrames = 0;
    this.clearTimer('atmoTimer');
    this.clearTimer('themeTimer');
    this.clearTimer('themeActivationTimer');
    this.clearTimer('fadeStopTimer');
    this.stopSource('atmoSource');
    this.stopSource('themeSource');
    this.stopSource('finalSource');
    this.stopSource('lastStageSource');
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
    return {
      contacts,
      loops,
      music: {
        active: this.musicActive,
        atmoPlaying: this.atmoSource !== null,
        themeActive: this.themeActive,
        themePlaying: this.themeSource !== null,
        theme: this.theme,
        lastStage: this.lastStage,
        lastStageNear: this.lastStageNear,
        lastStageCheckFrames: this.lastStageCheckFrames,
        lastStagePlaying: this.lastStageSource !== null,
        finalPlaying: this.finalSource !== null,
      },
    };
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
