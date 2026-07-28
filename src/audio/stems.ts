import { getContext, getStemBus } from './context';
import { Ab2, Ab4, Bb3, C3, C4, C5, DB6, Db2, F1, F2, F3, F4, FM7, FM9 } from './key';

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
 *
 * ## Nothing in here may sound like a drum
 *
 * This is a hard rule, not a stylistic preference. The player's whole job is to work out
 * which drum belongs on which step, and they do it by ear. A backing layer that reads as
 * a drum is not just clutter — it is a false answer: the player hears a tick on step 3,
 * assumes something is already placed there, and stops looking. Every drum sound in the
 * game must come from the sequencer, so that everything the player hears in the kit is
 * something they put there.
 *
 * Three properties make a sound read as a drum, and no layer below has any of them:
 *
 * 1. **A sharp transient.** Every attack here is at least 25ms, most are far longer.
 *    Nothing clicks.
 * 2. **Noise.** There is no noise source in this file at all. Filtered noise is what the
 *    ear identifies as a hat, a clap or a cymbal, so the riser is a filter sweep on a
 *    sawtooth rather than the bandpassed noise it used to be.
 * 3. **A short, unpitched body.** Every layer holds long enough, and at a clear enough
 *    pitch, to read as a note. The shortest thing here is the 200ms bass note, which is
 *    still nearly ten times the length of the rim's click.
 *
 * Placement carries the rest of the load. The only layers that pulse at all are the bass
 * ones, and they sit on the offbeat eighths — never on a quarter note, where a low sound
 * would be competing with the kick, and never on the sixteenths the rim is going to want.
 * Register does the rest: the bass is an octave below anything the kit puts up there, and
 * nothing else in the bed has an onset to confuse in the first place.
 */

const SILENT = 0.0001;

type BarScheduler = (barStart: number, stepDuration: number, out: AudioNode) => void;

interface ToneOptions {
  time: number;
  freq: number;
  duration: number;
  gain: number;
  type?: OscillatorType;
  cutoff?: number;
  /**
   * Seconds to reach full level. Floored at 25ms — see the note above; an attack faster
   * than that is a transient, and a transient is what makes a sound a drum.
   */
  attack?: number;
  /**
   * Seconds of fall at the end. Given, the note holds at level in between, so the
   * envelope is a plateau rather than a decay; omitted, it decays away across the whole
   * duration like a struck note.
   */
  release?: number;
  /** Cents of detune for a second, doubled oscillator. Width, for the sustained layers. */
  detune?: number;
}

/** No backing layer may attack faster than this. */
const MIN_ATTACK = 0.025;

function tone(opts: ToneOptions, out: AudioNode): void {
  const ctx = getContext();
  const { time, freq, duration, gain: level, type = 'sine', cutoff, release, detune } = opts;
  const attack = Math.max(opts.attack ?? MIN_ATTACK, MIN_ATTACK);

  const gain = ctx.createGain();
  const g = gain.gain;
  g.setValueAtTime(SILENT, time);
  g.linearRampToValueAtTime(level, time + attack);
  if (release !== undefined) {
    g.setValueAtTime(level, time + Math.max(attack, duration - release));
  }
  g.exponentialRampToValueAtTime(SILENT, time + duration);

  let node: AudioNode = gain;
  if (cutoff !== undefined) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 0.8;
    filter.connect(gain);
    node = filter;
  }
  gain.connect(out);

  const voices = detune === undefined ? [0] : [-detune, detune];
  for (const cents of voices) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    if (cents !== 0) osc.detune.setValueAtTime(cents, time);
    osc.connect(node);
    osc.start(time);
    osc.stop(time + duration + 0.02);
  }
}

function chord(freqs: number[], opts: Omit<ToneOptions, 'freq'>, out: AudioNode): void {
  for (const freq of freqs) tone({ ...opts, freq }, out);
}

/**
 * A vowel. A sawtooth through two parallel peaking bands at the first two formants of
 * an "ah", which is the cheapest thing that reads as a human voice rather than a synth.
 * Slow in, slow out, so it sits behind everything as a held note.
 */
