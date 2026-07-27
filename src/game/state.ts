import type { Transport } from '../audio/transport';
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
 * FAILED is entered at the collision and left on the next frame, because the brief
 * returns to EDITING immediately; editing is already unlocked while it is held.
 */
export type Phase = 'editing' | 'armed' | 'running' | 'success' | 'failed';

export interface Failure {
  step: number;
  instrument: Instrument;
  /** Audio-clock time of the collision, for the stumble and the ground marker. */
  at: number;
}

export interface StateEvents {
  onPhaseChange?: (phase: Phase, previous: Phase) => void;
  onFail?: (failure: Failure) => void;
  onSuccess?: () => void;
  onStageAdvance?: (stageIndex: number) => void;
  onBudgetReject?: () => void;
  onPatternChange?: () => void;
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

  get editable(): boolean {
    return this.phase === 'editing' || this.phase === 'failed';
  }

  toggle(instrument: Instrument, step: number): void {
    if (!this.editable || !this.isUnlocked(instrument)) return;

    const lane = this.pattern[instrument];
    if (step < 0 || step >= lane.length) return;

    if (!lane[step] && this.used >= this.budget) {
      // The budget is exact. Placing a wrong note is never punished with a failure;
      // the player simply cannot afford both the wrong note and the right one.
      this.events.onBudgetReject?.();
      return;
    }

    lane[step] = !lane[step];
    this.events.onPatternChange?.();
  }

  /** Escape: clear every note in the unlocked, currently editable rows. */
  clearEditable(): void {
    if (!this.editable) return;
    const unlocked = this.unlockedRows;
    for (const instrument of this.chapter.rows) {
      if (!unlocked.has(instrument)) continue;
      this.pattern[instrument].fill(false);
    }
    this.events.onPatternChange?.();
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
    if (!this.editable) return;

    this.failure = null;
    // The count-in has to start on a bar the lookahead scheduler has not already
    // passed, otherwise its first ticks would be missed.
    this.countInBar = this.transport.nextBarBoundary(this.transport.now + 0.15);
    this.runBar = this.countInBar + 1;
    this.runResult = null;
    this.setPhase('armed');
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
        // Held for a single frame. The stumble, the ground marker and the cell flash
        // outlive it; editing is unlocked already.
        this.setPhase('editing');
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
            this.setPhase('success');
            this.events.onSuccess?.();
          }
        } else {
          const collision = this.runBar * this.chapter.patternLength + result.failStep;
          if (this.transport.absoluteStepFloat >= collision) this.fail(result.failStep, result.missing);
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

  /** Progress through the run bar, 0..1. Drives the character's exit and the run readout. */
  get runProgress(): number {
    if (this.phase !== 'running') return 0;
    return Math.min(1, Math.max(0, this.transport.barFloat - this.runBar));
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
    this.setPhase('running');
  }

  private fail(step: number, instrument: Instrument): void {
    this.failure = { step, instrument, at: this.transport.now };
    this.runResult = null;
    this.setPhase('failed');
    this.events.onFail?.(this.failure);
  }

  private advanceStage(): void {
    this.advanceAtBar = null;
    this.runResult = null;
    if (this.stageIndex + 1 >= this.chapter.stages.length) {
      this.complete = true;
    } else {
      this.stageIndex++;
      this.events.onStageAdvance?.(this.stageIndex);
    }
    this.setPhase('editing');
  }

  private setPhase(phase: Phase): void {
    if (phase === this.phase) return;
    const previous = this.phase;
    this.phase = phase;
    this.events.onPhaseChange?.(phase, previous);
  }
}
