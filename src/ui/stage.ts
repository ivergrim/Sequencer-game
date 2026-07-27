import type { Failure, Phase } from '../game/state';
import type { Instrument, ObstacleType } from '../game/types';

/**
 * The stage.
 *
 * One bar occupies exactly the canvas width, so the world loop wraps seamlessly at the
 * bar line. Every position on screen derives from `stepFloat`, which derives from the
 * audio clock; nothing here advances by a per-frame delta.
 *
 * The stage never draws the step grid. No tick marks, no lanes, no step numbers. The
 * only positional aid is scenery on the quarter notes, which reads as parallax and
 * functions as a coarse ruler.
 *
 * Placeholder art, drawn procedurally. The visual target is the Chrome offline
 * dinosaur game.
 */

const INK = '#535353';
const LIGHT = '#bdbdbd';
const SOFT = '#dcdcdc';
const FAIL = '#c1554b';
const PAPER = '#f7f7f7';

const HEIGHT = 250;
const GROUND_Y = 206;
const DINO_FRACTION = 0.15;

/** Action durations, in steps, so they scale with tempo. */
const ACTION_STEPS: Record<Instrument, number> = {
  kick: 2,
  clap: 1,
  openhat: 0.9,
  shaker: 0.8,
  rim: 0.8,
  crash: 2.2,
};

const STUMBLE_SECONDS = 1.2;
const RISE_SECONDS = 0.6;

/** Ground litter, deliberately off the sixteenth grid so it can never read as one. */
const PEBBLES = [0.031, 0.107, 0.183, 0.271, 0.339, 0.427, 0.518, 0.603, 0.689, 0.771, 0.858, 0.941];

export interface RenderObstacle {
  step: number;
  type: ObstacleType;
  /** Audio time this obstacle rose into the world. */
  addedAt: number;
}

export interface StageFrame {
  stepFloat: number;
  /** Audio-clock time. */
  now: number;
  patternLength: number;
  obstacles: RenderObstacle[];
  phase: Phase;
  failure: Failure | null;
  countInBeat: number | null;
  /** 0..1 exit progress during the success flourish. */
  exit: number;
  complete: boolean;
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
  private readonly stepDuration: number;
  private actions: Action[] = [];
  private stumbleAt: number | null = null;
  private width = 0;

