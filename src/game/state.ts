import type { Transport } from '../audio/transport';
import { MAX_LEAD_SECONDS } from './actions';
import { activeObstacles, activeStems, noteBudget } from './chapter1';
import { requiredInstruments, simulate } from './simulate';
import type { Chapter, Instrument, Obstacle, Pattern, Result } from './types';
import { clonePattern, countNotes, emptyPattern } from './types';

/**
 * The run state machine.
 *
 * The world scroll, the backing layers and the player's pattern are always running and
 * always audible. Nothing here ever stops the transport, reloads a scene or opens a
 * dialog, from stage 1 through stage 10 and through every failure in between.
 *
 * FAILED is entered at the collision and held for the death camera, then released to
 * EDITING. Editing is never locked, so the player can already be placing notes while it
 * plays.
 */
export type Phase = 'editing' | 'armed' | 'running' | 'success' | 'failed';

/**
 * The death camera, in seconds.
 *
 * Stage presentation only. The transport, the drum voices, the backing layers and the
 * sequencer playhead all keep running untouched through it — "freeze the run" freezes
 * what the stage shows, not the clock.
 */
export const DEATH_CAMERA = {
  /** The last 200ms of approach, dilated into this much real time. */
  slowmo: 0.45,
  /** Held on the culprit after the slow motion resolves. */
  hold: 1.15,
  /** How much of the approach is replayed. */
  replay: 0.2,
  /** Total time the stage stays under the camera. */
  total: 1.6,
};

/**
 * How long before the run bar the run's pattern is fixed and its outcome decided.
 *
 * The moment of truth cannot be the bar line itself. The audio scheduler hands out the
 * run bar's first steps up to 100ms before the bar begins, and step 0's animation starts
 * `MAX_LEAD_SECONDS` (144ms) before it, so by the time the bar line arrives the run has
 * already been partly performed. Deciding at the bar line would let an edit land in that
 * window and change the outcome after its own audio and animation had fired — the one
 * thing the design forbids is the presentation contradicting the decided result.
 *
 * So the snapshot is taken this far ahead, comfortably outside both leads, and the whole
 * run bar — outcome, drum audio and animations alike — is played from it. Edits during
 * the count-in still count right up to this moment, and the live pattern is audible again
 * the instant the run bar ends.
 */
export const RUN_DECISION_LEAD = 0.3;

/**
 * Consecutive failures on one stage before the death camera starts helping.
 *
 * The sequencer never names the failed step — finding it is the skill the game
 * teaches — but a player stuck this long gets a floor put under them: the camera also
 * holds the quarter-note landmarks up out of the dim, so the culprit can be read
 * against the beat ruler instead of against a uniformly dimmed stage. The search
 * narrows; the answer is still theirs to find.
 */
export const HINT_AFTER_FAILURES = 3;

/** Fraction of the count-in bar the character spends arriving out of the distance. */
const ENTRY_FRACTION = 0.32;
/** Fraction of the success flourish the character spends receding into the distance. */
const EXIT_FRACTION = 0.38;

/** Where the character is, and whether the stage draws it at all. */
export interface CharacterPose {
  mode: 'hidden' | 'entering' | 'running' | 'exiting' | 'down';
  /** 0..1 through `entering` or `exiting`; ignored otherwise. */
  progress: number;
}

export interface Failure {
  step: number;
  instrument: Instrument;
  /**
   * Audio-clock time the camera took over, which is `DEATH_CAMERA.replay` seconds of
   * world time *before* the collision. The approach decelerates into the impact from
   * here rather than being rewound after it.
   */
  at: number;
  /** Absolute step position the world had reached when the camera took over. */
  fromStep: number;
  /** Absolute step position of the collision itself. */
  collisionStep: number;
}

export interface StateEvents {
  /** The collision: drives the death camera and the ground marker. */
  onFail?: (failure: Failure) => void;
  /**
   * A run decided a success, fired at the decision. `flourishTime` is the audio time
   * the success flourish begins on — the bar line after the run bar — so a cue can be
   * scheduled onto it sample-accurately, ahead of time like all audio here.
   */
  onSuccess?: (flourishTime: number) => void;
  /** The bar line where the next stage's obstacles rise into the world. */
  onStageAdvance?: (stageIndex: number) => void;
  /** The chapter is finished: free play begins and the obstacles leave the world. */
  onComplete?: () => void;
  /** A note placed with zero budget remaining. */
  onBudgetReject?: () => void;
}

export class GameState {
  readonly chapter: Chapter;
  private readonly transport: Transport;
  private readonly events: StateEvents;

