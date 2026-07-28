import { ACTIONS, impulse } from '../game/actions';
import type { CharacterPose, Failure, Phase } from '../game/state';
import { DEATH_CAMERA } from '../game/state';
import type { Instrument, ObstacleType } from '../game/types';
import { OBSTACLE_INSTRUMENT } from '../game/types';

/**
 * The stage.
 *
 * One bar occupies exactly the canvas width, so the world loop wraps seamlessly at the
 * bar line. Every position derives from `stepFloat`, which derives from the audio clock;
 * nothing here advances by a per-frame delta.
 *
 * The stage never draws the step grid. No tick marks, no lanes, no step numbers. Where
 * the beat falls is expressed two ways instead, neither of them a hit line: the launch
 * position is worn into the terrain, and every obstacle reacts as it crosses that spot,
 * whether or not a run is under way.
 *
 * Scenery on the quarter notes reads as parallax and functions as a coarse ruler.
 *
 * Legibility rests on two systems that are deliberately independent, so they can never
 * multiply and hide the oldest small obstacles:
 *
 *   Weight  is set by instrument. Size and detail only. Never changes.
 *   Depth   is set by recency. Opacity and layer only. Never changes size.
 *
 * Placeholder art, drawn procedurally. The visual target is the Chrome offline
 * dinosaur game.
 */

const INK = '#535353';
const LIGHT = '#bdbdbd';
const SOFT = '#dcdcdc';
const FAIL = '#c1554b';
const PAPER = '#f7f7f7';
/** Receded obstacles desaturate towards this rather than shrinking. */
const RECEDED_INK = '#7c7c7c';
/**
 * Dust and displaced air. A step darker than the ground litter it borrows its shapes
 * from, because it has to read in the fraction of a second it exists for.
 */
const DUST = '#a5a5a5';

export const STAGE_HEIGHT = 360;
const GROUND_Y = 292;
/**
 * Where the launch position sits across the stage.
 *
 * The brief said roughly 15%, but that leaves an obstacle only about two and a half steps
 * of screen after it crosses, so its reaction plays out just as it exits and is easy to
 * miss. At 28% it has around four and a half steps to react in, and the whole focal point
 * sits away from the edge. The cost is lookahead, and there is plenty to spare: about
 * eleven and a half steps of the bar are still visible ahead of it.
 */
const DINO_FRACTION = 0.28;

/**
 * How far a receded obstacle drops in opacity. A hard floor, so small types survive it.
 *
 * Depth has to be readable without the older obstacles becoming scenery. They are still
 * live hazards — every one of them will fail the run if its note goes missing — and a
 * stage-10 player is looking at eighteen of them, so sinking them almost into the paper
 * made most of the world look decorative. They sit clearly behind the current stage's
 * arrivals and clearly in front of the ground litter.
 */
const RECEDED_ALPHA = 0.58;

/**
 * Emphasis on the obstacles this stage introduced.
 *
 * Tied to the stage rather than to a timer: it is still there however long the player
 * takes, and it goes the moment the stage is cleared and the obstacle recedes. A caret
 * above and a slow bob, so the one thing being asked about is unmissable among twenty
 * that are not. The bob is deliberately a position change and not a size one, because
 * size is reserved for weight and must never track age.
 */
const ARRIVAL_BOB = 4;
const ARRIVAL_BOB_HZ = 1.6;

/**
 * The character reads as a runner among obstacles, not a giant stepping over pebbles, so
 * its size is set against the pillar band rather than against the canvas.
 */
const CHAR_SCALE = 1.45;
const JUMP_HEIGHT = 70;
/**
 * A dash is a short forward lunge plus speed lines, not a long translation. The obstacle
 * is at DINO_X on the impact frame, so carrying the character far past it would read as
 * dashing somewhere else rather than dashing through it.
 */
const DASH_DISTANCE = 32;
/** The hurdle clears the totem band without ever being mistaken for the kick's jump. */
const HURDLE_HEIGHT = 30;
/** The punch carries the body forward into the enemy rather than waving at it. */
const PUNCH_LUNGE = 14;

/** How long an obstacle takes to rise into the world, and to sink back out of it. */
export const RISE_SECONDS = 0.6;

/**
 * Where the character enters from and leaves to, as a fraction of the width, and how far
 * away that reads.
 *
 * It runs in out of the distance and away into it rather than across the ground, so it
 * never traverses the obstacle field and never appears to run through anything. Behind
 * the obstacle layer, small, grey and lifted towards the ground line's vanishing point.
 */
/**
 * How far to either side of the launch position it appears from and disappears to.
 *
 * Small on purpose. A long slide across the ground reads as running past the obstacles,
 * whichever layer it is on; keeping the lateral travel short leaves the shrinking, the
 * greying and the lift towards the vanishing point to carry the movement, which is what
 * makes it read as coming out of the screen rather than in from the wings.
 */
const HORIZON_OFFSET = 0.07;
/**
 * How small and how high the approach starts.
 *
 * The entry lasts the whole count-in, which is long enough that it has to begin genuinely
 * far off: at an eighth of full size it read as a character standing a few paces back
 * rather than one out on the horizon, and a walk that long from that close reads as slow
 * rather than distant. Small and high are the same statement made twice — apparent size
 * and height on the ground plane are the two cues perspective gives, and the lift is what
 * puts the start of the walk at the vanishing point instead of at the player's feet.
 */
const HORIZON_SCALE = 0.05;
const HORIZON_LIFT = 58;

/**
 * How long an obstacle's reaction lasts once it crosses the launch position.
 *
 * Short enough to read as an impact rather than an animation. It is derived from
 * `stepFloat` rather than fired as an event, so it needs no scheduling, repeats every
 * bar for free, and cannot drift.
 */
const REACTION_SECONDS = 0.22;

/**
 * How far an obstacle swells as it crosses the launch position.
 *
 * Anisotropic, and not for style. A uniform swell big enough to be unmissable also grows
 * each obstacle into its neighbours' bands, which breaks the guaranteed vertical
 * separation at exactly the moment the player is looking at it. Almost all of the punch
 * goes sideways, where there is nothing to collide with; the vertical component stays
 * inside the gaps between bands. `test/bands.test.ts` pins that.
 *
 * The horizontal component is where the announcement gets its force from, and it can be
 * spent freely: the swell peaks while the obstacle is alone at the launch position, and
 * anything sharing its step sits in a different band. The vertical component is capped
 * near 0.15 by the pillar/totem gap, so it is not the axis to push.
 */
