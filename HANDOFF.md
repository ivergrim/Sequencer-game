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

`README.md` is kept current and is the best single description of how the thing actually
works today; it explains the reasoning behind most of the non-obvious decisions.

## Working setup

- **Repo**: `ivergrim/Sequencer-game` on GitHub. Owner: ivergrim (ivergrim@gmail.com).
- **Branches**: **`main` only**, again. It is the default branch and the one that deploys.
  Earlier sessions each developed on a `claude/*` branch and pushed the same commits to
  both, which left a trail of merged duplicates holding nothing; the user deleted all of
  them and consolidated. Work goes to `main`.
  - A session harness may still *designate* a `claude/*` branch to develop on. If it
    does, treat it as a transient mirror of `main`, not a line of work — push the same
    commits to `main` in the same breath, and expect the user to want the mirror gone
    afterwards. Do not leave one behind and do not open a PR unless asked.
  - `claude/chapter1-song-structure-dxtazt` was a real exception to that for one session:
    the user wanted the chapter 1 rebuild kept off `main` while they listened to it and
    iterated. They merged it on 2026-07-29 and the exception is over. The branch is fully
    contained in `main` now and is the user's to delete (see the next bullet). The pattern
    is worth remembering: when a change is a matter of taste rather than correctness, they
    may want it parked on a branch so they can hear or see it before it deploys — ask
    rather than assume, in either direction.
  - **This environment cannot delete a remote branch**, so cleanup falls to the user:
    the git proxy accepts the connection and then hangs up on any delete-ref push
    (`send-pack: unexpected disconnect`, then `Everything up-to-date`), the GitHub MCP
    server exposes `create_branch` but no delete, and there is no `gh` CLI. It is a
    dashboard action: Branches → the trash icon. Do not read that `Everything
    up-to-date` as success; it is the failure.
  - Never delete a remote branch unasked, and check containment before deleting one that
    was asked for: `git merge-base --is-ancestor origin/<branch> origin/main`, plus
    `git log --all --not origin/main` coming back empty.
- **Deploy**: Cloudflare **Workers with static assets** (not Pages). Worker name in
  `wrangler.toml` is `sequencer-game` — this MUST match the worker the user created in
  the dashboard (`sequencer-game.ivergrim.workers.dev`). It was originally
  `sequencing-runner` per the brief and that mismatch broke deploys once; do not rename.
  Workers Builds is connected: **every push to `main` auto-deploys**. So pushing to
  main IS deploying to production.
  - The Workers Builds build command **is** `npm test && npm run build` — the user
    confirmed they set it. A red unit suite therefore fails the build instead of
    deploying, which matters because a push to `main` goes straight to production with
    nothing else in front of it. Keep the unit suite fast and green for that reason, and
    do not assume a push landed just because it was accepted: a failing test now shows up
    as a build that never deployed. `.github/workflows/ci.yml` runs the same checks on
    every branch and pull request as well.
- **This environment**: outbound HTTPS to `workers.dev` is blocked by the sandbox proxy
  (403), so the live site cannot be fetched from here. Verify via local build + browser
  checks, then push; the user checks the live URL.
- Commit style: no model IDs in commits/code; footer is
  `Co-Authored-By: Claude <model name> <noreply@anthropic.com>` plus the Claude-Session
  link. Explanatory, essay-style commit messages; commit and push often (the container
  was recycled mid-task once and only pushed work survived).

## Verification workflow (the user expects this)

```sh
npm test                    # 77 unit tests (vitest)
npx tsc --noEmit            # strict TS, noUnusedLocals etc.
npm run build               # tsc + vite build
npm run dev                 # dev server (use port 5199 for the e2e scripts)
npm run test:e2e            # full 10-stage playthrough, free play, reload
npm run test:e2e:patch1     # patch-1 + later acceptance criteria
npm run test:e2e:arrow      # the per-obstacle stuck arrow, in a real grid
npm run test:e2e:responsive # desktop + phone viewports, touch controls
npm run test:e2e:drift      # 5-minute no-drift proof (run when touching timing)
npm run test:e2e:shots      # stage art captures, for eyeballing
```

