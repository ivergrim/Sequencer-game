import { describe, expect, it } from 'vitest';
import { CHAPTER_1, noteBudget } from '../src/game/chapter1';
import { parseSave } from '../src/game/save';
import { clearStage, make } from './helpers';

describe('save round-trip', () => {
  it('restores mid-chapter progress exactly', () => {
    const { clock, state } = make();
    clearStage(clock, state);
    clearStage(clock, state);
    expect(state.stageIndex).toBe(2);

    // Half-finished work on stage 3 rides along with the committed stages.
    state.toggle('kick', 4);

    const raw = JSON.stringify(state.serialize());
    const parsed = parseSave(CHAPTER_1, raw);
    expect(parsed).not.toBeNull();

    const { state: revived } = make();
    revived.restore(parsed!);

    expect(revived.stageIndex).toBe(2);
    expect(revived.complete).toBe(false);
    expect(revived.pattern).toEqual(state.pattern);
    expect(revived.isLocked('kick', 0)).toBe(true);
    expect(revived.isLocked('kick', 8)).toBe(true);
    expect(revived.isLocked('kick', 4)).toBe(false);
    expect(revived.used).toBe(3);
  });

  it('restores a completed chapter into free play, with no locks', () => {
    const { clock, state } = make();
    for (let i = 0; i < CHAPTER_1.stages.length; i++) clearStage(clock, state);
    expect(state.complete).toBe(true);

    const parsed = parseSave(CHAPTER_1, JSON.stringify(state.serialize()));
    const { state: revived } = make();
    revived.restore(parsed!);

    expect(revived.complete).toBe(true);
    // The whole finished track, however many notes that is — derived, so retuning the
    // chapter cannot silently make this assert something smaller than the truth.
    expect(revived.used).toBe(noteBudget(CHAPTER_1, CHAPTER_1.stages.length - 1));
    expect(revived.unlockedRows.size).toBe(CHAPTER_1.rows.length);
    for (const row of CHAPTER_1.rows) {
      for (let step = 0; step < CHAPTER_1.patternLength; step++) {
        expect(revived.isLocked(row, step)).toBe(false);
      }
    }
  });
});

describe('save validation', () => {
  const valid = () => {
    const { clock, state } = make();
    clearStage(clock, state);
    return state.serialize();
  };

  it('accepts its own output', () => {
    expect(parseSave(CHAPTER_1, JSON.stringify(valid()))).not.toBeNull();
  });

  it.each([
    ['not JSON at all', 'definitely not json'],
    ['a JSON scalar', '42'],
    ['null', 'null'],
    ['an empty object', '{}'],
  ])('rejects %s', (_label, raw) => {
    expect(parseSave(CHAPTER_1, raw)).toBeNull();
  });

  it('rejects a stage index outside the chapter', () => {
    for (const stageIndex of [-1, CHAPTER_1.stages.length, 3.5]) {
      expect(parseSave(CHAPTER_1, JSON.stringify({ ...valid(), stageIndex }))).toBeNull();
    }
  });

  it('rejects lanes of the wrong shape', () => {
    const short = valid();
    short.pattern.kick = short.pattern.kick.slice(0, 8);
    expect(parseSave(CHAPTER_1, JSON.stringify(short))).toBeNull();

    const missing = valid() as unknown as Record<string, unknown>;
    delete (missing.locked as Record<string, unknown>).crash;
    expect(parseSave(CHAPTER_1, JSON.stringify(missing))).toBeNull();

    const wrongType = valid() as unknown as { pattern: Record<string, unknown> };
    wrongType.pattern.kick = new Array<number>(16).fill(1);
    expect(parseSave(CHAPTER_1, JSON.stringify(wrongType))).toBeNull();
  });

  it('rejects a non-boolean complete flag', () => {
    expect(parseSave(CHAPTER_1, JSON.stringify({ ...valid(), complete: 'yes' }))).toBeNull();
  });
});
