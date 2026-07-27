/**
 * Captures the death camera with and without the hint, for eyeballing.
 * Not an assertion; a look.
 *
 *   npm run dev
 *   E2E_SHOTS=./shots node test/e2e/hint-shot.mjs
 */
import { openGame, runAndSettle, solveCurrentStage } from './harness.mjs';

const OUT = process.env.E2E_SHOTS ?? '.';
const { browser, page } = await openGame();

// Get to a stage with enough scenery and obstacles to be worth reading: clear four,
// then fail stage 5 repeatedly with its new obstacles unanswered.
for (let stage = 1; stage <= 4; stage++) {
  await solveCurrentStage(page);
  await runAndSettle(page);
}

for (let attempt = 1; attempt <= 3; attempt++) {
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__debug.state.phase === 'failed', null, {
    timeout: 20_000,
  });
  // Partway through the hold, where the camera has settled on the culprit.
  await page.waitForTimeout(700);

  const streak = await page.evaluate(() => ({
    failStreak: window.__debug.state.failStreak,
    hint: window.__debug.state.hintActive,
  }));
  await page.screenshot({ path: `${OUT}/hint-attempt-${attempt}.png` });
  console.log(`attempt ${attempt}: streak ${streak.failStreak}, hint ${streak.hint}`);

  await page.waitForFunction(() => window.__debug.state.phase === 'editing', null, {
    timeout: 10_000,
  });
}

await browser.close();
