import { describe, expect, it } from 'vitest';
import { CHAPTER_1, noteBudget } from '../src/game/chapter1';
import type { StateEvents } from '../src/game/state';
import {
  DEATH_CAMERA,
  GameState,
  HINT_AFTER_FAILURES,
  RUN_DECISION_LEAD,
} from '../src/game/state';
import { StubClock, armAndDecide, clearStage, failRun, make, releaseCamera } from './helpers';

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

  it('locks notes on an ordinary stage clear', () => {
    const { clock, state } = make();
    clearStage(clock, state);
    expect(state.stageIndex).toBe(1);
    expect(state.isLocked('kick', 0)).toBe(true);
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

describe('the entry', () => {
  /** Arm a run and hand back the absolute bar index the count-in occupies. */
  function armed() {
    const { clock, state } = make();
    state.requestRun();
    return { clock, state, countInBar: clock.nextBarBoundary(0.15) };
  }

  it('is still out in the distance for all but the end of the count-in', () => {
    const { clock, state, countInBar } = armed();

    // Anywhere it has arrived, the world scrolls through a character that is not yet
    // running the bar and therefore answers none of it. So the approach owns the count.
    for (const fraction of [0, 0.25, 0.5, 0.75]) {
      clock.now = clock.timeOfBar(countInBar) + fraction * clock.barDuration;
      expect(state.characterPose.mode).toBe('entering');
    }
  });

  it('arrives when the count ends, with just enough left for step 0', () => {
    const { clock, state, countInBar } = armed();
    const runBarTime = clock.timeOfBar(countInBar + 1);
    const arrival = runBarTime - state.entryHeadroomSeconds;

    clock.now = arrival - 0.001;
    expect(state.characterPose.mode).toBe('entering');
    clock.now = arrival + 0.001;
    expect(state.characterPose.mode).toBe('running');

    // The floor: step 0's action begins `longestActionLead` before the bar line and is
    // damped away while the character is still distant. The run decision reaches back
    // further still and puts the character into RUNNING, which would cut the walk off
    // mid-stride rather than let it finish.
    expect(state.entryHeadroomSeconds).toBeGreaterThanOrEqual(state.longestActionLead);
    expect(state.entryHeadroomSeconds).toBeGreaterThan(RUN_DECISION_LEAD);
    // The ceiling: anything more than a settling margin is time spent standing in the
    // obstacle field, which is the thing being fixed.
    expect(state.entryHeadroomSeconds).toBeLessThan(RUN_DECISION_LEAD + 0.1);
  });

  it('walks the whole way in, once, without turning back', () => {
    const { clock, state, countInBar } = armed();
    const arrival = clock.timeOfBar(countInBar + 1) - state.entryHeadroomSeconds;

    let previous = -1;
    for (let i = 0; i <= 20; i++) {
      clock.now = clock.timeOfBar(countInBar) + (i / 20) * (arrival - clock.timeOfBar(countInBar));
      const pose = state.characterPose;
      const progress = pose.mode === 'entering' ? pose.progress : 1;
      expect(progress).toBeGreaterThanOrEqual(previous);
      previous = progress;
    }
    expect(previous).toBeCloseTo(1, 6);
  });
});

describe('the failure hint', () => {
  it('arms after enough consecutive failures on one stage', () => {
    const { clock, state } = make();
    for (let i = 1; i <= HINT_AFTER_FAILURES; i++) {
      expect(state.hintActive).toBe(false);
      failRun(clock, state);
      expect(state.failStreak).toBe(i);
    }
    expect(state.hintActive).toBe(true);
  });

  it('resets when the stage is finally cleared', () => {
    const { clock, state } = make();
    for (let i = 0; i < HINT_AFTER_FAILURES; i++) failRun(clock, state);
    expect(state.hintActive).toBe(true);

    clearStage(clock, state);
    expect(state.failStreak).toBe(0);
    expect(state.hintActive).toBe(false);
  });
});

describe('the stuck arrow', () => {
  /** Fail a run and come back out the far side of the death camera, in EDITING. */
  function die(clock: StubClock, state: GameState): void {
    failRun(clock, state);
    releaseCamera(clock, state);
  }

  /**
   * Clear the two single-kick stages and stop on stage 3, whose two new pillars — kick 4
   * and kick 12 — are the chapter's first pair of obstacles that can be missed
   * separately. Stages 1 and 2 are committed by then, so only these two can break.
   */
  function twoOpenObstacles() {
    const made = make();
    clearStage(made.clock, made.state);
    clearStage(made.clock, made.state);
    expect(made.state.stageIndex).toBe(2);
    return made;
  }

  it('says nothing the first time an obstacle is missed', () => {
    const { clock, state } = make();
    die(clock, state);
    expect(state.failure?.step).toBe(0);
    expect(state.arrowCell).toBeNull();
  });

  it('points at the missing cell from the second failure on', () => {
    const { clock, state } = make();
    die(clock, state);
    die(clock, state);
    expect(state.arrowCell).toEqual({ instrument: 'kick', step: 0 });

    // And every failure after that, rather than the second one only.
    die(clock, state);
    expect(state.arrowCell).toEqual({ instrument: 'kick', step: 0 });
  });

  it('waits for the death camera to finish', () => {
    const { clock, state } = make();
    die(clock, state);

    failRun(clock, state);
    expect(state.phase).toBe('failed');
    expect(state.arrowCell).toBeNull();

    releaseCamera(clock, state);
    expect(state.arrowCell).toEqual({ instrument: 'kick', step: 0 });
  });

  it('stays up through the count-in and stands down for the run', () => {
    const { clock, state } = make();
    die(clock, state);
    die(clock, state);

    // An edit made during the count-in still counts, so the arrow is still worth
    // something there and stays.
    state.requestRun();
    const runBar = clock.nextBarBoundary(clock.now + 0.15) + 1;
    expect(state.phase).toBe('armed');
    expect(state.arrowCell).toEqual({ instrument: 'kick', step: 0 });

    clock.now = clock.timeOfBar(runBar) - RUN_DECISION_LEAD + 0.001;
    state.update();
    expect(state.phase).toBe('running');
    expect(state.arrowCell).toBeNull();
  });

  it('follows the cell instead of being dismissed once', () => {
    const { clock, state } = make();
    die(clock, state);
    die(clock, state);

    state.toggle('kick', 0);
    expect(state.arrowCell).toBeNull();
    // Emptied again before the next run, so the question is back and so is the arrow.
    state.toggle('kick', 0);
    expect(state.arrowCell).toEqual({ instrument: 'kick', step: 0 });
  });

  it('counts per obstacle, so one death each on two of them is not being stuck', () => {
    const { clock, state } = twoOpenObstacles();

    die(clock, state);
    expect(state.failure?.step).toBe(4);
    expect(state.arrowCell).toBeNull();

    // Answering the first pillar carries the run to the second one, which is a different
    // obstacle with a tally of its own. Two deaths, two stage-side lessons, no arrow.
    state.toggle('kick', 4);
    die(clock, state);
    expect(state.failure?.step).toBe(12);
    expect(state.arrowCell).toBeNull();
  });

  it('starts an obstacle over once it has been passed', () => {
    const { clock, state } = twoOpenObstacles();

    die(clock, state);
    die(clock, state);
    expect(state.arrowCell).toEqual({ instrument: 'kick', step: 4 });

    // Filling the cell answers the arrow; getting past the obstacle clears its tally.
    state.toggle('kick', 4);
    expect(state.arrowCell).toBeNull();
    die(clock, state);
    expect(state.failure?.step).toBe(12);

    // Breaking it again asks from scratch: the first death back is a first death.
    state.toggle('kick', 4);
    die(clock, state);
    expect(state.failure?.step).toBe(4);
    expect(state.arrowCell).toBeNull();
    die(clock, state);
    expect(state.arrowCell).toEqual({ instrument: 'kick', step: 4 });
  });

  it('does not follow the player into the next stage', () => {
    const { clock, state } = twoOpenObstacles();
    die(clock, state);
    die(clock, state);
    expect(state.arrowCell).toEqual({ instrument: 'kick', step: 4 });

    clearStage(clock, state);
    expect(state.stageIndex).toBe(3);
    expect(state.arrowCell).toBeNull();
  });
});

describe('free play after chapter completion', () => {
  function completeChapter(events: StateEvents = {}) {
    const made = make(events);
    for (let i = 0; i < CHAPTER_1.stages.length; i++) clearStage(made.clock, made.state);
    return made;
  }

  it('completes the chapter and fires onComplete once', () => {
    let completions = 0;
    const { state } = completeChapter({ onComplete: () => completions++ });
    expect(state.complete).toBe(true);
    expect(state.phase).toBe('editing');
    expect(completions).toBe(1);
  });

  it('unlocks every row and every committed note', () => {
    const { state } = completeChapter();
    expect(state.unlockedRows.size).toBe(CHAPTER_1.rows.length);
    for (const row of CHAPTER_1.rows) {
      for (let step = 0; step < CHAPTER_1.patternLength; step++) {
        expect(state.isLocked(row, step)).toBe(false);
      }
    }
    // The full track survives the unlock. Derived from the chapter rather than pinned
    // to a number, so it keeps meaning "all of it" when the chapter is retuned.
    expect(state.used).toBe(noteBudget(CHAPTER_1, CHAPTER_1.stages.length - 1));
  });

  it('lifts the budget', () => {
    const { state } = completeChapter();
    const before = state.used;
    state.toggle('crash', 8); // nothing requires this, and the budget is long spent
    expect(state.used).toBe(before + 1);
    // And notes that used to be committed can now be removed.
    state.toggle('kick', 0);
    expect(state.used).toBe(before);
  });

  it('has no runs', () => {
    const { state } = completeChapter();
    state.requestRun();
    expect(state.phase).toBe('editing');
  });

  it('keeps the character performing', () => {
    const { state } = completeChapter();
    expect(state.characterPose).toEqual({ mode: 'running', progress: 1 });
  });
});
