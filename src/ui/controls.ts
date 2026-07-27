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
 * look. The banner is the offer of a run and nothing else: the moment one is under way
 * there is no offer to make, so it goes. It comes back when the run resolves, including
 * under the death camera, where R is the retry.
 *
 * It goes by `visibility` rather than by leaving the layout. Reflowing the page would
 * resize the canvas at the exact moment the player has started watching the world, and
 * against a uniform paper background a reserved gap and an absence look the same.
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
 * The phases in which there is a run to offer.
 *
 * FAILED is one of them, and reads exactly as EDITING does. Nothing outside the stage may
 * say that a run failed — the death camera names the obstacle, and a banner that behaved
 * differently after a failure would hand over for free the fact that there is something
 * to find. It is also the phase R exists for.
 */
const OFFERS_A_RUN: ReadonlySet<Phase> = new Set<Phase>(['editing', 'failed']);

export class Controls {
  private readonly run: HTMLButtonElement;
  private readonly restart: HTMLButtonElement;
  private readonly restartLabel: HTMLElement;
  private readonly restartText: string;

  private armed: number | null = null;
  private shownComplete: boolean | null = null;
  private shownLive: boolean | null = null;

  constructor(root: HTMLElement, actions: ControlActions) {
    this.run = button(root, 'run', 'run');
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
      // Free play has no obstacles, so a run has nothing to succeed or fail against. This
      // one never comes back, so it leaves the layout for good rather than going blank.
      this.run.hidden = state.complete;
    }

    const live = OFFERS_A_RUN.has(state.phase);
    if (live === this.shownLive) return;
    this.shownLive = live;
    // Disabled as well as invisible, so nothing can be tabbed to or clicked through
    // while a run it cannot affect is playing out.
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
