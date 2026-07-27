import { describe, expect, it } from 'vitest';
import { ACTIONS, actionTiming, impulse, stepsToNextHit } from '../src/game/actions';
import type { Instrument } from '../src/game/types';

const STEP = 60 / 124 / 4; // chapter 1: 124 BPM, 16th notes
const LENGTH = 16;

function lane(steps: number[]): boolean[] {
  const l = new Array<boolean>(LENGTH).fill(false);
  for (const step of steps) l[step] = true;
  return l;
}

describe('stepsToNextHit', () => {
  it('finds the next hit in the bar', () => {
    expect(stepsToNextHit(lane([0, 4, 8, 12]), 0)).toBe(4);
    expect(stepsToNextHit(lane([0, 4, 8, 12]), 4)).toBe(4);
  });

  it('wraps around the bar line', () => {
    expect(stepsToNextHit(lane([0, 15]), 15)).toBe(1);
    expect(stepsToNextHit(lane([0, 15]), 0)).toBe(15);
  });

  it('returns the full pattern length for a lone hit', () => {
    expect(stepsToNextHit(lane([0]), 0)).toBe(LENGTH);
  });
});

describe('actionTiming', () => {
  it('uses the base duration when there is room', () => {
    const timing = actionTiming('kick', lane([0, 4, 8, 12]), 0, STEP);
    expect(timing.duration).toBeCloseTo(0.4, 6);
    expect(timing.lead).toBeCloseTo(0.2, 6);
  });

  it('caps the duration by the gap to the next hit on the same instrument', () => {
    // Chapter 1's pickup: a kick on 15 and a kick on 0, one step apart.
    const kicks = lane([0, 4, 8, 12, 15]);
    const gap = STEP;
    expect(gap).toBeLessThan(ACTIONS.kick.duration);

    const timing = actionTiming('kick', kicks, 15, STEP);
    expect(timing.duration).toBeCloseTo(gap, 6);
    expect(timing.duration).toBeCloseTo(0.1209677, 5);
  });

  it('caps the duration by the gap behind as well as the gap ahead', () => {
    // Step 0's next kick is four steps away, but its previous kick is one step behind.
    // Capping forwards only would leave a 400ms jump whose 200ms lead reaches back
    // through the jump on step 15.
    const kicks = lane([0, 4, 8, 12, 15]);
    const timing = actionTiming('kick', kicks, 0, STEP);
    expect(timing.duration).toBeCloseTo(STEP, 6);
  });

  it('keeps the two adjacent kicks distinct and complete', () => {
    // Each jump finishes before the next one starts, so 15 and 0 read as two jumps.
    const kicks = lane([0, 4, 8, 12, 15]);
    const at15 = actionTiming('kick', kicks, 15, STEP);
    const at0 = actionTiming('kick', kicks, 0, STEP);

    const start15 = 15 * STEP - at15.lead;
    const end15 = start15 + at15.duration;
    const start0 = 16 * STEP - at0.lead; // step 0 of the following bar

    expect(end15).toBeLessThanOrEqual(start0 + 1e-9);
    expect(at15.duration).toBeGreaterThan(0);
    expect(at0.duration).toBeGreaterThan(0);
  });

  it('leaves the four on the floor jump uncapped', () => {
    const timing = actionTiming('kick', lane([0, 4, 8, 12]), 4, STEP);
    expect(timing.duration).toBeCloseTo(ACTIONS.kick.duration, 6);
  });

  it('scales the lead with the capped duration', () => {
    const kicks = lane([0, 15]);
    const timing = actionTiming('kick', kicks, 15, STEP);
    expect(timing.lead).toBeCloseTo(timing.duration * ACTIONS.kick.impact, 9);
  });

  it('never leads by more than the base duration allows', () => {
    for (const instrument of Object.keys(ACTIONS) as Instrument[]) {
      const timing = actionTiming(instrument, lane([0]), 0, STEP);
      expect(timing.lead).toBeLessThanOrEqual(
        ACTIONS[instrument].duration * ACTIONS[instrument].impact + 1e-9,
      );
    }
  });
});

describe('impulse', () => {
  it('is at its maximum exactly at the impact ratio', () => {
    for (const instrument of Object.keys(ACTIONS) as Instrument[]) {
      const { impact } = ACTIONS[instrument];
      expect(impulse(impact, impact)).toBeCloseTo(1, 12);
    }
  });

  it('is zero at both ends', () => {
    expect(impulse(0, 0.5)).toBe(0);
    expect(impulse(1, 0.5)).toBe(0);
  });

  it('rises to the impact and falls away from it', () => {
    const impact = 0.6;
    for (let t = 0.02; t < impact; t += 0.02) {
      expect(impulse(t, impact)).toBeLessThan(impulse(t + 0.02, impact));
    }
    for (let t = impact; t < 0.98; t += 0.02) {
      expect(impulse(t, impact)).toBeGreaterThan(impulse(t + 0.02, impact));
    }
  });

  it('puts the impact frame on the step, for every instrument', () => {
    // The whole point of B2: at stepTime(S) the elapsed fraction is the impact ratio,
    // so the character is at apex / full extension / full speed, never starting out.
    for (const instrument of Object.keys(ACTIONS) as Instrument[]) {
      const spec = ACTIONS[instrument];
      const timing = actionTiming(instrument, lane([0]), 0, STEP);
      const stepTime = 0;
      const start = stepTime - timing.lead;
      const elapsedFraction = (stepTime - start) / timing.duration;

      expect(elapsedFraction).toBeCloseTo(spec.impact, 12);
      expect(impulse(elapsedFraction, spec.impact)).toBeCloseTo(1, 12);
    }
  });

  it('is strictly below its maximum one frame either side of the step', () => {
    const frame = 1 / 60;
    for (const instrument of Object.keys(ACTIONS) as Instrument[]) {
      const spec = ACTIONS[instrument];
      const timing = actionTiming(instrument, lane([0]), 0, STEP);
      const before = (timing.lead - frame) / timing.duration;
      const after = (timing.lead + frame) / timing.duration;
      expect(impulse(before, spec.impact)).toBeLessThan(1);
      expect(impulse(after, spec.impact)).toBeLessThan(1);
    }
  });
});