export const SWELL_X = 1.15;
export const SWELL_Y = 0.13;

/**
 * How far an announcement lifts an obstacle out of its depth state, and towards full ink.
 *
 * Duration is not available as an axis — the announcement has to be finished inside two
 * steps or crossings start to smear into each other, which `test/reaction.test.ts` pins —
 * so the extra emphasis is bought in amplitude instead. A receded obstacle briefly comes
 * up to nearly foreground weight as it crosses and drops straight back, which is what
 * makes an old, small hat announce as loudly as a new pillar without ever confusing the
 * two at rest.
 */
const ANNOUNCE_ALPHA_LIFT = 0.4;

/**
 * The sky answers the launch position too.
 *
 * The quarter-note clouds have always been the coarse ruler; letting them announce as they
 * cross makes them a metronome as well, and puts an announcement directly above every
 * obstacle that sits on a quarter. Nothing shares the sky, so this swell can be uniform
 * and generous where the obstacles' has to be careful.
 */
const CLOUD_SWELL = 0.34;
const CLOUD_LIFT = 7;
/** How far a crossing cloud darkens out of the sky towards the ink. */
const CLOUD_INK = 0.5;

/**
 * How far into the scene the character sits while idling between runs.
 *
 * After the first run resolves, the character never vanishes — it walks back into the
 * background and stays there performing the live pattern at reduced depth, the same way
 * any distant object is drawn. The next count-in brings it forward again.
 *
 * 0.55 puts it at roughly 40% of full scale, greyed towards LIGHT. IDLE_LIFT raises the
 * character well above the HORIZON_LIFT range so it reads as standing on distant ground
 * near the clouds rather than floating just above the near ground line. The exit and
 * entry animations interpolate the lift so the walk stays smooth.
 */
const IDLE_DEPTH = 0.55;
const IDLE_LIFT = 65;

/** Period of the culprit's red breath under the death camera. */
const CULPRIT_PULSE_SECONDS = 1.1;

/** Ground litter, deliberately off the sixteenth grid so it can never read as one. */
const PEBBLES = [0.031, 0.107, 0.183, 0.271, 0.339, 0.427, 0.518, 0.603, 0.689, 0.771, 0.858, 0.941];

/**
 * Fixed, non-overlapping vertical bands, as distances above the ground line.
 *
 * Not cosmetic. Chapter 1 puts three obstacles on step 12 and two each on steps 0, 4 and
 * 15; without fixed bands they occlude each other at the same x. No lane guides are ever
 * drawn — this reads only as characteristic height per obstacle type.
 */
interface Band {
  bottom: number;
  top: number;
}

export const BANDS: Record<ObstacleType, Band> = {
  pillar: { bottom: 0, top: 52 }, // on the ground
  totem: { bottom: 62, top: 92 }, // just above
  enemy: { bottom: 102, top: 138 }, // chest
  bird: { bottom: 148, top: 186 }, // head
  wall: { bottom: 0, top: 196 }, // spans full height, drawn behind the others
};

/** Weight is set by instrument. Size and detail only, never opacity. */
type Weight = 'large' | 'medium' | 'small';

const WEIGHT: Record<ObstacleType, Weight> = {
  pillar: 'large', // kick
  enemy: 'large', // clap
  wall: 'large', // crash
  totem: 'medium', // rim
  bird: 'small', // openhat
};

export interface RenderObstacle {
  step: number;
  type: ObstacleType;
  /** Zero-based index of the stage that introduced it. Drives depth. */
  stage: number;
  /** Audio time this obstacle rose into the world. */
  addedAt: number;
  /** Audio time this obstacle began leaving the world, on chapter completion. */
  removedAt?: number;
}

export interface StageFrame {
  stepFloat: number;
  /** Audio-clock time. */
  now: number;
  patternLength: number;
  stepDuration: number;
  obstacles: RenderObstacle[];
  phase: Phase;
  character: CharacterPose;
  failure: Failure | null;
  countInBeat: number | null;
  /** The stage whose obstacles sit in the foreground, or null once the chapter is done. */
  currentStage: number | null;
  /** After repeated failures, the death camera holds the beat ruler up out of the dim. */
  hint: boolean;
  /** True when the entry walks from the idle background position rather than the horizon. */
  fromIdle: boolean;
}

interface Action {
  instrument: Instrument;
  start: number;
  duration: number;
}

/**
 * One channel per action, so they layer instead of interrupting.
 *
 * Each obstacle type gets a move that answers its own band, and no two share an axis:
 * a jump goes high, a hurdle goes low, a punch reaches forward, a duck goes down, a swat
 * reaches up, a dash goes through.
 */
interface Pose {
  /** kick, over the pillar on the ground. */
  jump: number;
  /** rim, stepping over the totem at shin height. */
  hurdle: number;
  /** clap, through the enemy at chest height. */
  punch: number;
  /** openhat, under the bird at head height. */
  duck: number;
  /** crash, straight through the wall. */
  dash: number;
}

