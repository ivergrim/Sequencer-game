/**
 * The chapter's key.
 *
 * F minor, the key the synthesized backing bed sits in. Everything tonal outside the
 * drum voices — the fallback stems and the UI cues alike — draws its pitches from
 * here, so a cue can never land out of key with the bed under it.
 *
 * One chapter exists, so one key lives here. When chapter 2 arrives this becomes
 * per-chapter data alongside its stems.
 */

export const F1 = 43.65;
export const F2 = 87.31;
export const Ab2 = 103.83;
export const C3 = 130.81;
export const F3 = 174.61;
export const Ab3 = 207.65;
export const C4 = 261.63;
export const Db4 = 277.18;
export const F4 = 349.23;
export const Ab4 = 415.3;
export const C5 = 523.25;

export const F_MINOR = [F3, Ab3, C4];
export const Db_MAJOR = [Db4, F4, Ab4];
