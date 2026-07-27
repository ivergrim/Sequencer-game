/**
 * The master clock.
 *
 * A setInterval running every 25ms looks 100ms ahead and hands every step falling in
 * that window to its listeners, together with the exact audio time the step lands on.
 * Listeners schedule audio against that time. Audio is never fired from the render
 * loop, and the interval's own jitter never reaches the sound.
 *
 * Position is derived, never accumulated:
 *
 *   elapsed   = audioCtx.currentTime - transportStart
 *   stepFloat = (elapsed / stepDuration) % patternLength
 *
 * so five minutes of drift is arithmetically impossible: the position is recomputed
 * from the audio clock every frame rather than advanced by a delta.
 */

const LOOKAHEAD_SECONDS = 0.1;
const INTERVAL_MS = 25;

export interface StepEvent {
  /** Absolute step index since transport start. Monotonic, never wraps. */
  step: number;
  /** `step` within the bar, 0..patternLength-1. */
  stepInBar: number;
  /** Absolute bar index since transport start. */
  bar: number;
  /** The audio-clock time this step lands on. Schedule against this, not currentTime. */
  time: number;
}

export type StepListener = (event: StepEvent) => void;

export class Transport {
  readonly stepDuration: number;
  readonly barDuration: number;
  readonly patternLength: number;

  private readonly ctx: AudioContext;
  private startTime = 0;
  private nextStep = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners: StepListener[] = [];

  constructor(ctx: AudioContext, bpm: number, patternLength: number) {
    this.ctx = ctx;
    this.patternLength = patternLength;
    this.stepDuration = 60 / bpm / 4;
    this.barDuration = this.stepDuration * patternLength;
  }

  /** Starts the transport. Once started it never stops, from stage 1 through stage 10. */
  start(): void {
    if (this.timer !== null) return;
    // A short offset so the first bar is scheduled ahead of the clock rather than
    // racing it.
    this.startTime = this.ctx.currentTime + 0.12;
    this.nextStep = 0;
    this.timer = setInterval(() => this.scheduleAhead(), INTERVAL_MS);
    this.scheduleAhead();
  }

  get started(): boolean {
    return this.timer !== null;
  }

  onStep(listener: StepListener): void {
    this.listeners.push(listener);
  }

  /** Seconds since the transport started. Negative during the pre-roll. */
  get elapsed(): number {
    return this.ctx.currentTime - this.startTime;
  }

  /** Fractional step position within the bar, 0..patternLength. Drives everything visual. */
  get stepFloat(): number {
    const raw = this.elapsed / this.stepDuration;
    return ((raw % this.patternLength) + this.patternLength) % this.patternLength;
  }

  /** Fractional step position since transport start, unwrapped. */
  get absoluteStepFloat(): number {
    return this.elapsed / this.stepDuration;
  }

  /** Fractional bar position since transport start, unwrapped. */
  get barFloat(): number {
    return this.absoluteStepFloat / this.patternLength;
  }

  /** The audio time a given absolute bar index begins on. */
  timeOfBar(bar: number): number {
    return this.startTime + bar * this.barDuration;
  }

  /**
   * The first bar index beginning at or after `time`.
   *
   * Arming a run uses this with a time past the lookahead horizon, so the count-in
   * always starts on a bar the scheduler has not already handed out.
   */
  nextBarBoundary(time: number): number {
    return Math.ceil((time - this.startTime) / this.barDuration);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  private scheduleAhead(): void {
    const now = this.ctx.currentTime;

    // Background tabs throttle setInterval to about once a second while the audio
    // clock keeps running. Skip whatever went past due rather than firing a burst of
    // it at once; position is derived, so the transport resumes exactly in phase.
    const firstFuture = Math.ceil((now - this.startTime) / this.stepDuration);
    if (this.nextStep < firstFuture) this.nextStep = firstFuture;

    const horizon = now + LOOKAHEAD_SECONDS;
    while (this.startTime + this.nextStep * this.stepDuration < horizon) {
      const step = this.nextStep;
      const event: StepEvent = {
        step,
        stepInBar: step % this.patternLength,
        bar: Math.floor(step / this.patternLength),
        time: this.startTime + step * this.stepDuration,
      };
      for (const listener of this.listeners) listener(event);
      this.nextStep++;
    }
  }
}
