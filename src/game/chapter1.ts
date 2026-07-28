import type { Chapter, Obstacle } from './types';

/**
 * Chapter 1, deep house. Content is data: adding a stage means adding obstacle
 * entries, never writing new logic.
 *
 * Steps are zero indexed. Step 0 is the downbeat, four on the floor is 0, 4, 8, 12,
 * offbeat eighths are 2, 6, 10, 14, and the "a" of each beat is 3, 7, 11, 15.
 *
 * Obstacles accumulate: the set active at stage N is the union of stages 1..N.
 *
 * ## The bar this chapter builds towards
 *
 * ```
 *          0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
 * crash    x  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .
 * openhat  .  .  x  .  .  .  x  .  .  .  x  .  .  .  x  .
 * clap     .  .  .  .  x  .  .  .  .  .  .  .  x  .  .  .
 * rim      .  .  .  x  .  .  .  x  .  .  .  x  .  x  .  x
 * kick     x  .  .  .  x  .  .  .  x  .  .  .  x  .  .  .
 * ```
 *
 * That is the textbook deep house bar and every part of it is load-bearing:
 *
 * - **Kick on every quarter.** The genre's floor.
 * - **Open hat on the offbeat eighths only.** The accented offbeat is *the* house
 *   signature, and it is the one thing the previous build got wrong: it also put hats
 *   on 3, 7, 11 and 15, so every offbeat was two open hats a sixteenth apart. At 124
 *   BPM a step is 121ms and this open hat decays over 250ms, so the second hat always
 *   started while the first was still ringing. That is a wash, not a groove, and it is
 *   the "double hi hat" that sounded bad. One hat per offbeat, never two in a row.
 * - **Clap on the backbeat**, 4 and 12, and nowhere else.
 * - **Rim on the sixteenths the hat does not own.** In a full kit this is what the
 *   closed hat does — fill the 1/16 slots not already taken by an open hat. There is no
 *   closed hat in this kit, so the rim plays that part: short, clicky, and out of the
 *   hat's way. 3, 7 and 11 push into each beat; 13 and 15 double up on the last beat to
 *   pull the loop round, which is what a turnaround is for.
 * - **One crash, on the downbeat.** It rings for 1.5s of a 1.94s bar, so a second one
 *   anywhere would smear the whole loop. It is the accent that says the track has
 *   arrived, which is why it is the last thing the chapter hands over.
 *
 * Steps 1, 5 and 9 stay empty on purpose. A loop with no gaps has no groove.
 *
 * ## How the ten stages get there
 *
 * The previous build added four obstacles at a time twice (stages 4 and 6) and reached
 * fourteen notes by stage 6. That is where it stopped being legible. This one never
 * adds more than two, so the ramp is 1, 2, 4, 6, 8, 10, 11, 12, 14, 16 and the player
 * is reading at most two new questions per stage.
 *
 * The order is the order a deep house track is actually built: floor, then the offbeat
 * that makes it house, then the backbeat, then the percussion detail, then the accent.
 * Each stage is also a complete groove in its own right rather than half of one — the
 * open hat arrives as 2 and 10 (a symmetric half-bar offbeat) before it completes,
 * whereas the clap arrives whole, because half a backbeat just sounds broken.
 *
 * No step carries more than two obstacles anywhere in the chapter.
 */
export const CHAPTER_1: Chapter = {
  name: 'Deep house',
  bpm: 124,
  patternLength: 16,
  // Display order only, top to bottom. It mirrors the obstacles' vertical order on
  // stage — bird highest, then enemy, totem, pillar on the ground — so a row and the
  // thing it clears sit at the same height. The wall spans the full height, and its crash
  // takes the top slot, which is also where a drum kit puts it.
  rows: ['crash', 'openhat', 'clap', 'rim', 'kick'],
  stages: [
    {
      // kick 0. One hit, one question: where the bar begins.
      id: 1,
      label: 'The downbeat',
      obstacles: [{ step: 0, type: 'pillar' }],
      stem: 'bass',
    },
    {
      // kick 8. The bar has a middle.
      id: 2,
      label: 'The half bar',
      obstacles: [{ step: 8, type: 'pillar' }],
      stem: 'bassline',
    },
    {
      // kick 4, 12. The floor is complete and the chapter has a pulse.
      id: 3,
      label: 'Four on the floor',
      obstacles: [
        { step: 4, type: 'pillar' },
        { step: 12, type: 'pillar' },
      ],
      stem: 'sub',
    },
    {
      // openhat 2, 10. The offbeat arrives half-strength — the "and" of beats 1 and 3.
      // Symmetric, so it is a groove on its own rather than an unfinished one.
      id: 4,
      label: 'The offbeat',
      obstacles: [
        { step: 2, type: 'bird' },
        { step: 10, type: 'bird' },
      ],
      stem: 'pad',
    },
    {
      // openhat 6, 14. Every offbeat now carries a hat. This is the moment the loop
      // stops being a metronome and becomes house.
      id: 5,
      label: 'Every offbeat',
      obstacles: [
        { step: 6, type: 'bird' },
        { step: 14, type: 'bird' },
      ],
      stem: 'keys',
    },
    {
      // clap 4, 12. The backbeat, whole. Half of it would just sound wrong.
      id: 6,
      label: 'The backbeat',
      obstacles: [
        { step: 4, type: 'enemy' },
        { step: 12, type: 'enemy' },
      ],
      stem: 'voice',
    },
    {
      // rim 15. A single tick on the last sixteenth, pulling the loop back round to the
      // downbeat. The first thing in the chapter that is decoration rather than skeleton.
      id: 7,
      label: 'The pickup',
      obstacles: [{ step: 15, type: 'totem' }],
      stem: 'strings',
    },
    {
      // rim 7. The mid-bar answer to it. 7 and 15 alone are already a groove.
      id: 8,
      label: 'The answer',
      obstacles: [{ step: 7, type: 'totem' }],
      stem: 'swell',
    },
    {
      // rim 3, 11. The sixteenth filler completes: every beat now pushes into the next.
      id: 9,
      label: 'The shuffle',
      obstacles: [
        { step: 3, type: 'totem' },
        { step: 11, type: 'totem' },
      ],
      stem: 'lead',
    },
    {
      // crash 0 and rim 13. The wall is the chapter's only full-height obstacle and the
      // crash is its only 1.5s voice; the extra rim on 13 turns the last beat into a
      // two-tick run-up so the crash lands on something.
      id: 10,
      label: 'The drop',
      obstacles: [
        { step: 0, type: 'wall' },
        { step: 13, type: 'totem' },
      ],
      stem: 'chords',
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
