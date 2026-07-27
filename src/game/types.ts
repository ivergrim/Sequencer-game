export type Instrument = 'kick' | 'clap' | 'openhat' | 'rim' | 'crash';
export type ObstacleType = 'pillar' | 'enemy' | 'bird' | 'totem' | 'wall';

/**
 * The only binding between the world and the sequencer. A stage is authored as
 * placed obstacles and nothing else; the solution falls out of this table, so an
 * authored solution can never drift out of sync with the authored world.
 */
export const OBSTACLE_INSTRUMENT: Record<ObstacleType, Instrument> = {
  pillar: 'kick',
  enemy: 'clap',
  bird: 'openhat',
  totem: 'rim',
  wall: 'crash',
};

export interface Obstacle {
  step: number;
  type: ObstacleType;
}

export interface Stage {
  id: number;
  label: string;
  /** Added by this stage, on top of every previous stage. */
  obstacles: Obstacle[];
  /** Backing layer entering with this stage. */
  stem: string | null;
}

export interface Chapter {
  name: string;
  bpm: number;
  patternLength: number;
  /** Display order in the sequencer. */
  rows: Instrument[];
  stages: Stage[];
}

/** One boolean lane per instrument, each `patternLength` long. */
export type Pattern = Record<Instrument, boolean[]>;

export type Result =
  | { ok: true }
  | { ok: false; failStep: number; missing: Instrument };

export function emptyPattern(rows: Instrument[], patternLength: number): Pattern {
  const pattern = {} as Pattern;
  for (const row of rows) pattern[row] = new Array<boolean>(patternLength).fill(false);
  return pattern;
}

export function clonePattern(pattern: Pattern): Pattern {
  const copy = {} as Pattern;
  for (const key of Object.keys(pattern) as Instrument[]) copy[key] = [...pattern[key]];
  return copy;
}

export function countNotes(pattern: Pattern): number {
  let used = 0;
  for (const key of Object.keys(pattern) as Instrument[]) {
    for (const on of pattern[key]) if (on) used++;
  }
  return used;
}
