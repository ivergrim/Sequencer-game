/**
 * Plays chapter 1 from stage 1 to stage 10 in a real browser.
 *
 * Covers the acceptance criteria that a unit test cannot reach: that the app makes
 * sound with public/stems/ empty, that the budget blocks overspending, that removing a
 * carried-over note fails at that step, and that the music and the world scroll never
 * stop across ten stage transitions and a failure.
 *
 *   npm run dev            # in one terminal
 *   npm run test:e2e       # in another
 */
import { check, openGame, report, runAndSettle, solveCurrentStage } from './harness.mjs';

const { browser, page, errors } = await openGame();

/** Watches the transport for the whole session. Nothing may interrupt it. */
async function installMonitor() {
  await page.evaluate(() => {
    const { transport, ctx } = window.__debug;
    const monitor = {
      anchor: transport.timeOfBar(0),
      anchorMoved: false,
      wentBackwards: 0,
      notRunning: 0,
      stalled: 0,
      samples: 0,
      maxLead: -Infinity,
      minLead: Infinity,
    };
    window.__monitor = monitor;

    let lastAbsolute = transport.absoluteStepFloat;
    let lastClock = transport.now;

    const tick = () => {
      const absolute = transport.absoluteStepFloat;
      const clock = transport.now;

      monitor.samples++;
      if (transport.timeOfBar(0) !== monitor.anchor) monitor.anchorMoved = true;
      if (ctx.state !== 'running') monitor.notRunning++;
      if (absolute < lastAbsolute) monitor.wentBackwards++;
      // The world must keep scrolling. Between two frames at least some time passed.
      if (clock > lastClock + 0.05 && absolute === lastAbsolute) monitor.stalled++;

      lastAbsolute = absolute;
      lastClock = clock;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const snapshot = () =>
  page.evaluate(() => {
    const s = window.__debug.state;
    return {
      stage: s.stage.id,
      label: s.stage.label,
      budget: s.budget,
      used: s.used,
      phase: s.phase,
      complete: s.complete,
      unlocked: [...s.unlockedRows],
      locked: [...document.querySelectorAll('.seq-row.locked')].map(
        (row) => row.dataset.instrument,
      ),
      failure: s.failure && { step: s.failure.step, missing: s.failure.instrument },
      obstacles: s.obstacles.length,
      editableDuringCamera: !document.querySelector('.seq-grid').classList.contains('busy'),
    };
  });

await installMonitor();

// --------------------------------------------------------------- stage 1 setup
{
  const s = await snapshot();
  check('starts on stage 1 in EDITING', s.stage === 1 && s.phase === 'editing', s.label);
  check('stage 1 budget is 1', s.budget === 1);
  check('only the kick row is unlocked', s.unlocked.length === 1 && s.unlocked[0] === 'kick');
  check(
    'the other four rows are locked and greyed',
    s.locked.length === 4 && !s.locked.includes('kick'),
    s.locked.join(','),
  );
}

// ------------------------------------------------------- the budget blocks over-placing
{
  await page.click('.seq-row[data-instrument="kick"] .seq-cell[data-step="7"]');
  const afterFirst = await snapshot();
  await page.click('.seq-row[data-instrument="kick"] .seq-cell[data-step="9"]');
  const afterSecond = await page.evaluate(() => {
    const s = window.__debug.state;
    return { used: s.used, kick9: s.pattern.kick[9] };
  });
  check('first note within budget is placed', afterFirst.used === 1);
  check(
    'a note beyond the budget is rejected',
    afterSecond.used === 1 && afterSecond.kick9 === false,
    JSON.stringify(afterSecond),
  );

  await page.keyboard.press('Escape');
  const cleared = await snapshot();
  check('escape clears the editable notes', cleared.used === 0);
}

// -------------------------------------------------- a locked row cannot be played
{
  await page.click('.seq-row[data-instrument="crash"] .seq-cell[data-step="0"]', { force: true });
  const s = await snapshot();
  check('a locked row rejects clicks', s.used === 0);
}

// ------------------------------------ the sequencer never changes for run state
{
  const idle = await page.evaluate(() => document.querySelector('.seq-grid').className);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__debug.state.phase === 'running', null, {
    timeout: 15_000,
  });
  const running = await page.evaluate(() => document.querySelector('.seq-grid').className);
  check('the grid looks the same while a run is in flight', idle === running, `${idle} / ${running}`);
  await page.waitForFunction(() => window.__debug.state.phase === 'editing', null, {
    timeout: 25_000,
  });
}

/**
 * Committed notes are frozen, and breaking one fails at that step.
 *
 * Run while stage 10 is solved but not yet cleared: that is the last moment either can
 * be observed. Clearing stage 10 ends the chapter, and free play unlocks the whole
 * grid and retires runs altogether.
 */
async function auditCommittedNotes() {
  const before = await snapshot();
  const inert = await page.evaluate(() => {
    const cell = document.querySelector(
      '.seq-row[data-instrument="kick"] .seq-cell[data-step="8"]',
    );
    return {
      committed: cell.classList.contains('committed'),
      disabled: cell.getAttribute('aria-disabled') === 'true',
      pointerEvents: getComputedStyle(cell).pointerEvents,
    };
  });
  // force, because the cell deliberately takes no pointer events at all.
  await page.click('.seq-row[data-instrument="kick"] .seq-cell[data-step="8"]', { force: true });
  const after = await snapshot();

  check(
    'a committed note is marked committed and inert',
    inert.committed && inert.disabled,
    JSON.stringify(inert),
  );
  check('it does not take pointer events', inert.pointerEvents === 'none', inert.pointerEvents);
  check('a committed note cannot be removed', after.used === before.used, `${before.used} -> ${after.used}`);

  // Reach past the UI to force the failure the renderer still has to handle.
  await page.evaluate(() => {
    window.__debug.state.pattern.kick[8] = false;
  });
  const removed = await snapshot();
  check('the pattern can still be broken from outside the UI', removed.used === 20, `${removed.used}`);

  await runAndSettle(page);
  const failed = await snapshot();
  check(
    'removing a carried-over note fails at that step',
    failed.failure?.step === 8 && failed.failure?.missing === 'kick',
    JSON.stringify(failed.failure),
  );
  // Patch 1 C1: FAILED holds for the death camera before releasing, rather than
  // returning to EDITING on the next frame.
  check('the death camera holds on the failure', failed.phase === 'failed');
  check('editing is never locked, even under the camera', failed.editableDuringCamera === true);

  await page.waitForFunction(() => window.__debug.state.phase === 'editing', null, {
    timeout: 10_000,
  });
  check('the death camera releases to EDITING on its own', (await snapshot()).phase === 'editing');

  const marker = await page.evaluate(() => window.__debug.state.failure !== null);
  check('the failure marker stays on the ground', marker === true);

  // Put it back the way it was broken: the grid cannot restore a committed note.
  await page.evaluate(() => {
    window.__debug.state.pattern.kick[8] = true;
  });
}

// ------------------------------------------------------------- play all ten stages
const seen = [];
for (let stage = 1; stage <= 10; stage++) {
  const before = await snapshot();
  const placed = await solveCurrentStage(page);
  const armed = await snapshot();

  check(
    `stage ${stage} solution fits the budget exactly`,
    armed.used === armed.budget,
    `${armed.used}/${armed.budget}`,
  );
  check(
    `stage ${stage} budget equals the active obstacle count`,
    armed.budget === armed.obstacles,
    `${armed.budget} vs ${armed.obstacles}`,
  );

  if (stage === 10) await auditCommittedNotes();

  await runAndSettle(page);
  const after = await snapshot();

  seen.push({
    stage,
    label: before.label,
    budget: before.budget,
    placed,
    next: after.stage,
    complete: after.complete,
  });

  if (stage < 10) {
    check(`stage ${stage} cleared and advanced to ${stage + 1}`, after.stage === stage + 1);
  } else {
    check('stage 10 cleared and the chapter completes', after.complete === true);
  }
}

check(
  'budgets follow the brief 1,2,4,8,10,14,15,17,18,21',
  JSON.stringify(seen.map((s) => s.budget)) === JSON.stringify([1, 2, 4, 8, 10, 14, 15, 17, 18, 21]),
  seen.map((s) => s.budget).join(','),
);

check(
  'every row is unlocked by the end',
  (await snapshot()).unlocked.length === 5,
  (await snapshot()).unlocked.join(','),
);

// --------------------------------------------------------------------- free play
{
  // The obstacles sink back out over RISE_SECONDS; give them the time and then some.
  await page.waitForTimeout(1_200);

  const free = await page.evaluate(() => {
    const { state, renderObstacles } = window.__debug;
    const committed = document.querySelector(
      '.seq-row[data-instrument="kick"] .seq-cell[data-step="8"]',
    );
    return {
      obstaclesOnStage: renderObstacles.length,
      obstaclesInData: state.obstacles.length,
      anyLocked: window.__debug.chapter.rows.some((row) =>
        state.pattern[row].some((_, step) => state.isLocked(row, step)),
      ),
      committedClass: committed.classList.contains('committed'),
      unlockedRows: [...state.unlockedRows].length,
      lockedRows: document.querySelectorAll('.seq-row.locked').length,
      used: state.used,
      status: document.querySelector('.seq-status').textContent,
      budgetText: document.querySelector('.seq-budget').textContent,
      runHidden: document.querySelector('#run').hidden,
    };
  });

  check('the world empties of obstacles', free.obstaclesOnStage === 0, `${free.obstaclesOnStage} left`);
  check(
    'the chapter data still holds all twenty-one',
    free.obstaclesInData === 21,
    `${free.obstaclesInData}`,
  );
  check('nothing is locked any more', free.anyLocked === false);
  check('and no cell still renders as committed', free.committedClass === false);
  check('every row is playable', free.unlockedRows === 5 && free.lockedRows === 0);
  check('the finished track survives the unlock', free.used === 21, `${free.used} notes`);
  check('the status reads free play', free.status === 'free play', `"${free.status}"`);
  check('the budget readout becomes a note count', free.budgetText === '21 notes', free.budgetText);
  check('the run button is gone', free.runHidden === true);

  // The budget is lifted: a note nothing ever required can now be placed.
  await page.click('.seq-row[data-instrument="crash"] .seq-cell[data-step="9"]');
  const added = await page.evaluate(() => window.__debug.state.used);
  check('notes can be placed past the old budget', added === 22, `${added}`);

  // And a formerly committed note can be taken out again.
  await page.click('.seq-row[data-instrument="kick"] .seq-cell[data-step="8"]');
  const removed = await page.evaluate(() => window.__debug.state.used);
  check('a formerly committed note can be removed', removed === 21, `${removed}`);

  // Runs are retired: there is nothing to run against.
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  const stillEditing = await page.evaluate(() => window.__debug.state.phase);
  check('run does nothing in free play', stillEditing === 'editing', stillEditing);
}

// -------------------------------------- the transport never stopped, start to finish
{
  const monitor = await page.evaluate(() => window.__monitor);
  check('the transport was never restarted', monitor.anchorMoved === false);
  check('the audio context stayed running', monitor.notRunning === 0, `${monitor.notRunning} frames`);
  check('the clock never went backwards', monitor.wentBackwards === 0);
  check('the world scroll never stalled', monitor.stalled === 0, `${monitor.stalled} frames`);
  check('the monitor actually sampled', monitor.samples > 1000, `${monitor.samples} frames`);
}

// ---------------------- it actually makes sound, with public/stems/ empty
{
  // Twenty-one drum notes and ten backing layers are running by now, and every one of
  // those layers is a synthesized substitute, because public/stems/ is empty. Tap both
  // buses and confirm signal is coming out of each.
  const level = await page.evaluate(async () => {
    const { ctx, drumBus, stemBus } = window.__debug;

    const tap = (node) => {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      node.connect(analyser);
      return analyser;
    };

    const drums = tap(drumBus);
    const stems = tap(stemBus);
    const out = tap(window.__debug.limiter);
    const buffer = new Float32Array(2048);

    const peaks = { drums: 0, stems: 0, out: 0 };
    for (let i = 0; i < 160; i++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      for (const [key, analyser] of [
        ['drums', drums],
        ['stems', stems],
        ['out', out],
      ]) {
        analyser.getFloatTimeDomainData(buffer);
        for (const sample of buffer) {
          const amplitude = Math.abs(sample);
          if (amplitude > peaks[key]) peaks[key] = amplitude;
        }
      }
    }
    return { ...peaks, stemsAreFallbacks: !window.__debug.stems.hasBuffer('bass') };
  });

  check('the stems directory really is empty', level.stemsAreFallbacks === true);
  check('the drum voices make sound', level.drums > 0.01, `peak ${level.drums.toFixed(3)}`);
  check(
    'the synthesized backing bed makes sound',
    level.stems > 0.01,
    `peak ${level.stems.toFixed(3)}`,
  );
  check(
    'the full mix does not clip',
    level.out > 0.01 && level.out <= 1,
    `peak ${level.out.toFixed(3)}`,
  );
}

// ---------------------------------------- progress survives a reload
//
// Last, because reloading discards the transport monitor and the audio graph the
// checks above are measuring.
{
  const before = await page.evaluate(() =>
    JSON.parse(JSON.stringify(window.__debug.state.pattern)),
  );

  await page.reload({ waitUntil: 'networkidle' });
  await page.click('#start');
  await page.waitForFunction(() => window.__debug?.transport?.started === true, null, {
    timeout: 10_000,
  });
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => ({
    complete: window.__debug.state.complete,
    used: window.__debug.state.used,
    pattern: JSON.parse(JSON.stringify(window.__debug.state.pattern)),
    obstaclesOnStage: window.__debug.renderObstacles.length,
  }));

  check('a reload restores the completed chapter', after.complete === true);
  check(
    'the pattern survives the reload exactly',
    JSON.stringify(after.pattern) === JSON.stringify(before),
    `${after.used} notes`,
  );
  check(
    'a restored free play has an empty world',
    after.obstaclesOnStage === 0,
    `${after.obstaclesOnStage}`,
  );

  // Leave no save behind: the next run of this suite must start from stage 1.
  await page.evaluate(() => localStorage.clear());
}

check('no unexpected console errors', errors.length === 0, errors.join(' | '));

console.log('\nstages played:');
for (const s of seen) {
  console.log(`  ${String(s.stage).padStart(2)}  ${s.label.padEnd(22)} budget ${String(s.budget).padStart(2)}  placed ${s.placed}`);
}

await browser.close();
process.exit(report());
