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

/**
 * The announcement, on and off the crossing.
 *
 * The whole of the emphasis lives in the fifth of a second an obstacle spends at the
 * launch position, so a mid-bar shot never shows it. These park the world just after a
 * crossing and just after nothing, which is the comparison worth looking at: the pair
 * shows how far the swell, the dust and the sky's own pulse carry, and whether the
 * receded obstacles are still readable once the emphasis has passed.
 */
async function shotAt(name, target) {
  await page.waitForFunction(
    (t) => {
      const s = window.__debug.transport.stepFloat;
      return s > t && s < t + 0.35;
    },
    target,
    { polling: 'raf', timeout: 20_000 },
  );
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`wrote ${OUT}/${name}.png`);
}

await shotAt('crossing-downbeat', 0.05);
await shotAt('crossing-quarter', 4.05);
await shotAt('crossing-none', 5.6);

await browser.close();
