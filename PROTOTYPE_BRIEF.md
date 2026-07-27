# Build brief: sequencing runner prototype (chapter 1, deep house)

Build a working prototype of a rhythm puzzle game. The player does not control the character directly. They program a drum pattern into a step sequencer, and that pattern drives every action the character takes. Obstacles in the scrolling world sit on exact sequencer steps. Place the right instrument on the right step and the run clears. Miss one and the run fails.

Visual target for this prototype is the Chrome offline dinosaur game. Placeholder art only, drawn procedurally on canvas. No asset pipeline.

Read `GAME_DESIGN.md` alongside this brief for the full design. This document is the prototype scope.

## Stack

- TypeScript, Vite, no framework
- Canvas 2D for the stage
- Plain DOM for the sequencer
- Web Audio API directly, no audio libraries
- No game engine, no physics engine

## Project structure

```
src/
  main.ts            entry, wiring, game state machine
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
public/
  stems/             optional wav files, app must run without them
  _headers           cache headers, served as-is
wrangler.toml
.nvmrc
.gitignore
README.md
GAME_DESIGN.md
PROTOTYPE_BRIEF.md
```

## Audio engine

This is the part that must be right. Everything else is replaceable.

**One clock.** `AudioContext.currentTime` is the only source of truth. Nothing anywhere in the codebase accumulates time in a `requestAnimationFrame` loop or uses `Date.now()` for anything that affects position or timing.

**Lookahead scheduler.** A `setInterval` running every 25ms looks ahead 100ms and schedules any step events falling in that window against the audio clock. Do not fire audio from the render loop.

**Derived position.** The renderer computes, every frame:

```
elapsed   = audioCtx.currentTime - transportStart
stepFloat = (elapsed / stepDuration) % patternLength
```

Playhead position, obstacle positions and character position all derive from `stepFloat`. `stepDuration = 60 / bpm / 4`.

**Drum voices, synthesized.** No samples. Build these in `drums.ts`:

| Voice | Synthesis |
|---|---|
| kick | Sine oscillator, frequency 150Hz to 45Hz exponential over 120ms, gain envelope to near zero over 250ms |
| clap | Bandpassed white noise around 1.2kHz, three 8ms bursts 12ms apart, then a 120ms tail |
| open hat | Highpassed white noise above 7kHz, 250ms decay |
| shaker | Bandpassed noise around 6kHz, 50ms decay |
| rim | 20ms noise click plus a short triangle blip around 800Hz |
| crash | Highpassed noise above 4kHz, 1.5s decay |

**Backing layers.** `stems.ts` attempts to load `public/stems/<name>.wav` for each layer. If the file is absent, it falls back to a synthesized substitute so the prototype runs with an empty `public/stems/` directory. The fallback bed is minimal: a bass note on each quarter note and a filtered chord stab on each offbeat eighth, in F minor.

Layers must be sample-accurate loops of exactly one bar at chapter tempo, started against the audio clock at a bar boundary, not with a bare `.play()`.

## Data

```ts
type Instrument = 'kick' | 'clap' | 'openhat' | 'shaker' | 'rim' | 'crash';
type ObstacleType = 'pillar' | 'enemy' | 'bird' | 'pest' | 'totem' | 'wall';

const OBSTACLE_INSTRUMENT: Record<ObstacleType, Instrument> = {
  pillar: 'kick',
  enemy:  'clap',
  bird:   'openhat',
  pest:   'shaker',
  totem:  'rim',
  wall:   'crash',
};

interface Obstacle { step: number; type: ObstacleType }

interface Stage {
  id: number;
  label: string;
  obstacles: Obstacle[];   // added by this stage, on top of all previous stages
  stem: string | null;     // backing layer entering with this stage
}

interface Chapter {
  name: string;
  bpm: number;
  patternLength: number;
  rows: Instrument[];      // display order in the sequencer
  stages: Stage[];
}
```

Steps are zero indexed. Step 0 is the downbeat. Four on the floor is 0, 4, 8, 12.

**Chapter 1 data.** Tempo 124, pattern length 16, rows in this order: kick, clap, openhat, shaker, rim, crash.