  phase: Phase = 'editing';
  stageIndex = 0;
  pattern: Pattern;
  /** True once stage 10 has been cleared. The chapter keeps playing. */
  complete = false;
  /** The most recent failure, kept so its marker stays on the ground. */
  failure: Failure | null = null;
  /** Failures on this stage since it was last cleared. Drives the death camera hint. */
  failStreak = 0;
  /**
   * Notes committed by clearing a stage. They keep playing but can no longer be changed.
   *
   * The budget is exact and a stage only clears when the placed notes are precisely the
   * derived solution, so everything on the grid at that moment is known-correct. Freezing
   * it means each stage asks the player about its own new obstacles and nothing else,
   * which is what keeps stage 10 tractable rather than a twenty-one note re-audit.
   */
  private readonly locked: Pattern;

  /** Absolute bar indices, set when a run is armed. */
  private countInBar = 0;
  private runBar = 0;
  /** Set when a run is decided a success, so the scheduler can bring the stem in on time. */
  private advanceAtBar: number | null = null;
  private runResult: Result | null = null;
  /**
   * The pattern as it stood at the run decision, `RUN_DECISION_LEAD` before the run bar.
   *
   * The run bar is performed entirely from this snapshot — outcome, drum audio and
   * animations — so a live edit during the run can never contradict the decided result.
   * Null outside a run; every other bar plays the live pattern.
   */
  private runPattern: Pattern | null = null;

  constructor(chapter: Chapter, transport: Transport, events: StateEvents = {}) {
    this.chapter = chapter;
    this.transport = transport;
    this.events = events;
    this.pattern = emptyPattern(chapter.rows, chapter.patternLength);
    this.locked = emptyPattern(chapter.rows, chapter.patternLength);
  }

  /** Whether this note was committed by an earlier stage and is now fixed. */
  isLocked(instrument: Instrument, step: number): boolean {
    return this.locked[instrument][step] === true;
  }

  // ---------------------------------------------------------------- stage data

  get stage() {
    return this.chapter.stages[this.stageIndex]!;
  }

  get obstacles(): Obstacle[] {
    return activeObstacles(this.chapter, this.stageIndex);
  }

  get budget(): number {
    return noteBudget(this.chapter, this.stageIndex);
  }

  get used(): number {
    return countNotes(this.pattern);
  }

  get unlockedRows(): Set<Instrument> {
    // Free play: the whole kit, no puzzle attached.
    if (this.complete) return new Set(this.chapter.rows);
    return requiredInstruments(this.obstacles);
  }

  isUnlocked(instrument: Instrument): boolean {
    return this.unlockedRows.has(instrument);
  }

  /**
   * The stems playing in a given absolute bar.
   *
   * The lookahead scheduler asks about bars up to 100ms in the future, so it has to be
   * told about a stage advance that the frame loop has not applied yet. A successful
   * run fixes its advance bar two bars ahead, well outside the lookahead window.
   */
  stemsForBar(bar: number): string[] {
    const advanced = this.advanceAtBar !== null && bar >= this.advanceAtBar;
    const index = advanced ? Math.min(this.stageIndex + 1, this.chapter.stages.length - 1) : this.stageIndex;
    return activeStems(this.chapter, index);
  }

  /** Whether this bar is the count-in bar, for the scheduler's ticks. */
  isCountInBar(bar: number): boolean {
    return this.phase === 'armed' && bar === this.countInBar;
  }

  // ------------------------------------------------------------------ editing

  /**
   * Cells are editable in every phase.
   *
   * Patch 1 C2 requires that nothing in the sequencer changes appearance when a run
   * fails. Locking the grid during a run would do exactly that: the lock would lift the
   * instant a run failed, which is a visible change caused by failing. Editing stays
   * live throughout instead, which is also what the design asks for everywhere else.
   */
  toggle(instrument: Instrument, step: number): void {
    if (!this.isUnlocked(instrument)) return;
    if (this.isLocked(instrument, step)) return;

    const lane = this.pattern[instrument];
    if (step < 0 || step >= lane.length) return;

    // Free play has no budget: extra hits were always harmless by rule, and with the
    // chapter finished there is nothing left to brute-force.
    if (!this.complete && !lane[step] && this.used >= this.budget) {
      // The budget is exact. Placing a wrong note is never punished with a failure;
      // the player simply cannot afford both the wrong note and the right one.
      this.events.onBudgetReject?.();
      return;
    }

    lane[step] = !lane[step];
  }

