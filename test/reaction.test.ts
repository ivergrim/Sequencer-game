import { describe, expect, it } from 'vitest';
import { reactionAt } from '../src/ui/stage';

const STEP = 60 / 124 / 4; // chapter 1: 124 BPM, 16th notes
const LENGTH = 16;

const at = (step: number, stepFloat: number) => reactionAt(step, stepFloat, LENGTH, STEP);

/**
 * The obstacle reaction is derived from `stepFloat`, not scheduled, so what has to hold
 * is that its onset coincides exactly with the obstacle reaching the launch position.
 * That coincidence is the whole point: it is what tells the player where the beat falls.
 */
describe('reactionAt', () => {
  it('begins exactly as the obstacle reaches the launch position', () => {
    expect(at(4, 4)).toBe(0);
    expect(at(0, 0)).toBe(0);
    expect(at(15, 15)).toBe(0);
  });

  it('has not begun a hair before the crossing', () => {
    expect(at(4, 3.999)).toBeNull();
    expect(at(0, 15.999)).toBeNull();
  });

  it('runs for a short window after the crossing, then stops', () => {
    const justAfter = at(4, 4.1);
    expect(justAfter).not.toBeNull();
    expect(justAfter!).toBeGreaterThan(0);
    expect(justAfter!).toBeLessThan(1);

    // The window is under two steps, so an obstacle is never still reacting two steps on.
    expect(at(4, 6)).toBeNull();
  });

  it('advances monotonically through the window', () => {
    let previous = -1;
    for (let offset = 0; offset < 1.8; offset += 0.1) {
      const value = at(4, 4 + offset);
      if (value === null) break;
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
    expect(previous).toBeGreaterThan(0.9);
  });

  it('wraps across the bar line', () => {
    // A pickup on step 15 crosses, then the bar turns over and it is still reacting.
    const value = at(15, 0.5);
    expect(value).not.toBeNull();
    expect(value!).toBeGreaterThan(0);
  });

  it('fires for every obstacle in the bar, once per pass', () => {
    // Sweep a whole bar and count how many steps each obstacle's onset is seen at.
    for (const step of [0, 3, 7, 12, 15]) {
      let onsets = 0;
      for (let i = 0; i < LENGTH * 100; i++) {
        const stepFloat = (i / 100) % LENGTH;
        const value = at(step, stepFloat);
        if (value === 0) onsets++;
      }
      expect(onsets).toBe(1);
    }
  });

  it('does not depend on the phase, the character or any scheduling', () => {
    // Pure function of position: same inputs, same answer, every time.
    const first = at(8, 8.4);
    for (let i = 0; i < 50; i++) expect(at(8, 8.4)).toBe(first);
  });
});
