import type { GameState } from '../game/state';

/**
 * The on-screen controls.
 *
 * Run, retry and clear were keyboard-only, which meant a phone could place notes and
 * then never actually play them. Every input the game has now has a button, and the
 * keyboard hints hide themselves on devices that have no keyboard to hint at.
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

export class Controls {
  private readonly run: HTMLButtonElement;
  private readonly restart: HTMLButtonElement;
  private readonly restartLabel: string;

  private armed: number | null = null;
  private shownComplete: boolean | null = null;

  constructor(root: HTMLElement, actions: ControlActions) {
    this.run = button(root, 'run', 'run');
    const clear = button(root, 'clear', 'clear');
    this.restart = button(root, 'restart', 'restart chapter');
    this.restartLabel = this.restart.textContent ?? 'restart chapter';

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
      this.restart.textContent = 'sure? press again';
      this.restart.classList.add('armed');
      this.armed = window.setTimeout(() => this.disarm(), RESTART_ARM_MS);
      this.restart.blur();
    });
  }

  /** Called every frame. Writes to the DOM only when something actually changed. */
  update(state: GameState): void {
    if (this.shownComplete === state.complete) return;
    this.shownComplete = state.complete;
    // Free play has no obstacles, so a run has nothing to succeed or fail against.
    this.run.hidden = state.complete;
  }

  private disarm(): void {
    this.armed = null;
    this.restart.textContent = this.restartLabel;
    this.restart.classList.remove('armed');
  }
}

function button(root: HTMLElement, id: string, label: string): HTMLButtonElement {
  const existing = root.querySelector<HTMLButtonElement>(`#${id}`);
  if (existing) return existing;

  const created = document.createElement('button');
  created.id = id;
  created.type = 'button';
  created.textContent = label;
  root.append(created);
  return created;
}