- E2e runs against `http://localhost:5199/` (`E2E_URL` to override). In this container:
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers E2E_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
  Node scripts importing playwright must live under the project dir (node_modules
  resolution), not the scratchpad.
- Editing `src/` while the dev server runs hot-reloads the page and **corrupts any e2e
  run in flight** — finish edits first, then run checks.
- Every suite clears `localStorage` before starting. Progress persists now, so without
  that a suite resumes wherever the last one stopped. Any new suite must do the same:
  clear after `goto`, before clicking `#start`.
- The dev-only `window.__debug` handle (in `main.ts`, stripped from builds) exposes
  transport, state, stage renderer, buses, `solution()`, `renderObstacles`, `bands`.
  The e2e suites and all visual-verification scripts depend on it.
- Screenshot-and-look loops (Playwright + Read on the PNG) were used constantly to
  judge visuals; the user also judges from the live build and sends feedback + sometimes
  screenshots. `test/e2e/hint-shot.mjs` is one of these — it drives three consecutive
  failures so the death-camera hint can be eyeballed on both sides of the threshold — and
  `test/e2e/entry-shot.mjs` is another, sampling the character's walk in at eight even
  points across the count-in.

## Architecture (src/)

- `audio/context.ts` — AudioContext singleton, unlock on first gesture, buses:
  drums (0.7) + stems (0.5) → master (0.85) → **limiter** (compressor; stacked voices
  clip without it) → destination. Shared noise buffer. `installResume()` keeps the
  context alive across suspension (visibilitychange / statechange / any gesture) — a
  suspended context freezes `currentTime` and therefore the whole game.
- `audio/transport.ts` — the one clock. 25ms setInterval, 100ms lookahead, hands out
  `StepEvent`s with exact audio times. Position is always derived:
  `stepFloat = (elapsed / stepDuration) % patternLength`. Never accumulate time; never
  use Date.now. `timeOfBar`, `timeOfStep`, `nextBarBoundary` compute from transport
  start absolutely. Background-tab throttling: scheduler skips past-due steps (no burst)
  and resumes in phase; backing can gap in hidden tabs — known, accepted (fix would be
  AudioWorklet, out of scope).
- `audio/drums.ts` — synthesized voices (no samples): kick, clap, openhat, rim, crash.
  Shaker existed and was **removed** (see below). Count-in tick lives here too.
  `triggerDrum` takes an optional level, used by the note audition.
- `audio/key.ts` — the chapter's F-minor pitch set. Every tonal voice (fallback stems,
  cues) draws from here so nothing can land out of key. Becomes per-chapter data when
  chapter 2 arrives.
- `audio/cues.ts` — failure thud (scheduled at the exact collision step time) and
  stage-clear sting (rising tonic triad on the flourish bar line). UI sounds like the
  count-in tick, never sequenceable.
- `audio/stems.ts` — tries `public/stems/<name>.wav`, falls back to synthesized F-minor
  bed. `public/stems/` is empty by design; app must run silent-asset-free. Each bar is
  scheduled as a fresh source at `timeOfBar(n)` — never `AudioBufferSourceNode.loop`.
  - **Nothing in here may sound like a drum**, and this is a correctness rule rather than
    a mixing preference: the player identifies drums by ear, so a percussive backing layer
    is a *false answer* — they hear a tick on a step, assume a note is already there, and
    stop looking. Enforced, not merely intended: `tone` floors every attack at 25ms
    (`MIN_ATTACK`), there is no noise source anywhere in the file, and
    `test/stems.test.ts` fails the build if either changes. Do not add a shaker, a
    percussion loop, or "just a little" filtered noise to the bed, however good it sounds.
- `game/types.ts` — `Instrument = kick|clap|openhat|rim|crash`,
  `ObstacleType = pillar|enemy|bird|totem|wall`, `OBSTACLE_INSTRUMENT` mapping table
  (the only binding between world and sequencer; solutions are always derived, never
  authored — this is a hard design rule, no answer keys anywhere).