| Stage | Label | Obstacles added | Stem |
|---|---|---|---|
| 1 | The downbeat | pillar 0 | bass |
| 2 | Half bar | pillar 8 | sub |
| 3 | Four on the floor | pillar 4, pillar 12 | bassline |
| 4 | The offbeat | bird 2, 6, 10, 14 | pad |
| 5 | Backbeat | enemy 4, enemy 12 | stab |
| 6 | Sixteenth lift | pest 3, 7, 11, 15 | chop |
| 7 | Pickup | pillar 15 | sweep |
| 8 | Offbeat percussion | totem 6, totem 14 | pad2 |
| 9 | Accent | wall 0 | chords |
| 10 | Turnaround | bird 12, totem 13, pest 14 | lead |

Obstacles accumulate. The obstacle set active at stage N is the union of stages 1 through N.

**The solution is never authored.** It is derived: for every active obstacle at step S of type T, `OBSTACLE_INSTRUMENT[T]` must be on at step S. Never store a separate answer key.

## Note budget

Each stage grants a total note budget equal to the number of active obstacles. Notes the player has already placed count against it. Attempting to place a note with zero remaining is rejected with a brief shake on the budget display.

Budget by stage: 1, 2, 4, 8, 10, 14, 15, 17, 18, 21.

Since misses fail and the budget is exact, each stage has exactly one solution, but placing a wrong note is never punished with a failure. The player simply cannot afford both the wrong note and the right one.

## Sequencer UI

- Rows are the chapter's instruments in the declared order.
- A row is locked and greyed until a stage introduces an obstacle mapping to it. On unlock the row animates in.
- 16 columns. Click a cell to toggle. Quarter note columns (0, 4, 8, 12) get slightly stronger column separators.
- A playhead highlight sweeps the columns, driven by `stepFloat`.
- Budget shown as `used / total`.
- Edits are live. Toggling a cell changes what is audible on the very next pass. There is no apply step.

## Stage renderer

- One bar occupies exactly the canvas width, so the world loop wraps seamlessly at the bar line.
- The character sits at a fixed x, roughly 15% from the left. The world scrolls right to left past it.
- Obstacle at step S is drawn at `x = DINO_X + ((S - stepFloat + patternLength) % patternLength) * (width / patternLength)`, wrapped so it draws again one screen to the right for continuity.
- The stage never draws the step grid. No tick marks, no lanes, no step numbers.
- Draw repeating background scenery at quarter note intervals only, four elements per bar. It reads as parallax scenery and functions as a coarse ruler. Never place scenery on sixteenths.
- Obstacle shapes: pillar is a ground cactus, enemy is a chest-height blob, bird is a small flyer at head height, pest is a small low flyer, totem is a short ground post, wall is a tall cracked barrier.
- Character actions: kick jumps, clap punches, openhat and shaker do a small dodge, rim does a small dodge variant, crash dashes. **Actions layer.** Two instruments on the same step produce a combined move, for example a dash-leap for crash plus kick. Small dodges must be readable when they occur on many steps in a row, so keep them cheap and non-interrupting.

## Simulation

```ts
type Result =
  | { ok: true }
  | { ok: false; failStep: number; missing: Instrument };

function simulate(
  obstacles: Obstacle[],
  pattern: Record<Instrument, boolean[]>,
  patternLength: number
): Result
```

Walk steps 0 to patternLength - 1 in order. For each active obstacle at that step, if the mapped instrument is not on, return a failure at that step. Otherwise return success.

There is no hitbox test anywhere in the codebase. Collision is a table lookup.

The result is computed in full **before** the run animates. The animation presents an already-decided outcome. This must be a pure function with unit tests.

## State machine

The world scroll, the backing layers and the player's pattern are always running and always audible. There is no silence and no scene reload at any point between stage 1 and stage 10.

- **EDITING.** World scrolls, music plays, pattern is audible, cells are editable. Obstacles scroll past the character's position, so the player can hear their own hits land against them before committing.
- **ARMED.** Player pressed Run. Wait for `stepFloat` to wrap to 0. Show a one bar count-in.
- **RUNNING.** The character executes the pattern for one full pass. At each step, trigger the actions for the hits on that step. If the precomputed result is a failure, stop at `failStep`.
- **SUCCESS.** Short flourish, character exits to the right. On the next bar line, the next stage's obstacles rise into the world and the next stem enters. Return to EDITING.
- **FAILED.** Character stumbles. A marker stays on the ground at the point of collision. The corresponding sequencer cell flashes. Return to EDITING immediately.

No modal dialogs anywhere in this loop.

## Controls

- Click a cell to toggle
- Space to run
- R to retry
- Escape to clear all unlocked, currently editable notes

## Audio assets

The prototype must run with `public/stems/` empty. Real audio is a drop-in later.

