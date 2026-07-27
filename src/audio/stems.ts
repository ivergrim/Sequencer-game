import { getContext, getNoiseBuffer, getStemBus } from './context';

/**
 * Backing layers.
 *
 * Each layer tries to load `public/stems/<name>.wav`. When the file is absent it falls
 * back to a synthesized substitute, so the prototype runs with an empty stems
 * directory and real audio is a drop-in later with no code change.
 *
 * Every layer is scheduled one bar at a time, as a fresh source started at an absolute
 * time computed from the transport start. `AudioBufferSourceNode.loop` is deliberately
 * unused: a bar at an arbitrary tempo is not a whole number of samples, so a
 * self-looping buffer accumulates error. Sub-sample error at each bar boundary is
 * inaudible and never accumulates.
 */

const SILENT = 0.0001;

type BarScheduler = (barStart: number, stepDuration: number, out: AudioNode) => void;

/** F minor. The fallback bed and every substitute layer sit in this key. */
const F1 = 43.65;
const F2 = 87.31;
const Ab2 = 103.83;
const C3 = 130.81;
const F3 = 174.61;
const Ab3 = 207.65;
const C4 = 261.63;
const Db4 = 277.18;
const F4 = 349.23;
const Ab4 = 415.3;
const C5 = 523.25;

const F_MINOR = [F3, Ab3, C4];
const Db_MAJOR = [Db4, F4, Ab4];

interface ToneOptions {
  time: number;
  freq: number;
  duration: number;
  gain: number;
  type?: OscillatorType;
  cutoff?: number;
  attack?: number;
}

function tone(opts: ToneOptions, out: AudioNode): void {
  const ctx = getContext();
  const { time, freq, duration, gain: level, type = 'sine', cutoff, attack = 0.005 } = opts;

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(SILENT, time);
  gain.gain.linearRampToValueAtTime(level, time + attack);
  gain.gain.exponentialRampToValueAtTime(SILENT, time + duration);

  let node: AudioNode = osc;
  if (cutoff !== undefined) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 0.8;
    node = osc.connect(filter);
  }
  node.connect(gain).connect(out);

  osc.start(time);
  osc.stop(time + duration + 0.02);
}

function chord(freqs: number[], opts: Omit<ToneOptions, 'freq'>, out: AudioNode): void {
  for (const freq of freqs) tone({ ...opts, freq }, out);
}

/**
 * The fallback bed, exactly as specified: a bass note on each quarter note and a
 * filtered chord stab on each offbeat eighth, in F minor. The remaining layers are
 * variations on those two so that each stage's entry is audible.
 */
const FALLBACKS: Record<string, BarScheduler> = {
  // A bass note on each quarter note.
  bass: (bar, step, out) => {
    for (const s of [0, 4, 8, 12]) {
      tone({ time: bar + s * step, freq: F2, duration: 0.34, gain: 0.5, cutoff: 400 }, out);
    }
  },

  sub: (bar, step, out) => {
    for (const s of [0, 8]) {
      tone({ time: bar + s * step, freq: F1, duration: step * 3.6, gain: 0.42, attack: 0.02 }, out);
    }
  },

  bassline: (bar, step, out) => {
    const line: Array<[number, number]> = [
      [2, F2],
      [6, Ab2],
      [10, F2],
      [14, C3],
    ];
    for (const [s, freq] of line) {
      tone(
        { time: bar + s * step, freq, duration: 0.2, gain: 0.34, type: 'triangle', cutoff: 500 },
        out,
      );
    }
  },

  pad: (bar, step, out) => {
    chord(
      F_MINOR,
      { time: bar, duration: step * 15.5, gain: 0.1, type: 'sawtooth', cutoff: 900, attack: 0.25 },
      out,
    );
  },

  // A filtered chord stab on each offbeat eighth.
  stab: (bar, step, out) => {
    for (const s of [2, 6, 10, 14]) {
      chord(
        F_MINOR,
        { time: bar + s * step, duration: 0.18, gain: 0.14, type: 'sawtooth', cutoff: 1500 },
        out,
      );
    }
  },

  chop: (bar, step, out) => {
    for (const s of [3, 7, 11, 15]) {
      chord(
        [Ab3, C4, F4],
        { time: bar + s * step, duration: 0.08, gain: 0.09, type: 'square', cutoff: 2200 },
        out,
      );
    }
  },

  sweep: (bar, step, out) => {
    const ctx = getContext();
    const barLength = step * 16;
    const source = ctx.createBufferSource();
    // The shared noise buffer, looped to cover a bar of any length, rather than a fresh
    // bar-sized buffer allocated every bar for the life of the session.
    source.buffer = getNoiseBuffer();
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(300, bar);
    filter.frequency.exponentialRampToValueAtTime(7000, bar + barLength);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(SILENT, bar);
    gain.gain.linearRampToValueAtTime(0.09, bar + barLength * 0.75);
    gain.gain.exponentialRampToValueAtTime(SILENT, bar + barLength);

    source.connect(filter).connect(gain).connect(out);
    source.start(bar);
    source.stop(bar + barLength);
  },

  pad2: (bar, step, out) => {
    chord(
      [Ab3, C4, F4],
      { time: bar, duration: step * 15.5, gain: 0.06, type: 'sawtooth', cutoff: 1300, attack: 0.4 },
      out,
    );
  },

  chords: (bar, step, out) => {
    // Fm for the first half of the bar, Db for the second.
    for (const s of [2, 6]) {
      chord(
        F_MINOR,
        { time: bar + s * step, duration: 0.22, gain: 0.1, type: 'sawtooth', cutoff: 1800 },
        out,
      );
    }
    for (const s of [10, 14]) {
      chord(
        Db_MAJOR,
        { time: bar + s * step, duration: 0.22, gain: 0.1, type: 'sawtooth', cutoff: 1800 },
        out,
      );
    }
  },

  lead: (bar, step, out) => {
    const line: Array<[number, number]> = [
      [0, F4],
      [6, Ab4],
      [8, C5],
      [14, Ab4],
    ];
    for (const [s, freq] of line) {
      tone(
        { time: bar + s * step, freq, duration: 0.3, gain: 0.09, type: 'triangle', cutoff: 2600 },
        out,
      );
    }
  },
};