- `game/chapter1.ts` — chapter data. 124 BPM, 16 steps, rows top-to-bottom
  `crash, openhat, clap, rim, kick` (mirrors on-stage vertical order). Budgets derived
  (= active obstacle count): 1,2,4,6,8,10,11,12,14,16 — pinned by tests. **Rebuilt** —
  see "The chapter 1 rebuild" below; the old 1,2,4,8,10,14,15,17,18,21 table and the
  double open hat that came with it are gone.
- `game/simulate.ts` — pure resolver, walks steps in order, table lookup. **No hitbox /
  physics code anywhere in the repo** (brief criterion; a grep check was part of
  acceptance).
- `game/save.ts` — localStorage persistence, versioned key, strict validation on load
  (bad/old saves degrade to a fresh start, never a corrupt one). Every storage touch is
  guarded; the game runs identically with storage forbidden, it just forgets.
- `game/state.ts` — phases editing/armed/running/success/failed.
  - **`RUN_DECISION_LEAD` (300ms)**: the pattern is snapshotted and the outcome
    simulated this far *before* the run bar, and the whole run bar (drum audio +
    animations) plays from that snapshot. Not cosmetic — the audio scheduler is 100ms
    ahead and step 0's animation 144ms ahead, so deciding at the bar line let a mid-run
    edit contradict an outcome that had already begun performing. `hitsAt(step, bar)`
    and `laneFor(instrument, bar)` are how callers get the right lane.
  - `DEATH_CAMERA` constants. `failStreak` / `hintActive` drive the stuck-player hint
    (`HINT_AFTER_FAILURES = 3`), reset on stage advance.
  - **Help escalates twice, and the second step is per obstacle.** `obstacleFailures`
    tallies deaths per obstacle — keyed by the cell it demands, since obstacle type →
    instrument is one-to-one — and `ARROW_AFTER_FAILURES = 2` puts a black arrow on that
    cell in the sequencer. Failing once each on three different obstacles earns nothing;
    the tally for everything *before* a collision is cleared on every run, because a run
    that got that far answered them. `arrowCell` is derived per frame from the phase and
    the live pattern (never during running/success/failed, never on a filled cell), so
    filling the cell retires the arrow and emptying it brings the same one back. Not
    persisted: being stuck is a property of the sitting, not of the save.
  - Note locking (`locked` pattern): clearing a stage commits its notes — greyed, inert,
    still audible, Escape spares them. **Completion clears every lock** (free play).
  - Character pose model (`hidden/entering/running/exiting/down`); after `complete` the
    character stays `running` forever.
  - Editing is live in **every** phase (locking the grid during runs would visibly
    change on failure, violating C2).
- `ui/sequencer.ts` — plain DOM grid. Playhead is one element driven by a CSS var from
  stepFloat. **Nothing in the sequencer may change appearance on failure** (patch 1 C2)
  — no flash, no status change (FAILED renders as "editing"), no dimming.
  - The **one** mark that ever appears on the grid is the stuck arrow (`.seq-arrow`,
    `ARROW_AFTER_FAILURES` above), and it is not failure styling: it costs a second death
    on the same obstacle and never lands until the camera has released. One element for
    the life of the page, re-parented into the target cell (which also gets
    `data-hint="true"` and an extended `aria-label`); `syncArrow` compares against what is
    on screen like the rest of the frame loop. `test:e2e:arrow` covers the wiring end to
    end, and `test:e2e:patch1`'s "no cell changes class on failure" checks still hold —
    the arrow changes no classes and shows only after the camera.
  - A locked row is **`display: none`**, not greyed: the kit arrives one instrument at a
    time (kick / stage 4 openhat / 5 clap / 8 rim / 9 crash) and each row's arrival
    animates its height open. `syncUnlocks` only ever adds, so a row that has appeared
    stays for the rest of the chapter. The `.seq-row.locked` class is kept because the
    e2e suites select on it. Anything that wants to click a locked cell has to go via
    `state.toggle` — there is no element to force-click any more.
