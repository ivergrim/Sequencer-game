import { describe, expect, it } from 'vitest';
import { BANDS, SWELL_X, SWELL_Y } from '../src/ui/stage';
import { CHAPTER_1, activeObstacles } from '../src/game/chapter1';
import type { ObstacleType } from '../src/game/types';

/** The vertical span an obstacle occupies at the peak of its announcement swell. */
function swelledSpan(type: ObstacleType): { bottom: number; top: number } {
  const band = BANDS[type];
  const grounded = band.bottom === 0;
  const height = band.top - band.bottom;

  // Grounded types pivot on their base so they never lift off the ground; the rest
  // pivot on their centre.
  if (grounded) return { bottom: 0, top: band.top * (1 + SWELL_Y) };
  const centre = (band.bottom + band.top) / 2;
  const half = (height / 2) * (1 + SWELL_Y);
  return { bottom: centre - half, top: centre + half };
}

describe('obstacle bands', () => {
  it('are non-overlapping at rest', () => {
    const spans = Object.values(BANDS)
      .filter((b) => b.top < 190) // the wall spans everything by design, behind the rest
      .sort((a, b) => a.bottom - b.bottom);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.bottom).toBeGreaterThan(spans[i - 1]!.top);
    }
  });

  it('stay non-overlapping at the peak of the announcement swell', () => {
    // The swell is what makes an obstacle's crossing legible; it must not cost the
    // separation that makes stacked obstacles legible in the first place.
    const types = (Object.keys(BANDS) as ObstacleType[]).filter((t) => t !== 'wall');
    const spans = types.map(swelledSpan).sort((a, b) => a.bottom - b.bottom);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.bottom).toBeGreaterThan(spans[i - 1]!.top);
    }
  });

  it('keeps every step that stacks obstacles readable through the swell', () => {
    const byStep = new Map<number, ObstacleType[]>();
    for (const o of activeObstacles(CHAPTER_1, 9)) {
      byStep.set(o.step, [...(byStep.get(o.step) ?? []), o.type]);
    }

    let stacked = 0;
    for (const [, types] of byStep) {
      const others = types.filter((t) => t !== 'wall');
      if (others.length < 2) continue;
      stacked++;
      const spans = others.map(swelledSpan).sort((a, b) => a.bottom - b.bottom);
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i]!.bottom).toBeGreaterThan(spans[i - 1]!.top);
      }
    }
    // Steps 4 and 12 stack in chapter 1 — pillar under enemy, on both backbeats. Step 0
    // carries a pillar and the wall, but the wall spans the full height behind
    // everything and so is exempt by construction. The rebuilt chapter stacks far less
    // than the old one did (which stacked on five steps, three deep in places); this
    // still has to hold, because the moment it stops holding is the moment a swelled
    // obstacle eats its neighbour.
    expect(stacked).toBe(2);
  });

  it('puts almost all of the punch sideways', () => {
    expect(SWELL_X).toBeGreaterThan(SWELL_Y * 3);
  });
});
