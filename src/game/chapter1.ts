import type { Chapter, Obstacle } from './types';

/**
 * Chapter 1, deep house. Content is data: adding a stage means adding obstacle
 * entries, never writing new logic.
 *
 * Steps are zero indexed. Step 0 is the downbeat, four on the floor is 0, 4, 8, 12,
 * offbeat eighths are 2, 6, 10, 14.
 *
 * Obstacles accumulate: the set active at stage N is the union of stages 1..N.
 */
export const CHAPTER_1: Chapter = {
  name: 'Deep house',
  bpm: 124,
  patternLength: 16,
  rows: ['kick', 'clap', 'openhat', 'shaker', 'rim', 'crash'],
  stages: [
    {
      id: 1,
      label: 'The downbeat',
      obstacles: [{ step: 0, type: 'pillar' }],
      stem: 'bass',
    },
    {
      id: 2,
      label: 'Half bar',
      obstacles: [{ step: 8, type: 'pillar' }],
      stem: 'sub',
    },
    {
      id: 3,
      label: 'Four on the floor',
      obstacles: [
        { step: 4, type: 'pillar' },
        { step: 12, type: 'pillar' },
      ],
      stem: 'bassline',
    },
    {
      id: 4,
      label: 'The offbeat',
      obstacles: [
        { step: 2, type: 'bird' },
        { step: 6, type: 'bird' },
        { step: 10, type: 'bird' },
        { step: 14, type: 'bird' },
      ],
      stem: 'pad',
    },
    {
      id: 5,
      label: 'Backbeat',
      obstacles: [
        { step: 4, type: 'enemy' },
        { step: 12, type: 'enemy' },
      ],
      stem: 'stab',
    },
    {
      id: 6,
      label: 'Sixteenth lift',
      obstacles: [
        { step: 3, type: 'pest' },
        { step: 7, type: 'pest' },
        { step: 11, type: 'pest' },
        { step: 15, type: 'pest' },
      ],
      stem: 'chop',
    },
    {
      id: 7,
      label: 'Pickup',
      obstacles: [{ step: 15, type: 'pillar' }],
      stem: 'sweep',
    },
    {
      id: 8,
      label: 'Offbeat percussion',
      obstacles: [
        { step: 6, type: 'totem' },
        { step: 14, type: 'totem' },
      ],
      stem: 'pad2',
    },
    {
      id: 9,
      label: 'Accent',
      obstacles: [{ step: 0, type: 'wall' }],
      stem: 'chords',
    },
    {
      id: 10,
      label: 'Turnaround',
      obstacles: [
        { step: 12, type: 'bird' },
        { step: 13, type: 'totem' },
        { step: 14, type: 'pest' },
      ],
      stem: 'lead',
    },
  ],
};

/** Every obstacle active at `stageIndex` (zero based): the union of stages 0..stageIndex. */
export function activeObstacles(chapter: Chapter, stageIndex: number): Obstacle[] {
  const active: Obstacle[] = [];
  for (let i = 0; i <= stageIndex && i < chapter.stages.length; i++) {
    active.push(...chapter.stages[i]!.obstacles);
  }
  return active;
}

/** Every stem playing at `stageIndex` (zero based), in the order they entered. */
export function activeStems(chapter: Chapter, stageIndex: number): string[] {
  const stems: string[] = [];
  for (let i = 0; i <= stageIndex && i < chapter.stages.length; i++) {
    const stem = chapter.stages[i]!.stem;
    if (stem) stems.push(stem);
  }
  return stems;
}

/**
 * The note budget for a stage: exactly the number of active obstacles.
 *
 * Derived, never tabulated. Because no two obstacles on the same step map to the same
 * instrument in this chapter, the required note count equals the obstacle count, so an
 * exact budget leaves each stage exactly one solution. `test/chapter1.test.ts` pins
 * that property, and the resulting budgets, against the brief.
 */
export function noteBudget(chapter: Chapter, stageIndex: number): number {
  return activeObstacles(chapter, stageIndex).length;
}
