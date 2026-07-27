import type { GameState, Phase } from '../game/state';

/**
 * The on-screen controls.
 *
 * Every input the game has is a button, sized to be pressed with a thumb. The keyboard
 * shortcut for each one is printed on the button itself rather than in a legend
 * underneath: a separate list of key hints is dead weight on a phone, and on a desktop it
 * puts the name of the action in two places at once. The chips hide themselves on devices
 * with no keyboard to hint at, which leaves plain buttons.
 *
 * Run is not in the row. It lives above the stage as a banner, because it is the one
 * control a player has to find and the row under the sequencer is the last place they
 * look. While a run is in flight the banner goes inert and reports the phase instead of
 * disappearing, so the canvas never shifts under a run that is already being watched.
 *
 * Buttons blur themselves after a click: left focused, the next Space would re-trigger
 * the button rather than reaching the window handler that arms a run.
 */

interface ControlActions {
  onRun: () => void;
  onClear: () => void;
  onRestart: () => void;
}

/** How long the restart button stays armed waiting for its confirming press. */
const RESTART_ARM_MS = 3000;

/**
 * What the banner reads while a run is under way.
 *
 * EDITING and FAILED are deliberately absent, so both fall through to the offer to run.
 * Nothing outside the stage may say that a run failed: the death camera names the
 * obstacle, and the banner going quiet or changing colour on a failure would hand over
 * for free the fact that there is something to find.
 */
const IN_FLIGHT: Partial<Record<Phase, string>> = {
  armed: 'count in',
  running: 'running',
  success: 'clear',
};

export class Controls {
  private readonly run: HTMLButtonElement;
  private readonly runLabel: HTMLElement;
  private readonly restart: HTMLButtonElement;
  private readonly restartLabel: HTMLElement;
  private readonly restartText: string;

  private armed: number | null = null;
  private shownComplete: boolean | null = null;
  private shownRunLabel = '';

  constructor(root: HTMLElement, actions: ControlActions) {
    this.run = button(root, 'run', 'run');
    this.runLabel = labelOf(this.run);
    const clear = button(root, 'clear', 'clear');
    this.restart = button(root, 'restart', 'restart chapter');
    this.restartLabel = labelOf(this.restart);
    this.restartText = this.restartLabel.textContent ?? 'restart chapter';

    this.run.addEventListener('click', () => {
      actions.onRun();
      this.run.blur();
    });

    clear.addEventListener('click', () => {
      actions.onClear();
      clear.blur();
    });

    // Restarting wipes the save, so it asks twice: the first press arms the button,
    // a second one within a few seconds goes through.
    this.restart.addEventListener('click', () => {
      if (this.armed !== null) {
        window.clearTimeout(this.armed);
        this.armed = null;
        actions.onRestart();
        return;
      }
      this.restartLabel.textContent = 'sure? press again';
      this.restart.classList.add('armed');
      this.armed = window.setTimeout(() => this.disarm(), RESTART_ARM_MS);
      this.restart.blur();
    });
  }

  /** Called every frame. Writes to the DOM only when something actually changed. */
  update(state: GameState): void {
    if (this.shownComplete !== state.complete) {
      this.shownComplete = state.complete;
      // Free play has no obstacles, so a run has nothing to succeed or fail against.
      this.run.hidden = state.complete;
    }

    const label = IN_FLIGHT[state.phase] ?? 'run';
    if (label === this.shownRunLabel) return;
    this.shownRunLabel = label;
    this.runLabel.textContent = label;

    // `live` is the whole of the banner's state: pressable, marked and quietly breathing,
    // or inert and reporting. Disabled rather than merely styled, so a press during a
    // count-in cannot look like it did something.
    const live = label === 'run';
    this.run.disabled = !live;
    this.run.dataset.live = String(live);
  }

  private disarm(): void {
    this.armed = null;
    this.restartLabel.textContent = this.restartText;
    this.restart.classList.remove('armed');
  }
}

/**
 * The button with this id, wherever it is on the page.
 *
 * `index.html` is the source of truth for the markup — the run banner in particular sits
 * outside the control row — so this looks across the document and only builds a fallback
 * if a host page has omitted one entirely.
 */
function button(root: HTMLElement, id: string, label: string): HTMLButtonElement {
  const existing = document.querySelector<HTMLButtonElement>(`#${id}`);
  if (existing) return existing;

  const created = document.createElement('button');
  created.id = id;
  created.type = 'button';
  const text = document.createElement('span');
  text.className = 'label';
  text.textContent = label;
  created.append(text);
  root.append(created);
  return created;
}

/** A button's own words, which are wrapped so a key chip can sit beside them. */
function labelOf(element: HTMLButtonElement): HTMLElement {
  return element.querySelector<HTMLElement>('.label') ?? element;
}
