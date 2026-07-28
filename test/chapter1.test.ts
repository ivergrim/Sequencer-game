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

  /** The steps one instrument is asked for across the finished chapter, in order. */
  function partFor(instrument: Instrument, stageIndex = 9): number[] {
    return requiredNotes(activeObstacles(CHAPTER_1, stageIndex))
      .filter((n) => n.instrument === instrument)
      .map((n) => n.step)
      .sort((a, b) => a - b);
  }

  it('builds the textbook deep house bar', () => {
    expect(partFor('kick')).toEqual([0, 4, 8, 12]);
    expect(partFor('openhat')).toEqual([2, 6, 10, 14]);
    expect(partFor('clap')).toEqual([4, 12]);
    expect(partFor('rim')).toEqual([3, 7, 11, 13, 15]);
    expect(partFor('crash')).toEqual([0]);
  });

  it('never asks for two open hats in consecutive steps', () => {
    // The reason this test exists. A step is 121ms at 124 BPM and the open hat decays
    // over 250ms, so back-to-back hats always overlap — the previous build asked for
    // hats on 2 and 3, 6 and 7, 10 and 11, 14 and 15, and the result was a wash rather
    // than a groove. The hat belongs on the offbeat eighths and nowhere else.
    const hats = partFor('openhat');
    for (const step of hats) {
      expect(hats).not.toContain((step + 1) % patternLength);
    }
  });

  it('asks for exactly one crash, because it rings for most of a bar', () => {
    // 1.5s of decay in a 1.94s bar. A second crash anywhere would smear the loop.
    expect(partFor('crash')).toHaveLength(1);
  });

  it('leaves the rim clear of the steps the open hat owns', () => {
    // The rim is playing the closed hat's part — the sixteenths an open hat has not
    // already taken. Doubling them up would just thicken the offbeat.
    const hats = new Set(partFor('openhat'));
    for (const step of partFor('rim')) expect(hats.has(step)).toBe(false);
  });

  it('leaves room to breathe', () => {
    const occupied = new Set(requiredNotes(activeObstacles(CHAPTER_1, 9)).map((n) => n.step));
    const empty = [...Array(patternLength).keys()].filter((s) => !occupied.has(s));
    expect(empty).toEqual([1, 5, 9]);
  });

  it('never stacks more than two obstacles on one step', () => {
    // Three used to land on a step. Two is the cap now, and the bands only have to keep
    // that many apart.
    const perStep = new Map<number, number>();
    for (const o of activeObstacles(CHAPTER_1, 9)) {
      perStep.set(o.step, (perStep.get(o.step) ?? 0) + 1);
    }
    expect(Math.max(...perStep.values())).toBe(2);
  });

  it('has ten stages, each adding a stem', () => {
    expect(stages).toHaveLength(10);
    expect(activeStems(CHAPTER_1, 9)).toEqual([
      'sub',
      'pad',
      'bass',
      'keys',
      'voice',
      'pulse',
      'strings',
      'swell',
      'lead',
      'chords',
    ]);
  });

  it('brings the kit in one instrument at a time, in the order the music needs it', () => {
    const arrival = new Map<Instrument, number>();
    stages.forEach((stage, i) => {
      for (const note of requiredNotes(stage.obstacles)) {
        if (!arrival.has(note.instrument)) arrival.set(note.instrument, i + 1);
      }
    });
    expect(Object.fromEntries(arrival)).toEqual({
      kick: 1,
      openhat: 4,
      clap: 6,
      rim: 7,
      crash: 10,
    });
  });

  it('never adds more than two obstacles in one stage', () => {
    // The old build added four at a time twice and was unreadable by stage 6.
    for (const stage of stages) expect(stage.obstacles.length).toBeLessThanOrEqual(2);
  });

  it('places every obstacle inside the pattern', () => {
    for (const obstacle of activeObstacles(CHAPTER_1, 9)) {
      expect(obstacle.step).toBeGreaterThanOrEqual(0);
      expect(obstacle.step).toBeLessThan(patternLength);
    }
  });

  it('ramps the budget gently and never by more than two', () => {
    // The brief's table was 1,2,4,8,10,14,15,17,18,21 — two +4 jumps, and fourteen notes
    // on screen by stage 6. This build trades the last five notes for legibility.
    const budgets = stages.map((_, i) => noteBudget(CHAPTER_1, i));
    expect(budgets).toEqual([1, 2, 4, 6, 8, 10, 11, 12, 14, 16]);
    for (let i = 1; i < budgets.length; i++) {
      expect(budgets[i]! - budgets[i - 1]!).toBeGreaterThanOrEqual(1);
      expect(budgets[i]! - budgets[i - 1]!).toBeLessThanOrEqual(2);
    }
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