  /** Escape: clear this stage's own notes, leaving committed ones alone. */
  clearEditable(): void {
    const unlocked = this.unlockedRows;
    for (const instrument of this.chapter.rows) {
      if (!unlocked.has(instrument)) continue;
      const lane = this.pattern[instrument];
      const committed = this.locked[instrument];
      for (let step = 0; step < lane.length; step++) {
        if (!committed[step]) lane[step] = false;
      }
    }
  }

  /**
   * The hits on a step, for the scheduler and for the character's actions.
   *
   * `bar` selects the pattern source: the run bar reads the snapshot taken at the run
   * decision, every other bar reads the live pattern. Callers that pass no bar always
   * read live.
   */
  hitsAt(stepInBar: number, bar?: number): Instrument[] {
    const hits: Instrument[] = [];
    for (const instrument of this.chapter.rows) {
      if (this.laneFor(instrument, bar)[stepInBar]) hits.push(instrument);
    }
    return hits;
  }

  /** The lane a given absolute bar plays from: the run snapshot for the run bar, live otherwise. */
  laneFor(instrument: Instrument, bar?: number): readonly boolean[] {
    const source = this.runPattern !== null && bar === this.runBar ? this.runPattern : this.pattern;
    return source[instrument];
  }

  // ---------------------------------------------------------------- run cycle

  /**
   * Space or R. Arms a run at the next safe bar boundary.
   *
   * Gone once the chapter is complete: free play has no obstacles, so a run has
   * nothing to succeed or fail against. The character is already on stage performing
   * the track, which is what a run was for.
   */
  requestRun(): void {
    if (this.complete) return;
    // Retry is a single input, so R during the death camera cuts it short and arms.
    if (this.phase !== 'editing' && this.phase !== 'failed') return;

    this.failure = null;
    // The count-in has to start on a bar the lookahead scheduler has not already
    // passed, otherwise its first ticks would be missed.
    this.countInBar = this.transport.nextBarBoundary(this.transport.now + 0.15);
    this.runBar = this.countInBar + 1;
    this.runResult = null;
    this.runPattern = null;
    this.phase = 'armed';
  }

  /**
   * Frame tick. Reads the audio clock and nothing else; it never accumulates time.
   * Every transition below is a comparison against a bar or step position derived from
   * `AudioContext.currentTime`.
   */
  update(): void {
    if (!this.transport.started) return;

    const barFloat = this.transport.barFloat;

    switch (this.phase) {
      case 'failed':
        // Held for the death camera, then released to EDITING. Editing was never
        // locked, so the player can already be placing notes while it plays.
        if (!this.failure || this.transport.now >= this.failure.at + DEATH_CAMERA.total) {
          this.phase = 'editing';
        }
        break;

      case 'armed':
        // The decision moment, not the bar line: see RUN_DECISION_LEAD.
        if (this.transport.now >= this.runBarTime - RUN_DECISION_LEAD) this.startRun();
        break;

      case 'running': {
        const result = this.runResult;
        if (!result) break;
        if (result.ok) {
          if (barFloat >= this.runBar + 1) {
            this.advanceAtBar = this.runBar + 2;
            this.runPattern = null;
            this.phase = 'success';
          }
        } else {
          // Hand over to the camera a little before the impact, so the approach can
          // decelerate into it. Rewinding after the fact reads as a jerk backwards.
          const collisionStep = this.runBar * this.chapter.patternLength + result.failStep;
          const collisionTime = this.transport.timeOfStep(collisionStep);
          if (this.transport.now >= collisionTime - DEATH_CAMERA.replay) {
            this.fail(result.failStep, result.missing, collisionStep);
          }
        }
        break;
      }

      case 'success':
        if (this.advanceAtBar !== null && barFloat >= this.advanceAtBar) this.advanceStage();
        break;

      case 'editing':
        break;
    }
  }

  /**
   * Where the character is, and whether the stage draws it at all.
   *
   * The character exists only for the run. During EDITING the world scrolls and the
   * music plays with an empty stage; it enters from off screen left during the count-in
   * and arrives at DINO_X at running speed, early enough that an anticipatory action for
   * step 0 is already under way by the time step 0 lands.
   */
  get characterPose(): CharacterPose {
    // Once the chapter is done there is nothing left to solve, so the character stays and
    // performs the finished track for good: no exit, no entry, no empty stage.
    if (this.complete && this.phase !== 'failed') return { mode: 'running', progress: 1 };

    switch (this.phase) {
      case 'editing':
        return { mode: 'hidden', progress: 0 };

      case 'armed': {
        const into = this.transport.barFloat - this.countInBar;
        if (into < 0) return { mode: 'hidden', progress: 0 };
        if (into >= ENTRY_FRACTION) return { mode: 'running', progress: 1 };
        return { mode: 'entering', progress: into / ENTRY_FRACTION };
      }

      case 'running':
        return { mode: 'running', progress: 1 };

      case 'success': {
        // The run that clears the last stage does not exit. `complete` is only set when
        // the stage actually advances, so without this the character would recede into
        // the distance and then pop straight back in.
        if (this.stageIndex + 1 >= this.chapter.stages.length) {
          return { mode: 'running', progress: 1 };
        }
        const progress = this.successProgress / EXIT_FRACTION;
        return progress >= 1
          ? { mode: 'hidden', progress: 1 }
          : { mode: 'exiting', progress };
      }

      case 'failed':
        return { mode: 'down', progress: 0 };
    }
  }

