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
npm run dev                 # in one terminal
npm run test:e2e            # in another: plays stage 1 through 10
npm run test:e2e:drift      # five minutes, then measures alignment
npm run test:e2e:patch1     # the patch 1 acceptance criteria
npm run test:e2e:responsive # desktop and phone viewports, touch controls
npm run test:e2e:shots      # captures stage art, and the announcement on and off a crossing
```

`test:e2e` plays the whole chapter by clicking real cells, and checks the budget
rejection, that only the rows the world has asked for are on screen, that a locked
instrument stays unplayable, that a committed note cannot be removed, and that the
transport is never restarted and never stalls. It ends in free play: the world emptying, the grid
unlocking, the budget lifting, runs retiring, and the whole thing surviving a reload.

`test:e2e:responsive` drives a 1100px desktop and a 390px phone, checking that nothing
overflows, that the canvas backing store matches its CSS box at each device pixel ratio,
and that a note can be placed, run and cleared entirely by tapping.

Every suite clears `localStorage` before starting, so a run always begins at stage 1
whatever the last one left behind.

`test/e2e/hint-shot.mjs` is a look rather than a check: it fails the same stage three
times and captures the death camera on either side of the hint threshold.

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
3. Build command `npm test && npm run build`, deploy command `npx wrangler deploy`, root
   directory `/`

The build command runs the unit suite first on purpose: a push to `main` deploys
straight to production, so the tests are the last gate before it. `.github/workflows/ci.yml`
runs the same checks on every branch and pull request.

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
| Click or tap a cell | Toggle a note, and hear it |
| Space or R, or the run banner | Run — the same action either way; R is there to retry |
| Escape, or the clear button | Clear this stage's notes (committed ones stay) |
| Restart chapter | Wipe the save and start over — asks twice |

Every input is a button as well as a key, sized to be pressed with a thumb, so the game
is playable on a phone. The shortcut is printed on the button that performs it rather
than in a legend underneath: a separate list of key hints was dead weight on a phone,
where the buttons are the only way in, and on a desktop it named every action twice. The
chips are dropped on a touch device, which leaves plain buttons.

**Run is a banner above the stage**, not a button in the row under the sequencer, because
it is the one control a player has to find and the row under the sequencer is the last
place they look. Full width, one line tall.

The banner is the offer of a run and nothing else, so it is gone for as long as one is
under way, and back the moment it resolves. It goes by `visibility` rather than by
leaving the layout: reflowing the page would resize the canvas at the exact moment the
player has started watching the world, and against a uniform paper background a reserved
gap and an absence look the same. `test:e2e` checks both halves — that the banner goes,
and that the stage does not move a pixel when it does.

It behaves identically in EDITING and after a failure, which is the same rule the
sequencer follows: the death camera names the obstacle, and a banner that changed after a
failure would give away for free that there is something to find. FAILED is also the
phase R exists for, so the banner has to be pressable under the camera. In free play it
retires for good, along with runs themselves.

Progress is saved continuously to `localStorage` and restored on load. A save from an
older build, or a corrupted one, is discarded rather than trusted, so an incompatible
save costs a fresh start and nothing worse.

## Architecture

```
src/
  main.ts            entry, wiring, game loop
  audio/
    context.ts       AudioContext singleton, unlock and stay-alive
    transport.ts     master clock, lookahead scheduler, step events
    drums.ts         synthesized drum voices
    key.ts           the chapter's key, shared by every tonal voice
    cues.ts          failure thud and stage-clear sting
    stems.ts         backing layer loading and playback
  game/
    types.ts
    chapter1.ts      chapter data
    simulate.ts      pure run resolver
    state.ts         state machine
    save.ts          progress persistence and save validation
  ui/
    sequencer.ts     step grid
    controls.ts      run, clear and restart buttons
    stage.ts         canvas renderer
