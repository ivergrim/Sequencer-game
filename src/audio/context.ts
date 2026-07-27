/**
 * The AudioContext singleton.
 *
 * `AudioContext.currentTime` is the only clock in this codebase. Nothing accumulates
 * time in a requestAnimationFrame loop and nothing uses Date.now() for anything that
 * affects position or timing.
 *
 * The context is created lazily on the first user gesture. Creating it earlier just
 * produces a suspended context whose currentTime does not advance, which would make
 * the transport start against a clock that is not running yet.
 */

let context: AudioContext | null = null;
let master: GainNode | null = null;
let drumBus: GainNode | null = null;
let stemBus: GainNode | null = null;

export function getContext(): AudioContext {
  if (!context) {
    context = new AudioContext({ latencyHint: 'interactive' });

    master = context.createGain();
    master.gain.value = 0.9;
    master.connect(context.destination);

    drumBus = context.createGain();
    drumBus.gain.value = 0.85;
    drumBus.connect(master);

    stemBus = context.createGain();
    stemBus.gain.value = 0.5;
    stemBus.connect(master);
  }
  return context;
}

export function getDrumBus(): GainNode {
  getContext();
  return drumBus!;
}

export function getStemBus(): GainNode {
  getContext();
  return stemBus!;
}

export function isRunning(): boolean {
  return context?.state === 'running';
}

/**
 * Unlock audio from inside a user gesture handler. Safari in particular only lifts the
 * autoplay block if a source is started synchronously within the gesture, so this
 * plays a one-sample silent buffer as well as resuming.
 */
export async function unlockAudio(): Promise<AudioContext> {
  const ctx = getContext();

  const silence = ctx.createBufferSource();
  silence.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  silence.connect(ctx.destination);
  silence.start(0);

  if (ctx.state !== 'running') await ctx.resume();
  return ctx;
}

/** A shared white noise buffer. Every noise-based voice reads from this one buffer. */
let noise: AudioBuffer | null = null;

export function getNoiseBuffer(): AudioBuffer {
  const ctx = getContext();
  if (!noise) {
    const length = Math.ceil(ctx.sampleRate * 2);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}