  /** The audio time the run bar begins. */
  get runBarTime(): number {
    return this.transport.timeOfBar(this.runBar);
  }

  /** The longest lead any action needs, so the entry can be checked against it. */
  get longestActionLead(): number {
    return MAX_LEAD_SECONDS;
  }

  /**
   * How long before the run bar the character is in position.
   *
   * The entry has to finish early enough for step 0's animation to have begun, which for
   * a 400ms jump means 200ms of lead.
   */
  get entryHeadroomSeconds(): number {
    return (1 - ENTRY_FRACTION) * this.transport.barDuration;
  }

  /** Progress through the success flourish, 0..1. Drives the character's exit. */
  get successProgress(): number {
    if (this.phase !== 'success' || this.advanceAtBar === null) return 0;
    const into = this.transport.barFloat - (this.advanceAtBar - 1);
    return Math.min(1, Math.max(0, into));
  }

  /** Count-in beats remaining, 4..1, or null when not counting in. */
  get countInBeat(): number | null {
    // RUNNING is included because the run decision lands slightly before the bar line,
    // and the final beat of the count-in must not vanish with it.
    if (this.phase !== 'armed' && this.phase !== 'running') return null;
    const into = this.transport.barFloat - this.countInBar;
    if (into < 0 || into >= 1) return null;
    return 4 - Math.floor(into * 4);
  }

  private startRun(): void {
    // The outcome is computed in full before any of it animates. The animation
    // presents an already-decided result, and the run bar is performed from the same
    // snapshot the outcome was computed from.
    this.runPattern = clonePattern(this.pattern);
    this.runResult = simulate(this.obstacles, this.runPattern, this.chapter.patternLength);
    this.phase = 'running';

    // A decided success is irrevocable, so the flourish cue can be scheduled now,
    // onto the bar line where the flourish will begin.
    if (this.runResult.ok) {
      this.events.onSuccess?.(this.transport.timeOfBar(this.runBar + 1));
    }
  }

  private fail(step: number, instrument: Instrument, collisionStep: number): void {
    this.failure = {
      step,
      instrument,
      at: this.transport.now,
      // Where the world actually is right now, so the camera can take over without a
      // discontinuity even when the collision is close enough that there is no room to
      // decelerate — a failure on step 0 hands over exactly at the impact.
      fromStep: Math.min(this.transport.absoluteStepFloat, collisionStep),
      collisionStep,
    };
    this.runResult = null;
    // The live pattern is audible again through the death camera and beyond.
    this.runPattern = null;
    this.failStreak++;
    this.phase = 'failed';
    this.events.onFail?.(this.failure);
  }

  /** Whether the death camera should hold the beat ruler up out of the dim. */
  get hintActive(): boolean {
    return this.failStreak >= HINT_AFTER_FAILURES;
  }

  private advanceStage(): void {
    this.advanceAtBar = null;
    this.runResult = null;
    this.failStreak = 0;

    if (this.stageIndex + 1 >= this.chapter.stages.length) {
      // The chapter is done and free play begins: the obstacles leave the world, so
      // there is nothing left for a lock to protect. Everything unlocks, and the
      // finished pattern becomes an instrument.
      this.complete = true;
      for (const instrument of this.chapter.rows) {
        this.locked[instrument].fill(false);
      }
      this.events.onComplete?.();
    } else {
      // Everything on the grid cleared this stage, so it is all correct. Commit it.
      for (const instrument of this.chapter.rows) {
        const lane = this.pattern[instrument];
        const committed = this.locked[instrument];
        for (let step = 0; step < lane.length; step++) {
          if (lane[step]) committed[step] = true;
        }
      }
      this.stageIndex++;
      this.events.onStageAdvance?.(this.stageIndex);
    }
    this.phase = 'editing';
  }
}