export class StageRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private actions: Action[] = [];
  private width = 0;
  /** What the backing store was last sized for, checked every frame. */
  private dpr = 0;
  private cssWidth = 0;
  private cssHeight = 0;

  /** Introspection for the browser checks. Nothing in the app reads these. */
  characterDrawn = false;
  lastStageStep = 0;
  lastPose: Pose = emptyPose();
  lastCulprit: { type: ObstacleType; alpha: number; grown: boolean } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('Canvas 2D is unavailable');
    this.g = g;
    this.resize();
  }

  /**
   * Size the backing store to the canvas's CSS box and the device pixel ratio.
   *
   * The scene is drawn in logical units in which the stage is always `STAGE_HEIGHT`
   * tall; a shorter canvas scales the whole scene down uniformly rather than cropping
   * it, so small screens see the same world, smaller.
   */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    // The bounding rect, not clientWidth/clientHeight: those round to whole pixels, and
    // a fluid box lands on fractions constantly. Rounding first and multiplying by a
    // device pixel ratio of 3 turns half a CSS pixel into one and a half device pixels
    // of mismatch, which is exactly the softness this sizing exists to avoid.
    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = rect.width || 960;
    const cssHeight = rect.height || STAGE_HEIGHT;
    this.dpr = dpr;
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;

    const scale = cssHeight / STAGE_HEIGHT;
    this.width = cssWidth / scale;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.g.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  }

  /**
   * Catch anything that changes how many device pixels the canvas needs — window
   * resizes, but also zoom changes and the window moving to a monitor with a different
   * devicePixelRatio, which fire no resize event and used to leave the canvas blurry.
   */
  private resizeIfStale(): void {
    const rect = this.canvas.getBoundingClientRect();
    // A tenth of a CSS pixel: below what any display can show, above the float noise a
    // fractional layout produces frame to frame.
    const moved =
      Math.abs(rect.width - this.cssWidth) > 0.1 || Math.abs(rect.height - this.cssHeight) > 0.1;
    if (moved || (window.devicePixelRatio || 1) !== this.dpr) this.resize();
  }

  /**
   * Queue a character action.
   *
   * `start` is `stepTime(S) - duration * impactRatio`, so the impact frame lands on the
   * step. The drum hit for that step fires separately, at exactly `stepTime(S)`.
   */
  triggerAction(instrument: Instrument, start: number, duration: number): void {
    this.actions.push({ instrument, start, duration });
  }

  render(frame: StageFrame): void {
    this.resizeIfStale();

    const { g } = this;
    const w = this.width;
    const cell = w / frame.patternLength;
    const dinoX = w * DINO_FRACTION;

    // The death camera replays the last stretch of approach in slow motion and then
    // holds. It rewrites only what the stage shows; the clock, the audio and the
    // sequencer playhead carry on untouched.
    const camera = this.cameraState(frame);
    const stepFloat = camera ? camera.stepFloat : frame.stepFloat;

    this.lastStageStep = stepFloat;

    const idle = frame.character.mode === 'idle';

    // When the character is idle, the paper fill is deferred to the end so that
    // `destination-over` can layer the character behind the entire scene — including
    // semi-transparent obstacles that would otherwise let it bleed through.
    if (idle) {
      g.clearRect(0, 0, w, STAGE_HEIGHT);
    } else {
      g.fillStyle = PAPER;
      g.fillRect(0, 0, w, STAGE_HEIGHT);
    }

    this.drawScenery(frame, stepFloat, cell, dinoX, w);
    this.drawGround(frame, stepFloat, cell, dinoX, w);

    // While it is out in the distance the character belongs behind the obstacle field,
    // which is what stops it appearing to run through anything on the way in or out.
    // The idle character uses a compositing trick at the end of the frame instead.
    const distant =
      frame.character.mode === 'entering' ||
      frame.character.mode === 'exiting';
    if (distant) this.drawCharacter(frame, stepFloat, camera, dinoX, w);

    // Back layer first, foreground over it, so recency reads as depth. Walls span the
    // full height and are drawn before anything else in either layer.
    const receded = frame.obstacles.filter((o) => !isCurrent(o, frame.currentStage));
    const current = frame.obstacles.filter((o) => isCurrent(o, frame.currentStage));
    for (const obstacle of [...byDepth(receded), ...byDepth(current)]) {
      const foreground = isCurrent(obstacle, frame.currentStage);
      // Marking is for the stage's own new obstacles. On completion there is no current
      // stage and everything returns to full opacity, which must not mean every one of
      // the twenty-one sprouts a caret.
      const marked = frame.currentStage !== null && obstacle.stage === frame.currentStage;
      const reaction = reactionAt(obstacle.step, stepFloat, frame.patternLength, frame.stepDuration);
      this.eachWrap(obstacle.step, stepFloat, frame.patternLength, cell, dinoX, w, (x) => {
        this.drawObstacle(
          obstacle,
          x,
          frame.now,
          foreground ? 1 : RECEDED_ALPHA,
          foreground,
          reaction,
          marked,
        );
      });
    }

    if (frame.failure && !camera) {
      this.eachWrap(frame.failure.step, stepFloat, frame.patternLength, cell, dinoX, w, (x) =>
        this.drawFailMarker(x),
      );
    }

    if (camera && frame.failure) {
      // Dim the whole stage to a uniform low level, then restore the culprit over it at
      // full opacity, foreground layer and full size, overriding both its weight and its
      // depth state. Identifying a hat introduced four stages ago depends on this.
      g.fillStyle = PAPER;
      g.globalAlpha = 0.74;
      g.fillRect(0, 0, w, STAGE_HEIGHT);
      g.globalAlpha = 1;

      // The hint, after enough consecutive failures: the quarter-note landmarks and
      // the launch patch come back up out of the dim, so the frozen culprit can be
      // read against the beat ruler. Nothing new is drawn and no step is named — the
      // scenery that was always the ruler just stays legible while the camera holds.
      if (frame.hint) {
        this.drawScenery(frame, stepFloat, cell, dinoX, w, LIGHT);
        this.drawImpactZone(dinoX);
      }

      const failure = frame.failure;
      const culprit = frame.obstacles.find(
        (o) => o.step === failure.step && OBSTACLE_INSTRUMENT[o.type] === failure.instrument,
      );
      if (culprit) {
        this.eachWrap(culprit.step, stepFloat, frame.patternLength, cell, dinoX, w, (x) =>
          this.drawCulprit(culprit, x, camera.elapsed),
        );
      }
    } else {
      this.lastCulprit = null;
    }

    if (!distant && !idle) this.drawCharacter(frame, stepFloat, camera, dinoX, w);

    if (frame.countInBeat !== null) this.drawCountIn(frame.countInBeat, w);
    if (frame.currentStage === null && !camera) this.drawBanner('chapter clear', w);

    // The idle character is composited behind the entire scene so that even
    // semi-transparent obstacles fully occlude it — no bleed-through.
    if (idle) {
      g.globalCompositeOperation = 'destination-over';
      this.drawCharacter(frame, stepFloat, camera, dinoX, w);
      g.fillStyle = PAPER;
      g.fillRect(0, 0, w, STAGE_HEIGHT);
      g.globalCompositeOperation = 'source-over';
    }
  }

  // ------------------------------------------------------------ death camera

  private cameraState(frame: StageFrame): { stepFloat: number; elapsed: number } | null {
    if (frame.phase !== 'failed' || !frame.failure) return null;

    const elapsed = frame.now - frame.failure.at;
    if (elapsed < 0 || elapsed > DEATH_CAMERA.total) return null;

    // Decelerate into the impact rather than rewinding to it. The camera takes over at
    // the world's real position, so there is no jump at the hand-over, and eases to a
    // stop exactly on the collision.
    //
    // The exponent is what makes the hand-over seamless. Covering `replay` seconds of
    // world time in `slowmo` seconds of real time means the average speed is
    // replay/slowmo of normal, so some slowing is unavoidable; raising (1 - u) to
    // slowmo/replay makes the curve leave at exactly normal speed and arrive at zero.
    const { fromStep, collisionStep } = frame.failure;
    const u = Math.min(1, elapsed / DEATH_CAMERA.slowmo);
    const remaining = Math.pow(1 - u, DEATH_CAMERA.slowmo / DEATH_CAMERA.replay);
    const absolute = collisionStep - (collisionStep - fromStep) * remaining;

    const length = frame.patternLength;
    return { stepFloat: ((absolute % length) + length) % length, elapsed };
  }

  // --------------------------------------------------------------- placement

  /**
   * An obstacle on step S sits at
   *   x = DINO_X + ((S - stepFloat + patternLength) % patternLength) * (width / patternLength)
   * and is drawn again one screen away so the wrap at the bar line is seamless.
   */
  private eachWrap(
    step: number,
    stepFloat: number,
    patternLength: number,
    cell: number,
    dinoX: number,
    w: number,
    draw: (x: number) => void,
  ): void {
    const offset = (((step - stepFloat) % patternLength) + patternLength) % patternLength;
    const x = dinoX + offset * cell;
    draw(x);
    draw(x - w);
  }

  // ----------------------------------------------------------------- scenery

  /**
   * Four elements per bar, on the quarter notes only. Never on sixteenths.
   *
   * They announce as they cross the launch position, exactly as the obstacles below them
   * do and off the same derivation. The sky then pulses on the quarter notes, which is
   * the beat the whole chapter is built on: a player who has not yet worked out where the
   * launch position is can find it by watching the clouds, and every obstacle sitting on a
   * quarter gets an announcement in the sky directly above its own.
   *
   * `ink` exists for the death camera's hint, which redraws these over the dim: at
   * their usual weight they would come back barely stronger than the dimmed stage, and
   * reading the culprit against them is the whole point of putting them back.
   */
  private drawScenery(
    frame: StageFrame,
    stepFloat: number,
    cell: number,
    dinoX: number,
    w: number,
    ink: string = SOFT,
  ): void {
    const { g } = this;
    for (let quarter = 0; quarter < 4; quarter++) {
      const step = (quarter * frame.patternLength) / 4;
      const reaction = reactionAt(step, stepFloat, frame.patternLength, frame.stepDuration);
      const punch = reaction === null ? 0 : pop(reaction);
      // The downbeat's cloud sits higher and wider, so the bar line is findable.
      const downbeat = quarter === 0;
      const y = downbeat ? 20 : 38 + (quarter % 2) * 10;
      const scale = downbeat ? 1.25 : 1;

      this.eachWrap(step, stepFloat, frame.patternLength, cell, dinoX, w, (x) => {
        g.save();
        g.fillStyle = punch > 0 ? mixInk(ink, INK, punch * CLOUD_INK) : ink;
        if (punch > 0) {
          // Swell about the cloud's own middle and ride up a little, so it reads as the
          // sky reacting rather than as a cloud that grew.
          const centreY = y + 7 * scale;
          g.translate(x, centreY - punch * CLOUD_LIFT);
          g.scale(1 + punch * CLOUD_SWELL, 1 + punch * CLOUD_SWELL);
          g.translate(-x, -centreY);
        }
        cloud(g, x, y, scale);
        g.restore();
      });
    }
  }

  private drawGround(
    frame: StageFrame,
    stepFloat: number,
    cell: number,
    dinoX: number,
    w: number,
  ): void {
    const { g } = this;

    this.drawImpactZone(dinoX);

    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, GROUND_Y + 1);
    g.lineTo(w, GROUND_Y + 1);
    g.stroke();

    g.fillStyle = LIGHT;
    for (const fraction of PEBBLES) {
      const step = fraction * frame.patternLength;
      this.eachWrap(step, stepFloat, frame.patternLength, cell, dinoX, w, (x) => {
        const size = 1 + ((fraction * 97) % 2 | 0);
        g.fillRect(Math.round(x), GROUND_Y + 6 + ((fraction * 53) % 3 | 0) * 3, 4 + size, 2);
      });
    }
  }

  /**
   * The launch position, as terrain rather than as a marker.
   *
   * A patch of ground worn bare by everything that has taken off from it. Drawn in the
   * same idiom as the ground litter — a soft shading and a few scuff marks — so it reads
   * as part of the scenery rather than as an overlay.
   *
   * Deliberately *not* a vertical line, and deliberately the one thing on the ground that
   * does not scroll. Everything else slides past it, which is what makes it legible as a
   * place: obstacles arrive here, and the character takes off from here.
   */
  private drawImpactZone(dinoX: number): void {
    const { g } = this;
    g.save();

    // Packed earth, a shade off the paper.
    g.fillStyle = SOFT;
    g.globalAlpha = 0.55;
    g.beginPath();
    g.ellipse(dinoX, GROUND_Y + 4, 46, 5, 0, 0, Math.PI * 2);
    g.fill();

    // A few scuffs, in the same 5x2 idiom as the litter, so the patch reads as worn
    // rather than as a shape someone drew.
    g.globalAlpha = 0.8;
    g.fillStyle = LIGHT;
    const scuffs: Array<[number, number, number]> = [
      [-30, 5, 6],
      [-12, 9, 5],
      [8, 5, 7],
      [26, 10, 5],
      [-2, 13, 4],
    ];
    for (const [dx, dy, len] of scuffs) {
      g.fillRect(Math.round(dinoX + dx), GROUND_Y + dy, len, 2);
    }

    g.restore();
  }

  // --------------------------------------------------------------- obstacles

  private drawObstacle(
    obstacle: RenderObstacle,
    x: number,
    now: number,
    alpha: number,
    foreground: boolean,
    reaction: number | null,
    marked: boolean,
  ): void {
    const { g } = this;
    // Leaving the world is the entrance played backwards: the same clip-and-drop for
    // grounded types, the same fade for the flyers.
    let rise = clamp01((now - obstacle.addedAt) / RISE_SECONDS);
    if (obstacle.removedAt !== undefined) {
      rise = Math.min(rise, 1 - clamp01((now - obstacle.removedAt) / RISE_SECONDS));
      if (rise <= 0) return;
    }

    // An announcement is worth as much emphasis as it can be given without touching the
    // axes it would corrupt. Size belongs to weight and opacity to depth — but only at
    // rest: for the fifth of a second an obstacle is crossing the launch position it
    // borrows both, coming up towards foreground ink and full opacity and dropping
    // straight back. Every obstacle announces at the same strength whatever its age, which
    // is the point; the moment it passes, the depth ordering is exactly as it was.
    const punch = reaction === null ? 0 : pop(reaction);
    const announced = Math.min(1, alpha + punch * ANNOUNCE_ALPHA_LIFT);

    g.save();
    g.globalAlpha = announced;
    g.fillStyle = foreground ? INK : mixInk(RECEDED_INK, INK, punch);

    const band = BANDS[obstacle.type];
    const bottom = GROUND_Y - band.bottom;
    const top = GROUND_Y - band.top;
    const grounded = band.bottom === 0;

    // Rising is a vertical entrance: clipped at the ground for the types that stand on
    // it, faded in for the ones that do not.
    if (rise < 1) {
      if (grounded) {
        g.beginPath();
        g.rect(0, 0, this.width, GROUND_Y + 1);
        g.clip();
        g.translate(0, (1 - ease(rise)) * (band.top + 20));
      } else {
        g.globalAlpha = announced * rise;
      }
    }

    // Everything this stage introduced bobs gently and wears a caret, for as long as it
    // is the current stage's business.
    if (marked) {
      const bob = Math.sin(now * ARRIVAL_BOB_HZ * Math.PI * 2) * ARRIVAL_BOB;
      g.translate(0, bob);
      caret(g, x, top - 16);
    }

    // The obstacle announces itself as it crosses the launch position: a quick swell and
    // snap back, pivoting on its base so a grounded shape never lifts off the ground.
    if (reaction !== null) {
      const pivotY = grounded ? bottom : (bottom + top) / 2;
      g.save();
      g.translate(x, pivotY);
      g.scale(1 + punch * SWELL_X, 1 + punch * SWELL_Y);
      g.translate(-x, -pivotY);
      drawShape(g, obstacle.type, x, bottom, top);
      g.restore();

      // Dust and ripples stay unscaled, so they read as thrown off the obstacle rather
      // than as part of it.
      if (grounded) dustPuff(g, x, bottom, reaction, announced);
      else ripple(g, x, (bottom + top) / 2, (bottom - top) / 2, reaction, announced);
    } else {
      drawShape(g, obstacle.type, x, bottom, top);
    }

    g.restore();
  }

  /**
   * The culprit under the death camera: full opacity, foreground layer and full size,
   * overriding both its weight and its depth state. A hat that killed you is drawn large,
   * not merely brightened.
   *
   * The shape itself carries a red tint that breathes, rather than being ringed. A drawn
   * ring points at the answer; a tinted shape lets the obstacle be the thing you notice.
   */
  private drawCulprit(obstacle: RenderObstacle, x: number, elapsed: number): void {
    const { g } = this;
    const band = BANDS[obstacle.type];
    const bottom = GROUND_Y - band.bottom;
    const natural = band.top - band.bottom;
    const grown = Math.max(natural, 60);
    const top = bottom - grown;

    this.lastCulprit = {
      type: obstacle.type,
      alpha: 1,
      grown: grown > natural || WEIGHT[obstacle.type] !== 'large',
    };

    // A slow breath, so it reads as alive without ever flashing.
    const breath = 0.5 + 0.5 * Math.sin((elapsed / CULPRIT_PULSE_SECONDS) * Math.PI * 2);

    g.save();
    g.globalAlpha = 1;
    g.fillStyle = mixInk(INK, FAIL, 0.4 + breath * 0.45);
    drawShape(g, obstacle.type, x, bottom, top);
    g.restore();
  }

  private drawFailMarker(x: number): void {
    const { g } = this;
    g.save();
    g.strokeStyle = FAIL;
    g.lineWidth = 2;
    const y = GROUND_Y - 4;
    g.beginPath();
    g.moveTo(x - 6, y - 6);
    g.lineTo(x + 6, y + 4);
    g.moveTo(x + 6, y - 6);
    g.lineTo(x - 6, y + 4);
    g.stroke();
    g.restore();
  }

  // --------------------------------------------------------------- character

  private drawCharacter(
    frame: StageFrame,
    stepFloat: number,
    camera: { elapsed: number } | null,
    dinoX: number,
    w: number,
  ): void {
    const { g } = this;
    const now = frame.now;

    this.actions = this.actions.filter((a) => now - a.start < a.duration);

    // 'down' outlives the camera by the frame it takes the state machine to release, so
    // treat it as hidden once the camera has ended rather than snapping upright.
    const mode = frame.character.mode === 'down' && !camera ? 'hidden' : frame.character.mode;
    if (mode === 'hidden') {
      this.characterDrawn = false;
      this.lastPose = emptyPose();
      return;
    }

    // Fold every live action into one pose. Taking the max of each channel is what makes
    // actions layer: a crash and a kick on the same step give a dash and a leap at once,
    // and dense dodges never interrupt anything. Each channel peaks at its own impact
    // ratio, so apex, full extension and full speed all land on the step.
    const pose = emptyPose();
    for (const action of this.actions) {
      const t = (now - action.start) / action.duration;
      if (t <= 0) continue;
      const value = impulse(t, ACTIONS[action.instrument].impact);
      switch (action.instrument) {
        case 'kick':
          pose.jump = Math.max(pose.jump, value);
          break;
        case 'crash':
          pose.dash = Math.max(pose.dash, value);
          break;
        case 'clap':
          pose.punch = Math.max(pose.punch, value);
          break;
        case 'openhat':
          pose.duck = Math.max(pose.duck, value);
          break;
        case 'rim':
          pose.hurdle = Math.max(pose.hurdle, value);
          break;
      }
    }
    let tumble = 0;
    // 1 at the launch position, 0 out at the horizon.
    let depth = 1;
    let x = dinoX;

    let extraLift = 0;

    if (mode === 'idle') {
      depth = IDLE_DEPTH;
      extraLift = IDLE_LIFT;
      x = dinoX;
    } else if (mode === 'entering') {
      if (frame.fromIdle) {
        depth = IDLE_DEPTH + (1 - IDLE_DEPTH) * frame.character.progress;
        extraLift = IDLE_LIFT * (1 - frame.character.progress);
        x = dinoX;
      } else {
        depth = frame.character.progress;
        x = dinoX - HORIZON_OFFSET * w * (1 - depth);
      }
    } else if (mode === 'exiting') {
      depth = 1 - (1 - IDLE_DEPTH) * frame.character.progress;
      extraLift = IDLE_LIFT * frame.character.progress;
      x = dinoX;
    } else if (mode === 'down' && camera) {
      tumble = clamp01((camera.elapsed - DEATH_CAMERA.slowmo) / 0.5);
    }

    // Actions only take hold as it arrives. A jump thrown while it is still out in the
    // distance reads as floating rather than leaping, and scaling them by the depth also
    // makes the count-in's own hits ramp up into the run rather than switch on. The entry
    // still finishes ahead of step 0's animation, so the run bar itself is never damped.
    if (depth < 1) {
      pose.jump *= depth;
      pose.hurdle *= depth;
      pose.punch *= depth;
      pose.duck *= depth;
      pose.dash *= depth;
    }
    this.lastPose = pose;

    // Distance reads as three things at once: smaller, greyer, and closer to the ground
    // line's vanishing point.
    //
    // Perspective, not linear interpolation: apparent size changes slowly while something
    // is far off and fastest as it arrives, so the curve has to accelerate. It used to
    // ease off at both ends, which over a third of a bar was fine and over a whole one is
    // not — the walk would reach full size two beats early and then stand there, which is
    // exactly the standing about the long entry exists to remove. True perspective
    // (1/distance) accelerates far harder than this, and lands as a lunge at the camera;
    // this is the readable half of it.
    const near = depth * Math.sqrt(depth);
    const scale = CHAR_SCALE * (HORIZON_SCALE + (1 - HORIZON_SCALE) * near);
    const groundY = GROUND_Y - (1 - near) * HORIZON_LIFT - extraLift;
    const ink = depth >= 1 ? INK : mixInk(LIGHT, INK, near);
    // Fade the last stretch out entirely, so it does not pop into or out of nothing.
    const fade = clamp01(depth / 0.18);

    // Any action still in flight settles out over the tumble instead of being cut, so a
    // character caught mid-air comes down rather than snapping to the ground. It also
    // ends up back at the collision point, which is what the camera is there to show.
    const settle = 1 - tumble;
    const lunge = (pose.dash * DASH_DISTANCE + pose.punch * PUNCH_LUNGE) * settle;
    const lift = (pose.jump * JUMP_HEIGHT + pose.hurdle * HURDLE_HEIGHT) * settle;
    x += lunge;
    const y = groundY - lift;

    if (pose.dash > 0.15 && tumble === 0 && depth >= 1) {
      g.strokeStyle = LIGHT;
      g.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const lineY = y - (20 + i * 15) * CHAR_SCALE;
        g.beginPath();
        g.moveTo(x - (30 + i * 12) * CHAR_SCALE, lineY);
        g.lineTo(x - (60 + i * 17) * CHAR_SCALE, lineY);
        g.stroke();
      }
    }

    g.save();
    g.globalAlpha = fade;
    g.translate(x, y);
    if (tumble > 0) {
      g.rotate(tumble * 1.4);
      g.translate(0, Math.sin(Math.PI * Math.min(tumble * 1.6, 1)) * -16);
    } else {
      g.rotate(pose.dash * 0.12);
    }
    g.scale(scale, scale);

    runner(g, {
      legPhase: stepFloat * Math.PI,
      airborne: pose.jump > 0.06,
      hurdle: pose.hurdle,
      crouch: pose.duck,
      punch: pose.punch,
      tumbled: tumble > 0,
      ink,
    });
    g.restore();

    this.characterDrawn = true;
  }

  // ------------------------------------------------------------------ chrome

  private drawCountIn(beat: number, w: number): void {
    const { g } = this;
    g.save();
    g.fillStyle = INK;
    g.globalAlpha = 0.8;
    g.font = '700 64px ui-monospace, Menlo, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(beat), w / 2, 58);
    g.restore();
  }

  private drawBanner(text: string, w: number): void {
    const { g } = this;
    g.save();
    g.fillStyle = INK;
    g.font = '700 15px ui-monospace, Menlo, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text.toUpperCase(), w / 2, 16);
    g.restore();
  }
}

