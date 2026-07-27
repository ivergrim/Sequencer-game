# Sequencing runner — chapter 1 prototype (deep house)

A rhythm puzzle game. You do not control the character. You program a drum pattern
into a step sequencer and that pattern drives every action the character takes.
Obstacles sit on exact sequencer steps: place the right instrument on the right step
and the run clears.

- `GAME_DESIGN.md` — the full design
- `PROTOTYPE_BRIEF.md` — the scope of this prototype
- `PATCH_1.md` — changes to the baseline; where it conflicts with the brief, it wins

## Requirements

Node 22 (see `.nvmrc`).

```sh
nvm use
npm install
```

## Local dev

```sh
npm run dev
```

Open the printed URL. Browsers block audio until a user gesture, so the app shows a
start overlay — click it or press space, and the transport starts.

## Test

```sh
npm test          # single run
npm run test:watch
```

`simulate()` is a pure function and carries the unit tests, including a success case, a
failure case and a carried-over-note case. `test/chapter1.test.ts` pins the chapter data
against the brief: the budget table, that every stage's derived solution clears it, and
that stage 3 is clearable by kick on 0, 4, 8, 12 and by no other pattern within budget.

### Browser checks

Two things cannot be asserted without a running audio clock: that the music and the
world never stop across ten stage transitions, and that nothing drifts. Both run against
the dev server in a real Chromium.

```sh
npm run dev                # in one terminal
npm run test:e2e           # in another: plays stage 1 through 10
npm run test:e2e:drift     # five minutes, then measures alignment
npm run test:e2e:patch1    # the patch 1 acceptance criteria
```

`test:e2e` plays the whole chapter by clicking real cells, and checks the budget
rejection, row locking, the carried-over-note failure, and that the transport is never
restarted and never stalls.

`test:e2e:drift` fills the pattern so a hit lands on every step, then records how far the
derived `stepFloat` sits from the step each hit was scheduled to sound on. That one number
is the alignment error, since the obstacles and the playhead both derive from `stepFloat`.
It compares the first thirty seconds against the last.

`test:e2e:patch1` covers the criteria added by the patch: that the character is absent
during EDITING, that it is in position before step 0, that the pose channel is at its
maximum on the frame an obstacle reaches `DINO_X`, that stage 10 renders exactly three
obstacles in the foreground, that the bands on step 12 do not overlap, and that no element
of the sequencer changes appearance when a run fails.

Set `E2E_CHROMIUM` to a Chromium binary if Playwright's own download is not present, and
`E2E_MINUTES` to change the drift duration.

## Build

```sh
npm run build     # type-checks, then emits dist/
npm run preview   # serve the built dist/ locally
```

## Deploy

Deployment targets **Cloudflare Workers with static assets**, not Pages. Config lives
in `wrangler.toml`.

```sh
npm run build
npx wrangler deploy
```

The first deploy opens a browser for `wrangler login`. `npm run deploy` does both steps.

### Automatic deploys

Connect **Workers Builds** to this GitHub repo so pushes deploy without manual steps:

1. Cloudflare dashboard → Workers & Pages → the `sequencer-game` worker → Settings → Builds
2. Connect the GitHub repository
3. Build command `npm run build`, deploy command `npx wrangler deploy`, root directory `/`

Pushes to `main` then deploy to production and other branches get preview URLs, which
is useful for trying alternative stage layouts without touching the live build.

`public/_headers` is served natively by Workers static assets. Vite emits
content-hashed filenames under `/assets`, so those are cached forever; stems get a
short TTL because they churn while the music is being produced.

## Audio

**The app runs and makes sound with `public/stems/` empty.** Every backing layer
attempts to load `public/stems/<name>.wav` and falls back to a synthesized substitute
when the file is absent. Real audio is a drop-in later — no code changes.

The drum voices are always synthesized. There are no drum samples.

### Dropping in real loops

Chapter 1 expects these ten stems, in the order they enter:

`bass`, `sub`, `bassline`, `pad`, `stab`, `chop`, `sweep`, `pad2`, `chords`, `lead`

Constraints, all of them hard:

- **Exactly one bar at the chapter tempo** (124 BPM → 1.935483…s), no leading silence,
  no tail past the bar. Anything needing time-stretching will drift. Pick the chapter
  tempo to match the loops you actually use rather than forcing loops to match 124.
- **Never MP3.** Encoder padding adds silence at head and tail, which breaks gapless
  looping and puts the backing permanently out of phase with the sequencer. Use WAV, or
  Opus in WebM if delivery size becomes a problem.
