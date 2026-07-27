/**
 * Acceptance criterion 2: leave it running five minutes, then confirm an obstacle
 * still crosses the character exactly on its step and the sequencer playhead still
 * lines up with the audible hits.
 *
 * The measurement: every time the frame loop releases a scheduled hit, sample the
 * derived `stepFloat` and record how far it sits from the step that hit was scheduled
 * for. That single number is the alignment error, because the character, the obstacle
 * positions and the playhead all derive from `stepFloat`. If anything accumulated,
 * that error would grow without bound. It is compared between the first and last 30
 * seconds of the run.
 *
 *   npm run dev
 *   npm run test:e2e:drift          # E2E_MINUTES=5 by default
 */
import { check, openGame, report } from './harness.mjs';

const MINUTES = Number(process.env.E2E_MINUTES ?? 5);
const { browser, page, errors } = await openGame();

await page.evaluate(() => {
  const { transport, stage, state, chapter } = window.__debug;

  const samples = [];
  window.__drift = {
    samples,
    anchor: transport.timeOfBar(0),
    anchorMoved: false,
    barTimeError: 0,
    lead: { min: Infinity, max: -Infinity },
  };

  // Fill the whole pattern so hits land on every step of every bar.
  for (const row of chapter.rows) state.pattern[row].fill(true);

  const original = stage.triggerAction.bind(stage);
  stage.triggerAction = (instrument, at) => {
    const stepFloat = transport.stepFloat;
    const scheduledStep = Math.round((at - window.__drift.anchor) / transport.stepDuration);
    const expected = ((scheduledStep % chapter.patternLength) + chapter.patternLength) %
      chapter.patternLength;

    // Wrap the difference into [-8, 8) so a sample taken across the bar line is honest.
    let delta = stepFloat - expected;
    const half = chapter.patternLength / 2;
    if (delta > half) delta -= chapter.patternLength;
    if (delta < -half) delta += chapter.patternLength;

    samples.push({
      t: transport.elapsed,
      stepError: delta,
      releaseLag: transport.now - at,
    });

    if (transport.timeOfBar(0) !== window.__drift.anchor) window.__drift.anchorMoved = true;

    // The bar anchor must stay exact: bar N begins at start + N * barDuration, with no
    // accumulation from bar N-1.
    const bar = Math.floor(transport.absoluteStepFloat / chapter.patternLength);
    const error = Math.abs(
      transport.timeOfBar(bar) - (window.__drift.anchor + bar * transport.barDuration),
    );
    if (error > window.__drift.barTimeError) window.__drift.barTimeError = error;

    return original(instrument, at);
  };

  // Watch the sequencer playhead against the same derived position.
  window.__playhead = { max: 0 };
  const el = document.querySelector('.seq-playhead');
  const watch = () => {
    const shown = parseFloat(getComputedStyle(el).getPropertyValue('--step'));
    const live = transport.stepFloat;
    let delta = Math.abs(shown - live);
    if (delta > chapter.patternLength / 2) delta = chapter.patternLength - delta;
    if (delta > window.__playhead.max) window.__playhead.max = delta;
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
});

console.log(`running for ${MINUTES} minute(s)...`);
const started = Date.now();
for (let elapsed = 0; elapsed < MINUTES * 60; elapsed += 30) {
  await page.waitForTimeout(30_000);
  const n = await page.evaluate(() => window.__drift.samples.length);
  process.stdout.write(`  ${Math.round((Date.now() - started) / 1000)}s  ${n} hits sampled\n`);
}

const result = await page.evaluate(() => {
  const { samples, anchorMoved, barTimeError } = window.__drift;
  const transport = window.__debug.transport;

  const window30 = 30;
  const last = samples[samples.length - 1].t;
  const first = samples.filter((s) => s.t <= window30);
  const final = samples.filter((s) => s.t >= last - window30);

  const worst = (rows) => Math.max(...rows.map((r) => Math.abs(r.stepError)));
  const worstLag = (rows) => Math.max(...rows.map((r) => Math.abs(r.releaseLag)));

  return {
    count: samples.length,
    elapsed: transport.elapsed,
    stepDuration: transport.stepDuration,
    firstWorst: worst(first),
    finalWorst: worst(final),
    firstLag: worstLag(first),
    finalLag: worstLag(final),
    overallWorst: worst(samples),
    anchorMoved,
    barTimeError,
    playheadWorst: window.__playhead.max,
    derivedExact: (() => {
      // stepFloat must be exactly the value the brief specifies, still, after minutes.
      const expected =
        (((transport.elapsed / transport.stepDuration) % 16) + 16) % 16;
      return Math.abs(transport.stepFloat - expected);
    })(),
  };
});

const frame = 1 / 60 / result.stepDuration; // one frame, expressed in steps
console.log('\n' + JSON.stringify(result, null, 2));
console.log(`\none frame at 60fps = ${frame.toFixed(3)} steps\n`);

check('the transport ran the full duration', result.elapsed >= MINUTES * 60 - 5, `${result.elapsed.toFixed(1)}s`);
check('hits were sampled throughout', result.count > 1000, `${result.count} hits`);
check('the transport was never restarted', result.anchorMoved === false);
check('bar start times stay exact', result.barTimeError === 0, `${result.barTimeError}`);
check(
  'stepFloat is still exactly elapsed / stepDuration mod 16',
  result.derivedExact === 0,
  `${result.derivedExact}`,
);
check(
  'the playhead still tracks the derived position',
  result.playheadWorst < frame * 2,
  `worst ${result.playheadWorst.toFixed(4)} steps`,
);
check(
  'hits land on their step at the start',
  result.firstWorst < frame * 2,
  `worst ${result.firstWorst.toFixed(4)} steps`,
);
check(
  `hits still land on their step after ${MINUTES} minutes`,
  result.finalWorst < frame * 2,
  `worst ${result.finalWorst.toFixed(4)} steps`,
);
check(
  'the alignment error did not grow over the run',
  result.finalWorst <= result.firstWorst + frame,
  `${result.firstWorst.toFixed(4)} -> ${result.finalWorst.toFixed(4)} steps`,
);
check('no unexpected console errors', errors.length === 0, errors.join(' | '));

await browser.close();
process.exit(report());
