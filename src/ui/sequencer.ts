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
 *
 * Everything drawn here is derived from the state each frame and compared against what is
 * already on screen — the pattern, the row unlocks and the stuck arrow alike — so nothing
 * is ever read back out of the DOM.
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

  /**
   * The stuck arrow. One element for the life of the page, moved between cells: only one
   * can ever be up, and re-parenting it restarts its animation on arrival for free.
   */
  private readonly arrow: HTMLElement;
  /** The cell currently holding the arrow, so the frame loop never reads back from it. */
  private arrowHost: HTMLButtonElement | null = null;

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
        // Kept on the element so the arrow can extend the label and put it back again
        // without the frame loop having to parse what is already there.
        cell.dataset.label = `${instrument} step ${step}`;
        cell.setAttribute('aria-label', cell.dataset.label);

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

    // The playhead runs past the right edge on the last step, so it has to be clipped.
    // It gets its own clipping layer rather than the grid clipping everything, because
    // the stuck arrow stands above the cell it points at and the arrow on a top-row cell
    // stands above the grid itself — a clip on the grid would cut it in half.
    const playheadClip = document.createElement('div');
    playheadClip.className = 'seq-playhead-clip';
    this.playhead = document.createElement('div');
    this.playhead.className = 'seq-playhead';
    playheadClip.append(this.playhead);
    this.grid.append(playheadClip);

    // Built once and left detached until a cell earns it. Decorative to a screen reader:
    // the cell it lands on carries the meaning, and it is the cell that gets labelled.
    this.arrow = document.createElement('span');
    this.arrow.className = 'seq-arrow';
    this.arrow.setAttribute('aria-hidden', 'true');

    this.root.append(head, this.grid);
    container.append(this.root);
  }

  /** Called every frame with a position derived from the audio clock. */
  update(state: GameState, stepFloat: number): void {
    this.playhead.style.setProperty('--step', stepFloat.toFixed(4));

    this.syncUnlocks(state);
    this.syncPattern(state);
    this.syncArrow(state);

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
    // scenery is the skill the game exists to teach. The arrow is the floor under that
    // rule rather than an exception to it — it costs a second failure on the same
    // obstacle and never lands until the camera is done. See `ARROW_AFTER_FAILURES`.
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

  /**
   * Put the arrow on the cell the state is pointing at, or take it off the grid.
   *
   * `state.arrowCell` is derived every frame rather than pushed as an event, so arriving,
   * moving and leaving are all the same comparison against what is currently on screen.
   * That is what lets it follow the cell's own state: filling the cell it points at
   * returns null here on the very next frame, and emptying it again brings it back.
   */
  private syncArrow(state: GameState): void {
    const target = state.arrowCell;
    const cell = target ? (this.cells.get(target.instrument)?.[target.step] ?? null) : null;
    if (cell === this.arrowHost) return;

    if (this.arrowHost) {
      delete this.arrowHost.dataset.hint;
      this.arrowHost.setAttribute('aria-label', this.arrowHost.dataset.label ?? '');
    }
    this.arrow.remove();

    this.arrowHost = cell;
    if (!cell) return;
    cell.dataset.hint = 'true';
    cell.setAttribute('aria-label', `${cell.dataset.label ?? ''}, missing note`);
    cell.append(this.arrow);
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