When swapping in real loops, the hard constraint is that every layer must be an exact one bar loop at the chapter tempo, with no leading silence and no tail past the bar. Anything needing time-stretching will drift. Pick the chapter tempo to match whatever loops get used rather than forcing loops to match 124.

**Never use MP3 for the loops.** Encoder padding adds silence at the head and tail, which breaks gapless looping and puts the backing permanently out of phase with the sequencer. Use WAV, or Opus in WebM if delivery size becomes a problem.

Do not rely on `AudioBufferSourceNode.loop`. A bar at an arbitrary tempo is not a whole number of samples, so a self-looping buffer accumulates error. Schedule each bar as a fresh source at a start time computed absolutely from the transport start. Sub-sample error at each bar boundary is inaudible and never accumulates.

Loop files are small enough that they belong in the repo directly. A one bar loop at 124 BPM is under two seconds, roughly 340KB as 16-bit stereo WAV. Ten stems is about 3.5MB. No git-lfs needed.

Sources worth pulling from, all royalty free:

- **Ghosthack free deep house pack.** <cite index="55-1">49 wav files at 50MB, containing atmosphere, bass, drum, melodic, percussion and synth loops plus one shot claps, hi-hats, kicks, percussion, rides and snares, royalty free for commercial use.</cite> The layer categories map almost directly onto the stem list above. Best single starting point. https://www.ghosthack.de/free_sample_packs/free-deep-house-samples
- **Looperman.** <cite index="56-1">Free deep house loops uploaded by users for commercial and non-commercial royalty free use subject to their terms, tagged with BPM and key.</cite> Around 477 in the deep house tag. Filter by a single BPM and key so the layers stack. https://www.looperman.com/loops/tags/free-deep-house-loops-samples-sounds-wavs-download
- **Samplephonics free deep house.** <cite index="58-1">Free deep house samples and loops, stabs, drum loops and basslines, royalty free.</cite> https://www.samplephonics.com/products/free/deep-house

Using royalty free sources costs nothing extra here and means nothing has to be torn out later when the prototype becomes the real thing.

## Repo and deployment

Everything lives in one git repo, deployed to Cloudflare. Initialise the repo as the first commit, before any application code.

**Target Workers with static assets, not Pages.** Workers reached feature parity with Pages for static assets and custom domains, and it is Cloudflare's recommended path for new projects. Static asset requests are free on both, so there is no cost difference. Choosing Workers now means saved progress, shared pattern URLs or a leaderboard can bind KV or D1 in the same project later instead of forcing a migration.

Setup steps:

1. `git init`, with a `.gitignore` covering `node_modules`, `dist`, `.wrangler` and `.DS_Store`
2. `.nvmrc` pinning the Node version
3. `wrangler.toml` at repo root:

```toml
name = "sequencing-runner"
compatibility_date = "2026-07-27"

[assets]
directory = "./dist"
not_found_handling = "single-page-application"
```

4. `npm run build` produces `dist`. `npx wrangler deploy` publishes it.
5. Connect Workers Builds to the GitHub repo so pushes to `main` deploy automatically and other branches get preview URLs. Preview URLs are useful for trying alternative stage layouts without touching the live build.
6. `public/_headers`, supported natively by Workers static assets:

```
/assets/*
  Cache-Control: public, max-age=31536000, immutable

/stems/*
  Cache-Control: public, max-age=300
```

Vite emits content-hashed filenames under `/assets`, so those are safe to cache forever. Stems get a short TTL because they will churn while the music is being produced.

`README.md` documents local dev, build, deploy, and the fact that the app runs with `public/stems/` empty.

## Acceptance criteria

1. The app runs and makes sound with `public/stems/` empty.
2. No drift. Leave it running five minutes, then confirm an obstacle still crosses the character exactly on its step and the sequencer playhead still lines up with the audible hits.
3. Stage 3 is clearable only by kick on steps 0, 4, 8 and 12.
4. Removing a carried-over note causes a failure at that step on the next run.
5. The budget blocks placing more notes than the active obstacle count.
6. Music and world scroll never stop from stage 1 through stage 10, including through failures and stage transitions.
7. `simulate()` is pure and unit tested, including a failure case, a success case and a carried-over-note case.
8. No hitbox or physics collision code exists anywhere in the repo.
9. `npx wrangler deploy` produces a working live URL, and audio starts correctly there after the first user gesture.
10. A push to `main` triggers a deploy without manual steps.

## Out of scope

Swing, ratchets, velocity, multi-bar patterns, chapter 2, menus, save and load, real art, mobile layout, pattern export.
