import type { GameState, Phase } from '../game/state';
import type { Instrument } from '../game/types';

/**
 * The step grid.
 *
 * Plain DOM. The playhead is a single element moved by a CSS custom property that the
 * frame loop writes from `stepFloat`, so it tracks the audio clock rather than an
 * animation of its own.
 *
 * Edits are live: toggling a cell changes what is audible on the very next pass. There
 * is no apply step.
 */

const STATUS: Record<Phase, string> = {
  editing: 'editing',
  armed: 'count in',
  running: 'running',
  success: 'clear',
  failed: 'editing', // never shown: FAILED is reported as EDITING, see update()
};

export class SequencerUI {
  private readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly playhead: HTMLElement;
  private readonly stageLabel: HTMLElement;
  private readonly status: HTMLElement;
  private readonly budget: HTMLElement;

  private readonly rows = new Map<Instrument, HTMLElement>();
  private readonly cells = new Map<Instrument, HTMLButtonElement[]>();

  private readonly unlocked = new Set<Instrument>();
  /** What the DOM currently shows, so the frame loop never reads back from it. */
  private readonly shown = new Map<Instrument, boolean[]>();
  private readonly shownLocked = new Map<Instrument, boolean[]>();
  private lastBudget = '';
  private lastStatus = '';
  private lastStageLabel = '';

  constructor(
    container: HTMLElement,
    instruments: Instrument[],
    patternLength: number,
    onToggle: (instrument: Instrument, step: number) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'seq';
    this.root.style.setProperty('--steps', String(patternLength));

    const head = document.createElement('div');
    head.className = 'seq-head';

    this.stageLabel = document.createElement('div');
    this.stageLabel.className = 'seq-stage';

    this.status = document.createElement('div');
    this.status.className = 'seq-status';

    this.budget = document.createElement('div');
    this.budget.className = 'seq-budget';

    head.append(this.stageLabel, this.status, this.budget);

    this.grid = document.createElement('div');
    this.grid.className = 'seq-grid';

    for (const instrument of instruments) {
      const row = document.createElement('div');
      row.className = 'seq-row locked';
      row.dataset.instrument = instrument;

      const name = document.createElement('div');
      name.className = 'seq-name';
      name.textContent = instrument;

      const lane = document.createElement('div');
      lane.className = 'seq-lane';

      const rowCells: HTMLButtonElement[] = [];
      for (let step = 0; step < patternLength; step++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'seq-cell';
        cell.dataset.step = String(step);
        // Quarter note columns get slightly stronger column separators.
        cell.dataset.quarter = String(step % 4 === 0);
        cell.setAttribute('aria-pressed', 'false');
        cell.setAttribute('aria-label', `${instrument} step ${step}`);

        const pad = document.createElement('span');
        pad.className = 'pad';
        cell.append(pad);

        cell.addEventListener('click', () => onToggle(instrument, step));
        lane.append(cell);
        rowCells.push(cell);
      }

      row.append(name, lane);
      this.grid.append(row);
      this.rows.set(instrument, row);
      this.cells.set(instrument, rowCells);
      this.shown.set(instrument, new Array<boolean>(patternLength).fill(false));
      this.shownLocked.set(instrument, new Array<boolean>(patternLength).fill(false));
    }

    this.playhead = document.createElement('div');
    this.playhead.className = 'seq-playhead';
    this.grid.append(this.playhead);

    this.root.append(head, this.grid);
    container.append(this.root);
  }

  /** Called every frame with a position derived from the audio clock. */
  update(state: GameState, stepFloat: number): void {
    this.playhead.style.setProperty('--step', stepFloat.toFixed(4));

    this.syncUnlocks(state);
    this.syncPattern(state);

    // Free play has no budget, so the readout becomes a plain note count.
    const budgetText = state.complete
      ? `${state.used} notes`
      : `${state.used} / ${state.budget}`;
    if (budgetText !== this.lastBudget) {
      this.lastBudget = budgetText;
      this.budget.textContent = budgetText;
      this.budget.classList.toggle('full', !state.complete && state.used >= state.budget);
    }

    const stageText = state.complete
      ? 'chapter clear'
      : `stage ${state.stage.id} — ${state.stage.label}`;
    if (stageText !== this.lastStageLabel) {
      this.lastStageLabel = stageText;
      this.stageLabel.textContent = stageText;
    }

    // FAILED reads as EDITING here on purpose. Nothing in the sequencer may change
    // appearance when a run fails: the stage says which obstacle and therefore which
    // instrument, and working out which step from its position against the quarter-note
    // scenery is the skill the game exists to teach.
    const phase = state.phase === 'failed' ? 'editing' : state.phase;
    const statusText = state.complete && phase === 'editing' ? 'free play' : STATUS[phase];
    if (statusText !== this.lastStatus) {
      this.lastStatus = statusText;
      this.status.textContent = statusText;
      this.status.dataset.phase = phase;
    }
  }

  /**
   * A row appears when a stage first introduces an obstacle mapping to it.
   *
   * Until then it is not in the layout at all: the chapter opens as a single kick lane
   * and grows a lane per instrument as the world starts asking for it. The set only ever
   * grows — `state.unlockedRows` is derived from the accumulated obstacle set, and this
   * keeps its own record besides — so a row that has appeared is there for the rest of
   * the chapter even once its stage has receded into the background.
   */
  private syncUnlocks(state: GameState): void {
    for (const [instrument, row] of this.rows) {
      if (this.unlocked.has(instrument) || !state.isUnlocked(instrument)) continue;
      this.unlocked.add(instrument);
      row.classList.remove('locked');
      row.classList.add('unlocking');
      row.addEventListener('animationend', () => row.classList.remove('unlocking'), { once: true });
    }
  }

  private syncPattern(state: GameState): void {
    for (const [instrument, rowCells] of this.cells) {
      const lane = state.pattern[instrument];
      const shown = this.shown.get(instrument)!;
      const shownLocked = this.shownLocked.get(instrument)!;

      for (let step = 0; step < rowCells.length; step++) {
        const cell = rowCells[step]!;

        const on = lane[step] === true;
        if (shown[step] !== on) {
          shown[step] = on;
          cell.setAttribute('aria-pressed', String(on));
        }

        // A note committed by an earlier stage greys out and stops responding, the same
        // way its obstacle recedes on stage. It keeps playing.
        const committed = state.isLocked(instrument, step);
        if (shownLocked[step] !== committed) {
          shownLocked[step] = committed;
          cell.classList.toggle('committed', committed);
          cell.setAttribute('aria-disabled', String(committed));
        }
      }
    }
  }


  /** Placing a note with zero budget remaining. */
  shakeBudget(): void {
    this.budget.classList.remove('shake');
    void this.budget.offsetWidth;
    this.budget.classList.add('shake');
    this.budget.addEventListener('animationend', () => this.budget.classList.remove('shake'), {
      once: true,
    });
  }
}
