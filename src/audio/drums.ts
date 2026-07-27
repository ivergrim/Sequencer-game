import { getContext, getDrumBus, getNoiseBuffer } from './context';
import type { Instrument } from '../game/types';

/**
 * Synthesized drum voices. No samples anywhere.
 *
 * Every voice takes the audio-clock time it should land on and schedules itself
 * against it. Nothing here reads currentTime to decide when to sound.
 *
 * Voices are per-genre in the full design and swap with the chapter. These are the
 * deep house set.
 */

const SILENT = 0.0001; // exponentialRampToValueAtTime cannot reach zero.

function noiseSource(duration: number, time: number): AudioBufferSourceNode {
  const ctx = getContext();
  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer();
  // Read from a random offset so repeated hits are not identical.
  source.loop = true;
  source.start(time, Math.random() * 1.5, duration);
  source.stop(time + duration);
  return source;
}

/** Sine 150Hz to 45Hz exponential over 120ms, gain to near zero over 250ms. */
function kick(time: number, out: AudioNode): void {
  const ctx = getContext();
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, time);
  osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(1, time);
  gain.gain.exponentialRampToValueAtTime(SILENT, time + 0.25);

  osc.connect(gain).connect(out);
  osc.start(time);
  osc.stop(time + 0.26);
}

/** Bandpassed noise at 1.2kHz: three 8ms bursts 12ms apart, then a 120ms tail. */
function clap(time: number, out: AudioNode): void {
  const ctx = getContext();
  const duration = 0.2;
  const source = noiseSource(duration, time);

  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1200;
  band.Q.value = 1.6;

  const gain = ctx.createGain();
  const g = gain.gain;
  g.setValueAtTime(0, time);
  for (let i = 0; i < 3; i++) {
    const burst = time + i * 0.012;
    g.setValueAtTime(0.85, burst);
    g.linearRampToValueAtTime(0.05, burst + 0.008);
  }
  const tail = time + 0.036;
  g.setValueAtTime(0.7, tail);
  g.exponentialRampToValueAtTime(SILENT, tail + 0.12);

  source.connect(band).connect(gain).connect(out);
}

/** Highpassed noise above 7kHz, 250ms decay. */
function openhat(time: number, out: AudioNode): void {
  const ctx = getContext();
  const duration = 0.3;
  const source = noiseSource(duration, time);

  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 7000;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.5, time);
  gain.gain.exponentialRampToValueAtTime(SILENT, time + 0.25);

  source.connect(high).connect(gain).connect(out);
}

/** A 20ms noise click plus a short triangle blip around 800Hz. */
function rim(time: number, out: AudioNode): void {
  const ctx = getContext();

  const source = noiseSource(0.03, time);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 2200;
  band.Q.value = 2;
  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(0.5, time);
  clickGain.gain.exponentialRampToValueAtTime(SILENT, time + 0.02);
  source.connect(band).connect(clickGain).connect(out);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(800, time);
  const blipGain = ctx.createGain();
  blipGain.gain.setValueAtTime(0.4, time);
  blipGain.gain.exponentialRampToValueAtTime(SILENT, time + 0.045);
  osc.connect(blipGain).connect(out);
  osc.start(time);
  osc.stop(time + 0.05);
}

/** Highpassed noise above 4kHz, 1.5s decay. */
function crash(time: number, out: AudioNode): void {
  const ctx = getContext();
  const duration = 1.6;
  const source = noiseSource(duration, time);

  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 4000;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.5, time);
  gain.gain.exponentialRampToValueAtTime(SILENT, time + 1.5);

  source.connect(high).connect(gain).connect(out);
}

const VOICES: Record<Instrument, (time: number, out: AudioNode) => void> = {
  kick,
  clap,
  openhat,
  rim,
  crash,
};

/** Schedule one hit at an absolute audio-clock time. */
export function triggerDrum(instrument: Instrument, time: number): void {
  VOICES[instrument](time, getDrumBus());
}

/**
 * The count-in tick. A UI sound rather than an instrument: it is not in the chapter's
 * row set and can never be sequenced.
 */
export function triggerCountIn(time: number, accented: boolean): void {
  const ctx = getContext();
  const out = getDrumBus();

  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(accented ? 1600 : 1050, time);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(accented ? 0.22 : 0.14, time);
  gain.gain.exponentialRampToValueAtTime(SILENT, time + 0.05);

  osc.connect(gain).connect(out);
  osc.start(time);
  osc.stop(time + 0.06);
}
