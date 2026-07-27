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
 * The stage never draws the step grid. No tick marks, no lanes, no step numbers. The
 * only positional aid is scenery on the quarter notes, which reads as parallax and
 * functions as a coarse ruler.
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
const RECEDED_INK = '#7d7d7d';

export const STAGE_HEIGHT = 360;
const GROUND_Y = 292;
const DINO_FRACTION = 0.15;

/** How far a receded obstacle drops in opacity. A hard floor, so small types survive it. */
const RECEDED_ALPHA = 0.5;

const CHAR_SCALE = 2.2;
const JUMP_HEIGHT = 85;
/**
 * A dash is a short forward lunge plus speed lines, not a long translation. The obstacle
 * is at DINO_X on the impact frame, so carrying the character far past it would read as
 * dashing somewhere else rather than dashing through it.
 */
const DASH_DISTANCE = 45;
const SIDESTEP = 26;

const RISE_SECONDS = 0.6;

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
  pillar: { bottom: 0, top: 38 }, // on the ground
  totem: { bottom: 44, top: 78 }, // just above
  enemy: { bottom: 84, top: 116 }, // chest
  bird: { bottom: 122, top: 154 }, // head
  pest: { bottom: 162, top: 196 }, // above head
  wall: { bottom: 0, top: 204 }, // spans full height, drawn behind the others
};

/** Weight is set by instrument. Size and detail only, never opacity. */
type Weight = 'large' | 'medium' | 'small';

const WEIGHT: Record<ObstacleType, Weight> = {
  pillar: 'large', // kick
  enemy: 'large', // clap
  wall: 'large', // crash
  totem: 'medium', // rim
  bird: 'small', // openhat
  pest: 'small', // shaker
};

export interface RenderObstacle {
  step: number;
  type: ObstacleType;
  /** Zero-based index of the stage that introduced it. Drives depth. */
  stage: number;
  /** Audio time this obstacle rose into the world. */
  addedAt: number;
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
}

interface Action {
  instrument: Instrument;
  start: number;
  duration: number;
}

interface Pose {
  jump: number;
  dash: number;
  punch: number;
  duck: number;
  sidestep: number;
  leanBack: number;
}

