import { chromium } from 'playwright';

export const URL = process.env.E2E_URL ?? 'http://localhost:5199/';

/**
 * Chromium in this container ships at a fixed path. Set E2E_CHROMIUM to override, or
 * leave it unset on a machine where `npx playwright install` has run.
 */
const EXECUTABLE = process.env.E2E_CHROMIUM;

export async function openGame() {
  const browser = await chromium.launch({
    ...(EXECUTABLE ? { executablePath: EXECUTABLE } : {}),
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });

  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });

  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // Missing stems are expected: the app is specified to run with public/stems/ empty.
    if (/stems\/.*\.wav/.test(message.text())) return;
    if (/Failed to load resource/.test(message.text())) return;
    errors.push(message.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.click('#start');
  await page.waitForFunction(() => window.__debug?.transport?.started === true, null, {
    timeout: 10_000,
  });

  const running = await page.evaluate(async () => {
    const t = window.__debug.transport;
    const before = t.now;
    await new Promise((resolve) => setTimeout(resolve, 400));
    return t.now > before;
  });
  if (!running) {
    await browser.close();
    throw new Error('the audio clock is not advancing: this environment has no audio sink');
  }

  return { browser, page, errors };
}

/** Place the notes this stage's obstacles require, clicking the real cells. */
export async function solveCurrentStage(page) {
  const missing = await page.evaluate(() =>
    window.__debug
      .solution()
      .filter((note) => !window.__debug.state.pattern[note.instrument][note.step]),
  );
  for (const note of missing) {
    await page.click(
      `.seq-row[data-instrument="${note.instrument}"] .seq-cell[data-step="${note.step}"]`,
    );
  }
  return missing.length;
}

/** Press run and wait for the whole arm / count-in / run / flourish cycle to land. */
export async function runAndSettle(page) {
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__debug.state.phase === 'armed', null, {
    timeout: 5_000,
  });
  await page.waitForFunction(
    () => window.__debug.state.phase === 'editing' || window.__debug.state.phase === 'failed',
    null,
    { timeout: 25_000 },
  );
  await page.waitForTimeout(120);
}

let failures = 0;

export function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
}

export function report() {
  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
  return failures;
}
