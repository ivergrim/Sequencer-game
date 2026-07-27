import { describe, expect, it } from 'vitest';
import type { Transport } from '../src/audio/transport';
import { CHAPTER_1 } from '../src/game/chapter1';
import { DEATH_CAMERA, GameState, RUN_DECISION_LEAD } from '../src/game/state';

/**
 * A hand-cranked stand-in for the transport: the same derived-position arithmetic,
 * driven by a `now` the test sets directly instead of by an AudioContext.
 */
class StubClock {
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

function make() {
  const clock = new StubClock();
  const state = new GameState(CHAPTER_1, clock as unknown as Transport);
  return { clock, state };
}

/** Arm a run and advance the clock to just past the run decision. */
function armAndDecide(clock: StubClock, state: GameState) {
  state.requestRun();
  const runBar = clock.nextBarBoundary(clock.now + 0.15) + 1;
  clock.now = clock.timeOfBar(runBar) - RUN_DECISION_LEAD + 0.001;
  state.update();
  return runBar;
}

describe('the run pattern snapshot', () => {
  it('decides the run just before the run bar, not on it', () => {
    const { clock, state } = make();
    state.toggle('kick', 0);
    state.requestRun();
    expect(state.phase).toBe('armed');

    const runBar = clock.nextBarBoundary(0.15) + 1;
    clock.now = clock.timeOfBar(runBar) - RUN_DECISION_LEAD - 0.01;
    state.update();
    expect(state.phase).toBe('armed');

    clock.now = clock.timeOfBar(runBar) - RUN_DECISION_LEAD + 0.001;
    state.update();
    expect(state.phase).toBe('running');
  });

  it('counts edits made during the count-in', () => {
    const { clock, state } = make();
    state.requestRun();
    // The solving note lands mid-count-in, before the decision.
    state.toggle('kick', 0);
    const runBar = clock.nextBarBoundary(0.15) + 1;
    clock.now = clock.timeOfBar(runBar) - RUN_DECISION_LEAD + 0.001;
    state.update();

    clock.now = clock.timeOfBar(runBar + 1) + 0.001;
    state.update();
    expect(state.phase).toBe('success');
  });

  it('plays the run bar from the snapshot while other bars stay live', () => {
    const { clock, state } = make();
    state.toggle('kick', 0);
    const runBar = armAndDecide(clock, state);
    expect(state.phase).toBe('running');

    // Removing the note mid-run changes the live pattern but not the run bar.
    state.toggle('kick', 0);
    expect(state.hitsAt(0, runBar)).toEqual(['kick']);
    expect(state.hitsAt(0, runBar + 1)).toEqual([]);
    expect(state.laneFor('kick', runBar)[0]).toBe(true);
    expect(state.laneFor('kick')[0]).toBe(false);
  });

  it('cannot be saved by an edit made after the decision', () => {
    const { clock, state } = make();
    const runBar = armAndDecide(clock, state);
    expect(state.phase).toBe('running');

    // The missing kick arrives too late: the outcome was decided without it.
    state.toggle('kick', 0);
    const collision = clock.timeOfStep(runBar * CHAPTER_1.patternLength);
    clock.now = collision - DEATH_CAMERA.replay + 0.001;
    state.update();

    expect(state.phase).toBe('failed');
    expect(state.failure?.step).toBe(0);
    expect(state.failure?.instrument).toBe('kick');
  });

  it('cannot be failed by an edit made after the decision', () => {
    const { clock, state } = make();
    state.toggle('kick', 0);
    const runBar = armAndDecide(clock, state);

    // Removing the required note mid-run changes nothing: the run was decided.
    state.toggle('kick', 0);
    clock.now = clock.timeOfBar(runBar + 1) + 0.001;
    state.update();
    expect(state.phase).toBe('success');
  });

  it('releases the snapshot the moment the run resolves', () => {
    const { clock, state } = make();
    state.toggle('kick', 0);
    const runBar = armAndDecide(clock, state);

    state.toggle('kick', 0);
    clock.now = clock.timeOfBar(runBar + 1) + 0.001;
    state.update();
    expect(state.phase).toBe('success');
    // The run is over, so even the run bar's index reads live again.
    expect(state.hitsAt(0, runBar)).toEqual([]);
  });

  it('keeps the final count-in beat visible across the early decision', () => {
    const { clock, state } = make();
    state.toggle('kick', 0);
    const runBar = armAndDecide(clock, state);
    expect(state.phase).toBe('running');

    // Just before the bar line the run is already decided, but the count-in is still
    // inside its bar and must still read "1".
    clock.now = clock.timeOfBar(runBar) - 0.05;
    expect(state.countInBeat).toBe(1);

    clock.now = clock.timeOfBar(runBar) + 0.05;
    expect(state.countInBeat).toBeNull();
  });
});
