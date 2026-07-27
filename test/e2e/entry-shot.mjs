/**
 * Captures the character's approach across the count-in, for eyeballing.
 * Not an assertion; a look.
 *
 *   npm run dev
 *   E2E_SHOTS=./shots node test/e2e/entry-shot.mjs
 */
import { openGame, runAndSettle, solveCurrentStage } from './harness.mjs';

const OUT = process.env.E2E_SHOTS ?? '.';
const { browser, page } = await openGame();

// Far enough in that the stage has a crowd for the approach to be read against.
for (let stage = 1; stage <= 5; stage++) {
  await solveCurrentStage(page);
  await runAndSettle(page);
}
await solveCurrentStage(page);

await page.keyboard.press('Space');

// The count-in starts on the next bar line, not on the keypress.
await page.waitForFunction(() => window.__debug.state.countInBeat !== null, null, {
  timeout: 20_000,
});
const countInBar = await page.evaluate(() => Math.floor(window.__debug.transport.barFloat));

// Sample the count-in at even fractions of the bar, so the whole approach is covered.
for (let i = 0; i <= 8; i++) {
  const at = i / 8;
  await page.waitForFunction(
    ({ bar, fraction }) => window.__debug.transport.barFloat >= bar + fraction,
    { bar: countInBar, fraction: at },
    { timeout: 20_000 },
  );
  const pose = await page.evaluate(() => window.__debug.state.characterPose);
  await page.screenshot({ path: `${OUT}/entry-${String(i).padStart(2, '0')}.png` });
  console.log(`${(at * 100).toFixed(0)}% of the count-in: ${pose.mode} ${pose.progress.toFixed(2)}`);
}

await browser.close();
