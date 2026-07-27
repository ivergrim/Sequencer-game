# Patch 1

Changes to the existing prototype. Seven items across three areas: stage legibility, character behaviour, and failure feedback.

Read `PROTOTYPE_BRIEF.md` for the baseline. Where this document conflicts with it, this document wins. Superseded lines are listed at the end.

---

## A. Stage legibility

The stage becomes unreadable as obstacles accumulate. By stage 10 there are 21 objects across one screen width, roughly one every 5% of the screen, and it is not possible to tell what the character stumbled on.

### A1. Weight and depth as independent axes

Two separate visual systems. They must not multiply, or the smallest and oldest obstacles become invisible.

**Weight is set by instrument.** Controls size and detail only. Never changes.

| Instrument | Weight |
|---|---|
| kick, clap, crash | Large, fully rendered, high detail |
| rim | Medium |
| openhat, shaker | Small, simplified, drawn as a clustered texture band rather than discrete objects |

**Depth is set by recency.** Controls opacity and layer only. Never changes size.

- Obstacles introduced by the **current stage** render in the foreground at full opacity.
- Obstacles introduced by **any earlier stage** move to a back layer, desaturated and reduced in opacity, with a hard opacity floor so small types remain visible.

Recency is per stage, not per attempt. Failing and retrying does not change what is highlighted.

On chapter completion there is no current stage, so all obstacles return to full opacity for the final run.

### A2. Guaranteed vertical separation

Each obstacle type occupies a fixed, non-overlapping vertical band. This is not drawn as lanes and no lane guides are rendered. It reads as characteristic height per obstacle type.

This is required, not cosmetic. The chapter 1 pattern puts three obstacles on step 12 and two each on steps 0, 4 and 15. Without fixed bands they occlude each other at the same x.

Suggested bands from the ground up: pillar (kick) on the ground, totem (rim) just above, enemy (clap) at chest, bird (openhat) at head, pest (shaker) above head. Wall (crash) spans full height and is drawn behind the others.

---

## B. Character behaviour

### B1. The character is only visible while running

During EDITING the character is not drawn at all. The world keeps scrolling and the music keeps playing, but the stage is empty of the character.

- **ARMED**: the character enters from off screen left during the count-in bar, arriving at `DINO_X` at running speed. It must arrive early enough that an anticipatory action for step 0 can already have begun (see B2).
- **RUNNING**: visible.
- **SUCCESS**: exits to the right, then is not drawn again until the next ARMED.
- **FAILED**: remains visible for the duration of the death camera, then is not drawn.

### B2. Actions trigger before the obstacle, not on it

Current behaviour is wrong: the character begins its action at the moment the obstacle reaches it, so it is at ground level on contact. It must **jump over**, **dash through** and **punch through**, which means the relevant phase of the animation has to already be underway when the obstacle arrives.

Give every action an **impact ratio**: the fraction of its animation elapsed at the moment it clears the obstacle.

| Action | Instrument | Base duration | Impact ratio | Impact frame |
|---|---|---|---|---|
| Jump | kick | 400ms | 0.50 | apex of the arc |
| Dash | crash | 300ms | 0.60 | mid-dash, at full speed |
| Punch | clap | 240ms | 0.55 | full extension |
| Dodge | openhat, shaker, rim | 160ms | 0.50 | apex of the dodge |

Schedule the animation as:

```
animationStart = stepTime(S) - duration * impactRatio
```

**Audio and animation decouple.** The drum hit still fires at exactly `stepTime(S)`. Only the animation starts early. The result is that the sound lands on the same frame the obstacle is cleared, which is correct both musically and visually. Tying the animation trigger to the audio trigger is what produced the current bug.

**Cap duration by the gap to the next hit on the same instrument:**

```
duration = min(baseDuration, timeToNextHitOnThisInstrument)
```

Required, because the chapter 1 pattern has a kick on step 15 and a kick on step 0, one step apart. At 124 BPM that is 121ms, far shorter than a 400ms jump. Capped, dense hits read as fast, tight motion, which is musically correct. The impact ratio scales with the capped duration so the impact frame still lands on the step.

---

## C. Failure feedback

### C1. Death camera, stage only

On collision:

1. Freeze the run.
2. Dilate the last 200ms of approach into slow motion.
3. Dim the entire stage to a uniform low level.
4. Restore the culprit obstacle to **full opacity, foreground layer and full size**, overriding both its weight and its depth state. A shaker that killed you is drawn large with a highlight ring, not merely brightened.
5. Hold for roughly 1.2 seconds.
6. Release to EDITING.

The death camera overriding A1 is the point. The player must be able to identify the culprit even when it is a small type introduced eight stages earlier.

### C2. No sequencer highlight on failure

**Remove all sequencer feedback on failure.** No cell flash, no row highlight, no readout of the failed beat or subdivision, no text naming the missing instrument. Nothing in the sequencer changes appearance when a run fails.

The stage tells the player *which obstacle* and *what type*, and therefore which instrument. Working out *which step* from the obstacle's position against the quarter-note scenery landmarks is the skill the game exists to teach. Handing over the step index removes the puzzle.

This makes the death camera load-bearing. If C1 is weak, failure becomes opaque rather than challenging. Build C1 properly before removing the sequencer feedback.

---

## Acceptance criteria

1. During EDITING the character is not drawn anywhere on the stage.
2. The character enters from off screen left during the count-in and is at `DINO_X` and at running speed by step 0.
3. Frame-step a run: at the exact frame an obstacle's x equals `DINO_X`, the character is at jump apex, mid-dash or full punch extension. It is never beginning the action at that frame.
4. The drum hit for step S is audible at exactly step S, while its animation began before it.
5. A kick on step 15 followed by a kick on step 0 produces two distinct, complete jumps.
6. On failure, nothing in the sequencer changes appearance.
7. On failure, the culprit is unambiguously identifiable on stage, including when it is a shaker introduced eight stages earlier.
8. At stage 10, exactly three obstacles render at full opacity and the other eighteen are receded but still visible.
9. All three obstacles on step 12 are individually visible with no occlusion.
10. Size never changes with obstacle age. Opacity never changes with instrument type.

---

## Superseded

These lines in `PROTOTYPE_BRIEF.md` are replaced by this patch:

- State machine, FAILED: "The corresponding sequencer cell flashes." Removed entirely by C2.
- State machine, EDITING and ARMED: the character is now hidden during EDITING and enters during ARMED, per B1.
- Stage renderer, character actions: action timing is now governed by the impact ratio table in B2.
