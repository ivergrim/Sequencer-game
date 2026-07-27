import { describe, expect, it } from 'vitest';
import { requiredInstruments, requiredNotes, simulate } from '../src/game/simulate';
import type { Instrument, Obstacle, Pattern } from '../src/game/types';
import { emptyPattern } from '../src/game/types';

const ROWS: Instrument[] = ['crash', 'openhat', 'clap', 'rim', 'kick'];
const LENGTH = 16;

function pattern(notes: Partial<Record<Instrument, number[]>>): Pattern {
  const p = emptyPattern(ROWS, LENGTH);
  for (const [instrument, steps] of Object.entries(notes) as Array<[Instrument, number[]]>) {
    for (const step of steps) p[instrument][step] = true;
  }
  return p;
}

describe('simulate', () => {
  it('succeeds when every obstacle has its instrument on its step', () => {
    const obstacles: Obstacle[] = [
      { step: 0, type: 'pillar' },
      { step: 8, type: 'pillar' },
    ];
    expect(simulate(obstacles, pattern({ kick: [0, 8] }), LENGTH)).toEqual({ ok: true });
  });

  it('fails at the step whose instrument is missing', () => {
    const obstacles: Obstacle[] = [
      { step: 0, type: 'pillar' },
      { step: 8, type: 'pillar' },
    ];
    expect(simulate(obstacles, pattern({ kick: [0] }), LENGTH)).toEqual({
      ok: false,
      failStep: 8,
      missing: 'kick',
    });
  });

  it('fails at the earliest failing step, walking in step order', () => {
    const obstacles: Obstacle[] = [
      { step: 12, type: 'pillar' },
      { step: 4, type: 'pillar' },
      { step: 8, type: 'pillar' },
    ];
    // Obstacles are given out of order; the failure is still the lowest step.
    const result = simulate(obstacles, pattern({ kick: [12] }), LENGTH);
    expect(result).toEqual({ ok: false, failStep: 4, missing: 'kick' });
  });

  it('removing a carried-over note fails at that step on the next run', () => {
    // Stage 4's obstacle set, solved: kick on the four, openhat on the offbeats.
    const stage4: Obstacle[] = [
      { step: 0, type: 'pillar' },
      { step: 8, type: 'pillar' },
      { step: 4, type: 'pillar' },
      { step: 12, type: 'pillar' },
      { step: 2, type: 'bird' },
      { step: 6, type: 'bird' },
      { step: 10, type: 'bird' },
      { step: 14, type: 'bird' },
    ];
    const solved = pattern({ kick: [0, 4, 8, 12], openhat: [2, 6, 10, 14] });
    expect(simulate(stage4, solved, LENGTH)).toEqual({ ok: true });

    // Pull out the kick carried over from stage 3.
    const broken = pattern({ kick: [0, 4, 12], openhat: [2, 6, 10, 14] });
    expect(simulate(stage4, broken, LENGTH)).toEqual({
      ok: false,
      failStep: 8,
      missing: 'kick',
    });
  });

  it('treats extra hits as harmless', () => {
    const obstacles: Obstacle[] = [{ step: 0, type: 'pillar' }];
    const noisy = pattern({ kick: [0, 1, 2, 3], crash: [5], openhat: [9] });
    expect(simulate(obstacles, noisy, LENGTH)).toEqual({ ok: true });
  });

  it('requires every instrument stacked on a shared step', () => {
    // Stage 9: a pillar and a wall both sit on step 0.
    const obstacles: Obstacle[] = [
      { step: 0, type: 'pillar' },
      { step: 0, type: 'wall' },
    ];
    expect(simulate(obstacles, pattern({ kick: [0] }), LENGTH)).toEqual({
      ok: false,
      failStep: 0,
      missing: 'crash',
    });
    expect(simulate(obstacles, pattern({ kick: [0], crash: [0] }), LENGTH)).toEqual({ ok: true });
  });

  it('succeeds on an empty obstacle set', () => {
    expect(simulate([], emptyPattern(ROWS, LENGTH), LENGTH)).toEqual({ ok: true });
  });

  it('ignores obstacles beyond the pattern length', () => {
    const obstacles: Obstacle[] = [{ step: 20, type: 'pillar' }];
    expect(simulate(obstacles, emptyPattern(ROWS, LENGTH), LENGTH)).toEqual({ ok: true });
  });

  it('is pure: it mutates neither the obstacles nor the pattern', () => {
    const obstacles: Obstacle[] = [
      { step: 0, type: 'pillar' },
      { step: 4, type: 'enemy' },
    ];
    const p = pattern({ kick: [0] });
    const obstaclesBefore = structuredClone(obstacles);
    const patternBefore = structuredClone(p);

    simulate(obstacles, p, LENGTH);

    expect(obstacles).toEqual(obstaclesBefore);
    expect(p).toEqual(patternBefore);
  });

  it('is deterministic: the same inputs always give the same result', () => {
    const obstacles: Obstacle[] = [
      { step: 3, type: 'bird' },
      { step: 7, type: 'bird' },
    ];
    const p = pattern({ openhat: [3] });
    const first = simulate(obstacles, p, LENGTH);
    for (let i = 0; i < 100; i++) expect(simulate(obstacles, p, LENGTH)).toEqual(first);
  });
});

describe('requiredNotes', () => {
  it('derives the solution from the obstacles', () => {
    const obstacles: Obstacle[] = [
      { step: 0, type: 'pillar' },
      { step: 2, type: 'bird' },
    ];
    expect(requiredNotes(obstacles)).toEqual([
      { step: 0, instrument: 'kick' },
      { step: 2, instrument: 'openhat' },
    ]);
  });

  it('deduplicates obstacles that ask for the same note', () => {
    const obstacles: Obstacle[] = [
      { step: 0, type: 'pillar' },
      { step: 0, type: 'pillar' },
    ];
    expect(requiredNotes(obstacles)).toHaveLength(1);
  });
});

describe('requiredInstruments', () => {
  it('reports the instruments an obstacle set unlocks', () => {
    const obstacles: Obstacle[] = [
      { step: 0, type: 'pillar' },
      { step: 4, type: 'pillar' },
      { step: 6, type: 'totem' },
    ];
    expect(requiredInstruments(obstacles)).toEqual(new Set(['kick', 'rim']));
  });
});