// -------------------------------------------------------------------- helpers

function emptyPose(): Pose {
  return { jump: 0, hurdle: 0, punch: 0, duck: 0, dash: 0 };
}

function isCurrent(obstacle: RenderObstacle, currentStage: number | null): boolean {
  // On chapter completion there is no current stage, so everything returns to full
  // opacity for the final run.
  return currentStage === null || obstacle.stage === currentStage;
}

/** Walls first, so the full-height barrier sits behind everything sharing its step. */
function byDepth(obstacles: RenderObstacle[]): RenderObstacle[] {
  return [...obstacles].sort((a, b) => Number(b.type === 'wall') - Number(a.type === 'wall'));
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * How far an obstacle is into its reaction, 0..1, or null if it is not reacting.
 *
 * Derived rather than scheduled. An obstacle on step S is at the launch position exactly
 * when `stepFloat` is S, so the steps elapsed since it last passed there is simply the
 * wrapped difference. It repeats every bar with no bookkeeping, fires in every phase
 * including EDITING, and inherits the transport's immunity to drift.
 */
export function reactionAt(
  step: number,
  stepFloat: number,
  patternLength: number,
  stepDuration: number,
): number | null {
  const sinceSteps = (((stepFloat - step) % patternLength) + patternLength) % patternLength;
  const t = (sinceSteps * stepDuration) / REACTION_SECONDS;
  return t < 1 ? t : null;
}

/** Blend two hex colours, for the culprit's tint. */
function mixInk(from: string, to: string, t: number): string {
  const k = clamp01(t);
  const channel = (offset: number) => {
    const a = parseInt(from.slice(offset, offset + 2), 16);
    const b = parseInt(to.slice(offset, offset + 2), 16);
    return Math.round(a + (b - a) * k);
  };
  return `rgb(${channel(1)}, ${channel(3)}, ${channel(5)})`;
}

/** Fast attack, slower release. Peaks around a quarter of the way in. */
function pop(t: number): number {
  return Math.sin(Math.PI * Math.pow(clamp01(t), 0.55));
}

function ease(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

// --------------------------------------------------------------------- shapes

function drawShape(
  g: CanvasRenderingContext2D,
  type: ObstacleType,
  x: number,
  bottom: number,
  top: number,
): void {
  switch (type) {
    case 'pillar':
      cactus(g, x, bottom, top);
      break;
    case 'wall':
      wall(g, x, bottom, top);
      break;
    case 'totem':
      totem(g, x, bottom, top);
      break;
    case 'enemy':
      blob(g, x, bottom, top);
      break;
    case 'bird':
      birdGlyph(g, x, bottom, top);
      break;
  }
}

/**
 * Dust kicked off the ground as a grounded obstacle passes the launch position.
 *
 * Drawn in the ground litter's own idiom — small light marks — so it reads as the world
 * reacting rather than as an effect layer.
 */
function dustPuff(
  g: CanvasRenderingContext2D,
  x: number,
  bottom: number,
  t: number,
  alpha: number,
): void {
  const fade = (1 - t) * 0.9;
  if (fade <= 0) return;

  const previousAlpha = g.globalAlpha;
  const previousFill = g.fillStyle;
  g.globalAlpha = alpha * fade;
  g.fillStyle = DUST;

  const out = ease(t);
  for (let i = 0; i < 10; i++) {
    // Marks either side, thrown clear of the shape rather than piling up on it.
    const direction = i % 2 === 0 ? -1 : 1;
    const rank = i >> 1;
    const spread = 12 + out * (28 + rank * 15);
    // A shallow arc: out and up, then settling back towards the ground.
    const lift = Math.sin(Math.PI * t) * (8 + rank * 7);
    g.fillRect(Math.round(x + direction * spread - 3), Math.round(bottom - lift - 1), 7, 3);
  }

  g.globalAlpha = previousAlpha;
  g.fillStyle = previousFill;
}

/**
 * The airborne equivalent of the dust: a couple of marks flicked sideways.
 *
 * A drawn ring reads as a diagram overlay against blocky monochrome shapes, so the
 * displaced air borrows the ground litter's vocabulary instead. Purely lateral, with no
 * arc, which distinguishes it from dust kicked off the ground.
 */
function ripple(
  g: CanvasRenderingContext2D,
  x: number,
  centreY: number,
  radius: number,
  t: number,
  alpha: number,
): void {
  const fade = (1 - t) * 0.85;
  if (fade <= 0) return;

  const previousAlpha = g.globalAlpha;
  const previousFill = g.fillStyle;
  g.globalAlpha = alpha * fade;
  g.fillStyle = DUST;

  const out = radius + 5 + ease(t) * 24;
  for (let i = 0; i < 6; i++) {
    const direction = i % 2 === 0 ? -1 : 1;
    const tier = i < 2 ? -1 : i < 4 ? 1 : 0;
    // The trailing pair sits further out again, so the flick reads as a burst rather
    // than as two marks that moved.
    const reach = i < 4 ? out : out + 9;
    g.fillRect(Math.round(x + direction * reach - 3), Math.round(centreY + tier * 6), 7, 2);
  }

  g.globalAlpha = previousAlpha;
  g.fillStyle = previousFill;
}

/** A small caret over the obstacles this stage introduced. */
function caret(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.fillRect(x - 7, y - 7, 4, 4);
  g.fillRect(x - 4, y - 4, 4, 4);
  g.fillRect(x - 1, y - 1, 3, 4);
  g.fillRect(x + 1, y - 4, 4, 4);
  g.fillRect(x + 4, y - 7, 4, 4);
}

function cloud(g: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  const w = 46 * scale;
  const h = 14 * scale;
  g.fillRect(x - w / 2, y, w, h);
  g.fillRect(x - w / 2 + 8 * scale, y - 6 * scale, w - 18 * scale, 6 * scale);
  g.fillRect(x - w / 2 - 5 * scale, y + 4 * scale, 5 * scale, h - 4 * scale);
  g.fillRect(x + w / 2, y + 4 * scale, 5 * scale, h - 4 * scale);
}

/** pillar (kick): a ground cactus. Large weight, fully rendered. */
function cactus(g: CanvasRenderingContext2D, x: number, bottom: number, top: number): void {
  const h = bottom - top;
  const w = 15;
  g.fillRect(x - w / 2, top, w, h);
  g.fillRect(x - w / 2 - 9, top + h * 0.3, 9, 5);
  g.fillRect(x - w / 2 - 9, top + h * 0.3, 5, h * 0.42);
  g.fillRect(x + w / 2, top + h * 0.48, 9, 5);
  g.fillRect(x + w / 2 + 4, top + h * 0.2, 5, h * 0.33);
}

/** wall (crash): a tall cracked barrier spanning the full height, behind the others. */
function wall(g: CanvasRenderingContext2D, x: number, bottom: number, top: number): void {
  const h = bottom - top;
  const w = 26;
  g.fillRect(x - w / 2, top, w, h);

  const previous = g.fillStyle;
  g.fillStyle = PAPER;
  g.fillRect(x - 3, top + h * 0.08, 3, h * 0.14);
  g.fillRect(x - 8, top + h * 0.24, 10, 3);
  g.fillRect(x + 2, top + h * 0.36, 3, h * 0.13);
  g.fillRect(x - 10, top + h * 0.55, 12, 3);
  g.fillRect(x + 1, top + h * 0.68, 3, h * 0.12);
  g.fillStyle = previous;
}

/** totem (rim): a short post. Medium weight. */
function totem(g: CanvasRenderingContext2D, x: number, bottom: number, top: number): void {
  const h = bottom - top;
  g.fillRect(x - 6, top + 5, 12, h - 5);
  g.fillRect(x - 11, top, 22, 6);

  const previous = g.fillStyle;
  g.fillStyle = PAPER;
  g.fillRect(x - 6, top + h * 0.55, 12, 3);
  g.fillStyle = previous;
}

/** enemy (clap): a chest-height blob. Large weight, fully rendered. */
function blob(g: CanvasRenderingContext2D, x: number, bottom: number, top: number): void {
  const h = bottom - top;
  const w = 32;
  g.beginPath();
  g.moveTo(x - w / 2, bottom);
  g.lineTo(x - w / 2, top + h * 0.25);
  g.quadraticCurveTo(x, top - h * 0.22, x + w / 2, top + h * 0.25);
  g.lineTo(x + w / 2, bottom);
  g.closePath();
  g.fill();

  const previous = g.fillStyle;
  g.fillStyle = PAPER;
  g.fillRect(x - 9, top + h * 0.28, 5, 5);
  g.fillRect(x + 4, top + h * 0.28, 5, 5);
  g.fillStyle = previous;
}

/**
 * bird (openhat): one coherent gull silhouette.
 *
 * The one small type left. It shared the stage with a shaker's swarm for a while, and the
 * pair were never distinguishable at speed however differently they were drawn, which is
 * why the shaker was dropped rather than redrawn again.
 */
function birdGlyph(g: CanvasRenderingContext2D, x: number, bottom: number, top: number): void {
  const h = bottom - top;
  const s = h / 28;
  const midY = top + h * 0.5;
  const u = (n: number) => Math.round(n * s);

  g.fillRect(x - u(4), midY - u(2), u(8), u(5)); // body
  g.fillRect(x - u(12), midY - u(6), u(8), u(4)); // left wing, outer
  g.fillRect(x - u(16), midY - u(10), u(6), u(4)); // left wing tip
  g.fillRect(x + u(4), midY - u(6), u(8), u(4)); // right wing, outer
  g.fillRect(x + u(10), midY - u(10), u(6), u(4)); // right wing tip
}

interface RunnerPose {
  legPhase: number;
  airborne: boolean;
  hurdle: number;
  crouch: number;
  punch: number;
  tumbled: boolean;
  ink: string;
}

/**
 * The character, drawn at the origin with its feet on y = 0, in unscaled units.
 *
 * Every action deforms this one pose rather than playing a separate animation, which is
 * what lets them layer — a crash and a kick on the same step give a dash and a leap at
 * once. Each deformation is exaggerated well past realism, because at 124 BPM a sixteenth
 * lasts 121ms and a subtle move simply is not seen.
 */
function runner(g: CanvasRenderingContext2D, pose: RunnerPose): void {
  // Ducking is a deep crouch, not a nod: the bird sits at head height and the character
  // has to visibly go under it. The head also pushes forward as it drops, which is what
  // separates a duck from simply being short.
  const squash = 1 - pose.crouch * 0.52;
  const bodyH = 20 * squash;
  const bodyY = -30 * squash - 6;
  const headY = bodyY - 16 * squash;
  const headX = pose.crouch * 7;

  g.fillStyle = pose.ink;

  // tail
  g.beginPath();
  g.moveTo(-13, bodyY + 4);
  g.lineTo(-26, bodyY - 2);
  g.lineTo(-13, bodyY + bodyH - 2);
  g.closePath();
  g.fill();

  // body
  g.fillRect(-13, bodyY, 26, bodyH);

  // legs
  if (pose.tumbled) {
    g.fillRect(-6, bodyY + bodyH, 6, 8);
    g.fillRect(6, bodyY + bodyH - 2, 6, 8);
  } else if (pose.hurdle > 0.08) {
    // A hurdle is a low step-over: lead leg thrown forward and straight, trailing leg
    // folded up behind. Unmistakable against the jump's tucked-in symmetry.
    const reach = pose.hurdle;
    g.fillRect(2, bodyY + bodyH - 1, 8 + reach * 16, 5);
    g.fillRect(2 + reach * 16, bodyY + bodyH - 3 - reach * 6, 5, 6);
    g.fillRect(-10, bodyY + bodyH - reach * 5, 6, 10 - reach * 4);
  } else if (pose.airborne) {
    // Both legs tucked, which is what makes a jump read as a jump.
    g.fillRect(-6, bodyY + bodyH, 6, 8);
    g.fillRect(4, bodyY + bodyH - 2, 6, 7);
  } else {
    const swing = Math.sin(pose.legPhase);
    const lift = Math.max(0, swing) * 5;
    const lift2 = Math.max(0, -swing) * 5;
    g.fillRect(-7 + swing * 3, bodyY + bodyH, 6, 12 - lift);
    g.fillRect(3 - swing * 3, bodyY + bodyH, 6, 12 - lift2);
  }

  // neck and head
  g.fillRect(6, headY, 10, 18 * squash);
  g.fillRect(6 + headX, headY - 12, 20, 14);
  g.fillRect(26 + headX, headY - 6, 6, 5);

  // eye
  g.fillStyle = PAPER;
  if (pose.tumbled) {
    g.fillRect(15 + headX, headY - 9, 6, 2);
    g.fillRect(17 + headX, headY - 11, 2, 6);
  } else {
    g.fillRect(16 + headX, headY - 9, 4, 4);
  }
  g.fillStyle = pose.ink;

  // The punch drives an arm the length of the body forward, at chest height.
  if (pose.punch > 0.02) {
    g.fillRect(6, bodyY + 3, 10 + pose.punch * 30, 6);
    g.fillRect(14 + pose.punch * 30, bodyY, 8, 11); // fist
  } else {
    g.fillRect(6, bodyY + 4, 8, 5);
  }
}
