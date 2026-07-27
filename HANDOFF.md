# Session handoff — read this first

Context document for continuing work on this repo in a fresh session. Everything below
was true at commit time; verify against the actual code where it matters, since this
file does not auto-update.

## What this project is

A rhythm puzzle game prototype ("sequencing runner", chapter 1, deep house). The player
programs a drum pattern into a step sequencer; the pattern drives every action a
Chrome-dino-style character takes. Obstacles sit on exact sequencer steps. Right
instrument on the right step clears the run; a miss fails it.

Authoritative documents, in order of precedence (later wins on conflict):

1. `GAME_DESIGN.md` — full design vision
2. `PROTOTYPE_BRIEF.md` — prototype scope (stack, audio engine, acceptance criteria)
3. `PATCH_1.md` — post-baseline changes (stage legibility, character behaviour, failure feedback)
4. A long series of user-directed iterations that exist **only in git history and this
   file** — several of them supersede the documents above. See "Deviations" below.

## Working setup

- **Repo**: `ivergrim/Sequencer-game` on GitHub. Owner: ivergrim (ivergrim@gmail.com).
- **Branches**: work is developed on `claude/prototype-brief-review-wg8611` and pushed
  to **both** that branch and `main` (`git push origin HEAD:main`) after each verified
  chunk. The two are kept identical. GitHub's default branch is still the claude branch
  (user never flipped it; harmless).
- **Deploy**: Cloudflare **Workers with static assets** (not Pages). Worker name in
  `wrangler.toml` is `sequencer-game` — this MUST match the worker the user created in
  the dashboard (`sequencer-game.ivergrim.workers.dev`). It was originally
  `sequencing-runner` per the brief and that mismatch broke deploys once; do not rename.
  Workers Builds is connected: **every push to `main` auto-deploys**. So pushing to
  main IS deploying to production.
- **This environment**: outbound HTTPS to `workers.dev` is blocked by the sandbox proxy
  (403), so the live site cannot be fetched from here. Verify via local build + browser
  checks, then push; the user checks the live URL.
- Commit style: no model IDs in commits/code; footer is
  `Co-Authored-By: Claude <model name> <noreply@anthropic.com>` plus the Claude-Session
  link. Explanatory, essay-style commit messages; commit and push often (the container
  was recycled mid-task once and only pushed work survived).

## Verification workflow (the user expects this)

```sh
npm test                    # 52 unit tests (vitest)
npx tsc --noEmit            # strict TS, noUnusedLocals etc.
npm run build               # tsc + vite build
npm run dev                 # dev server (use port 5199 for the e2e scripts)
npm run test:e2e            # full 10-stage playthrough in real Chromium
npm run test:e2e:patch1     # patch-1 + later acceptance criteria
npm run test:e2e:drift      # 5-minute no-drift proof (run when touching timing)
```

- E2e runs against `http://localhost:5199/` (`E2E_URL` to override). In this container:
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
  Node scripts importing playwright must live under the project dir (node_modules
  resolution), not the scratchpad.
- Editing `src/` while the dev server runs hot-reloads the page and **corrupts any e2e
  run in flight** — finish edits first, then run checks.
- The dev-only `window.__debug` handle (in `main.ts`, stripped from builds) exposes
  transport, state, stage renderer, buses, `solution()`, `renderObstacles`, `bands`.
  The e2e suites and all visual-verification scripts depend on it.
- Screenshot-and-look loops (Playwright + Read on the PNG) were used constantly to
  judge visuals; the user also judges from the live build and sends feedback + sometimes
  screenshots.

## Architecture (src/)

- `audio/context.ts` — AudioContext singleton, unlock on first gesture, buses:
  drums (0.7) + stems (0.5) → master (0.85) → **limiter** (compressor; stacked voices
  clip without it) → destination. Shared noise buffer.
- `audio/transport.ts` — the one clock. 25ms setInterval, 100ms lookahead, hands out
  `StepEvent`s with exact audio times. Position is always derived:
  `stepFloat = (elapsed / stepDuration) % patternLength`. Never accumulate time; never
  use Date.now. `timeOfBar`, `timeOfStep`, `nextBarBoundary` compute from transport
  start absolutely. Background-tab throttling: scheduler skips past-due steps (no burst)
  and resumes in phase; backing can gap in hidden tabs — known, accepted (fix would be
  AudioWorklet, out of scope).
