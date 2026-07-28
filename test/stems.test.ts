import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAPTER_1, activeStems } from '../src/game/chapter1';

/**
 * The backing bed may not sound like a drum.
 *
 * This is a correctness rule, not a mixing preference. The player works out which drum
 * belongs on which step by ear, so a backing layer that reads as percussion is a false
 * answer: they hear a tick on a step, assume a note is already there, and stop looking
 * for the one that is missing. Every drum in the game has to come from the sequencer.
 *
 * Two properties are what make the ear call something a drum, and both are checked here
 * against the real schedulers rather than against a description of them:
 *
 * - **A sharp transient.** Measured as the time each envelope takes to get from a tenth
 *   of its target to nine tenths, read straight off the gain automation.
 * - **Noise.** Filtered noise is what the ear identifies as a hat, a clap or a cymbal,
 *   so no backing layer may allocate a buffer source at all.
 *
 * Tested at the source, through a recording stub for the audio context. Measuring the
 * rendered signal instead does not work: above the sub, where transients live, a
 * sawtooth's own waveform is a spike train, and no envelope follower short enough to
 * resolve a 5ms attack can tell that apart from an actual attack.
 */

/** Every automation call made against one AudioParam, in the order it was made. */
interface Automation {
  kind: 'set' | 'linear' | 'exponential';
  value: number;
  time: number;
}

const gainAutomations: Automation[][] = [];
let bufferSources = 0;
let noiseRequests = 0;

function makeParam(record?: Automation[]): AudioParam {
  const push = (kind: Automation['kind']) => (value: number, time: number) => {
    record?.push({ kind, value, time });
    return param;
  };
  const param = {
    value: 0,
    setValueAtTime: push('set'),
    linearRampToValueAtTime: push('linear'),
    exponentialRampToValueAtTime: push('exponential'),
  } as unknown as AudioParam;
  return param;
}

function makeNode(extra: Record<string, unknown> = {}): AudioNode {
  const node = {
    connect: (target: AudioNode) => target,
    disconnect: () => {},
    ...extra,
  } as unknown as AudioNode;
  return node;
}

vi.mock('../src/audio/context', () => ({
  getStemBus: () => makeNode(),
  getNoiseBuffer: () => {
    noiseRequests++;
    return {} as AudioBuffer;
  },
  getContext: () =>
    ({
      sampleRate: 48_000,
      currentTime: 0,
      createGain: () => {
        const record: Automation[] = [];
        gainAutomations.push(record);
        return makeNode({ gain: makeParam(record) });
      },
      createOscillator: () =>
        makeNode({
          type: 'sine',
          frequency: makeParam(),
          detune: makeParam(),
          start: () => {},
          stop: () => {},
        }),
      createBiquadFilter: () =>
        makeNode({ type: 'lowpass', frequency: makeParam(), Q: makeParam() }),
      createBufferSource: () => {
        bufferSources++;
        return makeNode({ buffer: null, loop: false, start: () => {}, stop: () => {} });
      },
    }) as unknown as AudioContext,
}));

const { Stems } = await import('../src/audio/stems');

const STEP = 60 / CHAPTER_1.bpm / 4; // 124 BPM in sixteenths — 121ms.
const NAMES = activeStems(CHAPTER_1, CHAPTER_1.stages.length - 1);

/**
 * The fastest rise in one layer's bar, in seconds.
 *
 * Walks each gain's automation looking for a rise from at or below a tenth of a target
 * to at or above nine tenths of it — the usual way an attack time is quoted. A layer's
 * envelope may have several; the shortest is the one that decides how it reads.
 */
function fastestAttack(automations: Automation[][]): number {
  let fastest = Infinity;
  for (const points of automations) {
    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1]!;
      const to = points[i]!;
      if (to.value <= from.value) continue; // a fall, not an attack
      if (from.value > to.value * 0.1) continue; // not starting from silence
      fastest = Math.min(fastest, to.time - from.time);
    }
  }
  return fastest;
}

function scheduleOne(name: string): Automation[][] {
  gainAutomations.length = 0;
  const stems = new Stems(STEP);
  // Bar 1 rather than bar 0: a layer's very first bar carries a one-off entry fade, and
  // that fade is the layer arriving with its stage, not part of the layer itself.
  stems.scheduleBar([name], 0);
  gainAutomations.length = 0;
  stems.scheduleBar([name], STEP * 16);
  return [...gainAutomations];
}

describe('the backing bed', () => {
  beforeEach(() => {
    bufferSources = 0;
    noiseRequests = 0;
  });

  it('covers every layer the chapter asks for', () => {
    expect(NAMES).toHaveLength(CHAPTER_1.stages.length);
    expect(new Set(NAMES).size).toBe(NAMES.length);
  });

  it.each(NAMES)('gives %s no attack a drum could have', (name) => {
    const fastest = fastestAttack(scheduleOne(name));
    expect(fastest).toBeGreaterThan(0);
    // 25ms is the floor `tone` enforces. A kick reaches full level in under 1ms and the
    // rim's click is 20ms end to end, so anything under this line is in drum territory.
    expect(fastest).toBeGreaterThanOrEqual(0.025);
  });

  it.each(NAMES)('builds %s without a single noise source', (name) => {
    scheduleOne(name);
    expect(bufferSources).toBe(0);
    expect(noiseRequests).toBe(0);
  });

  it('holds to both rules with the whole bed playing at once', () => {
    gainAutomations.length = 0;
    const stems = new Stems(STEP);
    stems.scheduleBar(NAMES, 0);
    gainAutomations.length = 0;
    stems.scheduleBar(NAMES, STEP * 16);

    expect(fastestAttack(gainAutomations)).toBeGreaterThanOrEqual(0.025);
    expect(bufferSources).toBe(0);
  });

  it('still covers a layer it has never heard of', () => {
    // A stem name with no scheduler falls back to a generic one rather than to silence,
    // and that fallback is bound by the same two rules as the named layers.
    const fastest = fastestAttack(scheduleOne('a-name-nothing-defines'));
    expect(fastest).toBeGreaterThanOrEqual(0.025);
    expect(bufferSources).toBe(0);
  });
});
