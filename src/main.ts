import './style.css';

import { getDrumBus, getLimiter, getStemBus, unlockAudio } from './audio/context';
import { triggerCountIn, triggerDrum } from './audio/drums';
import { Stems } from './audio/stems';
import { Transport } from './audio/transport';
import { MAX_LEAD_SECONDS, actionTiming } from './game/actions';
import { CHAPTER_1 } from './game/chapter1';
import { requiredNotes } from './game/simulate';
import { GameState } from './game/state';
import type { Instrument } from './game/types';
import { SequencerUI } from './ui/sequencer';
import type { RenderObstacle } from './ui/stage';
import { BANDS, StageRenderer } from './ui/stage';

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

/**
 * A character action waiting for its start time.
 *
 * Animations start before their step, by `duration * impactRatio`, so they cannot ride
 * on the audio scheduler: a 400ms jump starts 200ms early, and the lookahead only hands
 * out steps 100ms ahead. The frame loop schedules them instead, off the same clock.
 */
interface PendingAction {
  instrument: Instrument;
  start: number;
  duration: number;
}

async function start(): Promise<void> {
  if (started) return;
  started = true;

  const ctx = await unlockAudio();
  startOverlay.classList.add('gone');

  const transport = new Transport(ctx, chapter.bpm, chapter.patternLength);
  const stems = new Stems(transport.stepDuration);
  const stage = new StageRenderer(canvas);

  const state = new GameState(chapter, transport, {
    // Nothing happens in the sequencer on failure. The stage's death camera is the
    // whole of the feedback, by design.
    onStageAdvance: (index) => {
      // The next stage's obstacles rise into the world on this bar line.
      for (const obstacle of chapter.stages[index]!.obstacles) {
        renderObstacles.push({ ...obstacle, stage: index, addedAt: transport.now });
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
  /** Next absolute step whose animations have not been worked out yet. */
  let animCursor = 0;

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
    //
    // Audio only. The drum hit for step S fires at exactly stepTime(S); its animation
    // was started earlier, by the frame loop.
    for (const instrument of state.hitsAt(event.stepInBar)) triggerDrum(instrument, event.time);
  });

  transport.start();

  // Stage 1's obstacles rise in as the first bar begins.
  for (const obstacle of chapter.stages[0]!.obstacles) {
    renderObstacles.push({ ...obstacle, stage: 0, addedAt: transport.timeOfBar(0) });
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
        drumBus: getDrumBus(),
        stemBus: getStemBus(),
        limiter: getLimiter(),
        solution: () => requiredNotes(state.obstacles),
        renderObstacles,
        bands: BANDS,
      },
    });
  }

  /**
   * Work out when each upcoming hit's animation has to start, and release it when the
   * clock reaches that time.
   *
   * Every action clears its obstacle partway through, so it has to begin before the step
   * rather than on it. The step's own drum hit is untouched and still fires at
   * stepTime(S): audio and animation decouple, which is the whole point of B2.
   */
  function scheduleAnimations(now: number): void {
    // Catch up without firing a burst if the frame loop was parked in a background tab.
    if (animCursor < transport.absoluteStepFloat - 2) {
      animCursor = Math.floor(transport.absoluteStepFloat);
    }

    while (transport.timeOfStep(animCursor) - MAX_LEAD_SECONDS <= now) {
      const stepInBar = ((animCursor % chapter.patternLength) + chapter.patternLength) %
        chapter.patternLength;
      const stepTime = transport.timeOfStep(animCursor);

      for (const instrument of chapter.rows) {
        const lane = state.pattern[instrument];
        if (!lane[stepInBar]) continue;
        const { duration, lead } = actionTiming(
          instrument,
          lane,
          stepInBar,
          transport.stepDuration,
        );
        pending.push({ instrument, start: stepTime - lead, duration });
      }
      animCursor++;
    }

    for (let i = pending.length - 1; i >= 0; i--) {
      const action = pending[i]!;
      if (action.start > now) continue;
      pending.splice(i, 1);
      // Drop anything that fell far enough behind to be meaningless.
      if (now - action.start < action.duration) {
        stage.triggerAction(action.instrument, action.start, action.duration);
      }
    }
  }

  function frame(): void {
    state.update();

    const now = transport.now;
    scheduleAnimations(now);

    const stepFloat = transport.stepFloat;
    sequencer.update(state, stepFloat);
    stage.render({
      stepFloat,
      now,
      patternLength: chapter.patternLength,
      stepDuration: transport.stepDuration,
      obstacles: renderObstacles,
      phase: state.phase,
      character: state.characterPose,
      failure: state.failure,
      countInBeat: state.countInBeat,
      currentStage: state.complete ? null : state.stageIndex,
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