- `audio/drums.ts` — synthesized voices (no samples): kick, clap, openhat, rim, crash.
  Shaker existed and was **removed** (see below). Count-in tick lives here too.
- `audio/stems.ts` — tries `public/stems/<name>.wav`, falls back to synthesized F-minor
  bed. `public/stems/` is empty by design; app must run silent-asset-free. Each bar is
  scheduled as a fresh source at `timeOfBar(n)` — never `AudioBufferSourceNode.loop`.
- `game/types.ts` — `Instrument = kick|clap|openhat|rim|crash`,
  `ObstacleType = pillar|enemy|bird|totem|wall`, `OBSTACLE_INSTRUMENT` mapping table
  (the only binding between world and sequencer; solutions are always derived, never
  authored — this is a hard design rule, no answer keys anywhere).
- `game/chapter1.ts` — chapter data. 124 BPM, 16 steps, rows top-to-bottom
  `crash, openhat, clap, rim, kick` (mirrors on-stage vertical order). Budgets derived
  (= active obstacle count): 1,2,4,8,10,14,15,17,18,21 — pinned by tests.
- `game/simulate.ts` — pure resolver, walks steps in order, table lookup. **No hitbox /
  physics code anywhere in the repo** (brief criterion; a grep check was part of
  acceptance).
- `game/state.ts` — phases editing/armed/running/success/failed. Outcome precomputed
  before the run animates. `DEATH_CAMERA` constants. Note locking (`locked` pattern):
  clearing a stage commits its notes — greyed, inert, still audible, Escape spares them.
  Character pose model (`hidden/entering/running/exiting/down`); after `complete` the
  character stays `running` forever. Editing is live in **every** phase (locking the
  grid during runs would visibly change on failure, violating C2).
- `ui/sequencer.ts` — plain DOM grid. Playhead is one element driven by a CSS var from
  stepFloat. **Nothing in the sequencer may change appearance on failure** (patch 1 C2)
  — no flash, no status change (FAILED renders as "editing"), no dimming.
- `ui/stage.ts` — canvas renderer, the biggest file. Key systems:
  - One bar = canvas width; obstacle x = `DINO_X + ((S - stepFloat + L) % L) * cell`,
    drawn twice for seamless wrap. No step grid ever drawn on stage.
  - **Weight** (by instrument: size/detail) and **depth** (by recency: opacity/layer)
    are independent axes — never multiply them, size never tracks age.
  - `BANDS`: fixed non-overlapping vertical bands per obstacle type (pillar ground,
    totem shin, enemy chest, bird head; wall full-height behind). Load-bearing: chapter
    stacks up to 3 obstacles per step.
  - Launch position (`DINO_FRACTION = 0.28`, moved from brief's 0.15) marked by a worn
    ground patch (non-scrolling terrain, not a hit line — hit lines are vetoed).
  - Obstacle announcements: derived from stepFloat (`reactionAt`, pure, tested), swell
    is **anisotropic** `SWELL_X 0.75 / SWELL_Y 0.12` — vertical component sized so
    swelled bands stay disjoint (`test/bands.test.ts` pins this). Dust for grounded
    types, lateral flicks for flyers (rings looked like diagrams — rejected).
  - Current-stage obstacles wear a caret + bob (position, never size), tied to the
    stage not a timer; receded obstacles at alpha 0.26 / lighter ink.
  - Death camera: takes over `replay` (200ms of world time) **before** impact at the
    world's true position and decelerates in (exponent slowmo/replay makes it velocity-
    continuous); never rewinds (the rewind was a visible jerk — traced and fixed).
    Culprit redrawn full-size/full-opacity with a **pulsing red tint** (mixInk breath,
    1.1s period) — the old red ring was rejected as "too on the nose". Tumble settles
    pose channels out instead of zeroing them.
  - Character: `CHAR_SCALE 1.45`. Six→five actions, one pose channel each, layered by
    max, exaggerated hard (a sixteenth is 121ms): kick=jump (legs tucked), rim=hurdle
    (lead leg thrown), clap=punch (arm+fist), openhat=duck (deep crouch, head forward),
    crash=dash (short lunge + speed lines; DASH kept small so it reads as through, not
    past). Entry/exit are **depth**, not traversal: tiny lateral travel
    (`HORIZON_OFFSET 0.07`), smoothstep scale from `HORIZON_SCALE 0.12`, grey→ink,
    lifted toward vanishing point, drawn **behind** obstacles while distant, fast
    (`ENTRY_FRACTION 0.32` of the count-in bar).
