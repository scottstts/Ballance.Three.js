/**
 * Audio: original WAVs via Web Audio. Impact and rolling sounds follow the
 * original per-surface collision model (thresholds, delays, speed curves as
 * in the original's IVP collision/contact detectors). Music reproduces the
 * two independent Sound.nmo schedulers and its final-sector state machine.
 */
import * as THREE from 'three';
import { fetchGameBuffer } from '../engine/assets.ts';
import { SIM_DT, type BallKind } from './constants.ts';
import { ScaleableProximity } from './proximity.ts';

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

/** Exact PhysicsCollDetection inputs serialized by Sound.nmo/Hit Sounds. */
export const COLLISION_SOUND_SOURCE: Record<Surface, Readonly<{
  collisionId: number;
  minSpeed: number;
  maxSpeed: number;
  sleep: number;
}>> = {
  stone: { collisionId: 1, minSpeed: 2, maxSpeed: 30, sleep: 1 },
  wood: { collisionId: 2, minSpeed: 2, maxSpeed: 14, sleep: 1 },
  metal: { collisionId: 3, minSpeed: 2, maxSpeed: 14, sleep: 2 },
  dome: { collisionId: 4, minSpeed: 1, maxSpeed: 15, sleep: 1 },
};

/** Exact Sound.nmo/MultiRollSoundControl and contact-detector inputs. */
export const ROLL_SOUND_SOURCE = {
  volumeFactor: 0.05000000074505806,
  pitchBase: 0.5,
  pitchFactor: 0.01,
  contactDelayStart: 0.30000001192092896,
  contactDelayEnd: 0.30000001192092896,
  contactOutputs: 3,
} as const;

/** Exact Sound.nmo/HitSound Woodenflaps detector inputs. */
export const WOODEN_FLAP_SOUND_SOURCE = {
  minSpeed: 0.30000001192092896,
  maxSpeed: 10,
  sleep: 0.5,
} as const;

/** physics_RT.dll emits speed/max after the strict minimum-speed gate. */
export function collisionSpeedVolume(speed: number, maxSpeed: number): number {
  if (speed <= 0.0001) return 0.0001;
  if (maxSpeed < 0.0001 || speed / maxSpeed > 1) return 1;
  return speed / maxSpeed;
}

/** TT_Toolbox_RT.dll's TT_LinearVolume conversion used by wooden flaps. */
export function linearVolume(normalized: number): number {
  if (normalized > 1) return 1;
  if (normalized <= 0.01) return 0;
  return 0.02 * Math.pow(50, normalized);
}

/** TT ProximityVolumeControl's full-near, silent-far linear gain. */
export function proximityVolume(distance: number, near: number, far: number): number {
  if (distance <= near) return 1;
  if (distance >= far) return 0;
  return (far - distance) / (far - near);
}

export function rollVolume(speed: number): number {
  return Math.min(1, Math.max(0, speed) * ROLL_SOUND_SOURCE.volumeFactor);
}

export function rollPitch(speed: number): number {
  return ROLL_SOUND_SOURCE.pitchBase + Math.max(0, speed) * ROLL_SOUND_SOURCE.pitchFactor;
}

const SURFACES: Surface[] = ['stone', 'wood', 'metal'];

interface RollContactState {
  touching: boolean;
  since: number;
  active: boolean;
}

interface DistanceLoopState {
  audio: THREE.Audio | null;
  target: THREE.Object3D;
  wanted: boolean;
  disposed: boolean;
  volume: number;
  distance: number;
  near: number;
  far: number;
  playbackRate: number;
}

export interface DistanceLoopHandle {
  setActive(on: boolean): void;
  setDistance(distance: number): void;
  setDistanceRange(near: number, far: number): void;
  setPlaybackRate(rate: number): void;
  dispose(): void;
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
  lastStageDistance: 200,
  lastStageExactnessMinDistance: 200,
  lastStageExactnessMaxDistance: 250,
  lastStageMinFrameDelay: 5,
  lastStageMaxFrameDelay: 20,
  lastStageInitialFrameDelay: 2,
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

type MusicChannel = 'atmo' | 'theme';

export class AudioManager {
  readonly listener: THREE.AudioListener;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  /** Reusable direct Wave Player instances, keyed by the CKWaveSound name. */
  private restartPlayers = new Map<string, THREE.Audio>();
  private restartGenerations = new Map<string, number>();
  /** Flat loops whose gain is driven by TT ProximityVolumeControl. */
  private distanceLoops = new Set<DistanceLoopState>();
  /** always-playing roll loops keyed `${ball}:${surface}`, modulated only */
  private rollLoops = new Map<string, THREE.Audio>();
  private rollContacts = new Map<Surface, RollContactState>();
  private hitSleep = new Map<Surface, number>();
  private woodenFlapSleep = new Map<number, number>();
  private ballSoundsActive = false;
  private musicGain: GainNode | null = null;
  private atmoSource: AudioBufferSourceNode | null = null;
  private themeSource: AudioBufferSourceNode | null = null;
  private finalSource: AudioBufferSourceNode | null = null;
  private finalCueGeneration = 0;
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
  private readonly lastStageProximity = new ScaleableProximity({
    distance: MUSIC_SOURCE.lastStageDistance,
    exactnessMinDistance: MUSIC_SOURCE.lastStageExactnessMinDistance,
    exactnessMaxDistance: MUSIC_SOURCE.lastStageExactnessMaxDistance,
    minimumFrameDelay: MUSIC_SOURCE.lastStageMinFrameDelay,
    maximumFrameDelay: MUSIC_SOURCE.lastStageMaxFrameDelay,
    initialFrameDelay: MUSIC_SOURCE.lastStageInitialFrameDelay,
    axes: 7,
    squaredDistance: false,
  });
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