function vowel(
  freqs: number[],
  opts: { time: number; duration: number; gain: number },
  out: AudioNode,
): void {
  const ctx = getContext();
  const { time, duration, gain: level } = opts;

  const gain = ctx.createGain();
  const g = gain.gain;
  g.setValueAtTime(SILENT, time);
  g.linearRampToValueAtTime(level, time + duration * 0.4);
  g.setValueAtTime(level, time + duration * 0.6);
  g.exponentialRampToValueAtTime(SILENT, time + duration);
  gain.connect(out);

  // First two formants of "ah". The pair is what carries the vowel; a single band just
  // sounds like a filtered saw.
  for (const [formant, q] of [
    [720, 7],
    [1150, 9],
  ]) {
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = formant!;
    band.Q.value = q!;
    band.connect(gain);

    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, time);
      osc.detune.setValueAtTime(Math.random() * 8 - 4, time);
      osc.connect(band);
      osc.start(time);
      osc.stop(time + duration + 0.02);
    }
  }
}

/**
 * The fallback bed: ten layers in the order the chapter introduces them, arranged as a
 * deep house track actually assembles — bass first and in three pieces, then warmth,
 * keys, voice, height, tension, melody, release.
 *
 * The harmony is one bar of Fm7 into Dbmaj9, carried by the sub moving F → Db underneath
 * a pad that never changes shape. See `key.ts` for why that voicing works, and the file
 * header for why nothing in here attacks fast enough to be a drum.
 */
