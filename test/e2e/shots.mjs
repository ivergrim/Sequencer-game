/**
 * Plays the chapter and captures the stage at each step of the build-up, for eyeballing
 * the placeholder art. Not an assertion; a look.
 *
 *   E2E_SHOTS=./shots npm run test:e2e:shots
 */
import { mkdir } from 'node:fs/promises';
import { openGame, runAndSettle, solveCurrentStage } from './harness.mjs';

const OUT = process.env.E2E_SHOTS ?? '.';
const AT = new Set((process.env.E2E_SHOT_STAGES ?? '1,4,6,10').split(',').map(Number));

await mkdir(OUT, { recursive: true });
const { browser, page } = await openGame();

for (let stage = 1; stage <= 10; stage++) {
  await solveCurrentStage(page);

  if (AT.has(stage)) {
    // Catch the character mid-bar so an action is in flight.
    await page.waitForFunction(() => {
      const s = window.__debug.transport.stepFloat;
      return s > 0.2 && s < 1.2;
    });
    await page.screenshot({ path: `${OUT}/stage-${stage}.png` });
    console.log(`wrote ${OUT}/stage-${stage}.png`);
  }

  await runAndSettle(page);
}

await browser.close();