- `ui/controls.ts` — run / clear / restart buttons, cached DOM writes, buttons blur
  after click (a focused button eats the next Space). Run button hides in free play.
  Restart is two-press and wipes the save (its label swaps, so it has a `.label` span
  like the others — do not put a key chip inside the element whose textContent gets
  replaced).
  - **`#run` is a full-width banner above the canvas**, outside `#controls`; `button()`
    looks it up across the document for that reason. It is the offer of a run: in
    ARMED/RUNNING/SUCCESS it goes `disabled` with `data-live="false"`, which is
    `visibility: hidden` — **not** `display:none`, because leaving the layout would
    resize the canvas mid-run. `test:e2e` pins that the stage's box does not move.
    EDITING and FAILED both show it (nothing outside the stage may reveal a failure, and
    FAILED is what R is for). Free play uses `hidden`, which does leave the layout — that
    one never comes back.
  - The separate `#hints` legend is **deleted**. Each button carries its own `<kbd>`
    chips in a `.keys` span; `@media (pointer: coarse)` hides `.keys`, which is what the
    responsive suite now checks instead of `#hints`. The `click / toggle` hint went with
    it — it named no action, and a non-button in a row of buttons was the thing being
    fixed. Buttons are ≥44px tall on touch, pinned by `test:e2e:responsive`.
- `ui/stage.ts` — canvas renderer, the biggest file (~1100 lines). Key systems:
  - One bar = canvas width; obstacle x = `DINO_X + ((S - stepFloat + L) % L) * cell`,
    drawn twice for seamless wrap. No step grid ever drawn on stage.
  - Draws in **logical units** where the stage is always `STAGE_HEIGHT` tall; a shorter
    canvas scales the whole scene uniformly rather than cropping. Sizing uses
    `getBoundingClientRect` (not clientWidth — integer rounding is visible softness at
    DPR 3) and re-checks every frame, so DPR/zoom/monitor changes are caught.
  - **Weight** (by instrument: size/detail) and **depth** (by recency: opacity/layer)
    are independent axes — never multiply them, size never tracks age.
  - `BANDS`: fixed non-overlapping vertical bands per obstacle type (pillar ground,
    totem shin, enemy chest, bird head; wall full-height behind). Load-bearing: chapter
    stacks up to 3 obstacles per step.
  - Launch position (`DINO_FRACTION = 0.28`, moved from brief's 0.15) marked by a worn
    ground patch (non-scrolling terrain, not a hit line — hit lines are vetoed).
  - Obstacle announcements: derived from stepFloat (`reactionAt`, pure, tested), swell
    is **anisotropic** `SWELL_X 1.15 / SWELL_Y 0.13` — vertical component sized so
    swelled bands stay disjoint (`test/bands.test.ts` pins this; the pillar/totem gap
    caps SWELL_Y near 0.15, so push X, never Y). Dust for grounded types, lateral flicks
    for flyers (rings looked like diagrams — rejected). `REACTION_SECONDS 0.22` is
    **capped by `test/reaction.test.ts`**, which requires the window to be under two
    steps (0.242s at 124 BPM) — emphasis has to be bought in amplitude, not duration.
    `ANNOUNCE_ALPHA_LIFT` lifts a crossing obstacle out of its depth state towards
    foreground ink and full opacity and straight back, so age never changes how loudly
    something announces.
  - The **quarter-note clouds announce too**, off the same `reactionAt`: swell, darken
    towards INK, ride up. Sky has no bands to collide with, so that swell is uniform.
  - Current-stage obstacles wear a caret + bob (position, never size), tied to the
    stage not a timer; receded obstacles at `RECEDED_ALPHA 0.58` / `RECEDED_INK
    #7c7c7c`. That floor is high on purpose — receded obstacles are still live hazards
    and eighteen of twenty-one are receded at stage 10.
  - `removedAt` on a `RenderObstacle` plays the rise animation backwards; free play sets
    it on every obstacle and the frame loop prunes them once gone.
  - Death camera: takes over `replay` (200ms of world time) **before** impact at the
    world's true position and decelerates in (exponent slowmo/replay makes it velocity-
    continuous); never rewinds (the rewind was a visible jerk — traced and fixed).
    Culprit redrawn full-size/full-opacity with a **pulsing red tint** (mixInk breath,
    1.1s period) — the old red ring was rejected as "too on the nose". Tumble settles
    pose channels out instead of zeroing them. With the hint active it also redraws the
    quarter-note scenery at `LIGHT` (not `SOFT` — at sky weight it barely reads over the
    dim) plus the launch patch.
  - Character: `CHAR_SCALE 1.45`. Six→five actions, one pose channel each, layered by
    max, exaggerated hard (a sixteenth is 121ms): kick=jump (legs tucked), rim=hurdle
    (lead leg thrown), clap=punch (arm+fist), openhat=duck (deep crouch, head forward),
    crash=dash (short lunge + speed lines; DASH kept small so it reads as through, not
    past). Entry/exit are **depth**, not traversal: tiny lateral travel
    (`HORIZON_OFFSET 0.07`), scale from `HORIZON_SCALE 0.05` on `depth^1.5` (accelerating,
    the readable half of 1/distance — smoothstep eased off too early and reached full size
    two beats before the run), grey→ink, `HORIZON_LIFT 58` toward the vanishing point,
    drawn **behind** obstacles while distant.
    - The entry takes the **whole count-in**, not a third of it. Standing at the launch
      position before the run bar means unanswered obstacles pass through a character that
      is not running that bar yet; distant, it is behind them and nothing touches it.
      `ENTRY_LEAD_SECONDS = RUN_DECISION_LEAD + 0.06` in `state.ts` is the arrival point,
      and the lead **must exceed `RUN_DECISION_LEAD`** — the decision moves the phase to
      RUNNING, whose pose is `progress: 1`, so a shorter lead does not delay the arrival,
      it truncates it (and `test:e2e:patch1` stops seeing an arrival at all, since it only
      samples while ARMED). `test/state.test.ts` pins both ends.
    - After the first run resolves, the character **never disappears**. It walks back to
      an idle position at `IDLE_DEPTH 0.55` — smaller, grey, drawn behind obstacles — and
      stays there performing the live pattern. `IDLE_LIFT 65` raises it well above the
      depth-based `HORIZON_LIFT` so it sits roughly halfway between the cloud line and the
      ground; the depth formula alone (58 px range) could never reach that high, which is
      why a separate additive lift exists. Scale, ink, and action damping still come from
      `IDLE_DEPTH`; only the vertical position uses the extra lift. The idle character is
      composited behind the entire scene using `destination-over` so that even
      semi-transparent receded obstacles fully occlude it — no bleed-through.
      The next count-in brings it forward from the idle position (no lateral offset —
      both idle and running are at `dinoX`); the deep-horizon entry with its
      `HORIZON_OFFSET` lateral shift is reserved for the very first run. `hasRunOnce` in
      `state.ts` tracks the distinction and `fromIdle` in `StageFrame` tells the renderer
      which path to use. The exit animation after a success also stops at `IDLE_DEPTH`
      (with `IDLE_LIFT`) instead of going all the way to zero.
