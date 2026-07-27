import type { Chapter, Pattern } from './types';

/**
 * Progress persistence.
 *
 * The design asks for the pattern to be saved continuously, and a browser refresh must
 * not cost the player a chapter. The whole of the durable state is four fields; they
 * are written to localStorage on every mutation and validated strictly on the way back
 * in, so a save from an older shape of the game degrades to a fresh start rather than
 * a corrupt one.
 *
 * Storage can be absent or forbidden (private windows, embedded contexts). Every touch
 * of it is guarded: the game runs identically without persistence, it just forgets.
 */

const KEY = 'sequencer-game.chapter1.v1';

export interface SaveData {
  stageIndex: number;
  complete: boolean;
  pattern: Pattern;
  locked: Pattern;
}

function isLanes(chapter: Chapter, value: unknown): value is Pattern {
  if (typeof value !== 'object' || value === null) return false;
  return chapter.rows.every((row) => {
    const lane = (value as Record<string, unknown>)[row];
    return (
      Array.isArray(lane) &&
      lane.length === chapter.patternLength &&
      lane.every((cell) => typeof cell === 'boolean')
    );
  });
}

/** Validate a raw save. Anything malformed, out of range or from another shape is null. */
export function parseSave(chapter: Chapter, raw: string): SaveData | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;

  const save = data as Partial<SaveData>;
  if (
    typeof save.stageIndex !== 'number' ||
    !Number.isInteger(save.stageIndex) ||
    save.stageIndex < 0 ||
    save.stageIndex >= chapter.stages.length
  ) {
    return null;
  }
  if (typeof save.complete !== 'boolean') return null;
  if (!isLanes(chapter, save.pattern) || !isLanes(chapter, save.locked)) return null;

  return {
    stageIndex: save.stageIndex,
    complete: save.complete,
    pattern: save.pattern,
    locked: save.locked,
  };
}

export function loadProgress(chapter: Chapter): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? null : parseSave(chapter, raw);
  } catch {
    return null;
  }
}

export function saveProgress(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage full or forbidden. The game plays on; it just forgets.
  }
}

export function clearProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear, or nowhere to clear it from.
  }
}