  /**
   * Flat loop controlled by a source-authored distance. Ballance's fan and
   * UFO sounds are CK_WAVESOUND_BACKGROUND objects: TT ProximityVolumeControl
   * changes only their gain, without a spatial panner.
   */
  createLoop(
    name: string,
    target: THREE.Object3D,
    volume = 1,
  ): DistanceLoopHandle {
    const state: DistanceLoopState = {
      audio: null,
      target,
      wanted: false,
      disposed: false,
      volume,
      distance: 0,
      near: 0,
      far: Infinity,
      playbackRate: 1,
    };
    this.distanceLoops.add(state);
    void this.load(name).then((buffer) => {
      if (!buffer || this.disposed || state.disposed) return;
      const audio = new THREE.Audio(this.listener);
      state.audio = audio;
      audio.setBuffer(buffer);
      audio.setLoop(true);
      audio.setPlaybackRate(state.playbackRate);
      target.add(audio);
      this.updateDistanceLoopVolume(state);
      if (state.wanted) audio.play();
    });
    return {
      setActive: (on: boolean) => {
        state.wanted = on;
        if (!state.audio) return;
        if (on && !state.audio.isPlaying) state.audio.play();
        else if (!on && state.audio.isPlaying) state.audio.stop();
      },
      setDistance: (distance: number) => {
        state.distance = Math.max(0, distance);
        this.updateDistanceLoopVolume(state);
      },
      setDistanceRange: (near: number, far: number) => {
        state.near = near;
        state.far = Math.max(near, far);
        this.updateDistanceLoopVolume(state);
      },
      setPlaybackRate: (rate: number) => {
        state.playbackRate = Math.max(0.0001, rate);
        state.audio?.setPlaybackRate(state.playbackRate);
      },
      dispose: () => {
        if (state.disposed) return;
        state.disposed = true;
        state.wanted = false;
        if (state.audio?.isPlaying) state.audio.stop();
        state.audio?.removeFromParent();
        state.audio?.disconnect();
        this.distanceLoops.delete(state);
      },
    };
  }

  private updateDistanceLoopVolume(state: DistanceLoopState): void {
    if (!state.audio) return;
    const attenuation = proximityVolume(state.distance, state.near, state.far);
    state.audio.setVolume(state.volume * attenuation * this.sfxVolume);
  }

  /** Ball impact using physics_RT.dll's strict gate and speed/max output. */
  hit(ball: BallKind, surface: Surface, impactSpeed: number): void {
    if (!this.ballSoundsActive) return;
    const source = COLLISION_SOUND_SOURCE[surface];
    if (!(impactSpeed > source.minSpeed)) return;
    if ((this.hitSleep.get(surface) ?? 0) > 0) return;
    this.hitSleep.set(surface, source.sleep);
    // ball sounds are flat (non-positional), as in the original
    this.playFlat(hitFile(ball, surface), collisionSpeedVolume(impactSpeed, source.maxSpeed));
  }