- `game/actions.ts` — impact-ratio timing (`animationStart = stepTime − duration·impact`;
  audio always fires exactly on the step — animation and audio are decoupled, animations
  are scheduled by the frame loop because leads exceed the audio lookahead). Durations
  tight (0.18–0.28s), `impulse` is **ballistic** (1−phase²), and duration is capped by
  the gap to the nearest same-lane hit **in both directions** (the patch said forward
  only; that provably merges the step-15+step-0 kicks — commit message has the math).

## The chapter 1 rebuild

The user disliked how chapter 1 sounded, singling out "the double hi hat". They were
right and the cause was structural: stage 4 placed open hats on 2, 6, 10, 14 and stage 6
placed four more on 3, 7, 11, 15, so the finished bar asked for two open hats a sixteenth
apart on every offbeat. A step is 121ms at 124 BPM and `openhat` decays over 250ms — the
second hat always began while the first was still ringing. Every source on house drum
programming says the same thing: one open hat per offbeat eighth, and the *closed* hat
fills the 1/16 slots the open hat has not taken. There is no closed hat in this kit, so
the rim now plays that part.

The finished bar is kick 0/4/8/12, openhat 2/6/10/14, clap 4/12, rim 3/7/11/13/15,
crash 0. Sixteen notes; steps 1, 5 and 9 deliberately empty. Full table and reasoning in
`README.md` under "The bar the chapter builds", stage-by-stage comments in
`chapter1.ts`.

