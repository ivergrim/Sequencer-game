import { getContext, getDrumBus, getNoiseBuffer } from './context';
import { Ab3, C4, F1, F4 } from './key';

/**
 * The two moments the run cycle turns on, given a sound.
 *
 * UI cues like the count-in tick: not instruments, never sequenceable, scheduled at
 * absolute audio-clock times like everything else. Both are built from the chapter's
 * key (`key.ts`), so they land inside the backing bed rather than on top of it, and
 * both are quiet — they mark the moment, the music around them carries the feeling.
 */

const SILENT = 0.0001;

/**
 * The collision. A low thud on the chapter's root plus a short, dark crumple of noise.
 *
 * Scheduled at the exact audio time of the collision step, so it lands where the
 * missing drum hit would have. Deliberately darker and longer than the kick so the two
 * never read as the same voice.
 */
export function triggerFailThud(time: number): void {
  const ctx = getContext();
  const out = getDrumBus();

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(F1 * 2, time);
  osc.frequency.exponentialRampToValueAtTime(F1 * 0.75, time + 0.18);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.8, time);
  gain.gain.exponentialRampToValueAtTime(SILENT, time + 0.45);

  osc.connect(gain).connect(out);
  osc.start(time);
  osc.stop(time + 0.46);

  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer();
  noise.loop = true;
  noise.start(time, Math.random() * 1.5, 0.2);
  noise.stop(time + 0.2);

  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 320;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.4, time);
  noiseGain.gain.exponentialRampToValueAtTime(SILENT, time + 0.18);

  noise.connect(low).connect(noiseGain).connect(out);
}

/**
 * The stage clear. A quick rising arpeggio up the chapter's tonic triad.
 *
 * Scheduled at the bar line where the success flourish begins, spaced in fractions of
 * the step so it stays in the groove at any tempo.
 */
export function triggerSuccessSting(time: number, stepDuration: number): void {
  const ctx = getContext();
  const out = getDrumBus();

  const notes: Array<[number, number]> = [
    [0, Ab3],
    [0.5, C4],
    [1, F4],
  ];

  for (const [step, freq] of notes) {
    const at = time + step * stepDuration;
    const last = freq === F4;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, at);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(SILENT, at);
    gain.gain.linearRampToValueAtTime(last ? 0.2 : 0.14, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(SILENT, at + (last ? 0.4 : 0.14));

    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 2600;

    osc.connect(soft).connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + (last ? 0.42 : 0.16));
  }
}