- Loops are small enough to live in the repo directly. A one-bar loop at 124 BPM as
  16-bit stereo WAV is roughly 340KB; ten stems is about 3.5MB. No git-lfs needed.

Each bar is scheduled as a fresh `AudioBufferSourceNode` at an absolute time computed
from the transport start. `AudioBufferSourceNode.loop` is deliberately not used: a bar
at an arbitrary tempo is not a whole number of samples, so a self-looping buffer
accumulates error. Sub-sample error at each bar boundary is inaudible and never
accumulates.

Royalty-free sources worth pulling from — the Ghosthack free deep house pack is the
best single starting point, and its layer categories map almost directly onto the stem
list above:

- <https://www.ghosthack.de/free_sample_packs/free-deep-house-samples>
- <https://www.looperman.com/loops/tags/free-deep-house-loops-samples-sounds-wavs-download>
- <https://www.samplephonics.com/products/free/deep-house>

On Looperman, filter by a single BPM and key so the layers stack.

## Controls

| Input | Action |
|---|---|
| Click a cell | Toggle a note |
| Space | Run |
| R | Retry |
| Escape | Clear all editable notes |

## Architecture

```
src/
  main.ts            entry, wiring, game loop
  audio/
    context.ts       AudioContext singleton, unlock on first gesture
    transport.ts     master clock, lookahead scheduler, step events
    drums.ts         synthesized drum voices
    stems.ts         backing layer loading and playback
  game/
    types.ts
    chapter1.ts      chapter data
    simulate.ts      pure run resolver
    state.ts         state machine
  ui/
    sequencer.ts     step grid
    stage.ts         canvas renderer
```

Add `test/reaction.test.ts` to the unit suite: it pins the obstacle reaction's onset to
the moment an obstacle reaches the launch position.

Four commitments hold the whole thing up:

**One clock.** `AudioContext.currentTime` is the only source of truth. Nothing
accumulates time in a `requestAnimationFrame` loop and nothing uses `Date.now()` for
anything that affects position or timing.

**Lookahead scheduling.** A 25ms `setInterval` looks 100ms ahead and schedules step
events against the audio clock. Audio is never fired from the render loop.

**Derived position.** Every frame the renderer computes

```
elapsed   = audioCtx.currentTime - transportStart
stepFloat = (elapsed / stepDuration) % patternLength
```

and derives the playhead, every obstacle position and the character from `stepFloat`.

**The death camera decelerates into the impact.** It takes over `DEATH_CAMERA.replay`
seconds of world time *before* the collision, at the world's real position, and eases to
a stop exactly on it. Rewinding to the collision after the fact — which is the literal
reading of "dilate the last 200ms of approach" — puts a backwards jump of a step and a
half on a single frame. `test/e2e/patch1.mjs` traces the hand-over and fails on any
backwards motion.

**Collision is a table lookup.** There is no hitbox test and no physics anywhere in
this repo. At step N an obstacle either requires instrument I or it does not, and the
pattern at step N either contains I or does not. The run outcome is computed in full
before the animation starts; the animation presents an already-decided result.

### Reading the stage

Two systems keep the stage legible as obstacles accumulate, and they are deliberately
independent so they can never multiply and bury the oldest small obstacles:

| | Set by | Controls | Changes with |
|---|---|---|---|
| **Weight** | instrument | size and detail | never |
| **Depth** | recency | opacity and layer | which stage is current |

Each obstacle type also occupies a fixed, non-overlapping vertical band. This is load
bearing rather than decorative: chapter 1 stacks three obstacles on step 12 and two each
on steps 0, 4 and 15, which would occlude each other at the same x without it. No lane
guides are ever drawn — it reads only as characteristic height per type.

### Where the beat falls

There is no hit line, and no step grid. Two things carry it instead.

The **launch position is worn into the terrain** — a patch of bare ground with a few
scuff marks, in the same idiom as the ground litter. It is the one thing on the ground
that does not scroll, which is what makes it read as a place rather than as scenery. It
sits at 28% of the width rather than the brief's 15%: further left, an obstacle has only
about two and a half steps of screen left after crossing, so its reaction plays out just
as it exits.

Every obstacle then **announces itself as it crosses that spot**: a quick swell and snap
back, with dust kicked off the ground or air flicked sideways for the ones that fly. It
fires in every phase, including EDITING, so the player watches each obstacle land on its
beat before committing to a run.