Constraints that came with the request and should be treated as standing:

- **Kicks are fixed**: 1 on stage 1, 2 on stage 2, 4 on stage 3. User specified this.
- **Never add too many hits early** — the old build added four obstacles at a time twice
  and had fourteen notes on screen by stage 6. Cap is two per stage, pinned by a test.
- **Ten stages**, still.
- **No drums in the background**, for the reason in the `stems.ts` note above.

Stem names changed wholesale (`bass, bassline, sub, pad, keys, voice, strings, swell,
lead, chords`) — if real loops are ever dropped into `public/stems/`, they must match
these filenames. `PROTOTYPE_BRIEF.md`'s stage table is now historical; it was already
stale.

**The bass opens the track, in three pieces across the three kick stages**, on user
direction after hearing the first version. Three things were wrong with that version and
all three had the same fix:

- The bed opened on a held 43.65Hz sub. Most laptop and phone speakers do not reproduce
  that at all, so the first screen of the game was effectively silent — the user asked
  for "some sound playing already right from the very beginning".
- The bass was not the first instrument in, and they wanted it to be.
- The replacement bassline (two half-bar sustained notes carrying the chord change) was
  flatter than the original. Their words: the old one was "more bouncy and rhythmic and
  arguably better". They were right — the old one was the deep house offbeat donk, short
  notes in the gaps between the kicks, and bounce in this genre comes from being short
  and off the beat.

So the F–Ab–F–C offbeat line is restored verbatim from the pre-rebuild code, split by
step across stages 1 and 2 (layers accumulate rather than replace, so it cannot be split
by pitch), with the sustained sub moved to stage 3 where it reads as the bass filling out
rather than as the opening. Nothing in the bass lands on 0, 4, 8 or 12: a low sound on a
quarter note is the one thing that could be taken for a kick.

The `pulse` layer was deleted in the same pass — it was a mid-range offbeat organ on 2,
6, 10, 14, and once the bass owned those steps from stage 1 it was doubling a part that
was already there. Ten layers still, because `bassline` replaced it.

Knock-on changes worth knowing about:

- The crash row now arrives with **stage 10** rather than stage 9, so its 620ms arrival
  animation can still be in flight during the stage-10 checks. `test:e2e:patch1` waits
  for `.seq-row.unlocking` to clear before it compares sequencer markup across a failure;
  without that wait it fails for the wrong reason.
- Max stack is **two** obstacles on a step (was three). `test/bands.test.ts` and
  `test:e2e:patch1` both pin it.
- `test/save.test.ts` and `test/state.test.ts` used to hardcode `21` for "the whole
  track". Now derived via `noteBudget`, so retuning the chapter cannot quietly make them
  assert something smaller.
- **A rendered-signal test for the no-drums rule does not work** and was tried and thrown
  away. Above the sub — where transients live and where a highpass has to sit, because a
  43.65Hz sub's 22.9ms period swamps any window short enough to resolve an attack — a
  sawtooth's own waveform is a spike train. Every layer, including an 800ms-attack pad,
  measured 50-70% "rise in 5ms". The metric was reading crest factor, not envelope.
  `test/stems.test.ts` checks the gain automation through a stub context instead, which
  tests the actual guarantee and runs in 13ms. Both of its rules were mutation-checked.

## The stuck arrow's placement

User direction after seeing it: "the arrow should be above the sequencer pointing down at
it. Also make it bob up and down to make it visible for the player." It used to sit
centred *inside* the target cell at 11×14px with a ±2px nudge.

It now stands above the cell, 15×19px, bobbing 8px every 0.9s. Three things had to move
with it, and none of them are optional:

- **`.seq-grid` no longer clips its overflow.** An arrow above a top-row cell is above the
  grid, and the clip cut it in half. The clip existed only for the playhead, which runs
  past the right edge on the last step — the playhead now sits in its own
  `.seq-playhead-clip` layer spanning the grid, so its `top/bottom/left/width` are
  unchanged and nothing else is clipped. Do not put `overflow: hidden` back on the grid.
- **`.seq-head`'s bottom padding is the room the arrow stands in** (0.6rem → 1.5rem).
  Reserved permanently rather than made on demand, so the grid never jumps under the
  player's cursor mid-edit. `#stage` has a fixed height clamp, so this does not move the
  canvas.
- **The target cell is outlined dashed** (`.seq-cell[data-hint="true"] .pad`). On a
  one-row grid "above the cell" and "above the sequencer" are the same place, which is
  almost certainly the grid the user was looking at. On a four-row grid they are not: the
  arrow sits in the band of the row *above* its target and, alone, reads as pointing at
  that row — verified by screenshot at stage 7, where it pointed at rim 15 from inside the
  clap row. The outline is what disambiguates it. `data-hint` had no styling at all before
  this, so the arrow was the only cell marker; if the arrow ever moves again, the outline
  is what stops the hint becoming ambiguous.

Worth re-checking with the user: whether they meant above the *whole grid* rather than
above the cell. Above the whole grid would point at a column and nothing else, so the
outline would be doing all the work of naming the cell — which is why it was not chosen,
but it is a one-rule change if they want it.

`test/e2e/arrow.mjs` pins the clearance over the cell, the centring, the outline, that
nothing clips it out of the sequencer, and that it actually travels — the animation is
behaviour here, not decoration.

## Deviations from the written docs (do not "fix" these back)

- Worker name `sequencer-game`, not `sequencing-runner`.
- `DINO_FRACTION` 0.28, not ~0.15.
- **Shaker instrument and pest obstacle are deleted.** Open hat took the whole hat part.
  That over-corrected — see "The chapter 1 rebuild" above — and the hat is now back to
  the offbeat eighths alone, with the rim covering the sixteenths.
- Brief criterion "removing a carried-over note causes a failure" is **unreachable via
  UI** (committed notes are locked). Resolver still behaves that way (unit-tested); the
  e2e suite forces it via `__debug` **at stage 10 before clearing it** — after that,
  free play unlocks the grid and retires runs, so it is the last opportunity.
- FAILED holds for the death camera (~1.6s), not one frame; R during camera cuts it
  short.
- **Runs are gone after chapter completion.** The old behaviour (free play = running
  against the full obstacle set) was replaced on user instruction: the world empties,
  the kit unlocks, the budget lifts. `GAME_DESIGN.md` §13's free-play mode, arrived at
  early.
- Character **hidden before the first run only** (patch 1 B1 superseded). After any run
  resolves it idles in the background at reduced depth, performing the live pattern.
  After chapter completion it stays performing at full size permanently.
- Character size, jump height etc. re-tuned smaller; pillar band grown to 52 for ratio.
- Entry is "out of the screen" depth illusion per explicit user direction, not the
  patch's "enters from off screen left at running speed" (user overrode). It also lasts
  the entire count-in on user direction, so the approach is never over while obstacles are
  still crossing an idle character — patch 1 B2's "in position by step 0" holds, but only
  just, and deliberately.
- Patch 1 C1 says the culprit gets "a highlight ring" — rejected as too on the nose,
  it is a pulsing red tint instead.
- `GAME_DESIGN.md` §10 and the brief's §"Sequencer" both say rows "start greyed out and
  inactive" and unlock in place. **Superseded**: a row that has not arrived is not in the
  layout at all. User direction — five lanes of unanswerable questions on the opening
  screen was the problem being solved, and greying them did not solve it.

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
- `body { min-height: 100% }` needs `html { height: 100% }` or the percentage does not
  resolve and vertical centring silently disappears. Caught only by screenshot.
- Adding persistence broke e2e isolation invisibly until the harness cleared storage.

## User's standing preferences (inferred over many rounds)

- Chrome-dino monochrome idiom: blocky procedural shapes, no effect-layer look (rejected
  circles/rings twice), everything diegetic and subtle-but-legible.