const FALLBACKS: Record<string, BarScheduler> = {
  /*
   * 1-3 are one instrument arriving in three pieces: the bass, which is the first thing
   * the player ever hears. It is deliberately the opening sound rather than a pad,
   * because the game's first screen used to be effectively silent — the layer that
   * opened it was a 43.65Hz drone, which most laptop and phone speakers do not
   * reproduce at all.
   *
   * The whole line is the deep house offbeat "donk": a short, round note in the gaps
   * between the kicks, so kick and bass answer each other. It is bouncy because the
   * notes are short and land off the beat, not because they are loud.
   *
   *          0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
   * stage 1  .  .  F  .  .  .  .  .  .  .  F  .  .  .  .  .
   * stage 2  .  .  .  .  .  .  Ab .  .  .  .  .  .  .  C  .
   *
   * Layers accumulate rather than replace, so the split has to be by step: stage 2 fills
   * the offbeats stage 1 left alone and the two together are the full F–Ab–F–C line.
   *
   * Nothing here lands on 0, 4, 8 or 12. That is the point — a low sound on a quarter
   * note is the one thing that could be mistaken for a kick, and these sit squarely in
   * between, which is also why they only make full sense once the kicks arrive.
   */

  // 1. The seed. The root, twice a bar, off the beat.
  bass: (bar, step, out) => {
    for (const s of [2, 10]) {
      tone(
        { time: bar + s * step, freq: F2, duration: 0.2, gain: 0.3, type: 'triangle', cutoff: 520 },
        out,
      );
    }
  },

  // 2. The line. The other two offbeats, and the movement that makes it a line rather
  //    than a pulse. C over the second half reads against Db as its major seventh.
  bassline: (bar, step, out) => {
    for (const [s, freq] of [
      [6, Ab2],
      [14, C3],
    ] as Array<[number, number]>) {
      tone(
        { time: bar + s * step, freq, duration: 0.2, gain: 0.3, type: 'triangle', cutoff: 520 },
        out,
      );
    }
  },

  // 3. The body, arriving with the last two kicks. A held sub underneath, F for the first
  //    half of the bar and Db for the second — which is both the low end that makes the
  //    bass feel full and the chord change everything above it is later voiced against.
  sub: (bar, step, out) => {
    const half = step * 8;
    for (const [s, freq] of [
      [0, F1],
      [8, Db2],
    ] as Array<[number, number]>) {
      tone(
        {
          time: bar + s * step,
          freq,
          duration: half,
          gain: 0.3,
          type: 'sine',
          attack: 0.09,
          release: 0.1,
        },
        out,
      );
    }
  },

  // 4. Warmth. The Fm7 shape, held. Detuned for width, filtered dark so it stays under
  //    everything.
  pad: (bar, step, out) => {
    chord(
      FM7,
      {
        time: bar,
        duration: step * 15.6,
        gain: 0.075,
        type: 'sawtooth',
        cutoff: 850,
        attack: 0.5,
        release: 0.4,
        detune: 7,
      },
      out,
    );
  },

  // 5. Keys. A Rhodes-ish swell on each half of the bar, taking the two chord colours.
  //    100ms in and a long tail — the shape of something struck softly and left to ring,
  //    which is as close to rhythmic as the backing gets this early.
  keys: (bar, step, out) => {
    const half = step * 8;
    for (const [s, voicing] of [
      [0, FM9],
      [8, DB6],
    ] as Array<[number, number[]]>) {
      chord(
        voicing,
        {
          time: bar + s * step,
          duration: half * 0.96,
          gain: 0.055,
          type: 'triangle',
          cutoff: 1600,
          attack: 0.1,
          release: half * 0.55,
        },
        out,
      );
    }
  },

  // 6. The voice. A held "ah" on the fifth and the root, swelling across the bar.
  voice: (bar, step, out) => {
    vowel([F3, C4], { time: bar, duration: step * 16, gain: 0.075 }, out);
  },

  // 7. Height. The same harmony an octave up, very slow in, barely there — it opens the
  //    top of the mix without adding an event to it.
  strings: (bar, step, out) => {
    chord(
      [C5, Ab4],
      {
        time: bar,
        duration: step * 15.6,
        gain: 0.032,
        type: 'sawtooth',
        cutoff: 2400,
        attack: 0.8,
        release: 0.5,
        detune: 11,
      },
      out,
    );
  },

  // 8. The riser. A filter opening across the bar and shutting at the line, which is the
  //    tension the old noise sweep was going for — but on a sawtooth, because a bandpass
  //    climbing to 7kHz on white noise is, to the ear, a hi-hat.
  swell: (bar, step, out) => {
    const ctx = getContext();
    const barLength = step * 16;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 4;
    filter.frequency.setValueAtTime(180, bar);
    filter.frequency.exponentialRampToValueAtTime(2600, bar + barLength * 0.92);
    filter.frequency.exponentialRampToValueAtTime(180, bar + barLength);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(SILENT, bar);
    gain.gain.linearRampToValueAtTime(0.05, bar + barLength * 0.85);
    gain.gain.exponentialRampToValueAtTime(SILENT, bar + barLength);
    filter.connect(gain).connect(out);

    for (const freq of [F2, C4]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, bar);
      osc.connect(filter);
      osc.start(bar);
      osc.stop(bar + barLength + 0.02);
    }
  },

  // 9. The hook. A four-note line, soft-attacked and long enough that each note reads as
  //    a pitch rather than a hit.
  lead: (bar, step, out) => {
    const line: Array<[number, number]> = [
      [0, F4],
      [6, Ab4],
      [8, C5],
      [14, Bb3],
    ];
    for (const [s, freq] of line) {
      tone(
        {
          time: bar + s * step,
          freq,
          duration: step * 2.6,
          gain: 0.06,
          type: 'triangle',
          cutoff: 2600,
          attack: 0.045,
          release: step * 1.6,
        },
        out,
      );
    }
  },

  // 10. The release, arriving with the crash. The full chords, brighter and wider than
  //     the keys under them, holding each half of the bar so the loop opens out rather
  //     than getting busier.
  chords: (bar, step, out) => {
    const half = step * 8;
    for (const [s, voicing] of [
      [0, FM9],
      [8, DB6],
    ] as Array<[number, number[]]>) {
      chord(
        voicing,
        {
          time: bar + s * step,
          duration: half * 0.97,
          gain: 0.045,
          type: 'sawtooth',
          cutoff: 2000,
          attack: 0.15,
          release: half * 0.35,
          detune: 9,
        },
        out,
      );
    }
  },
};

/** Anything not named above still gets a layer rather than silence. */
const DEFAULT_FALLBACK: BarScheduler = (bar, step, out) => {
  chord(
    FM7,
    {
      time: bar,
      duration: step * 15.6,
      gain: 0.05,
      type: 'sawtooth',
      cutoff: 1200,
      attack: 0.4,
      release: 0.4,
    },
    out,
  );
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
