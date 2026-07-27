# Sequencing runner — chapter 1 prototype (deep house)

A rhythm puzzle game. You do not control the character. You program a drum pattern
into a step sequencer and that pattern drives every action the character takes.
Obstacles sit on exact sequencer steps: place the right instrument on the right step
and the run clears.

- `GAME_DESIGN.md` — the full design
- `PROTOTYPE_BRIEF.md` — the scope of this prototype

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

`simulate()` is a pure function and carries the unit tests, including a success case,
a failure case and a carried-over-note case.

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

1. Cloudflare dashboard → Workers & Pages → the `sequencing-runner` worker → Settings → Builds
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

**Collision is a table lookup.** There is no hitbox test and no physics anywhere in
this repo. At step N an obstacle either requires instrument I or it does not, and the
pattern at step N either contains I or does not. The run outcome is computed in full
before the animation starts; the animation presents an already-decided result.

The solution to a stage is never authored. It is derived from the obstacle set through
`OBSTACLE_INSTRUMENT`, so a stage is placed obstacles and nothing else. There is no
answer key anywhere in the repo.
