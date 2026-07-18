/** Menu sounds: the original atmosphere loop and click, via Web Audio. */
import { fetchGameBuffer } from '../engine/assets.ts';

class MenuAudio {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private atmo: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private atmoWanted = false;
  private atmoTimer: ReturnType<typeof setTimeout> | null = null;

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
        gain.gain.value = 0.5;
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

  private oneShot(name: string, volume = 1): void {
    void this.load(name).then((buffer) => {
      if (!buffer) return;
      const ctx = this.ensureCtx();
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(gain);
      src.start();
    });
  }

  click(): void {
    this.oneShot('Menu_click.wav');
  }

  /** page/confirm chime */
  dong(): void {
    this.oneShot('Menu_dong.wav');
  }

  /** level begins loading */
  levelLoad(): void {
    this.oneShot('Menu_load.wav');
  }

  /** score-counter tick on the win screen */
  counter(): void {
    this.oneShot('Menu_counter.wav', 0.7);
  }

  /** highscore screen music */
  highscoreMusic(): void {
    this.oneShot('Music_Highscore.wav', 0.7);
  }

  /** intro sequence theme */
  introMusic(): void {
    this.oneShot('Music_Theme_4_1.wav', 0.6);
  }
}

export const menuAudio = new MenuAudio();