```

`test/reaction.test.ts` pins the obstacle reaction's onset to the moment an obstacle
reaches the launch position; `test/state.test.ts` and `test/save.test.ts` drive the state
machine against a hand-cranked clock from `test/helpers.ts`, covering the run snapshot,
the failure hint, free play and the save round-trip.

Five commitments hold the whole thing up:

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

**The run bar is played from a snapshot.** The outcome being decided in advance is only
half of the guarantee — the performance has to come from the same pattern the decision
did. `RUN_DECISION_LEAD` (300ms) before the run bar, the pattern is frozen, the outcome
simulated from the frozen copy, and the run bar's drum audio and character animations
both read it. The lead is not decoration: the audio scheduler hands out the bar's first
steps 100ms early and step 0's animation starts 144ms early, so deciding at the bar line
would leave a window in which an edit could change an outcome that had already begun
performing. Edits during the count-in still count, and the live pattern is audible again
the moment the run resolves. Without this, removing a note mid-run left the character
running through a pillar on a run that still cleared.

### Reading the stage

By stage 10 there are twenty-one obstacles across one screen. Four systems keep that
readable rather than merely dense.

**Committed notes freeze.** A stage only clears when the placed notes are exactly the
derived solution, so everything on the grid at that moment is known-correct. It greys out
and stops taking input, mirroring the way its obstacle recedes on stage. Each stage then
asks about its own new obstacles and nothing else, instead of re-presenting the whole
pattern. It also means a solved stage can never be broken.

**Rows mirror the stage.** The sequencer's row order is the obstacles' vertical order:
openhat highest, then clap, rim, and kick on the ground, with crash at the top where the
wall's full-height silhouette and a drum kit both put it. A row and the thing it clears
sit at the same height.

**The kit arrives one instrument at a time.** A row is not in the layout at all until a
stage introduces an obstacle that asks for it, so the chapter opens as a single kick lane
and one question. Stage 4's birds bring the open hat in, stage 5's enemies the clap,
stage 8's totems the rim, stage 9's wall the crash. Rows used to be present but greyed
and hatched, which still put five lanes of unanswerable questions on the first screen; an
absent row asks nothing. Arrival is the only transition — once a row has appeared it stays
for the rest of the chapter, whatever the current stage happens to introduce, because the
notes already committed to it keep playing and the obstacles it answers are still out
there.

**There is one small type, not two.** The chapter originally ran a shaker alongside the
open hat. The two sounded too close and their silhouettes read too close at speed, and no
amount of redrawing fixed it, so the shaker was dropped and the open hat took its part —
2, 3, 6, 7, 10, 11, 12, 14 and 15, which is a hat pattern a deep house track would
actually play. The budget table is unchanged: stage 6 places hats where it used to place
shakers, and stage 10's third obstacle became a clap on 14.

**The current stage's obstacles are marked.** Everything this stage introduced wears a
caret and bobs gently, for as long as it is the current stage's business. Tied to the
stage rather than to a timer, so it is still there however long the player takes and gone
the moment it is solved. The bob is a position change and never a size one, because size
is reserved for weight and must never track age.

The announcement swell is deliberately anisotropic: almost all of the punch goes sideways,
where there is nothing to collide with, and the vertical component stays inside the gaps
between bands. A uniform swell large enough to be unmissable also grows each obstacle into
its neighbours' bands, which would break the separation at exactly the moment the player
is looking. `test/bands.test.ts` pins that the bands stay disjoint at the peak of the
swell, including on the five steps of chapter 1 that stack obstacles. The pillar/totem gap
caps the vertical component near 0.15, which is why the horizontal one carries the force.

**Receded does not mean faint.** Older obstacles drop to `RECEDED_ALPHA` and a lighter
ink, and that floor is deliberately high. They are still live hazards — every one will
fail the run if its note goes missing — and by stage 10 eighteen of the twenty-one are
receded, so sinking them near the paper made most of the world look like decoration. They
sit clearly behind the current stage's arrivals and clearly in front of the ground litter.

Once the chapter is cleared there is nothing left to solve, so the character stays on
stage and performs the finished track for good — no exit, no empty stage, and no obstacle
still marked as the current stage's business.

Clearing stage 10 opens **free play**: the obstacles sink back out of the world the way
they rose in, every lock lifts, the budget goes, and runs retire because there is nothing
left to run against. What is left is the finished track as an instrument — the full
backing mix underneath, the player's pattern editable live on top, and the character
performing whatever they make of it.

The two depth systems below stay deliberately independent, so they can never multiply and
bury the oldest small obstacles:

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

The announcement is the loudest thing on the stage, and all of that comes out of
amplitude rather than duration. It has to be finished inside two steps or consecutive
crossings smear into one another, which `test/reaction.test.ts` pins, so instead it
spends everything it can in the fifth of a second it has: a wide sideways swell, a burst
of dust, and — for the fraction of a second it is crossing — a lift out of its own depth
state, up towards foreground ink and full opacity and straight back down. That lift is
why an open hat introduced four stages ago announces exactly as loudly as a pillar placed
this stage, while the depth ordering at rest is left exactly as it was.

**The sky announces too.** The quarter-note clouds cross the launch position on the same
derivation and swell, darken and ride up as they do. They were always the coarse ruler;
this makes them a metronome as well. A player who has not yet found the launch position
can find it by watching the clouds, and every obstacle sitting on a quarter note gets a
second announcement in the sky directly above its own. Nothing shares the sky, so that
swell can be uniform and generous where the obstacles' has to be careful.

The reaction is derived from `stepFloat` rather than fired as an event. An obstacle on
step S is at the launch position exactly when `stepFloat` is S, so how far it is into its
reaction is just the wrapped difference. Nothing is scheduled, it repeats every bar for
free, and it inherits the transport's immunity to drift. `test/reaction.test.ts` pins the
onset to the crossing.

Placing a note also **auditions it**, quietly, at the moment of the click. Waiting for
the playhead to come round is up to two seconds of doubt about what was just committed
to, and hearing the voice on placement is the instrument-to-sound binding the game
exists to teach.

### When a player gets stuck

The sequencer never names the failed step — the stage says *which obstacle*, and working
out *which step* from its position against the quarter-note landmarks is the skill being
taught. That principle needs a floor under it, though, or a player who cannot make the
translation has nothing coming.

After `HINT_AFTER_FAILURES` (3) consecutive failures on one stage, the death camera also
holds the landmarks and the launch patch up out of the dim, drawn at the ground litter's
weight rather than the sky's so they actually read against the dimmed stage. Nothing new
is drawn and no step is named: the ruler that was always there simply stays legible while
the camera holds, and the search narrows from sixteen steps to a position relative to a
visible beat. The streak resets when the stage clears, so the help never outlives the
trouble that earned it.

### Actions

Each obstacle band gets a move that answers it, and no two share an axis, so they stay
distinguishable at a glance even at 121ms apart:

| Instrument | Obstacle | Band | Action |
|---|---|---|---|
| kick | pillar | ground | jump, legs tucked |
| rim | totem | shin | hurdle, lead leg thrown forward |
| clap | enemy | chest | punch, arm and fist driven forward |
| openhat | bird | head | duck, deep crouch with the head pushed down and forward |
| crash | wall | full height | dash, forward lunge with speed lines |

They layer by taking the max of each channel, so a crash and a kick on one step give a
dash-leap. Every deformation is exaggerated well past realism, because a sixteenth at 124
BPM lasts 121ms and a subtle move simply is not seen.

The character exists only for the run, and enters and leaves along the depth axis rather
than across the ground — small, grey and lifted towards the vanishing point, behind the
obstacle layer, resolving to full size and full ink as it reaches the launch position. The
lateral travel is deliberately tiny, because any long slide along the ground reads as
running past the obstacles whichever layer it is drawn on; the apparent size does the
work, on a curve that changes fastest while it is far away.

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

Two moments outside the pattern have voices of their own, in `cues.ts`: a low thud on
collision, scheduled at the exact audio time of the collision step where the missing
drum hit would have been, and a rising triad on a stage clear, scheduled onto the bar
line the flourish begins on. Both are built from the chapter's key in `key.ts`, which
the synthesized backing bed also draws from, so a cue can never land out of key with
what is playing under it. Like the count-in tick they are UI sounds, not instruments,
and can never be sequenced.

The context is also kept alive for the life of the session. Browsers suspend an
`AudioContext` on backgrounding, phone calls and output-device changes, and a suspended
context freezes `currentTime` — which freezes the whole game, since every position
derives from that one clock. `installResume()` watches for the tab returning, the
context announcing its own state change, and any fresh gesture.

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
| 4 | Removing a carried-over note fails at that step | `test/simulate.test.ts` and `test:e2e`, which forces it at stage 10 — the last point before free play unlocks the grid |
| 5 | The budget blocks over-placing | `test:e2e` |
| 6 | Music and scroll never stop, stage 1 to 10 | `test:e2e` monitors the transport for the whole session |
| 7 | `simulate()` is pure and unit tested | `test/simulate.test.ts` |
| 8 | No hitbox or physics code | `grep -rniE "hitbox\|intersect\|collide\|physics\|velocity\|gravity" src/` — the only hits are comments saying there is none, plus `impulse()`'s note that it is ballistic rather than sinusoidal |
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
