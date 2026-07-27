import type { Transport } from '../audio/transport';
import { MAX_LEAD_SECONDS } from './actions';
import { activeObstacles, activeStems, noteBudget } from './chapter1';
import { requiredInstruments, simulate } from './simulate';
import type { Chapter, Instrument, Obstacle, Pattern, Result } from './types';
import { countNotes, emptyPattern } from './types';

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

/** Fraction of the count-in bar the character spends entering from off screen left. */
const ENTRY_FRACTION = 0.6;

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
  /** The bar line where the next stage's obstacles rise into the world. */
  onStageAdvance?: (stageIndex: number) => void;
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

    if (!lane[step] && this.used >= this.budget) {
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

  /** The hits on a step, for the scheduler and for the character's actions. */
  hitsAt(stepInBar: number): Instrument[] {
    const hits: Instrument[] = [];
    for (const instrument of this.chapter.rows) {
      if (this.pattern[instrument][stepInBar]) hits.push(instrument);
    }
    return hits;
  }

  // ---------------------------------------------------------------- run cycle

  /**
   * Space or R. Arms a run at the next safe bar boundary.
   *
   * Still allowed once the chapter is complete: there is no stage left to advance to,
   * so the run simply plays the finished pattern against the full obstacle set.
   */
  requestRun(): void {
    // Retry is a single input, so R during the death camera cuts it short and arms.
    if (this.phase !== 'editing' && this.phase !== 'failed') return;

    this.failure = null;
    // The count-in has to start on a bar the lookahead scheduler has not already
    // passed, otherwise its first ticks would be missed.
    this.countInBar = this.transport.nextBarBoundary(this.transport.now + 0.15);
    this.runBar = this.countInBar + 1;
    this.runResult = null;
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
        if (barFloat >= this.runBar) this.startRun();
        break;

      case 'running': {
        const result = this.runResult;
        if (!result) break;
        if (result.ok) {
          if (barFloat >= this.runBar + 1) {
            this.advanceAtBar = this.runBar + 2;
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
        const progress = this.successProgress;
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
    if (this.phase !== 'armed') return null;
    const into = this.transport.barFloat - this.countInBar;
    if (into < 0 || into >= 1) return null;
    return 4 - Math.floor(into * 4);
  }

  private startRun(): void {
    // The outcome is computed in full before any of it animates. The animation
    // presents an already-decided result.
    this.runResult = simulate(this.obstacles, this.pattern, this.chapter.patternLength);
    this.phase = 'running';
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
    this.phase = 'failed';
    this.events.onFail?.(this.failure);
  }

  private advanceStage(): void {
    this.advanceAtBar = null;
    this.runResult = null;

    // Everything on the grid cleared this stage, so it is all correct. Commit it.
    for (const instrument of this.chapter.rows) {
      const lane = this.pattern[instrument];
      const committed = this.locked[instrument];
      for (let step = 0; step < lane.length; step++) {
        if (lane[step]) committed[step] = true;
      }
    }

    if (this.stageIndex + 1 >= this.chapter.stages.length) {
      this.complete = true;
    } else {
      this.stageIndex++;
      this.events.onStageAdvance?.(this.stageIndex);
    }
    this.phase = 'editing';
  }
}
