# Sequencing Runner: Game Design Document

## 1. Concept

A side-scrolling runner where the player does not control the character directly. Instead, the player programs a drum pattern into a step sequencer, and that pattern drives every action the character takes.

Obstacles in the world sit on exact sequencer steps. To clear an obstacle you must place the correct instrument on the correct step. Get it right and the run succeeds. Miss one and the run ends.

Each chapter is a musical genre. Working through a chapter's stages builds up a complete drum pattern in that genre, layered over an instrumental that grows with it. By the end of a chapter the player has produced a finished track and learned how that genre's drums are constructed.

**Design pillars**

1. Teach real genre drum programming through play, not through tutorials.
2. Every chapter ends with a track the player built.
3. Failure is instant to retry and never ambiguous about what went wrong.
4. The music is the interface. Alignment is something you hear before you see.

## 2. The two components

The screen is split into a **stage** and a **sequencer**.

**Stage.** A side-scrolling world. The character sits at a fixed horizontal position near the left. The world scrolls right to left past it in a seamless loop. One screen width equals one bar of the pattern, so the loop wraps exactly on the bar line.

**Sequencer.** A standard step grid. Instrument rows down the side, steps across. Click a cell to place a hit. A playhead sweeps in time with the world.

The stage is divided into the same steps as the sequencer, but **the stage never displays that grid**. There are no tick marks, no lanes, no step numbers. The player has to find the placement musically rather than copying it visually.

## 3. Grid and timing

- Default pattern length is **16 steps**, one bar of 16th notes in 4/4.
- Pattern length is a per-chapter property. Chapters that need more room can use 32 or 64 steps.
- Tempo is a per-chapter property.
- One screen width always equals one bar, regardless of pattern length. A 32 step pattern scrolls across two screens.

16 steps is the baseline because everything worth teaching lives on a 16th grid. Four on the floor is steps 1, 5, 9 and 13. Backbeat is 5 and 13. Offbeats are 3, 7, 11 and 15.

## 4. Instruments and actions

Each instrument row maps to one physical action.

| Instrument | Action |
|---|---|
| Kick | Jump |
| Snare / clap | Punch |
| Crash | Dash |
| Hi-hat | Small dodge |
| Percussion | Small dodge variant |

**All actions are layerable.** Two instruments on the same step produce a combined move, for example a dash-leap when a crash and a kick land together. This is required, because in most genres a crash sits on a downbeat alongside a kick. Small dodges layer freely on top of any large action, so dense hi-hat patterns read as continuous motion rather than sixteen separate animations per bar.

The vocabulary is extensible. New chapters can introduce new instruments with new actions, and existing instruments can gain variants such as an open hat producing a longer version of the closed hat's motion.

## 5. Obstacles and solutions

An obstacle is defined by two things: the **step** it occupies and its **type**. Each type maps to exactly one instrument.

The correct pattern is never authored separately. It is derived:

> For every obstacle at step N of type T, the instrument bound to T must be on at step N.

This means designing a stage means placing obstacles and nothing else. The solution falls out automatically, and it is impossible for the authored solution to drift out of sync with the authored world.

**Misses fail.** If a required instrument is absent at a required step, the run ends there.

**Extra hits are harmless.** Placing an instrument where no obstacle requires it causes no failure. It just produces a wasted action and a note that does not belong in the groove.

## 6. Note budget

Because extra hits are harmless, there must be something preventing the player from filling every cell and clearing every stage by brute force. That is the note budget.

Each stage grants a number of notes exactly equal to the number of hits the current obstacle set requires. Notes already committed in earlier stages stay committed and count against the running total. Placing a note beyond the budget is blocked.

The result is that a stage has exactly one solution, but arriving at a wrong placement is never punished with a failure state. You simply cannot afford both the wrong note and the right one. The budget also carries an implicit lesson: it tells the player how many hits the groove contains before they place any of them.

## 7. Continuous world

A chapter is a single continuous scrolling world and a single continuous music session. There is no level loading, no scene transition and no silence between stages.

- Obstacles **accumulate**. A pillar introduced in stage 1 is still there in stage 8.
- Backing stems **accumulate**. Each stage adds another layer of the instrumental.
- The pattern the player has built **carries over**. Later stages are additive edits to the same pattern.

By the end of a chapter, the world contains every obstacle introduced, the instrumental is complete, and the sequencer holds a full drum pattern for the genre.

## 8. Run flow

The backing loop, the world scroll and the player's current pattern are **always running and always audible**. Editing is live: toggling a cell changes what you hear on the very next pass.

This is what makes an invisible grid fair. While editing, the player watches obstacles scroll past the character's launch point and hears their own pattern against them. Alignment is verifiable by ear before committing.

**Run.** The player presses run. The character syncs in at the next beat 1 and performs one full pass of the pattern.

**Success.** A short flourish, then the character exits. The music and the world keep running without interruption. At the following bar line, the next stage's obstacles rise into the world and the next backing stem enters.

**Failure.** The character collides and the take ends. The world keeps scrolling and the music keeps playing. A marker stays on the ground at the point of collision, and the corresponding step in the sequencer flashes. Retry is a single input and syncs in at the next beat 1.

There are no modal dialogs anywhere in this loop.

