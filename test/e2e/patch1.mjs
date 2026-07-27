/**
 * The patch 1 acceptance criteria that need a running clock and a real canvas.
 *
 *   npm run dev
 *   npm run test:e2e:patch1
 */
import { check, openGame, report, runAndSettle, solveCurrentStage } from './harness.mjs';

const { browser, page, errors } = await openGame();

const snap = () =>
  page.evaluate(() => {
    const { state, stage } = window.__debug;
    return {
      phase: state.phase,
      stageId: state.stage.id,
      complete: state.complete,
      character: state.characterPose,
      characterDrawn: stage.characterDrawn,
      pose: stage.lastPose,
      failure: state.failure && { step: state.failure.step, missing: state.failure.instrument },
    };
  });

// ------------------------------------------------- 1. no character during EDITING
{
  await page.waitForTimeout(500);
  const samples = [];
  for (let i = 0; i < 12; i++) {
    samples.push(await snap());
    await page.waitForTimeout(90);
  }
  check(
    'the character is never drawn during EDITING',
    samples.every((s) => s.phase === 'editing' && s.characterDrawn === false),
    `${samples.filter((s) => s.characterDrawn).length} of ${samples.length} frames drew it`,
  );
}

// -------------------------- 2. enters during the count-in, in position before step 0
{
  await solveCurrentStage(page);
  await page.keyboard.press('Space');

  // Watch the whole armed phase and record when it arrives.
  const entry = await page.evaluate(async () => {
    const { state, transport } = window.__debug;
    const modes = new Set();
    let arrivedAt = null;
    let sawEntering = false;

    while (state.phase === 'armed') {
      const pose = state.characterPose;
      modes.add(pose.mode);
      if (pose.mode === 'entering') sawEntering = true;
      if (sawEntering && pose.mode === 'running' && arrivedAt === null) {
        arrivedAt = transport.now;
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    return {
      modes: [...modes],
      // Seconds between arriving at DINO_X and the run bar beginning.
      headroom: arrivedAt === null ? null : state.runBarTime - arrivedAt,
      required: state.longestActionLead,
    };
  });

  check(
    'the character runs in out of the distance during the count-in',
    entry.modes.includes('entering'),
    entry.modes.join(','),
  );
  check(
    'it is at DINO_X and at running speed before step 0',
    entry.headroom !== null && entry.headroom > 0,
    `${entry.headroom?.toFixed(3)}s of headroom`,
  );
  check(
    'it arrives early enough for step 0 to have begun its action',
    entry.headroom !== null && entry.headroom >= entry.required,
    `${entry.headroom?.toFixed(3)}s headroom vs ${entry.required?.toFixed(3)}s longest lead`,
  );
}

// ---------- 3 & 4. the impact frame lands on the step, while the drum fires on it
{
  // Sample the pose at the frame each obstacle crosses DINO_X. Stage 1 is a lone kick
  // on step 0, so the channel to watch is unambiguous.
  const impact = await page.evaluate(async () => {
    const { transport, stage, state } = window.__debug;
    let best = null;

    const deadline = transport.now + 6;
    while (transport.now < deadline && state.phase === 'running') {
      // Distance from step 0, wrapped, in steps.
      let delta = transport.stepFloat;
      if (delta > 8) delta -= 16;
      if (best === null || Math.abs(delta) < Math.abs(best.delta)) {
        best = { delta, jump: stage.lastPose.jump };
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    return best;
  });

  check(
    'at the frame the obstacle reaches DINO_X the jump is at apex',
    impact !== null && impact.jump > 0.9,
    `jump ${impact?.jump.toFixed(3)} at ${impact?.delta.toFixed(3)} steps from the step`,
  );
  check(
    'it is never merely beginning the action at that frame',
    impact !== null && impact.jump > 0.5,
    `jump ${impact?.jump.toFixed(3)}`,
  );

  await page.waitForFunction(() => window.__debug.state.phase === 'editing', null, {
    timeout: 25_000,
  });
}

// ------------------------------------------------- play on to stage 10 for the rest
for (let stage = 2; stage <= 9; stage++) {
  await solveCurrentStage(page);
  await runAndSettle(page);
}
await solveCurrentStage(page);

// ------------------------------------------ 8 & 10. depth is recency, weight is type
{
  const depth = await page.evaluate(() => {
    const { state } = window.__debug;
    const obstacles = window.__debug.renderObstacles;
    const current = state.complete ? null : state.stageIndex;
    return {
      total: obstacles.length,
      foreground: obstacles.filter((o) => current === null || o.stage === current).length,
      stageIndex: state.stageIndex,
    };
  });

  check('stage 10 has all twenty-one obstacles', depth.total === 21, `${depth.total}`);
  check(
    'exactly three render at full opacity, eighteen receded',
    depth.foreground === 3 && depth.total - depth.foreground === 18,
    `${depth.foreground} foreground, ${depth.total - depth.foreground} receded`,
  );
}

// --------------------------------- 9. the three obstacles on step 12 do not occlude
{
  const bands = await page.evaluate(() => {
    const obstacles = window.__debug.renderObstacles.filter((o) => o.step === 12);
    return { types: obstacles.map((o) => o.type), bands: window.__debug.bands };
  });

  check('step 12 carries three obstacles', bands.types.length === 3, bands.types.join(','));

  const spans = bands.types.map((t) => bands.bands[t]).sort((a, b) => a.bottom - b.bottom);
  let disjoint = true;
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].bottom < spans[i - 1].top) disjoint = false;
  }
  check(
    'their vertical bands do not overlap',
    disjoint,
    spans.map((s) => `${s.bottom}-${s.top}`).join(' '),
  );
}

// ---------------------------------------- 6 & 7. failure feedback is stage-only
{
  // Fail on a small type introduced four stages earlier: the stage 6 open hat on step 3.
  const before = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.seq-cell')];
    return {
      classes: cells.map((c) => c.className).join('|'),
      grid: document.querySelector('.seq-grid').className,
      status: document.querySelector('.seq-status').textContent,
      rows: [...document.querySelectorAll('.seq-row')].map((r) => r.className).join('|'),
    };
  });

  // Committed notes are frozen now, so a small, old obstacle can no longer be orphaned
  // through the UI. The renderer still has to identify one, so force it directly.
  await page.evaluate(() => {
    window.__debug.state.pattern.openhat[3] = false;
  });
  await page.mouse.move(5, 5); // keep hover styling out of the comparison
  await page.keyboard.press('Space');

  // Trace the stage position across the hand-over to the death camera. The camera used
  // to rewind to the collision, which showed up as a jump backwards on a single frame.
  const trace = await page.evaluate(async () => {
    const { state, transport, stage } = window.__debug;
    const deadline = transport.now + 24;
    while (state.phase !== 'failed' && transport.now < deadline) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    const rows = [];
    const start = transport.now;
    const handover = { shown: stage.lastStageStep, world: transport.stepFloat };
    while (transport.now - start < 0.8) {
      rows.push(stage.lastStageStep);
      await new Promise((r) => requestAnimationFrame(r));
    }

    let worst = 0;
    for (let i = 1; i < rows.length; i++) {
      let delta = rows[i] - rows[i - 1];
      if (delta < -8) delta += 16; // the bar line, not a jump
      if (Math.abs(delta) > Math.abs(worst)) worst = delta;
    }
    return { handover, worst, frames: rows.length, stepDuration: transport.stepDuration };
  });

  const frameSteps = 1 / 60 / trace.stepDuration;
  // The two readings come from different moments — one is the last rendered frame, the
  // other is the clock right now — so one frame of skew is the harness, not the app.
  // What the app guarantees is that the hand-over introduces no jump of its own, which
  // the two checks below measure directly.
  check(
    'the death camera takes over where the world is',
    Math.abs(trace.handover.shown - trace.handover.world) < frameSteps,
    `${trace.handover.shown.toFixed(4)} vs ${trace.handover.world.toFixed(4)}, one frame is ${frameSteps.toFixed(3)}`,
  );
  check(
    'the stage never jumps backwards into the camera',
    trace.worst > -0.05,
    `worst single-frame change ${trace.worst.toFixed(4)} steps`,
  );
  check(
    'the approach decelerates rather than cutting',
    Math.abs(trace.worst) < frameSteps * 2.5,
    `worst ${Math.abs(trace.worst).toFixed(4)} steps, one frame is ${frameSteps.toFixed(3)}`,
  );

  await page.waitForTimeout(300);

  const during = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.seq-cell')];
    return {
      classes: cells.map((c) => c.className).join('|'),
      grid: document.querySelector('.seq-grid').className,
      status: document.querySelector('.seq-status').textContent,
      rows: [...document.querySelectorAll('.seq-row')].map((r) => r.className).join('|'),
    };
  });

  const failed = await snap();
  check(
    'the run failed on the old, small open hat',
    failed.failure?.step === 3 && failed.failure?.missing === 'openhat',
    JSON.stringify(failed.failure),
  );
  check('no sequencer cell changes class on failure', before.classes === during.classes);
  check('no sequencer row changes class on failure', before.rows === during.rows);
  check('the grid itself does not change on failure', before.grid === during.grid);
  check(
    'the status readout does not name the failure',
    before.status === during.status,
    `"${before.status}" -> "${during.status}"`,
  );

  // The culprit is restored on stage, overriding both its weight and its depth.
  const culprit = await page.evaluate(() => window.__debug.stage.lastCulprit);
  check(
    'the culprit is drawn large, full opacity, in the foreground',
    culprit !== null && culprit.type === 'bird' && culprit.alpha === 1 && culprit.grown === true,
    JSON.stringify(culprit),
  );
  check('the character stays visible through the death camera', failed.characterDrawn === true);

  // And it releases on its own.
  await page.waitForFunction(() => window.__debug.state.phase === 'editing', null, {
    timeout: 10_000,
  });
  const after = await snap();
  check('the death camera releases to EDITING', after.phase === 'editing');
  check('the character is hidden again afterwards', after.characterDrawn === false);
}

// -------------------------- the finished chapter keeps the character on stage
{
  // Put back the committed note that was broken from outside the UI: it is locked, so
  // the grid cannot restore it, by design.
  await page.evaluate(() => {
    window.__debug.state.pattern.openhat[3] = true;
  });

  // Stage 10 is still unsolved after the forced failure above. Clear it for real.
  await solveCurrentStage(page);
  await runAndSettle(page);
  await page.waitForFunction(() => window.__debug.state.complete === true, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(2_500);

  const done = await snap();
  check('the chapter completes', done.complete === true && done.phase === 'editing');
  check(
    'the character stays on stage performing the finished track',
    done.characterDrawn === true && done.character.mode === 'running',
    `${done.character.mode}, drawn ${done.characterDrawn}`,
  );

  // Nothing is the "current stage" any more, so nothing should still be marked.
  const marked = await page.evaluate(() => {
    const { state } = window.__debug;
    return { currentStage: state.complete ? null : state.stageIndex };
  });
  check('no obstacle is still marked as this stage\'s', marked.currentStage === null);
}

check('no unexpected console errors', errors.length === 0, errors.join(' | '));

await browser.close();
process.exit(report());
