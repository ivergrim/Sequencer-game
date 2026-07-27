import { describe, expect, it } from 'vitest';
import { CHAPTER_1, activeObstacles, activeStems, noteBudget } from '../src/game/chapter1';
import { requiredNotes, simulate } from '../src/game/simulate';
import type { Instrument, Pattern } from '../src/game/types';
import { countNotes, emptyPattern } from '../src/game/types';

const { rows, patternLength, stages } = CHAPTER_1;

/** The pattern a stage's obstacle set demands, derived rather than authored. */
function derivedSolution(stageIndex: number): Pattern {
  const p = emptyPattern(rows, patternLength);
  for (const note of requiredNotes(activeObstacles(CHAPTER_1, stageIndex))) {
    p[note.instrument][note.step] = true;
  }
  return p;
}

describe('chapter 1 data', () => {
  it('is 124 BPM, 16 steps, five rows in the declared order', () => {
    expect(CHAPTER_1.bpm).toBe(124);
    expect(patternLength).toBe(16);
    // Top to bottom, mirroring the obstacles' vertical order on stage.
    expect(rows).toEqual(['crash', 'openhat', 'clap', 'rim', 'kick']);
  });

  it('gives the open hat the whole hat part', () => {
    // The shaker was dropped: it sounded too close to the open hat and its swarm read
    // too close to the bird, which is what made the late stages cluttered rather than
    // hard. The open hat now covers both the offbeat eighths and the sixteenths.
    const hats = requiredNotes(activeObstacles(CHAPTER_1, 9))
      .filter((n) => n.instrument === 'openhat')
      .map((n) => n.step)
      .sort((a, b) => a - b);
    expect(hats).toEqual([2, 3, 6, 7, 10, 11, 12, 14, 15]);
  });

  it('has ten stages, each adding a stem', () => {
    expect(stages).toHaveLength(10);
    expect(activeStems(CHAPTER_1, 9)).toEqual([
      'bass',
      'sub',
      'bassline',
      'pad',
      'stab',
      'chop',
      'sweep',
      'pad2',
      'chords',
      'lead',
    ]);
  });

  it('places every obstacle inside the pattern', () => {
    for (const obstacle of activeObstacles(CHAPTER_1, 9)) {
      expect(obstacle.step).toBeGreaterThanOrEqual(0);
      expect(obstacle.step).toBeLessThan(patternLength);
    }
  });

  it('matches the note budget table in the brief', () => {
    const budgets = stages.map((_, i) => noteBudget(CHAPTER_1, i));
    expect(budgets).toEqual([1, 2, 4, 8, 10, 14, 15, 17, 18, 21]);
  });

  it('grants a budget exactly equal to the number of required notes', () => {
    // The budget is the active obstacle count. It only leaves exactly one solution if
    // no two obstacles on one step map to the same instrument, which would make the
    // required note count smaller than the obstacle count and leave a spare note.
    stages.forEach((_, i) => {
      const obstacles = activeObstacles(CHAPTER_1, i);
      expect(requiredNotes(obstacles)).toHaveLength(obstacles.length);
      expect(countNotes(derivedSolution(i))).toBe(noteBudget(CHAPTER_1, i));
    });
  });

  it('is clearable at every stage by the derived solution', () => {
    stages.forEach((_, i) => {
      expect(simulate(activeObstacles(CHAPTER_1, i), derivedSolution(i), patternLength)).toEqual({
        ok: true,
      });
    });
  });

  it('carries every stage solution forward into the next', () => {
    for (let i = 1; i < stages.length; i++) {
      const previous = derivedSolution(i - 1);
      const current = derivedSolution(i);
      for (const row of rows) {
        for (let step = 0; step < patternLength; step++) {
          if (previous[row][step]) expect(current[row][step]).toBe(true);
        }
      }
    }
  });

  it('fails a stage whose newly added obstacles are unanswered', () => {
    // Solving stage N-1 and pressing run on stage N must fail on a new obstacle.
    for (let i = 1; i < stages.length; i++) {
      const result = simulate(activeObstacles(CHAPTER_1, i), derivedSolution(i - 1), patternLength);
      expect(result.ok).toBe(false);
    }
  });
});

describe('stage 3, four on the floor', () => {
  const STAGE_3 = 2; // zero based
  const obstacles = activeObstacles(CHAPTER_1, STAGE_3);

  it('asks for kick on 0, 4, 8 and 12 and nothing else', () => {
    expect(requiredNotes(obstacles).sort((a, b) => a.step - b.step)).toEqual([
      { step: 0, instrument: 'kick' },
      { step: 4, instrument: 'kick' },
      { step: 8, instrument: 'kick' },
      { step: 12, instrument: 'kick' },
    ]);
  });

  it('clears with kick on 0, 4, 8, 12', () => {
    expect(simulate(obstacles, derivedSolution(STAGE_3), patternLength)).toEqual({ ok: true });
  });

  it('is clearable by no other pattern within the budget', () => {
    // The budget is exactly 4, so any other 4-note pattern has swapped at least one
    // required note for something else. Every such swap must fail.
    const budget = noteBudget(CHAPTER_1, STAGE_3);
    expect(budget).toBe(4);

    const required: Array<[Instrument, number]> = [
      ['kick', 0],
      ['kick', 4],
      ['kick', 8],
      ['kick', 12],
    ];

    let checked = 0;
    for (const [dropRow, dropStep] of required) {
      for (const addRow of rows) {
        for (let addStep = 0; addStep < patternLength; addStep++) {
          const isRequired = required.some(([r, s]) => r === addRow && s === addStep);
          if (isRequired) continue;

          const candidate = derivedSolution(STAGE_3);
          candidate[dropRow][dropStep] = false;
          candidate[addRow][addStep] = true;

          expect(countNotes(candidate)).toBe(budget);
          expect(simulate(obstacles, candidate, patternLength).ok).toBe(false);
          checked++;
        }
      }
    }
    expect(checked).toBe(4 * (rows.length * patternLength - required.length));
  });
});