## 9. Legibility of the invisible grid

Four systems make placement solvable without ever drawing the grid on the stage:

1. **Live editing against a running loop.** The player hears their hits land against the obstacle as it passes.
2. **Sync.** The world scroll is locked to the audio clock, so an obstacle reaching the launch point is always exactly on its step.
3. **Scenery landmarks on quarter notes.** Background elements repeat every four steps. They read as parallax scenery and function as a coarse ruler. Sixteenths are never marked.
4. **Graduated density.** Early stages place obstacles on quarter notes only. Eighths, sixteenths and syncopation arrive once the player has built up feel.

## 10. Row unlocking

Sequencer rows start greyed out and inactive. When a new obstacle type first appears in the world, its row unlocks and draws attention to itself, carrying the new budget.

The player therefore never has to guess *which* instrument an obstacle wants, only *where* it goes. Difficulty can be raised in later chapters by unlocking two rows at once, without changing any underlying mechanic.

## 11. Chapters

One genre per chapter. Roughly ten stages per chapter, adjustable.

A chapter defines:

- Tempo
- Pattern length
- The set of instrument rows available and the order they unlock in
- The backing stems and the order they enter in
- The ordered list of obstacle additions per stage

**Chapter 1 is deep house. Chapter 2 is drum and bass.** Further chapters are open. Specific obstacle layouts and stage-by-stage content are decided during authoring, not fixed here.

Difficulty across chapters escalates through tempo, pattern length, finer subdivisions, more simultaneous unlocks, and new mechanics rather than through tighter execution demands. The sequencer is quantized, so there is no timing skill to grind. The challenge is always compositional.

## 12. Mechanics held for later chapters

Candidates, none committed:

- **Swing / shuffle.** A global swing control. Obstacles placed off the straight grid become reachable only with swing engaged. A direct way to teach pocket.
- **Ratchets.** A single step subdivided into two or three rapid hits, mapped to a multi-hit action. Teaches hi-hat rolls.
- **Multi-bar patterns.** 32 and 64 step patterns for genres whose phrases do not fit in one bar.
- **Accent and velocity.** A second intensity level per hit, mapped to a stronger action against tougher obstacles. Teaches ghost notes and dynamics.
- **Obstacle fields.** A hazard spanning several consecutive steps, requiring a sustained subdivision rather than a single hit.
- **Fills and turnarounds.** A final-beat gauntlet that only clears with a fill.

## 13. Progression and persistence

- Progress is tracked per chapter and per stage.
- The player's pattern is saved continuously.
- Completing a chapter unlocks the finished track, playable in full.
- Patterns should be exportable, as MIDI at minimum and ideally as audio, so the player leaves with something they made.

A free-play mode with the full instrument set and no obstacles is a natural companion once the chapters exist, letting the player use what they have learned without a puzzle attached.

## 14. Technical principles

These are architectural commitments. Specific engines, frameworks and libraries are deliberately left open.

**The audio clock is the master clock.** All world position, playhead position and animation timing derive from audio time. Nothing derives position from an independent frame counter or accumulator. Visual drift against the music is the one bug the whole design cannot tolerate.

**Scheduling uses lookahead.** Audio events are scheduled ahead of time against the audio clock rather than fired from a frame loop.

**Collision is logical, not physical.** There is no hitbox intersection test. At step N there either is or is not an obstacle requiring instrument I, and the player's pattern at step N either contains I or does not. This makes every outcome deterministic, exactly reproducible, and unit testable, and it removes any possibility of a run failing because of a dropped frame.

**Outcomes are computed before they are animated.** Given an obstacle set and a player pattern, the result of a run is a pure function: pass, or fail at step N. The animation presents an already-known result. This guarantees that what the player sees always matches what the rules decided.

**Content is data, not code.** Chapters, stages and obstacles are declarative data. Adding a stage means adding obstacle entries, never writing new logic.

## 15. Audio design

Backing music is stem-based, so layers can enter and stack across stages. Stems must be written to work when entering on any bar line, since the player advances whenever they solve a stage rather than on a fixed phrase boundary.

Drum voices are per-genre and swap with the chapter.

Instrumentation, production approach and the specific sound of each genre are open. The music will be produced directly rather than specified in advance.

## 16. Visual design

Fixed structural requirements:

- Side-scrolling, character at a fixed horizontal position near the left, world scrolling right to left.
- The loop wraps seamlessly at one screen per bar.
- Repeating scenery landmarks on quarter notes.
- No visible step grid, lanes or markers on the stage.
- Every instrument's action must be visually distinct at a glance, and small actions must be readable when they occur on every step.

Art direction, character design, setting and per-chapter visual identity are open. Visuals will be drawn directly rather than specified in advance. Any placeholder art exists only to validate the mechanics.

## 17. Open questions

- Whether each stage displays a short lesson label naming what was just programmed, or whether that is held to an end-of-chapter summary.
- Whether unrequired hits that still fit the groove should ever be rewarded, for instance as an optional style score, or whether the note budget should remain strictly exact.
- Whether a hint system exists after repeated failures, and if so whether it reveals the step, the instrument, or plays the correct pattern once.
- Whether a chapter's finished track is replayable as a performance mode with all obstacles active at once.
