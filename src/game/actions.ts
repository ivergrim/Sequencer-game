import type { Instrument } from './types';

/**
 * Action timing.
 *
 * The character has to be mid-action when the obstacle arrives, not starting one. Every
 * action carries an impact ratio: the fraction of its animation elapsed at the moment it
 * clears the obstacle. The animation is scheduled as
 *
 *   animationStart = stepTime(S) - duration * impactRatio
 *
 * so the impact frame lands exactly on the step.
 *
 * Audio and animation decouple. The drum hit still fires at exactly `stepTime(S)`; only
 * the animation starts early. Tying the animation trigger to the audio trigger is what
 * left the character at ground level on contact.
 */

export interface ActionSpec {
  /** Seconds, before capping. */
  duration: number;
  /** Fraction of the animation elapsed at the impact frame. */
  impact: number;
}

export const ACTIONS: Record<Instrument, ActionSpec> = {
  kick: { duration: 0.4, impact: 0.5 }, // jump, apex of the arc
  crash: { duration: 0.3, impact: 0.6 }, // dash, mid-dash at full speed
  clap: { duration: 0.24, impact: 0.55 }, // punch, full extension
  openhat: { duration: 0.16, impact: 0.5 }, // dodge, apex
  shaker: { duration: 0.16, impact: 0.5 },
  rim: { duration: 0.16, impact: 0.5 },
};

/** The longest lead any action can need, for the frame loop's scheduling horizon. */
export const MAX_LEAD_SECONDS = Math.max(
  ...Object.values(ACTIONS).map((spec) => spec.duration * spec.impact),
);

/**
 * Steps from `step` to this lane's next hit, wrapping the bar.
 *
 * A lane whose only hit is `step` itself returns the full pattern length rather than
 * zero, so a lone hit is never capped.
 */
export function stepsToNextHit(lane: readonly boolean[], step: number): number {
  const length = lane.length;
  for (let gap = 1; gap <= length; gap++) {
    if (lane[(step + gap) % length]) return gap;
  }
  return length;
}

/** Steps from this lane's previous hit to `step`, wrapping the bar. */
export function stepsFromPrevHit(lane: readonly boolean[], step: number): number {
  const length = lane.length;
  for (let gap = 1; gap <= length; gap++) {
    if (lane[(((step - gap) % length) + length) % length]) return gap;
  }
  return length;
}

export interface ActionTiming {
  /** Seconds the animation runs for, capped by the gap to the next hit on this lane. */
  duration: number;
  /** Seconds before the step that the animation starts. */
  lead: number;
}

/**
 * Cap the duration by the gap to the nearest hit on the same instrument, in either
 * direction.
 *
 * Chapter 1 puts a kick on step 15 and a kick on step 0, one step apart. At 124 BPM that
 * is 121ms, far shorter than a 400ms jump. Capped, dense hits read as fast, tight
 * motion, which is musically correct. The impact ratio scales with the capped duration,
 * so the impact frame still lands on the step.
 *
 * The patch specifies `min(baseDuration, timeToNextHitOnThisInstrument)`, capping
 * forwards only. That is not enough to keep those two kicks distinct, because an action
 * also extends *backwards* by its lead. Forwards-only, the jump on 15 ends 60ms after
 * step 15, while the uncapped 400ms jump on step 0 starts 200ms before step 0 — 79ms
 * before the first one has finished. Layered by max, the two merge into one long hover
 * instead of the two distinct jumps the patch asks for. Capping by the nearer of the two
 * gaps makes them land exactly back to back.
 */
export function actionTiming(
  instrument: Instrument,
  lane: readonly boolean[],
  step: number,
  stepDuration: number,
): ActionTiming {
  const spec = ACTIONS[instrument];
  const ahead = stepsToNextHit(lane, step);
  const behind = stepsFromPrevHit(lane, step);
  const gap = Math.min(ahead, behind) * stepDuration;
  const duration = Math.min(spec.duration, gap);
  return { duration, lead: duration * spec.impact };
}

/**
 * The action's pose value at `t`, rising to 1 at the impact ratio and falling back to 0.
 *
 * `impulse(impact, impact) === 1` is what makes the impact frame land on the step: at
 * `stepTime(S)` the elapsed fraction is exactly the impact ratio, so the channel is at
 * its maximum. Apex of the jump, full extension of the punch, full speed of the dash.
 */
export function impulse(t: number, impact: number): number {
  if (t <= 0 || t >= 1) return 0;
  if (t <= impact) return Math.sin((t / impact) * (Math.PI / 2));
  return Math.cos(((t - impact) / (1 - impact)) * (Math.PI / 2));
}
