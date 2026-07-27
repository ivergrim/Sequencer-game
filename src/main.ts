import './style.css';

import { unlockAudio } from './audio/context';
import { triggerCountIn, triggerDrum } from './audio/drums';
import { Stems } from './audio/stems';
import { Transport } from './audio/transport';
import { CHAPTER_1 } from './game/chapter1';
import { requiredNotes } from './game/simulate';
import { GameState } from './game/state';
import type { Instrument } from './game/types';
import { SequencerUI } from './ui/sequencer';
import type { RenderObstacle } from './ui/stage';
import { StageRenderer } from './ui/stage';

/**
 * Entry and wiring.
 *
 * Two consumers of the clock, and only these two:
 *
 *   - the lookahead scheduler, which schedules audio against the audio clock
 *   - the frame loop, which derives every position from `stepFloat` and advances the
 *     state machine by comparing derived positions against bar boundaries
 *
 * Once the transport starts it never stops, from stage 1 through stage 10, through
 * failures and stage transitions alike.
 */

const chapter = CHAPTER_1;

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const sequencerHost = document.querySelector<HTMLElement>('#sequencer')!;
const startOverlay = document.querySelector<HTMLElement>('#start')!;

let started = false;

/** Character actions waiting for the audio clock to reach the time they were scheduled for. */
interface PendingAction {
  time: number;
  hits: Instrument[];
}

async function start(): Promise<void> {
  if (started) return;
  started = true;

  const ctx = await unlockAudio();
  startOverlay.classList.add('gone');

  const transport = new Transport(ctx, chapter.bpm, chapter.patternLength);
  const stems = new Stems(transport.stepDuration);
  const stage = new StageRenderer(canvas, transport.stepDuration);

  const state = new GameState(chapter, transport, {
    onFail: (failure) => {
      stage.stumble(failure.at);
      sequencer.flash(failure.instrument, failure.step);
    },
    onStageAdvance: (index) => {
      // The next stage's obstacles rise into the world on this bar line.
      for (const obstacle of chapter.stages[index]!.obstacles) {
        renderObstacles.push({ ...obstacle, addedAt: transport.now });
      }
    },
    onBudgetReject: () => sequencer.shakeBudget(),
  });

  const sequencer = new SequencerUI(
    sequencerHost,
    chapter.rows,
    chapter.patternLength,
    (instrument, step) => state.toggle(instrument, step),
  );

  const renderObstacles: RenderObstacle[] = [];
  const pending: PendingAction[] = [];

  // Every layer is attempted; a missing file falls back to a synthesized substitute,
  // so this resolving or not never blocks the transport.
  const stemNames = chapter.stages.map((s) => s.stem).filter((s): s is string => s !== null);
  void stems.preload(stemNames);

  transport.onStep((event) => {
    // Backing layers, one bar at a time, at an absolute time from the transport start.
    if (event.stepInBar === 0) stems.scheduleBar(state.stemsForBar(event.bar), event.time);

    // The one bar count-in, on the quarter notes.
    if (state.isCountInBar(event.bar) && event.stepInBar % 4 === 0) {
      triggerCountIn(event.time, event.stepInBar === 0);
    }

    // The player's pattern is always audible, in every state. Editing is live: this
    // reads the pattern as it stands when the step is scheduled, so a toggle lands on
    // the very next pass.
    const hits = state.hitsAt(event.stepInBar);
    if (hits.length > 0) {
      for (const instrument of hits) triggerDrum(instrument, event.time);
      pending.push({ time: event.time, hits });
    }
  });

  transport.start();

  // Stage 1's obstacles rise in as the first bar begins.
  for (const obstacle of chapter.stages[0]!.obstacles) {
    renderObstacles.push({ ...obstacle, addedAt: transport.timeOfBar(0) });
  }

  installControls(state);

  if (import.meta.env.DEV) {
    // Handle for the browser checks in test/e2e. Dev only, stripped from any build.
    // `solution` is derived on call from the live obstacle set, the same way the game
    // derives it. Nothing here stores an answer key.
    Object.assign(window, {
      __debug: {
        transport,
        state,
        stems,
        stage,
        chapter,
        ctx,
        solution: () => requiredNotes(state.obstacles),
      },
    });
  }

  function frame(): void {
    state.update();

    // Release the visual actions whose audio has now landed, so the character moves
    // with the sound rather than with the frame that queued it.
    const now = transport.now;
    while (pending.length > 0 && pending[0]!.time <= now) {
      const due = pending.shift()!;
      for (const instrument of due.hits) stage.triggerAction(instrument, due.time);
    }

    const stepFloat = transport.stepFloat;
    sequencer.update(state, stepFloat);
    stage.render({
      stepFloat,
      now,
      patternLength: chapter.patternLength,
      obstacles: renderObstacles,
      phase: state.phase,
      failure: state.failure,
      countInBeat: state.countInBeat,
      exit: state.successProgress,
      complete: state.complete,
    });

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function installControls(state: GameState): void {
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    switch (event.code) {
      case 'Space':
        event.preventDefault();
        state.requestRun();
        break;
      case 'KeyR':
        event.preventDefault();
        state.requestRun();
        break;
      case 'Escape':
        event.preventDefault();
        state.clearEditable();
        break;
    }
  });
}

startOverlay.addEventListener('click', () => void start());
startOverlay.addEventListener('keydown', (event) => {
  if (event.code === 'Space' || event.code === 'Enter') {
    event.preventDefault();
    void start();
  }
});
window.addEventListener(
  'keydown',
  (event) => {
    if (!started && (event.code === 'Space' || event.code === 'Enter')) {
      event.preventDefault();
      void start();
    }
  },
  { capture: true },
);
