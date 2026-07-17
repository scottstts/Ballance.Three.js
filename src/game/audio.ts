/**
 * Audio: original WAVs via Web Audio. Impact sounds follow the original
 * matrix Hit_<Ball>_<Surface>; rolling loops Roll_<Ball>_<Surface> scale
 * with speed; music plays the level's theme variations with pauses.
 */
import * as THREE from 'three';
import { fetchGameBuffer } from '../engine/assets.ts';
import type { BallKind } from './constants.ts';

export type Surface = 'stone' | 'wood' | 'metal';

const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

function hitFile(ball: BallKind, surface: Surface): string {
  if (ball === 'paper') return 'Hit_Paper.wav';
  return `Hit_${cap(ball)}_${cap(surface)}.wav`;
}

function rollFile(ball: BallKind, surface: Surface): string {
  if (ball === 'paper') return 'Roll_Paper.wav';
  return `Roll_${cap(ball)}_${cap(surface)}.wav`;
}

/** per-level music theme (original assignment) */
export const LEVEL_THEMES: Record<number, number> = {
  1: 1, 2: 5, 3: 2, 4: 3, 5: 1, 6: 5, 7: 4, 8: 2, 9: 3, 10: 1, 11: 3, 12: 4,
};

export class AudioManager {
  readonly listener: THREE.AudioListener;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private rollSound: THREE.PositionalAudio | null = null;
  private rollKey = '';
  private musicGain: GainNode | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private musicTimer: ReturnType<typeof setTimeout> | null = null;
  private hitCooldown = 0;
  private disposed = false;
  sfxVolume = 1;
  musicVolume = 0.55;

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

  /** ball impact on a surface */
  hit(ball: BallKind, surface: Surface, position: THREE.Vector3, strength: number, scene: THREE.Object3D): void {
    if (this.hitCooldown > 0) return;
    this.hitCooldown = 0.08;
    const vol = THREE.MathUtils.clamp(strength, 0.12, 1);
    this.play(hitFile(ball, surface), position, vol, scene);
  }

  /** continuous rolling: call each frame */
  updateRoll(ball: BallKind, surface: Surface | null, speed: number, position: THREE.Vector3, scene: THREE.Object3D, dt: number): void {
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    const wanted = surface && speed > 1.2 ? rollFile(ball, surface) : null;
    const key = wanted ?? '';
    if (key !== this.rollKey) {
      this.rollKey = key;
      this.rollSound?.stop();
      this.rollSound?.removeFromParent();
      this.rollSound = null;
      if (wanted) {
        void this.load(wanted).then((buffer) => {
          if (!buffer || this.rollKey !== key || this.disposed) return;
          const audio = new THREE.PositionalAudio(this.listener);
          audio.setBuffer(buffer);
          audio.setLoop(true);
          audio.setRefDistance(30);
          audio.setVolume(0);
          scene.add(audio);
          audio.play();
          this.rollSound = audio;
        });
      }
    }
    if (this.rollSound) {
      const vol = THREE.MathUtils.clamp((speed - 1) / 14, 0, 1) * this.sfxVolume;
      this.rollSound.setVolume(vol);
      this.rollSound.position.copy(position);
      const rate = THREE.MathUtils.clamp(0.8 + speed / 25, 0.8, 1.35);
      this.rollSound.setPlaybackRate(rate);
    }
  }

  /** music scheduler: theme variations with silent gaps, original files */
  startMusic(level: number): void {
    this.stopMusic();
    const theme = LEVEL_THEMES[level] ?? 1;
    const ctx = this.listener.context;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.musicGain.connect(ctx.destination);
    const playNext = () => {
      if (this.disposed || !this.musicGain) return;
      const variation = 1 + Math.floor(Math.random() * 3);
      void this.load(`Music_Theme_${theme}_${variation}.wav`).then((buffer) => {
        if (!buffer || this.disposed || !this.musicGain) return;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(this.musicGain);
        src.start();
        this.musicSource = src;
        src.onended = () => {
          this.musicSource = null;
          const gap = 4000 + Math.random() * 10000;
          this.musicTimer = setTimeout(playNext, gap);
        };
      });
    };
    playNext();
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

  dispose(): void {
    this.disposed = true;
    this.stopMusic();
    this.rollSound?.stop();
    this.rollSound?.removeFromParent();
  }
}
