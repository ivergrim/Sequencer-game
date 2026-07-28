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
export const Db2 = 69.3;
export const F2 = 87.31;
export const Ab2 = 103.83;
export const C3 = 130.81;
export const Db3 = 138.59;
export const Eb3 = 155.56;
export const F3 = 174.61;
export const Ab3 = 207.65;
export const Bb3 = 233.08;
export const C4 = 261.63;
export const Db4 = 277.18;
export const Eb4 = 311.13;
export const F4 = 349.23;
export const G4 = 392.0;
export const Ab4 = 415.3;
export const C5 = 523.25;

/**
 * The chapter's two chords, voiced without their roots.
 *
 * The bass supplies the root and it is the only thing that moves: F under
 * `[F3, Ab3, C4, Eb4]` is Fm7, and Db under the very same four notes is Dbmaj9. So the
 * pad can hold one shape for the whole bar and still change chord halfway through it,
 * which is why the backing never has to re-attack anything to imply harmony — and a
 * layer that never re-attacks can never be mistaken for a drum.
 */
export const FM7 = [F3, Ab3, C4, Eb4];

/**
 * The two colours for the layers that do re-voice halfway through the bar: Fm9 and Db6,
 * both rootless. They voice-lead by three notes each moving down one scale step
 * (C→Bb, Eb→Db, G→F), which is why the change reads as a chord moving rather than as
 * two chords being struck.
 */
export const FM9 = [Ab3, C4, Eb4, G4];
export const DB6 = [Ab3, Bb3, Db4, F4];