- `game/actions.ts` — impact-ratio timing (`animationStart = stepTime − duration·impact`;
  audio always fires exactly on the step — animation and audio are decoupled, animations
  are scheduled by the frame loop because leads exceed the audio lookahead). Durations
  tight (0.18–0.28s), `impulse` is **ballistic** (1−phase²), and duration is capped by
  the gap to the nearest same-lane hit **in both directions** (the patch said forward
  only; that provably merges the step-15+step-0 kicks — commit message has the math).

## Deviations from the written docs (do not "fix" these back)

- Worker name `sequencer-game`, not `sequencing-runner`.
- `DINO_FRACTION` 0.28, not ~0.15.
- **Shaker instrument and pest obstacle are deleted.** Open hat took the whole hat part
  (2,3,6,7,10,11,12,14,15). Stage 6 places birds; stage 10 is bird 12 / totem 13 /
  **clap 14** (a bird on 14 would collide with stage 4's and break the exact-budget
  single-solution property — verified before changing). Budget table unchanged.
- Brief criterion "removing a carried-over note causes a failure" is **unreachable via
  UI** now (committed notes are locked). Resolver still behaves that way (unit-tested);
  e2e suites force it via `__debug` to exercise the death camera.
- FAILED holds for the death camera (~1.6s), not one frame; R during camera cuts it
  short. Run is allowed after chapter completion (free play against full obstacle set).
- Character absent during EDITING (patch 1 B1) **except** after chapter completion,
  where it stays performing the finished track permanently.
- Character size, jump height etc. re-tuned smaller; pillar band grown to 52 for ratio.
- Entry is "out of the screen" depth illusion per explicit user direction, not the
  patch's "enters from off screen left at running speed" (user overrode).

## Things that bit us (avoid repeating)

- Playwright in this container: use the executablePath above; `npx playwright install`
  is forbidden/unnecessary. Headless Chromium needs
  `--autoplay-policy=no-user-gesture-required --mute-audio`; audio clock advances fine.
- `pointer-events:none` cells make Playwright `click()` hang — use `{ force: true }`
  or assert via evaluate.
- Committed notes broken via `__debug` can't be restored through the UI; restore them
  the same way before continuing a playthrough.
- Container recycling wiped the working tree once mid-task. Push early.
- Vite config: tests import `defineConfig` from `vitest/config`.
- A uniform announcement swell >~1.14× vertically breaks band separation — that's why
  the swell is anisotropic and `test/bands.test.ts` exists.
- Two e2e assertions were once wrong rather than the app (frame-skew comparison; asserting
  completion before it happened). When a check fails, decide honestly which side is wrong.

## User's standing preferences (inferred over many rounds)

- Chrome-dino monochrome idiom: blocky procedural shapes, no effect-layer look (rejected
  circles/rings twice), everything diegetic and subtle-but-legible.
- No rhythm-game hit line, ever. No step grid on stage. The stage must teach by ear and
  by the worn launch patch + announcements.
- Readability > realism; animations exaggerated and tight, never floaty.
- They ask for changes in batches, want clarifying questions asked *before* coding when
  scope is genuinely ambiguous (AskUserQuestion), and expect flagged trade-offs when a
  request conflicts with a spec or an earlier acceptance criterion — do the sensible
  thing, then tell them plainly what you decided and why.
- Deployment flow is theirs to click; give exact dashboard steps when needed.

## State at handoff

All 52 unit tests, `test:e2e` and `test:e2e:patch1` green; build clean; latest work
pushed to both branches (HEAD = "Punch up the announcement swell and keep the dino for
the finished track"). Drift check last run several commits ago — rerun it if you touch
transport, scheduling, or anything in the frame loop's timing path.

No open TODOs from the user at handoff. Known accepted limitations: background-tab
stem gaps; stems directory empty pending real loops (drop-in, constraints in README).
