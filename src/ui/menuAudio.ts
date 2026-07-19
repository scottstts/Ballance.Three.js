/** Menu sounds: the original atmosphere loop and click, via Web Audio. */
import { fetchGameBuffer } from '../engine/assets.ts';
import { SIM_DT } from '../game/constants.ts';
import { linearVolume } from '../game/soundGain.ts';
import { gameStore } from '../game/store.ts';

/** Exact CKWaveSound settings serialized by base.cmo and Intro.nmo. */
export const INTRO_AUDIO_SOURCE = {
  theme: { gain: 1, pitch: 1 },
  atari: { gain: 0.800000011920929, pitch: 1 },
} as const;

class MenuAudio {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private atmo: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private atmoWanted = false;
  private atmoTimer: ReturnType<typeof setTimeout> | null = null;
  private restartSources = new Map<string, AudioBufferSourceNode>();
  private restartGenerations = new Map<string, number>();

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const resume = () => {
        if (this.ctx?.state === 'suspended') void this.ctx.resume();
      };
      window.addEventListener('pointerdown', resume);
      window.addEventListener('keydown', resume);
    }
    return this.ctx;
  }

  private load(name: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(name);
    if (!p) {
      p = fetchGameBuffer(`Sounds/${name}`)
        .then((buf) => this.ensureCtx().decodeAudioData(buf.slice(0)))
        .catch(() => null);
      this.buffers.set(name, p);
    }
    return p;
  }

  /** original: the atmo plays once, then again after 1-10s of silence */
  startAtmo(): void {
    if (this.atmoWanted) return;
    this.atmoWanted = true;
    const playOnce = () => {
      if (!this.atmoWanted) return;
      void this.load('Menu_atmo.wav').then((buffer) => {
        if (!buffer || !this.atmoWanted) return;
        const ctx = this.ensureCtx();
        const gain = ctx.createGain();
        gain.gain.value = linearVolume(gameStore.getState().settings.musicVolume);
        gain.connect(ctx.destination);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(gain);
        src.start();
        this.atmo = { src, gain };
        src.onended = () => {
          gain.disconnect();
          this.atmo = null;
          if (this.atmoWanted) {
            this.atmoTimer = setTimeout(playOnce, 1000 + Math.random() * 9000);
          }
        };
      });
    };
    playOnce();
  }

  stopAtmo(): void {
    this.atmoWanted = false;
    if (this.atmoTimer) clearTimeout(this.atmoTimer);
    this.atmoTimer = null;
    if (this.atmo) {
      try {
        this.atmo.src.stop();
      } catch {
        /* not started */
      }
      this.atmo.gain.disconnect();
      this.atmo = null;
    }
  }

  setMusicVolume(volume: number): void {
    if (this.atmo) this.atmo.gain.gain.value = linearVolume(volume);
  }

  private oneShot(name: string, volume = 1, music = false, playbackRate = 1): void {
    void this.load(name).then((buffer) => {
      if (!buffer) return;
      const ctx = this.ensureCtx();
      const gain = ctx.createGain();
      gain.gain.value = volume * (music ? linearVolume(gameStore.getState().settings.musicVolume) : 1);
      gain.connect(ctx.destination);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = playbackRate;
      src.connect(gain);
      src.start();
      src.onended = () => gain.disconnect();
    });
  }

  /** Sound.nmo direct players: Stop now, Play one behavior tick later. */
  private restartOneShot(name: string, music = false): void {
    const generation = (this.restartGenerations.get(name) ?? 0) + 1;
    this.restartGenerations.set(name, generation);
    const existing = this.restartSources.get(name);
    if (existing) {
      try {
        existing.stop();
      } catch {
        /* already ended */
      }
      this.restartSources.delete(name);
    }
    void this.load(name).then((buffer) => {
      if (!buffer || this.restartGenerations.get(name) !== generation) return;
      const ctx = this.ensureCtx();
      const gain = ctx.createGain();
      gain.gain.value = music ? linearVolume(gameStore.getState().settings.musicVolume) : 1;
      gain.connect(ctx.destination);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(gain);
      this.restartSources.set(name, src);
      src.start(ctx.currentTime + SIM_DT);
      src.onended = () => {
        if (this.restartSources.get(name) === src) this.restartSources.delete(name);
        gain.disconnect();
      };
    });
  }

  click(): void {
    this.restartOneShot('Menu_click.wav');
  }

  /** page/confirm chime */
  dong(): void {
    this.restartOneShot('Menu_dong.wav');
  }

  /** level begins loading */
  levelLoad(): void {
    this.restartOneShot('Menu_load.wav');
  }

  /** score-counter tick on the win screen */
  counter(): void {
    // Menu.nmo alternates two 37 ms players so rapid ticks may overlap.
    this.oneShot('Menu_counter.wav');
  }

  /** highscore screen music */
  highscoreMusic(): void {
    this.restartOneShot('Music_Highscore.wav', true);
  }

  /** intro sequence theme */
  introMusic(): void {
    this.oneShot('Music_Theme_4_1.wav', INTRO_AUDIO_SOURCE.theme.gain, false, INTRO_AUDIO_SOURCE.theme.pitch);
  }

  /** Atari movie sound is independent of the later DB_Options music mixer. */
  atariIntro(): void {
    this.oneShot('ATARI.wav', INTRO_AUDIO_SOURCE.atari.gain, false, INTRO_AUDIO_SOURCE.atari.pitch);
  }
}

export const menuAudio = new MenuAudio();
