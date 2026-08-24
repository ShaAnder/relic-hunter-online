# Character Sprite System — Design

Status: planned, not started. Baseline drafted externally, reviewed against the live repo, gaps folded in below. Deliberately scoped to Brawler only for the first pass — generalize once one class works end to end, not before.

## Goal

Replace `Mercenary`'s current placeholder sphere with a real, directional, animated sprite — starting with Brawler, on the map only. Combat/`BattleOverlay` integration is explicitly phase 2, not part of this first pass.

## File tree

```
client/src/
├── assets/characters/brawler/
│   ├── idle.png, walk.png, run.png, attack.png, critical.png,
│   └── hit.png, stunned.png, defeated.png, victory.png
├── entities/
│   ├── Mercenary.ts              ← modify
│   └── CharacterSprite.ts        ← new
├── math/
│   └── characterDirection.ts     ← new
├── rendering/
│   └── characterSprites.ts       ← new
├── types/
│   └── characterSprite.ts        ← new
└── ui/overlay/
    └── BattleOverlay.ts          ← modify, phase 2 only
```

## Core architecture decision — why this shape

One `CharacterSprite`, parameterized by `characterClass`, not a `Brawler`/`Hunter`/`Scout` class hierarchy. This matches how `MonsterToken`, `Mercenary`, and `Chest` already work in this codebase — standalone, composed classes, no inheritance tree between them. A `Brawler extends Mercenary` hierarchy would be the first inheritance-based entity in a codebase that's deliberately avoided that so far. `characterSprites.ts` is the one place asset-per-class-per-animation gets mapped, so adding Hunter/Scout/Tank/Mage/Summoner later never touches rendering code, just that one lookup table.

## Phased implementation order

**Phase 1 — Asset.** Brawler sprite sheet(s) in `assets/characters/brawler/`.

**Phase 2 — `CharacterSprite`.** Load and display one idle spritesheet. Anchor at `(0.5, 1)` — bottom-center, feet on the tile — matching the pivot convention `Card` already uses elsewhere in this codebase, not a new one.

**Phase 3 — `Mercenary` integration.**
- Remove the placeholder sphere, add a separate shadow graphic plus `CharacterSprite` as two distinct children of `Mercenary.view`, not one baked-together sprite.
- Constructor signature changes to take `characterClass` alongside `initialCoord`. **Before touching this file**: grep every `new Mercenary(...)` call site first — `spawnLocalUnit`, `spawnEnemyHunters`, and `regenerateMap` in `MapScene` all construct one directly and will all need updating. Don't discover this mid-edit.
- Existing movement/animation fields (`currentScreenPos`, `animPoints`, `_isAnimating`, etc.) stay completely untouched — this is additive, not a rewrite of movement.
- **Reconcile with the existing defeat-dimming logic** before this phase is called done: `MapScene.update()` already sets `unit.mercenary.view.alpha = currentHp <= 0 ? 0.4 : 1` for every downed unit. Decide explicitly whether the new `"defeated"` animation state replaces that dimming, runs alongside it, or one is dropped — don't let a real decision get made by accident once both exist and visibly fight each other.

**Phase 4 — Direction.** `getCharacterDirection(from, to): CharacterDirection` in `math/characterDirection.ts`, matching the location convention `isoGridMath.ts` already establishes for this kind of pure grid-math helper. Four generated views (N/NE/E/SE) mirrored for the other four via `flipX`. Explicit, tracked caveat from the original plan, worth keeping verbatim: test mirroring against the actual attack sprite once it exists — a held weapon can visually flip to the wrong hand, and idle/walk are much safer to mirror than attack.

**Phase 5 — Walk.** Wire into the existing `moveAlongPath`/`isAnimating` flow: `play("walk")` on movement start, `play("idle")` on completion. No new animation state machine needed — the existing boolean already does this job.

**Phase 6 — Combat, strictly after 1–5 are confirmed working on the real map.**
- Replace `BattleOverlay`'s attacker/defender circles with `CharacterSprite` instances.
- **Real, repo-specific integration point, not in the original plan**: `BattleOverlay` already computes and threads a real UI scale factor `s` through everything it lays out (`localPlayZone.layout(width/2, height/2 - uiPx(30, s), s)`, the hand, etc.). `CharacterSprite`'s position and size inside `BattleOverlay` need to respect that same `s` from day one — ideally via an optional external scale parameter on `CharacterSprite` itself, mirroring how `PlayZone.layout` already accepts one. Bolting scale-awareness on after the fact is exactly the category of bug that took multiple real rounds to fully track down with the card system tonight — worth designing in from the start here instead.
- Animation sequence: `attack` → wait for completion → resolve damage → `hit` or `critical`→`hit` → `defeated` (if HP ≤ 0) or back to `idle`. Winner plays `victory` once the battle actually ends.
- A small `play(animation, {loop, onComplete})` API, with an eventual `playAsync` wrapper — not required for the first pass, but worth architecting toward, since combat's real sequencing (attack finishes → damage resolves → hit plays) needs it eventually regardless.

## Explicitly deferred, not decided here

**Monsters.** `MonsterToken`'s placeholder diamond isn't touched by this plan at all. The same one-parameterized-class idea likely applies eventually (tier instead of class as the parameter), but that's a real, separate decision — monsters and mercenaries differ on a different axis, so this shouldn't be assumed to just fall out of the character system for free.

**A generalized animation state machine.** Deliberately not built now — the existing `isAnimating` boolean plus a simple `play()` call is enough for one class's idle/walk. Revisit only once combat's real sequencing needs (Phase 6) prove the simple version insufficient, not before.