export class StageRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private actions: Action[] = [];
  private width = 0;

  /** Introspection for the browser checks. Nothing in the app reads these. */
  characterDrawn = false;
  lastPose: Pose = emptyPose();
  lastCulprit: { type: ObstacleType; alpha: number; grown: boolean } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('Canvas 2D is unavailable');
    this.g = g;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = this.canvas.clientWidth || 960;
    this.width = cssWidth;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(STAGE_HEIGHT * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    const { g } = this;
    const w = this.width;
    const cell = w / frame.patternLength;
    const dinoX = w * DINO_FRACTION;

    // The death camera replays the last stretch of approach in slow motion and then
    // holds. It rewrites only what the stage shows; the clock, the audio and the
    // sequencer playhead carry on untouched.
    const camera = this.cameraState(frame);
    const stepFloat = camera ? camera.stepFloat : frame.stepFloat;

    g.fillStyle = PAPER;
    g.fillRect(0, 0, w, STAGE_HEIGHT);

    this.drawScenery(frame, stepFloat, cell, dinoX, w);
    this.drawGround(frame, stepFloat, cell, dinoX, w);

    // Back layer first, foreground over it, so recency reads as depth. Walls span the
    // full height and are drawn before anything else in either layer.
    const receded = frame.obstacles.filter((o) => !isCurrent(o, frame.currentStage));
    const current = frame.obstacles.filter((o) => isCurrent(o, frame.currentStage));
    for (const obstacle of [...byDepth(receded), ...byDepth(current)]) {
      const foreground = isCurrent(obstacle, frame.currentStage);
      this.eachWrap(obstacle.step, stepFloat, frame.patternLength, cell, dinoX, w, (x) => {
        this.drawObstacle(obstacle, x, frame.now, foreground ? 1 : RECEDED_ALPHA, foreground);
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
      // depth state. Identifying a shaker introduced eight stages ago depends on this.
      g.fillStyle = PAPER;
      g.globalAlpha = 0.74;
      g.fillRect(0, 0, w, STAGE_HEIGHT);
      g.globalAlpha = 1;

      const failure = frame.failure;
      const culprit = frame.obstacles.find(
        (o) => o.step === failure.step && OBSTACLE_INSTRUMENT[o.type] === failure.instrument,
      );
      if (culprit) {
        this.eachWrap(culprit.step, stepFloat, frame.patternLength, cell, dinoX, w, (x) =>
          this.drawCulprit(culprit, x),
        );
      }
    } else {
      this.lastCulprit = null;
    }

    this.drawCharacter(frame, stepFloat, camera, dinoX, w);

    if (frame.countInBeat !== null) this.drawCountIn(frame.countInBeat, w);
    if (frame.currentStage === null && !camera) this.drawBanner('chapter clear', w);
  }

  // ------------------------------------------------------------ death camera

  private cameraState(frame: StageFrame): { stepFloat: number; elapsed: number } | null {
    if (frame.phase !== 'failed' || !frame.failure) return null;

    const elapsed = frame.now - frame.failure.at;
    if (elapsed < 0 || elapsed > DEATH_CAMERA.total) return null;

    // Rewind by the replayed slice of approach, then run it forward at a fraction of
    // speed until it reaches the collision, and hold there.
    const rewind = DEATH_CAMERA.replay / frame.stepDuration;
    const progress = Math.min(1, elapsed / DEATH_CAMERA.slowmo);
    return { stepFloat: frame.failure.step - rewind * (1 - progress), elapsed };
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

  /** Four elements per bar, on the quarter notes only. Never on sixteenths. */
  private drawScenery(
    frame: StageFrame,
    stepFloat: number,
    cell: number,
    dinoX: number,
    w: number,
  ): void {
    const { g } = this;
    for (let quarter = 0; quarter < 4; quarter++) {
      const step = (quarter * frame.patternLength) / 4;
      this.eachWrap(step, stepFloat, frame.patternLength, cell, dinoX, w, (x) => {
        g.fillStyle = SOFT;
        // The downbeat's cloud sits higher and wider, so the bar line is findable.
        const downbeat = quarter === 0;
        cloud(g, x, downbeat ? 20 : 38 + (quarter % 2) * 10, downbeat ? 1.25 : 1);
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

  // --------------------------------------------------------------- obstacles

  private drawObstacle(
    obstacle: RenderObstacle,
    x: number,
    now: number,
    alpha: number,
    foreground: boolean,
  ): void {
    const { g } = this;
    const rise = clamp01((now - obstacle.addedAt) / RISE_SECONDS);

    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = foreground ? INK : RECEDED_INK;

    const band = BANDS[obstacle.type];
    const bottom = GROUND_Y - band.bottom;
    const top = GROUND_Y - band.top;

    // Rising is a vertical entrance: clipped at the ground for the types that stand on
    // it, faded in for the ones that do not.
    if (rise < 1) {
      if (band.bottom === 0) {
        g.beginPath();
        g.rect(0, 0, this.width, GROUND_Y + 1);
        g.clip();
        g.translate(0, (1 - ease(rise)) * (band.top + 20));
      } else {
        g.globalAlpha = alpha * rise;
      }
    }

    drawShape(g, obstacle.type, x, bottom, top, WEIGHT[obstacle.type]);
    g.restore();
  }

  /**
   * The culprit under the death camera: full opacity, foreground layer and full size,
   * with a highlight ring. A shaker that killed you is drawn large, not merely
   * brightened. This overriding both weight and depth is the point of the camera.
   */
  private drawCulprit(obstacle: RenderObstacle, x: number): void {
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

    g.save();
    g.globalAlpha = 1;
    g.fillStyle = INK;
    drawShape(g, obstacle.type, x, bottom, top, 'large');

    g.strokeStyle = FAIL;
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(x, (bottom + top) / 2, grown * 0.8, 0, Math.PI * 2);
    g.stroke();
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
        case 'shaker':
          pose.sidestep = Math.max(pose.sidestep, value);
          break;
        case 'rim':
          pose.leanBack = Math.max(pose.leanBack, value);
          break;
      }
    }
    this.lastPose = pose;

    let offsetX = 0;
    let tumble = 0;

    if (mode === 'entering') {
      // Linear, so it arrives at running speed rather than easing to a halt.
      offsetX = -(1 - frame.character.progress) * (dinoX + 140);
    } else if (mode === 'exiting') {
      offsetX = ease(frame.character.progress) * (w - dinoX + 140);
    } else if (mode === 'down' && camera) {
      tumble = clamp01((camera.elapsed - DEATH_CAMERA.slowmo * 0.55) / 0.45);
    }

    // While tumbling the character stays at the collision point: the death camera is
    // about identifying the culprit, and a body sliding away from it works against that.
    const lunge = tumble > 0 ? 0 : pose.dash * DASH_DISTANCE + pose.sidestep * SIDESTEP;
    const x = dinoX + offsetX + lunge;
    const y = GROUND_Y - (tumble > 0 ? 0 : pose.jump) * JUMP_HEIGHT;

    if (pose.dash > 0.15 && tumble === 0) {
      g.strokeStyle = LIGHT;
      g.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const lineY = y - 30 - i * 22;
        g.beginPath();
        g.moveTo(x - 46 - i * 18, lineY);
        g.lineTo(x - 92 - i * 26, lineY);
        g.stroke();
      }
    }

    g.save();
    g.translate(x, y);
    if (tumble > 0) {
      g.rotate(tumble * 1.4);
      g.translate(0, Math.sin(Math.PI * Math.min(tumble * 1.6, 1)) * -16);
    } else {
      g.rotate(-pose.leanBack * 0.2 + pose.dash * 0.1);
    }
    g.scale(CHAR_SCALE, CHAR_SCALE);

    runner(g, {
      legPhase: stepFloat * Math.PI,
      airborne: pose.jump > 0.06,
      crouch: pose.duck,
      punch: pose.punch,
      tumbled: tumble > 0,
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
  return { jump: 0, dash: 0, punch: 0, duck: 0, sidestep: 0, leanBack: 0 };
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
  weight: Weight,
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
      if (weight === 'small') swarm(g, x, bottom, top, 5, 5);
      else flyer(g, x, bottom, top);
      break;
    case 'pest':
      if (weight === 'small') swarm(g, x, bottom, top, 4, 4);
      else flyer(g, x, bottom, top);
      break;
  }
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
 * bird and pest at small weight: a clustered texture band rather than discrete objects.
 *
 * Simplified on purpose. Sixteen of these across a bar have to read as texture, not as
 * sixteen things competing with the kicks and claps for attention.
 */
function swarm(
  g: CanvasRenderingContext2D,
  x: number,
  bottom: number,
  top: number,
  count: number,
  size: number,
): void {
  const h = bottom - top;
  const spread = 13;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const px = x + Math.cos(angle * 1.7 + i) * spread;
    const py = top + h * 0.5 + Math.sin(angle * 2.3 + i) * (h * 0.32);
    g.fillRect(Math.round(px), Math.round(py), size, size - 1);
  }
}

/** bird and pest promoted to large weight, for the death camera. */
function flyer(g: CanvasRenderingContext2D, x: number, bottom: number, top: number): void {
  const h = bottom - top;
  const w = 34;
  const midY = top + h * 0.58;
  g.fillRect(x - w / 2, midY - h * 0.12, w, h * 0.24);
  g.fillRect(x + w / 2, midY - h * 0.16, 10, h * 0.12);
  g.fillRect(x - w / 2 + 5, top, w * 0.6, h * 0.5);
}

interface RunnerPose {
  legPhase: number;
  airborne: boolean;
  crouch: number;
  punch: number;
  tumbled: boolean;
}

/**
 * The character, drawn at the origin with its feet on y = 0, in unscaled units.
 *
 * Small actions read as changes to this pose rather than as separate animations, which
 * is what keeps a bar of sixteenth dodges legible instead of sixteen interruptions.
 */
function runner(g: CanvasRenderingContext2D, pose: RunnerPose): void {
  const squash = 1 - pose.crouch * 0.28;
  const bodyH = 20 * squash;
  const bodyY = -30 * squash - 6;
  const headY = bodyY - 16 * squash;

  g.fillStyle = INK;

  g.beginPath();
  g.moveTo(-13, bodyY + 4);
  g.lineTo(-26, bodyY - 2);
  g.lineTo(-13, bodyY + bodyH - 2);
  g.closePath();
  g.fill();

  g.fillRect(-13, bodyY, 26, bodyH);

  if (pose.tumbled) {
    g.fillRect(-6, bodyY + bodyH, 6, 8);
    g.fillRect(6, bodyY + bodyH - 2, 6, 8);
  } else if (pose.airborne) {
    g.fillRect(-6, bodyY + bodyH, 6, 8);
    g.fillRect(4, bodyY + bodyH - 2, 6, 7);
  } else {
    const swing = Math.sin(pose.legPhase);
    const lift = Math.max(0, swing) * 5;
    const lift2 = Math.max(0, -swing) * 5;
    g.fillRect(-7 + swing * 3, bodyY + bodyH, 6, 12 - lift);
    g.fillRect(3 - swing * 3, bodyY + bodyH, 6, 12 - lift2);
  }

  g.fillRect(6, headY, 10, 18 * squash);
  g.fillRect(6, headY - 12, 20, 14);
  g.fillRect(26, headY - 6, 6, 5);

  g.fillStyle = PAPER;
  if (pose.tumbled) {
    g.fillRect(15, headY - 9, 6, 2);
    g.fillRect(17, headY - 11, 2, 6);
  } else {
    g.fillRect(16, headY - 9, 4, 4);
  }
  g.fillStyle = INK;

  g.fillRect(6, bodyY + 4, 8 + pose.punch * 14, 5);
}
