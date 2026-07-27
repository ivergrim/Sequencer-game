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
  const { transport, state, chapter } = window.__debug;

  const samples = [];
  window.__drift = {
    samples,
    anchor: transport.timeOfBar(0),
    anchorMoved: false,
    barTimeError: 0,
  };

  // Fill the whole pattern so a hit lands on every step of every bar.
  for (const row of chapter.rows) state.pattern[row].fill(true);

  // Every scheduled step, with the exact audio time it will sound on. Measuring the
  // audio path directly rather than the character: animations now deliberately start
  // before their step, so they are the wrong thing to measure alignment with.
  const queue = [];
  transport.onStep((event) => queue.push({ time: event.time, stepInBar: event.stepInBar }));

  const watch = () => {
    const now = transport.now;
    while (queue.length > 0 && queue[0].time <= now) {
      const due = queue.shift();
      const stepFloat = transport.stepFloat;

      // Wrap the difference into [-8, 8) so a sample across the bar line stays honest.
      let delta = stepFloat - due.stepInBar;
      const half = chapter.patternLength / 2;
      if (delta > half) delta -= chapter.patternLength;
      if (delta < -half) delta += chapter.patternLength;

      samples.push({ t: transport.elapsed, stepError: delta, releaseLag: now - due.time });

      if (transport.timeOfBar(0) !== window.__drift.anchor) window.__drift.anchorMoved = true;

      const bar = Math.floor(transport.absoluteStepFloat / chapter.patternLength);
      const error = Math.abs(
        transport.timeOfBar(bar) - (window.__drift.anchor + bar * transport.barDuration),
      );
      if (error > window.__drift.barTimeError) window.__drift.barTimeError = error;
    }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);

  // Watch the sequencer playhead against the same derived position.
  //
  // This can only ever measure the render pipeline: the playhead is written from
  // stepFloat during the frame and committed at the next paint, so a sample compares a
  // committed value against a newer clock read. The absolute number is display latency,
  // not drift. What proves there is no drift is that it does not grow.
  const playhead = [];
  window.__playhead = playhead;
  const el = document.querySelector('.seq-playhead');
  const watchHead = () => {
    const shown = parseFloat(getComputedStyle(el).getPropertyValue('--step'));
    let delta = Math.abs(shown - transport.stepFloat);
    if (delta > chapter.patternLength / 2) delta = chapter.patternLength - delta;
    playhead.push({ t: transport.elapsed, delta });
    requestAnimationFrame(watchHead);
  };
  requestAnimationFrame(watchHead);
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

  const head = window.__playhead;
  const headLast = head[head.length - 1].t;
  const headWorst = (rows) => Math.max(...rows.map((r) => r.delta));

  return {
    count: samples.length,
    playheadFirst: headWorst(head.filter((r) => r.t <= window30)),
    playheadFinal: headWorst(head.filter((r) => r.t >= headLast - window30)),
    elapsed: transport.elapsed,
    stepDuration: transport.stepDuration,
    firstWorst: worst(first),
    finalWorst: worst(final),
    firstLag: worstLag(first),
    finalLag: worstLag(final),
    overallWorst: worst(samples),
    anchorMoved,
    barTimeError,
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
  'the playhead still lines up after ' + MINUTES + ' minutes',
  result.playheadFinal <= result.playheadFirst + frame,
  `${result.playheadFirst.toFixed(4)} -> ${result.playheadFinal.toFixed(4)} steps`,
);
check(
  'the playhead stays within the render pipeline latency',
  result.playheadFinal < frame * 4,
  `worst ${result.playheadFinal.toFixed(4)} steps, one frame is ${frame.toFixed(3)}`,
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