  constructor(canvas: HTMLCanvasElement, stepDuration: number) {
    this.canvas = canvas;
    this.stepDuration = stepDuration;
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
    this.canvas.height = Math.round(HEIGHT * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Queue a character action, phase-locked to the audio time its hit landed on. */
  triggerAction(instrument: Instrument, at: number): void {
    if (this.stumbleAt !== null) return; // the character is on the floor
    this.actions.push({
      instrument,
      start: at,
      duration: ACTION_STEPS[instrument] * this.stepDuration,
    });
  }

  stumble(at: number): void {
    this.stumbleAt = at;
    this.actions = [];
  }

  render(frame: StageFrame): void {
    const { g } = this;
    const w = this.width;
    const cell = w / frame.patternLength;

    g.fillStyle = PAPER;
    g.fillRect(0, 0, w, HEIGHT);

    const dinoX = w * DINO_FRACTION;

    this.drawScenery(frame, cell, dinoX, w);
    this.drawGround(frame, cell, dinoX, w);

    for (const obstacle of frame.obstacles) {
      const rise = clamp01((frame.now - obstacle.addedAt) / RISE_SECONDS);
      this.eachWrap(obstacle.step, frame.stepFloat, frame.patternLength, cell, dinoX, w, (x) =>
        this.drawObstacle(obstacle.type, x, rise, frame.stepFloat),
      );
    }

    if (frame.failure) {
      this.eachWrap(
        frame.failure.step,
        frame.stepFloat,
        frame.patternLength,
        cell,
        dinoX,
        w,
        (x) => this.drawFailMarker(x),
      );
    }

    this.drawCharacter(frame, dinoX, w);

    if (frame.countInBeat !== null) this.drawCountIn(frame.countInBeat, w);
    if (frame.complete) this.drawBanner('chapter clear', w);
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
    // x lands in [dinoX, dinoX + w). Drawing it again one screen to the left covers
    // [0, dinoX), so the two together tile the canvas exactly once with no seam.
    draw(x);
    draw(x - w);
  }

  // ---------------------------------------------------------------- scenery

  /** Four elements per bar, on the quarter notes only. Never on sixteenths. */
  private drawScenery(frame: StageFrame, cell: number, dinoX: number, w: number): void {
    const { g } = this;
    for (let quarter = 0; quarter < 4; quarter++) {
      const step = (quarter * frame.patternLength) / 4;
      this.eachWrap(step, frame.stepFloat, frame.patternLength, cell, dinoX, w, (x) => {
        g.fillStyle = SOFT;
        // The downbeat's cloud sits higher and wider, so the bar line is findable.
        const downbeat = quarter === 0;
        const y = downbeat ? 40 : 58 + (quarter % 2) * 12;
        const scale = downbeat ? 1.25 : 1;
        cloud(g, x, y, scale);
      });
    }
  }

  private drawGround(frame: StageFrame, cell: number, dinoX: number, w: number): void {
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
      this.eachWrap(step, frame.stepFloat, frame.patternLength, cell, dinoX, w, (x) => {
        const size = 1 + ((fraction * 97) % 2 | 0);
        g.fillRect(Math.round(x), GROUND_Y + 6 + ((fraction * 53) % 3 | 0) * 3, 4 + size, 2);
      });
    }
  }

  // -------------------------------------------------------------- obstacles

  private drawObstacle(type: ObstacleType, x: number, rise: number, stepFloat: number): void {
    const { g } = this;
    g.save();
    g.fillStyle = INK;

    switch (type) {
      case 'pillar':
        this.fromGround(rise, () => cactus(g, x, GROUND_Y, 46));
        break;
      case 'wall':
        this.fromGround(rise, () => wall(g, x, GROUND_Y, 82));
        break;
      case 'totem':
        this.fromGround(rise, () => totem(g, x, GROUND_Y, 24));
        break;
      case 'enemy':
        this.fromGround(rise, () => blob(g, x, GROUND_Y, 36));
        break;
      case 'bird':
        g.globalAlpha = rise;
        flyer(g, x, GROUND_Y - 58, 1, stepFloat);
        break;
      case 'pest':
        g.globalAlpha = rise;
        flyer(g, x, GROUND_Y - 20, 0.62, stepFloat * 1.7);
        break;
    }

    g.restore();
  }

  /** Ground obstacles rise into the world, clipped so they emerge from the ground. */
  private fromGround(rise: number, draw: () => void): void {
    const { g } = this;
    g.save();
    g.beginPath();
    g.rect(0, 0, this.width, GROUND_Y + 1);
    g.clip();
    g.translate(0, (1 - ease(rise)) * 90);
    draw();
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

  // -------------------------------------------------------------- character

  private drawCharacter(frame: StageFrame, dinoX: number, w: number): void {
    const { g } = this;
    const now = frame.now;

    // Cull finished actions, then fold the survivors into one pose. Taking the max of
    // each channel is what makes actions layer: a crash and a kick on the same step
    // give a dash and a leap at once, and dense dodges never interrupt anything.
    this.actions = this.actions.filter((a) => now - a.start < a.duration);

    const pose: Pose = { jump: 0, dash: 0, punch: 0, duck: 0, sidestep: 0, leanBack: 0 };
    for (const action of this.actions) {
      const t = (now - action.start) / action.duration;
      if (t < 0) continue;
      const arc = Math.sin(Math.PI * t);
      switch (action.instrument) {
        case 'kick':
          pose.jump = Math.max(pose.jump, arc);
          break;
        case 'crash':
          pose.dash = Math.max(pose.dash, Math.pow(arc, 0.6));
          break;
        case 'clap':
          pose.punch = Math.max(pose.punch, arc);
          break;
        case 'openhat':
          pose.duck = Math.max(pose.duck, arc);
          break;
        case 'shaker':
          pose.sidestep = Math.max(pose.sidestep, arc);
          break;
        case 'rim':
          pose.leanBack = Math.max(pose.leanBack, arc);
          break;
      }
    }

    let tumble = 0;
    if (this.stumbleAt !== null) {
      const t = (now - this.stumbleAt) / STUMBLE_SECONDS;
      if (t >= 1) this.stumbleAt = null;
      else if (t >= 0) tumble = t;
    }

    // The success flourish: off to the right across the first half of the bar, back in
    // from the left across the second, so the world never has to pause for a reset.
    let exit = 0;
    if (frame.exit > 0) {
      exit =
        frame.exit < 0.5
          ? ease(frame.exit * 2) * (w - dinoX + 60)
          : -(1 - ease((frame.exit - 0.5) * 2)) * (dinoX + 60);
    }

    const x = dinoX + pose.dash * 74 + pose.sidestep * 12 + exit;
    const y = GROUND_Y - pose.jump * 84;

    if (pose.dash > 0.15 && tumble === 0) {
      g.strokeStyle = LIGHT;
      g.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const lineY = y - 14 - i * 10;
        g.beginPath();
        g.moveTo(x - 26 - i * 12, lineY);
        g.lineTo(x - 52 - i * 16, lineY);
        g.stroke();
      }
    }

    g.save();
    g.translate(x, y);

    if (tumble > 0) {
      g.rotate(tumble * 1.5);
      g.translate(0, Math.sin(Math.PI * Math.min(tumble * 1.6, 1)) * -10);
    } else {
      g.rotate(-pose.leanBack * 0.22 + pose.dash * 0.12);
    }

    runner(g, {
      legPhase: frame.stepFloat * Math.PI,
      airborne: pose.jump > 0.06,
      crouch: pose.duck,
      punch: pose.punch,
      tumbled: tumble > 0,
    });

    g.restore();
  }

  // ------------------------------------------------------------------ chrome

  private drawCountIn(beat: number, w: number): void {
    const { g } = this;
    g.save();
    g.fillStyle = INK;
    g.globalAlpha = 0.85;
    g.font = '700 64px ui-monospace, Menlo, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(beat), w / 2, 84);
    g.restore();
  }

  private drawBanner(text: string, w: number): void {
    const { g } = this;
    g.save();
    g.fillStyle = INK;
    g.font = '700 15px ui-monospace, Menlo, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text.toUpperCase(), w / 2, 30);
    g.restore();
  }
}

// ------------------------------------------------------------------- shapes

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function ease(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

function cloud(g: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  const w = 46 * scale;
  const h = 14 * scale;
  g.fillRect(x - w / 2, y, w, h);
  g.fillRect(x - w / 2 + 8 * scale, y - 6 * scale, w - 18 * scale, 6 * scale);
  g.fillRect(x - w / 2 - 5 * scale, y + 4 * scale, 5 * scale, h - 4 * scale);
  g.fillRect(x + w / 2, y + 4 * scale, 5 * scale, h - 4 * scale);
}

/** pillar: a ground cactus. */
function cactus(g: CanvasRenderingContext2D, x: number, ground: number, height: number): void {
  const w = 12;
  g.fillRect(x - w / 2, ground - height, w, height);
  g.fillRect(x - w / 2 - 8, ground - height + 14, 8, 5);
  g.fillRect(x - w / 2 - 8, ground - height + 14, 5, 18);
  g.fillRect(x + w / 2, ground - height + 22, 8, 5);
  g.fillRect(x + w / 2 + 3, ground - height + 8, 5, 19);
}

/** wall: a tall cracked barrier. */
function wall(g: CanvasRenderingContext2D, x: number, ground: number, height: number): void {
  const w = 22;
  g.fillRect(x - w / 2, ground - height, w, height);
  g.fillStyle = PAPER;
  g.fillRect(x - 2, ground - height + 12, 2, 20);
  g.fillRect(x - 6, ground - height + 32, 8, 2);
  g.fillRect(x + 2, ground - height + 44, 2, 18);
  g.fillRect(x - 8, ground - height + 62, 10, 2);
  g.fillStyle = INK;
}

/** totem: a short ground post. */
function totem(g: CanvasRenderingContext2D, x: number, ground: number, height: number): void {
  g.fillRect(x - 5, ground - height, 10, height);
  g.fillRect(x - 9, ground - height - 5, 18, 5);
  g.fillStyle = PAPER;
  g.fillRect(x - 5, ground - height + 9, 10, 3);
  g.fillStyle = INK;
}

/** enemy: a chest-height blob. */
function blob(g: CanvasRenderingContext2D, x: number, ground: number, height: number): void {
  const w = 26;
  g.beginPath();
  g.moveTo(x - w / 2, ground);
  g.lineTo(x - w / 2, ground - height + 8);
  g.quadraticCurveTo(x, ground - height - 8, x + w / 2, ground - height + 8);
  g.lineTo(x + w / 2, ground);
  g.closePath();
  g.fill();

  g.fillStyle = PAPER;
  g.fillRect(x - 7, ground - height + 10, 4, 4);
  g.fillRect(x + 3, ground - height + 10, 4, 4);
  g.fillStyle = INK;
}

/** bird and pest: flyers, wings driven by the same clock as everything else. */
function flyer(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  phase: number,
): void {
  const up = Math.sin(phase * 2) > 0;
  const w = 18 * scale;
  const h = 8 * scale;
  g.fillRect(x - w / 2, y - h / 2, w, h);
  g.fillRect(x + w / 2, y - h / 2 - 1 * scale, 6 * scale, 3 * scale);
  if (up) {
    g.fillRect(x - w / 2 + 2 * scale, y - h / 2 - 9 * scale, 12 * scale, 9 * scale);
  } else {
    g.fillRect(x - w / 2 + 2 * scale, y + h / 2, 12 * scale, 9 * scale);
  }
}

interface RunnerPose {
  legPhase: number;
  airborne: boolean;
  crouch: number;
  punch: number;
  tumbled: boolean;
}

/**
 * The character, drawn at the origin with its feet on y = 0.
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

  // neck and head
  g.fillRect(6, headY, 10, 18 * squash);
  g.fillRect(6, headY - 12, 20, 14);
  g.fillRect(26, headY - 6, 6, 5);

  // eye
  g.fillStyle = PAPER;
  if (pose.tumbled) {
    g.fillRect(15, headY - 9, 6, 2);
    g.fillRect(17, headY - 11, 2, 6);
  } else {
    g.fillRect(16, headY - 9, 4, 4);
  }
  g.fillStyle = INK;

  // arm, extended on a punch
  const reach = pose.punch * 14;
  g.fillRect(6, bodyY + 4, 8 + reach, 5);
}