  /** Independent Start Music-gated collision detector on each wooden flap. */
  woodenFlapHit(name: string, detector: number, impactSpeed: number): void {
    if (!(impactSpeed > WOODEN_FLAP_SOUND_SOURCE.minSpeed)) return;
    if ((this.woodenFlapSleep.get(detector) ?? 0) > 0) return;
    this.woodenFlapSleep.set(detector, WOODEN_FLAP_SOUND_SOURCE.sleep);
    const normalized = collisionSpeedVolume(impactSpeed, WOODEN_FLAP_SOUND_SOURCE.maxSpeed);
    this.playFlat(name, linearVolume(normalized));
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

  /**
   * Direct Wave Player restart: stop the existing source now, then play it on
   * the next 66 Hz behavior tick, matching Simple Sound Messages.nmo.
   */
  restartFlat(name: string, volume = 1): void {
    const generation = (this.restartGenerations.get(name) ?? 0) + 1;
    this.restartGenerations.set(name, generation);
    const existing = this.restartPlayers.get(name);
    if (existing?.isPlaying) existing.stop();
    void this.load(name).then((buffer) => {
      if (!buffer || this.disposed || this.restartGenerations.get(name) !== generation) return;
      let audio = this.restartPlayers.get(name);
      if (!audio) {
        audio = new THREE.Audio(this.listener);
        this.restartPlayers.set(name, audio);
      } else if (audio.isPlaying) {
        audio.stop();
      }
      audio.setBuffer(buffer);
      audio.setVolume(volume * this.sfxVolume);
      audio.play(SIM_DT);
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

  /** Advance PhysicsCollDetection sleep timers on the fixed simulation clock. */
  updateSimulation(dt: number): void {
    for (const state of this.distanceLoops) this.updateDistanceLoopVolume(state);
    for (const [surface, remaining] of this.hitSleep) {
      if (remaining > 0) this.hitSleep.set(surface, Math.max(0, remaining - dt));
    }
    for (const [detector, remaining] of this.woodenFlapSleep) {
      if (remaining > 0) this.woodenFlapSleep.set(detector, Math.max(0, remaining - dt));
    }
  }

  /** Mirror BallNav activate/deactivate, which creates/stops ball detectors. */
  setBallSoundsActive(active: boolean): void {
    if (active === this.ballSoundsActive) return;
    this.ballSoundsActive = active;
    this.hitSleep.clear();
    this.rollContacts.clear();
    if (!active) {
      for (const loop of this.rollLoops.values()) loop.setVolume(0);
    }
  }

  /** Continuous rolling under the source's identical 0.3 s on/off delays. */
  updateRoll(ball: BallKind, touching: ReadonlySet<Surface>, speed: number, dt: number): void {
    if (!this.ballSoundsActive) return;
    const volume = rollVolume(speed);
    const pitch = rollPitch(speed);
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
      if (now && !st.active && st.since >= ROLL_SOUND_SOURCE.contactDelayStart) st.active = true;
      else if (!now && st.active && st.since >= ROLL_SOUND_SOURCE.contactDelayEnd) st.active = false;

      const loop = this.ensureRollLoop(ball, surface);
      if (loop) {
        loop.setVolume(st.active ? volume * this.sfxVolume : 0);
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
    this.lastStageProximity.reset();
    this.setLastStageLoop(true);
  }

  /** Apply TT Scaleable Proximity's source threshold and adaptive sampler. */
  updateLastStageDistance(distance: number): void {
    if (!this.lastStage) return;
    const output = this.lastStageProximity.updateDistance(distance);
    if (output === 'exitRange') {
      this.lastStageNear = false;
      this.setLastStageLoop(false);
    } else if (output === 'enterRange') {
      this.lastStageNear = true;
      this.setLastStageLoop(true);
    }
  }

  /** Ball Off stops the block; its delayed `In` resets only Last Check. */
  restartLastStageProximity(): void {
    if (this.lastStage) this.lastStageProximity.restartTransitionState();
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
    this.playFinalCue(levelFinalMusic(level));
  }

  /** PE_Balloon/UFO iterator row 11 starts the regular final cue. */
  playUfoFinal(): void {
    this.playFinalCue('Music_Final.wav', SIM_DT);
  }

  private playFinalCue(file: 'Music_Final.wav' | 'Music_LastFinal.wav', delay = 0): void {
    this.stopSource('finalSource');
    const musicGeneration = this.musicGeneration;
    const cueGeneration = ++this.finalCueGeneration;
    void this.load(file).then((buffer) => {
      if (
        !buffer ||
        !this.musicGain ||
        musicGeneration !== this.musicGeneration ||
        cueGeneration !== this.finalCueGeneration
      ) return;
      const source = this.listener.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.musicGain);
      this.finalSource = source;
      source.onended = () => {
        if (this.finalSource === source) this.finalSource = null;
      };
      source.start(this.listener.context.currentTime + delay);
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
    this.finalCueGeneration++;
    this.musicActive = false;
    this.themeActive = false;
    this.musicFadingOut = false;
    this.lastStage = false;
    this.lastStageNear = false;
    this.lastStageProximity.reset();
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
        lastStageCheckFrames: this.lastStageProximity.remainingFrames(),
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
    for (const audio of this.restartPlayers.values()) {
      if (audio.isPlaying) audio.stop();
      audio.disconnect();
    }
    this.restartPlayers.clear();
    this.restartGenerations.clear();
    for (const loop of [...this.distanceLoops]) {
      loop.disposed = true;
      if (loop.audio?.isPlaying) loop.audio.stop();
      loop.audio?.removeFromParent();
      loop.audio?.disconnect();
    }
    this.distanceLoops.clear();
  }
}
