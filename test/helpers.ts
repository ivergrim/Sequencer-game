import { expect } from 'vitest';
import type { Transport } from '../src/audio/transport';
import { CHAPTER_1 } from '../src/game/chapter1';
import { requiredNotes } from '../src/game/simulate';
import type { StateEvents } from '../src/game/state';
import { DEATH_CAMERA, GameState, RUN_DECISION_LEAD } from '../src/game/state';

/**
 * A hand-cranked stand-in for the transport: the same derived-position arithmetic,
 * driven by a `now` the test sets directly instead of by an AudioContext.
 */
export class StubClock {
  now = 0;
  readonly started = true;
  readonly stepDuration = 60 / CHAPTER_1.bpm / 4;
  readonly barDuration = this.stepDuration * CHAPTER_1.patternLength;
  readonly patternLength = CHAPTER_1.patternLength;

  get elapsed(): number {
    return this.now;
  }
  get absoluteStepFloat(): number {
    return this.now / this.stepDuration;
  }
  get stepFloat(): number {
    const raw = this.absoluteStepFloat;
    return ((raw % this.patternLength) + this.patternLength) % this.patternLength;
  }
  get barFloat(): number {
    return this.absoluteStepFloat / this.patternLength;
  }
  timeOfBar(bar: number): number {
    return bar * this.barDuration;
  }
  timeOfStep(step: number): number {
    return step * this.stepDuration;
  }
  nextBarBoundary(time: number): number {
    return Math.ceil(time / this.barDuration);
  }
}

export function make(events: StateEvents = {}) {
  const clock = new StubClock();
  const state = new GameState(CHAPTER_1, clock as unknown as Transport, events);
  return { clock, state };
}

/** Arm a run and advance the clock to just past the run decision. */
export function armAndDecide(clock: StubClock, state: GameState): number {
  state.requestRun();
  const runBar = clock.nextBarBoundary(clock.now + 0.15) + 1;
  clock.now = clock.timeOfBar(runBar) - RUN_DECISION_LEAD + 0.001;
  state.update();
  return runBar;
}

/**
 * Arm a run and walk the clock through it until it collides.
 *
 * Steps the clock rather than jumping to a known collision time, so it works for a
 * failure anywhere in the bar. It stops inside the death camera, which is where a failed
 * run actually leaves the player.
 */
export function failRun(clock: StubClock, state: GameState): void {
  state.requestRun();
  const runBar = clock.nextBarBoundary(clock.now + 0.15) + 1;
  const end = clock.timeOfBar(runBar + 1);
  while (clock.now < end) {
    clock.now += clock.stepDuration / 2;
    state.update();
    if (state.phase === 'failed') return;
  }
  throw new Error('the run was expected to fail and did not');
}

/** Sit out the death camera and land back in EDITING. */
export function releaseCamera(clock: StubClock, state: GameState): void {
  clock.now += DEATH_CAMERA.total + 0.001;
  state.update();
  expect(state.phase).toBe('editing');
}

/** Place the derived solution, run it, and walk the clock through to the advance. */
export function clearStage(clock: StubClock, state: GameState): void {
  for (const note of requiredNotes(state.obstacles)) {
    if (!state.pattern[note.instrument][note.step]) state.toggle(note.instrument, note.step);
  }
  state.requestRun();
  const runBar = clock.nextBarBoundary(clock.now + 0.15) + 1;
  clock.now = clock.timeOfBar(runBar) - RUN_DECISION_LEAD + 0.001;
  state.update();
  clock.now = clock.timeOfBar(runBar + 1) + 0.001;
  state.update();
  clock.now = clock.timeOfBar(runBar + 2) + 0.001;
  state.update();
  expect(state.failure).toBeNull();
}