The reaction is derived from `stepFloat` rather than fired as an event. An obstacle on
step S is at the launch position exactly when `stepFloat` is S, so how far it is into its
reaction is just the wrapped difference. Nothing is scheduled, it repeats every bar for
free, and it inherits the transport's immunity to drift. `test/reaction.test.ts` pins the
onset to the crossing.

### Action timing

The character has to be mid-action when an obstacle arrives, not starting one. Each
action carries an impact ratio, and its animation is scheduled at

```
animationStart = stepTime(S) - duration * impactRatio
```

so the apex of a jump, the full extension of a punch and the full speed of a dash all
land exactly on the step. Audio and animation decouple here: the drum hit still fires at
`stepTime(S)`, and only the animation starts early. This is why animation scheduling
lives in the frame loop rather than the audio scheduler — a 400ms jump begins 200ms
before its step, and the lookahead only reaches 100ms ahead.

Durations are capped by the gap to the nearest hit on the same instrument. The patch
specifies capping forwards only; that is not enough, because an action extends backwards
by its lead too, and chapter 1's kick on step 15 followed by a kick on step 0 would
overlap and merge into one hover instead of two distinct jumps.

The solution to a stage is never authored. It is derived from the obstacle set through
`OBSTACLE_INSTRUMENT`, so a stage is placed obstacles and nothing else. There is no
answer key anywhere in the repo.

### Signal path

```
drum voices ──▶ drum bus (0.7) ─┐
                                ├─▶ master (0.85) ──▶ limiter ──▶ destination
backing layers ─▶ stem bus (0.5)┘
```

A stage can stack several voices on one step by design — by stage 10 a kick, a clap and
an open hat all land on step 12 — so the limiter is there to keep the sum under one
rather than to shape the sound.

### Known limitation

Browsers throttle `setInterval` to roughly once a second in a background tab while the
audio clock keeps running. The scheduler skips whatever went past due rather than firing
a burst of it on return, so the transport resumes exactly in phase and nothing drifts,
but the backing can gap while the tab is hidden. Fixing it properly means moving the
scheduler into an `AudioWorklet` or a `Worker`, which is beyond this prototype.

## Verifying the acceptance criteria

| # | Criterion | Where it is checked |
|---|---|---|
| 1 | Runs and makes sound with `public/stems/` empty | `test:e2e` taps the drum and stem buses and asserts signal on both |
| 2 | No drift after five minutes | `test:e2e:drift` |
| 3 | Stage 3 clears only with kick on 0, 4, 8, 12 | `test/chapter1.test.ts` |
| 4 | Removing a carried-over note fails at that step | `test/simulate.test.ts` and `test:e2e` |
| 5 | The budget blocks over-placing | `test:e2e` |
| 6 | Music and scroll never stop, stage 1 to 10 | `test:e2e` monitors the transport for the whole session |
| 7 | `simulate()` is pure and unit tested | `test/simulate.test.ts` |
| 8 | No hitbox or physics code | `grep -rniE "hitbox\|intersect\|collide\|bounding\|physics\|velocity\|gravity" src/` |
| 9 | `wrangler deploy` produces a working URL | Needs Cloudflare credentials; `npx wrangler deploy --dry-run` validates the config without them |
| 10 | A push to `main` deploys | Needs Workers Builds connected in the dashboard, see above |

Patch 1 adds ten more, covered by `test/actions.test.ts` and `test:e2e:patch1`:

| # | Criterion | Where it is checked |
|---|---|---|
| 1 | No character on stage during EDITING | `test:e2e:patch1` |
| 2 | Enters during the count-in, in position by step 0 | `test:e2e:patch1` |
| 3 | Mid-action, not starting one, at the impact frame | `test:e2e:patch1` and `test/actions.test.ts` |
| 4 | The drum fires on the step, the animation began before | `test:e2e:drift` |
| 5 | Kick on 15 then 0 gives two distinct, complete jumps | `test/actions.test.ts` |
| 6 | Nothing in the sequencer changes on failure | `test:e2e:patch1` |
| 7 | The culprit is unambiguous, however small and old | `test:e2e:patch1` |
| 8 | Three foreground, eighteen receded, at stage 10 | `test:e2e:patch1` |
| 9 | Step 12's three obstacles do not occlude | `test:e2e:patch1` |
| 10 | Size never tracks age, opacity never tracks type | Weight and depth are separate code paths; `test:e2e:patch1` pins the counts |
