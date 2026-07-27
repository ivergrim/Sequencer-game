/**
 * Screenshots the game at a desktop and a phone viewport, and checks that the touch
 * controls actually drive the state machine.
 *
 *   npm run dev
 *   npm run test:e2e:responsive
 */
import { chromium } from 'playwright';
import { check, report } from './harness.mjs';

const URL = process.env.E2E_URL ?? 'http://localhost:5199/';
const EXECUTABLE = process.env.E2E_CHROMIUM;
const OUT = process.env.E2E_SHOTS ?? '.';

const browser = await chromium.launch({
  ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

const VIEWPORTS = [
  { name: 'desktop', width: 1100, height: 800, touch: false },
  { name: 'phone', width: 390, height: 844, touch: true },
];

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: viewport.touch,
    isMobile: viewport.touch,
    deviceScaleFactor: viewport.touch ? 3 : 1,
  });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  // This suite builds its own context rather than using openGame, so it clears the
  // saved progress the same way: the checks below assume stage 1.
  await page.evaluate(() => localStorage.clear());
  await page.click('#start');
  await page.waitForFunction(() => window.__debug?.transport?.started === true, null, {
    timeout: 10_000,
  });
  await page.waitForTimeout(600);

  const layout = await page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const canvas = document.querySelector('#stage');
    return {
      doc: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      stage: box('#stage'),
      controls: box('#controls'),
      run: box('#run'),
      keysHidden: [...document.querySelectorAll('.keys')].every(
        (keys) => getComputedStyle(keys).display === 'none',
      ),
      // Every control has to be big enough to hit with a thumb, key chips or not.
      targets: [...document.querySelectorAll('#run, #controls button')].map((b) => ({
        id: b.id,
        height: b.getBoundingClientRect().height,
      })),
      // The backing store must match the CSS box times the device pixel ratio.
      backing: { width: canvas.width, height: canvas.height },
      dpr: window.devicePixelRatio,
    };
  });

  check(
    `${viewport.name}: nothing overflows horizontally`,
    layout.doc <= layout.viewport + 1,
    `document ${layout.doc} vs viewport ${layout.viewport}`,
  );
  check(
    `${viewport.name}: the canvas backing store matches its CSS box`,
    Math.abs(layout.backing.width - layout.stage.width * layout.dpr) <= 1 &&
      Math.abs(layout.backing.height - layout.stage.height * layout.dpr) <= 1,
    `${layout.backing.width}x${layout.backing.height} for ${layout.stage.width}x${layout.stage.height} @${layout.dpr}`,
  );
  check(
    `${viewport.name}: the run banner is on screen, above the stage`,
    layout.run !== null && layout.run.width > 0 && layout.run.x >= 0 &&
      layout.run.y + layout.run.height <= layout.stage.y + 1,
    JSON.stringify(layout.run),
  );
  check(
    `${viewport.name}: the run banner spans the stage`,
    Math.abs(layout.run.width - layout.stage.width) <= 1,
    `${layout.run.width} vs ${layout.stage.width}`,
  );
  check(
    `${viewport.name}: key chips are ${viewport.touch ? 'hidden' : 'shown'}`,
    layout.keysHidden === viewport.touch,
    `hidden: ${layout.keysHidden}`,
  );
  {
    // 44px is the smallest target a thumb hits reliably. Desktop is allowed to be a
    // little smaller, but never small enough to be a line of text.
    const floor = viewport.touch ? 44 : 36;
    const small = layout.targets.filter((t) => t.height < floor);
    check(
      `${viewport.name}: every control is a real target`,
      small.length === 0 && layout.targets.length === 3,
      layout.targets.map((t) => `${t.id} ${t.height.toFixed(0)}px`).join(', '),
    );
  }

  // The whole point: place a note and run it without touching a keyboard.
  const tap = async (selector) => {
    if (viewport.touch) await page.tap(selector);
    else await page.click(selector);
  };

  await tap('.seq-row[data-instrument="kick"] .seq-cell[data-step="0"]');
  const placed = await page.evaluate(() => window.__debug.state.used);
  check(`${viewport.name}: tapping a cell places a note`, placed === 1, `used ${placed}`);

  await tap('#run');
  const armed = await page
    .waitForFunction(() => window.__debug.state.phase === 'armed', null, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  check(`${viewport.name}: the run button arms a run`, armed);

  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/stage-${viewport.name}.png` });

  await tap('#clear');
  const cleared = await page.evaluate(() => window.__debug.state.used);
  check(`${viewport.name}: the clear button clears`, cleared === 0, `used ${cleared}`);

  await context.close();
}

await browser.close();
process.exit(report());
