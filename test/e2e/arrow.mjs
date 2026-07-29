/**
 * The stuck arrow, end to end: when it appears, where it lands, and what makes it go.
 *
 * The state machine is pinned by `test/state.test.ts`; what needs a real browser is the
 * wiring — that the arrow ends up in the right cell, inside it, and that clicking that
 * cell takes it away.
 *
 *   npm run dev
 *   npm run test:e2e:arrow
 */
import { check, openGame, report, runAndSettle, solveCurrentStage } from './harness.mjs';

const { browser, page, errors } = await openGame();

/** Fail the current pattern and come back out the far side of the death camera. */
async function die() {
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__debug.state.phase === 'failed', null, {
    timeout: 25_000,
  });
  return async () => {
    await page.waitForFunction(() => window.__debug.state.phase === 'editing', null, {
      timeout: 10_000,
    });
    await page.waitForTimeout(120);
  };
}

const arrowAt = () =>
  page.evaluate(() => {
    const arrow = document.querySelector('.seq-arrow');
    if (!arrow) return null;
    const cell = arrow.closest('.seq-cell');
    return {
      instrument: cell?.closest('.seq-row')?.dataset.instrument ?? null,
      step: Number(cell?.dataset.step),
      hinted: document.querySelectorAll('.seq-cell[data-hint="true"]').length,
      label: cell?.getAttribute('aria-label') ?? null,
    };
  });

// ------------------------------------------------ one failure changes nothing on the grid
{
  const release = await die();
  check('no arrow while the death camera holds', (await arrowAt()) === null);
  await release();
  check('no arrow after the first failure on an obstacle', (await arrowAt()) === null);
}

// -------------------------------------------------- the second failure points at the cell
{
  const release = await die();
  check('still no arrow during the second death', (await arrowAt()) === null);
  await release();

  const arrow = await arrowAt();
  check(
    'the second failure points at the missing cell',
    arrow?.instrument === 'kick' && arrow?.step === 0,
    JSON.stringify(arrow),
  );
  check('exactly one cell is marked', arrow?.hinted === 1, `${arrow?.hinted}`);
  check(
    'the cell says so to a screen reader too',
    arrow?.label === 'kick step 0, missing note',
    `"${arrow?.label}"`,
  );

  // It has to be findable and inside the cell it points at, which is the one thing the
  // unit tests cannot see.
  const box = await page.evaluate(() => {
    const arrowBox = document.querySelector('.seq-arrow').getBoundingClientRect();
    const cellBox = document.querySelector('.seq-cell[data-hint="true"]').getBoundingClientRect();
    return {
      arrow: { w: arrowBox.width, h: arrowBox.height },
      inside:
        arrowBox.left >= cellBox.left - 0.5 &&
        arrowBox.right <= cellBox.right + 0.5 &&
        arrowBox.top >= cellBox.top - 0.5 &&
        arrowBox.bottom <= cellBox.bottom + 0.5,
      cell: { w: cellBox.width, h: cellBox.height },
    };
  });
  check(
    'the arrow is drawn, with size',
    box.arrow.w > 4 && box.arrow.h > 4,
    `${box.arrow.w}x${box.arrow.h}`,
  );
  check(
    'and stays within the cell it points at',
    box.inside,
    `arrow ${box.arrow.w}x${box.arrow.h} in cell ${box.cell.w.toFixed(1)}x${box.cell.h.toFixed(1)}`,
  );
}

// ---------------------------------------------- it is tied to the cell, not dismissed once
{
  await page.click('.seq-row[data-instrument="kick"] .seq-cell[data-step="0"]');
  await page.waitForTimeout(60);
  check('filling the cell clears the arrow', (await arrowAt()) === null);

  await page.click('.seq-row[data-instrument="kick"] .seq-cell[data-step="0"]');
  await page.waitForTimeout(60);
  const back = await arrowAt();
  check(
    'emptying it again brings the arrow back',
    back?.instrument === 'kick' && back?.step === 0,
    JSON.stringify(back),
  );
}

// -------------------------------------------------------------- never during the run itself
{
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__debug.state.phase === 'armed', null, { timeout: 5_000 });
  await page.waitForTimeout(60);
  check('the arrow survives the count-in, where an edit still counts', (await arrowAt()) !== null);

  await page.waitForFunction(() => window.__debug.state.phase === 'running', null, {
    timeout: 10_000,
  });
  check('and stands down for the run', (await arrowAt()) === null);

  await page.waitForFunction(() => window.__debug.state.phase === 'editing', null, {
    timeout: 25_000,
  });
  await page.waitForTimeout(120);
  check('and is back once the run has resolved', (await arrowAt()) !== null);
}

// ------------------------------------------------------ clearing the stage takes it with it
{
  await solveCurrentStage(page);
  await page.waitForTimeout(60); // the grid syncs on the next frame, like everything here
  check('solving the stage clears the arrow', (await arrowAt()) === null);
  await runAndSettle(page);
  const stage = await page.evaluate(() => window.__debug.state.stage.id);
  check('the stage cleared', stage === 2, `stage ${stage}`);
  check('and left no arrow behind', (await arrowAt()) === null);
}

// --------------------------------- one death each on two obstacles is not being stuck
{
  // Stage 3 adds a second pillar, so it is the first stage with two obstacles that can
  // be missed separately.
  await solveCurrentStage(page);
  await runAndSettle(page);

  let release = await die();
  await release();
  const first = await page.evaluate(() => window.__debug.state.failure.step);
  check('the run stops on the first unanswered pillar', first === 4, `step ${first}`);
  check('one death there is not being stuck', (await arrowAt()) === null);

  // Answer it: the next run reaches a different obstacle, with a tally of its own.
  await page.click('.seq-row[data-instrument="kick"] .seq-cell[data-step="4"]');
  release = await die();
  await release();
  const second = await page.evaluate(() => window.__debug.state.failure.step);
  check('the next run gets further', second === 12, `step ${second}`);
  check('one death each on two obstacles still earns no arrow', (await arrowAt()) === null);

  // A second death on this one does.
  release = await die();
  await release();
  const arrow = await arrowAt();
  check(
    'the second death on the same obstacle points at it',
    arrow?.instrument === 'kick' && arrow?.step === 12,
    JSON.stringify(arrow),
  );
}

check('no unexpected console errors', errors.length === 0, errors.join(' | '));

await browser.close();
process.exit(report());
