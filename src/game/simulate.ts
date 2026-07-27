import type { Instrument, Obstacle, Result } from './types';
import { OBSTACLE_INSTRUMENT } from './types';

/**
 * Resolve a run in full, before any of it is animated.
 *
 * Walks steps 0..patternLength-1 in order. For each active obstacle on that step,
 * the mapped instrument must be on. The first step where it is not is the failure.
 *
 * There is no hitbox test here or anywhere else in the repo. Collision is a table
 * lookup, which makes every outcome deterministic, exactly reproducible, and immune
 * to a dropped frame.
 *
 * Pure: no clock, no audio, no DOM, no mutation of either argument.
 */
export function simulate(
  obstacles: Obstacle[],
  pattern: Record<Instrument, boolean[]>,
  patternLength: number,
): Result {
  for (let step = 0; step < patternLength; step++) {
    for (const obstacle of obstacles) {
      if (obstacle.step !== step) continue;
      const required = OBSTACLE_INSTRUMENT[obstacle.type];
      if (!pattern[required]?.[step]) {
        return { ok: false, failStep: step, missing: required };
      }
    }
  }
  return { ok: true };
}

/**
 * The notes an obstacle set demands, derived the same way `simulate` derives them.
 *
 * Used for the note budget and for nothing else. This is not an answer key: it is
 * computed from the obstacles on demand and never stored.
 */
export function requiredNotes(obstacles: Obstacle[]): Array<{ step: number; instrument: Instrument }> {
  const seen = new Set<string>();
  const notes: Array<{ step: number; instrument: Instrument }> = [];
  for (const obstacle of obstacles) {
    const instrument = OBSTACLE_INSTRUMENT[obstacle.type];
    const key = `${instrument}:${obstacle.step}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push({ step: obstacle.step, instrument });
  }
  return notes;
}

/** Instruments any active obstacle asks for. Drives sequencer row unlocking. */
export function requiredInstruments(obstacles: Obstacle[]): Set<Instrument> {
  const instruments = new Set<Instrument>();
  for (const obstacle of obstacles) instruments.add(OBSTACLE_INSTRUMENT[obstacle.type]);
  return instruments;
}