- No rhythm-game hit line, ever. No step grid on stage. No beat numbers on the sequencer
  (explicitly rejected). The stage must teach by ear and by the worn launch patch +
  announcements.
- Readability > realism; animations exaggerated and tight, never floaty.
- They ask for changes in batches, want clarifying questions asked *before* coding when
  scope is genuinely ambiguous (AskUserQuestion), and expect flagged trade-offs when a
  request conflicts with a spec or an earlier acceptance criterion — do the sensible
  thing, then tell them plainly what you decided and why.
- They will happily approve a large batch at once ("go for it to everything") with
  per-item amendments. Work through it in verified, individually pushed chunks.
- Deployment flow is theirs to click; give exact dashboard steps when needed.

## State at handoff

All 119 unit tests green (80 before, plus the chapter, backing-bed and arrow additions);
`test:e2e`, `test:e2e:arrow`, `test:e2e:patch1` and `test:e2e:responsive` green; build and
typecheck clean.

The chapter 1 rebuild, the bass rework and the stuck arrow's placement are **merged to
`main` and therefore deployed**. `claude/chapter1-song-structure-dxtazt` is fully
contained in `main` and is the user's to delete from the dashboard.

Mix reference points from the playthrough suite, useful for judging any future change by
ear: drum bus peaks 1.05, backing bed 0.37, full mix 0.92 after the limiter. At stage 1
the bed peaks at 0.147 with 51% of that surviving a 150Hz highpass, which is the rough
floor of what a laptop speaker reproduces — the old opener was a pure 43.65Hz sine and had
none of that.

The user signed off on the music with "looks good" after the bass rework, so the structure
is settled. What has never been tuned by ear is the balance *between* the ten backing
layers; the gains in `stems.ts` were reasoned about rather than listened to. Two open
questions the user has not been asked yet: whether the rim on 13 and 15 makes the last
beat too busy, and whether the crash arriving only at stage 10 is too late a reveal for
its row.

The last session tuned the idle dino that the session before it introduced. Changes:
the idle character is now composited behind the entire scene using canvas
`destination-over` (previously it bled through semi-transparent receded obstacles); an
`IDLE_LIFT` of 65 px positions it roughly halfway between the cloud line and the ground
(the depth-based `HORIZON_LIFT` range is only 58 px, far too small); entering from idle
no longer applies the `HORIZON_OFFSET` lateral shift (both idle and running sit at
`dinoX`, so the old code caused a visible teleport to the left at the start of the
walk-in); and `IDLE_DEPTH` was raised from 0.28 to 0.55 so the character reads as
present rather than a speck.

The session before that added the idle dino itself: after any run, the character stays
visible in the background at reduced depth, performing the live pattern while the player
edits. Re-entries walk from the idle position to the launch position over the full
count-in. The very first entry still uses the deep-horizon approach.

Two sessions ago was a presentation batch: receded obstacles brought back up out of the
paper, the crossing announcement made much louder (amplitude only — duration and the
vertical swell are both pinned by tests), the quarter-note clouds announcing along with
it, sequencer rows arriving one instrument at a time instead of sitting greyed, the key
hints folded into the buttons that perform them, and run promoted to a banner above the
stage that withdraws while a run is under way.

Open items the user has deferred rather than declined:

- Beat labels above the sequencer — **declined**, do not revisit.

**Deployment:** pushing to `main` IS deploying to production (Workers Builds, see top of
file). If the user reports a change is not visible, **take a screenshot yourself** before
blaming caching — `npx vite --port 5199` serves live source, and the e2e harness at
`test/e2e/harness.mjs` can open it in headless Chromium for a screenshot. In this
session several rounds of small constant tweaks (within the 58 px `HORIZON_LIFT` range)
were genuinely invisible, and misdiagnosing that as a deploy issue wasted time. Always
verify visual changes with a screenshot capture before telling the user the change is
live.

Known accepted limitations: background-tab stem gaps; stems directory empty pending real
loops (drop-in, constraints in README). `ui/stage.ts` is still ~1100 lines and would
split cleanly into character/shapes modules if it grows further.