/** Anything not named above still gets a layer rather than silence. */
const DEFAULT_FALLBACK: BarScheduler = (bar, step, out) => {
  for (const s of [2, 10]) {
    chord(
      F_MINOR,
      { time: bar + s * step, duration: 0.2, gain: 0.1, type: 'sawtooth', cutoff: 1600 },
      out,
    );
  }
};

export class Stems {
  private readonly buffers = new Map<string, AudioBuffer | null>();
  private readonly gains = new Map<string, GainNode>();
  private readonly entered = new Set<string>();
  private readonly stepDuration: number;

  constructor(stepDuration: number) {
    this.stepDuration = stepDuration;
  }

  /**
   * Try to load every layer up front so a stem entering mid-session never hitches.
   * A missing or undecodable file is recorded as null and falls back from then on.
   */
  async preload(names: string[]): Promise<void> {
    await Promise.all(names.map((name) => this.load(name)));
  }

  /** Whether a layer is playing a real loop rather than its synthesized substitute. */
  hasBuffer(name: string): boolean {
    return this.buffers.get(name) != null;
  }

  private async load(name: string): Promise<void> {
    if (this.buffers.has(name)) return;
    const url = `${import.meta.env.BASE_URL}stems/${name}.wav`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        this.buffers.set(name, null);
        return;
      }
      const bytes = await response.arrayBuffer();
      const buffer = await getContext().decodeAudioData(bytes);
      this.buffers.set(name, buffer);
    } catch {
      // Absent, blocked or undecodable. The synthesized substitute covers it.
      this.buffers.set(name, null);
    }
  }

  private busFor(name: string): GainNode {
    let gain = this.gains.get(name);
    if (!gain) {
      gain = getContext().createGain();
      gain.gain.value = 1;
      gain.connect(getStemBus());
      this.gains.set(name, gain);
    }
    return gain;
  }

  /**
   * Schedule one bar of every active layer, at an absolute time from the transport.
   *
   * `barStart` comes from `Transport.timeOfBar`, so bar N always lands on
   * `transportStart + N * barDuration` regardless of what happened in bar N-1.
   */
  scheduleBar(names: string[], barStart: number): void {
    for (const name of names) {
      const out = this.busFor(name);

      // A layer entering with a stage fades in over its first bar rather than
      // snapping on mid-groove.
      if (!this.entered.has(name)) {
        this.entered.add(name);
        const beat = this.stepDuration * 4;
        out.gain.setValueAtTime(0, barStart);
        out.gain.linearRampToValueAtTime(1, barStart + beat);
      }

      const buffer = this.buffers.get(name);
      if (buffer) {
        const source = getContext().createBufferSource();
        source.buffer = buffer;
        source.connect(out);
        source.start(barStart);
      } else {
        (FALLBACKS[name] ?? DEFAULT_FALLBACK)(barStart, this.stepDuration, out);
      }
    }
  }
}
