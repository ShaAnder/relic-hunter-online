# Character Sprite System / Sprite Factory — Current Design

Status: **implemented on the map, factory pipeline in place, asset pipeline still being reconciled.** This document was re-audited against `main` on 2026-08-31 and replaces the original pre-implementation plan.

The original document described a future Brawler sprite system built from separate animation images. The live code has moved past that design. The current system is a **strip-source → packed atlas → runtime loader** pipeline, with per-character manifests for scale/timing and four authored isometric facings.

The Brawler is still the only character with a checked-in sheet. Map rendering is live. Combat overlay sprite integration is still deferred.

## 1. Goals and current scope

The sprite system has four jobs:

1. Let artists work in simple per-animation, per-facing horizontal strips.
2. Pack those strips into one runtime `sheet.png` plus generated `atlas.json` metadata.
3. Keep animation timing, scale, foot placement, and supported facings in a character manifest.
4. Present a small `CharacterSprite` API to map entities without making `Mercenary` know how atlases are sliced.

The current implementation is deliberately centered on the Brawler. The architecture is parameterized by character class, but other classes do not yet have production sheets.

Map integration is active. `BattleOverlay` still renders simple `Graphics` combatant tokens and does not yet use `CharacterSprite`.

## 2. Current file layout

```text
relic-hunter-online/
├── scripts/
│   └── pack-character-sheet.mjs
│
└── client/src/
    ├── assets/characters/
    │   └── brawler/
    │       ├── source/
    │       │   ├── idle_ne.png
    │       │   ├── idle_nw.png
    │       │   ├── idle_se.png
    │       │   ├── idle_se_still.png
    │       │   ├── idle_sw.png
    │       │   ├── walk_ne.png
    │       │   ├── walk_nw.png
    │       │   ├── walk_se.png
    │       │   ├── walk_se_alt.png
    │       │   ├── walk_sw.png
    │       │   ├── attack_se.png
    │       │   └── attack_se_heavy.png
    │       ├── sheet.png
    │       └── atlas.json
    │
    ├── entities/
    │   ├── CharacterSprite.ts
    │   └── Mercenary.ts
    │
    ├── math/
    │   └── characterDirection.ts
    │
    ├── rendering/
    │   └── characterSprites.ts
    │
    ├── sprites/manifests/
    │   └── brawler.ts
    │
    ├── manifests/
    │   └── brawler.ts        # duplicate currently present; not the runtime import
    │
    └── types/
        └── characterSprite.ts
```

`client/src/sprites/manifests/brawler.ts` is the manifest imported by the live runtime. `client/src/manifests/brawler.ts` currently duplicates it and should not be treated as a second source of truth.

## 3. Sprite Factory pipeline

“Sprite Factory” in the current codebase is not one runtime class. It is the combination of:

- artist-authored strips in `assets/characters/{class}/source/`;
- `scripts/pack-character-sheet.mjs`;
- generated `sheet.png` and `atlas.json`;
- the per-character manifest;
- `characterSprites.ts`, which slices the packed texture at runtime;
- `CharacterSprite`, which plays the result.

The intended flow is:

```text
source strips
    ↓
pack-character-sheet.mjs
    ↓
sheet.png + atlas.json
    ↓
characterSprites.ts
    ↓
CharacterSprite
    ↓
Mercenary
```

The generated sheet and atlas are a pair. **Do not replace one without regenerating or replacing the other.**

## 4. Source-strip contract

The packer scans:

```text
client/src/assets/characters/{class}/source/
```

It accepts filenames with the exact pattern:

```text
{action}_{facing}.png
```

Supported facings are:

```text
ne
se
sw
nw
```

Supported action names in the current packer are:

```text
idle
walk
run
attack
hit
stunned
defeated
victory
```

Examples of valid factory inputs:

```text
idle_ne.png
idle_se.png
walk_nw.png
attack_se.png
```

Files with an additional suffix are currently **working/reference variants, not packer inputs**. For example:

```text
idle_se_still.png
walk_se_alt.png
attack_se_heavy.png
```

The packer regex only accepts one action token plus one facing token. Those three files are therefore skipped unless they are renamed or the packer is deliberately extended to support variants.

### Strip dimensions

Each accepted strip is one horizontal row:

```text
height = cell size
width  = frame count × cell size
```

The current production contract in TypeScript is:

```text
128 × 128 px per frame
```

The packer defaults to a `128` pixel cell and can also be invoked with an explicit cell size.

For the high-resolution production assets, use:

```bash
node scripts/pack-character-sheet.mjs brawler
```

or equivalently:

```bash
node scripts/pack-character-sheet.mjs brawler --cell 128
```

Do not use `--cell 32` for the current high-resolution Brawler art.

### Packer behavior

The packer:

- reads all valid strips from `source/`;
- rejects strip widths that are not divisible by the cell size;
- derives frame count from `width / cell`;
- normalizes strip height to the requested cell size with nearest-neighbor scaling;
- sorts rows by action, then by facing order `se`, `sw`, `ne`, `nw`;
- left-aligns each animation inside its row;
- creates an RGBA transparent `sheet.png`;
- creates `atlas.json` containing frame dimensions, column count, row lookup, strip frame counts, source filenames, and generation timestamp.

The sheet width is determined by the largest frame count among all packed strips. Shorter rows occupy only the left side of their row.

## 5. Four-facing isometric model

The current sprite system has moved away from the old eight-direction + mirroring design.

The authored sprite facings are exactly:

```text
NE  SE  SW  NW
```

No horizontal mirroring is currently required for those four authored facings. `resolveSheetDirection()` returns the same isometric facing with `flipX: false`.

Legacy eight-way `CharacterDirection` still exists only for gradual migration. `IsoFacing` is the preferred type.

The map projection used by `getIsoFacing()` is:

```text
+x grid movement → SE
+y grid movement → SW
-x grid movement → NW
-y grid movement → NE
```

This mapping matters when producing art. “NE” and “NW” refer to the game world's isometric movement directions, not arbitrary screen-facing labels.

## 6. Runtime atlas loading

`client/src/rendering/characterSprites.ts` owns runtime sheet discovery and slicing.

It uses `import.meta.glob` to discover, per class:

```text
../assets/characters/*/sheet.png
../assets/characters/*/atlas.json
```

For each class, the runtime builds an atlas descriptor containing:

- texture URL;
- frame width;
- frame height;
- maximum columns;
- animation/facing → row map.

When `atlas.json` is present, its frame dimensions, columns, and rows take priority.

If an atlas is absent, the Brawler has a temporary hard-coded fallback row map. The fallback exists for resilience only; the generated atlas is the intended normal path.

Textures are cropped with Pixi `Rectangle` objects directly from the source texture. Nearest-neighbor scale mode is applied to preserve pixel-art edges.

## 7. Manifest responsibilities

The runtime manifest currently lives at:

```text
client/src/sprites/manifests/brawler.ts
```

It defines the character-level presentation and animation metadata that does **not** belong in the generated atlas:

```text
characterClass
frameWidth
frameHeight
map scale
foot offset
idle behavior
animation frame counts
fps / per-frame durations
loop behavior
preferred facings
```

The current Brawler manifest specifies:

```text
frame size:     128 × 128
map scale:      0.5
footOffsetY:    -16
facings:        SE, SW, NE, NW
```

Current animation timing is:

| Animation | Frames | Timing | Loop |
| --- | ---: | --- | --- |
| idle | 1 | 1 fps + runtime idle motion | yes |
| walk | 6 | 9 fps | yes |
| run | 4 | 12 fps | yes |
| attack | 5 | 100, 90, 45, 70, 120 ms | no |
| hit | 3 | 60, 100, 120 ms | no |
| stunned | 2 | 4 fps | yes |
| defeated | 5 | 8 fps | no |
| victory | 4 | 8 fps | no |

`critical` remains in the animation type/fallback table but is not currently defined in the Brawler manifest or packer's action list.

### Important source-of-truth rule

The manifest is the runtime source of truth for timing and requested frame count.

`atlas.json` is the generated source of truth for physical sheet geometry and row placement.

The packer currently **does not import the TypeScript manifest**, despite the manifest comment saying packer and runtime align to it. The packer derives frame counts directly from image dimensions. Because of that, changing a strip's frame count also requires updating the manifest manually.

Until this is automated, every asset update must keep these three things in sync:

```text
source strip dimensions
atlas.json generated geometry
manifest animation frame count
```

## 8. CharacterSprite behavior

`CharacterSprite` is one parameterized map-sprite class. There is no `BrawlerSprite extends CharacterSprite` hierarchy.

It owns:

- the Pixi `Sprite`;
- current animation;
- current frame;
- animation timing;
- isometric facing;
- frame reload when facing changes;
- looping / completion behavior;
- optional `playAsync()` sequencing;
- map scale and foot offset;
- temporary runtime idle motion.

It does **not** own world position. `Mercenary.view` owns the map position.

### Anchor and foot placement

The internal Pixi sprite uses:

```text
anchor = (0.5, 1)
```

That means the sprite is registered from the bottom-center of its frame.

The manifest then applies:

```text
footOffsetY = -16
```

as the sprite's local Y offset.

With `scale = 0.5`, a 128 px source frame renders at roughly 64 px in map space, appropriate for the 64×32 isometric tiles.

Production sprite frames should therefore keep the character's ground-contact point consistent from frame to frame. Animation art should not solve placement by moving the entire body around inside the cell.

## 9. Idle animation and alignment

The current code uses a one-frame idle pose plus runtime vertical movement:

```text
idleBobY = [0, -1, -2, -1, 0]
idleBobPeriodMs = 1400
runtimeIdle = true
```

This was useful as a prototype, but it moves the entire sprite vertically and therefore conflicts with the current art-direction requirement that idle breathing remain registered to one fixed ground position.

For production breathing art, the preferred direction is:

- feet and root position remain fixed;
- breathing is drawn in chest/shoulder/clothing changes;
- multiple authored idle frames may be used;
- whole-sprite Y translation should be removed or reduced to zero.

When production breathing strips replace the prototype idle, update the manifest together with the strip:

```text
idle.frames      = actual authored frame count
idle.runtimeIdle = false
idleBobY          = [0] or remove runtime bob support
```

The factory itself already supports multi-frame idle strips; the current one-frame manifest is a content choice, not a packer limitation.

## 10. Walk animation

Map walking is live.

`Mercenary.moveAlongPath()`:

- determines facing from the active grid path;
- starts `walk` when movement begins;
- continues moving the entity through the existing polyline/easing system;
- updates facing as the unit enters new path segments;
- returns to `idle` when movement completes.

The movement system and sprite animation remain separate. The sprite walks in place while `Mercenary` moves its parent container through world space.

This separation is intentional and should be preserved.

## 11. Mercenary integration

`Mercenary` currently contains three visual layers:

```text
ground shadow
CharacterSprite
placeholder Graphics body
```

The placeholder remains visible until the character sheet successfully initializes. If the requested class has no discovered sheet, the placeholder remains.

The map updates `CharacterSprite` once per frame through `Mercenary.update()`.

Downed hunters are still visually dimmed by `MapScene`:

```text
unit.mercenary.view.alpha = currentHp <= 0 ? 0.4 : 1
```

A production `defeated` sprite animation has not yet replaced that behavior.

### Current class behavior on the map

The local unit is currently constructed as:

```ts
new Mercenary(state.coord)
```

so it uses the constructor's default visual class, `brawler`, regardless of the local gameplay class.

AI hunters pass their real `state.characterClass` into `Mercenary`. Because only the Brawler currently has a checked-in sheet, non-Brawler AI hunters fall back to their placeholder body when their class sheet cannot initialize.

This is acceptable as a temporary Brawler showcase behavior, but it is not the final multi-class behavior.

Once additional class sheets exist, the local spawn should pass `state.characterClass` as well.

## 12. Combat overlay status

The original plan proposed reusing `CharacterSprite` inside `BattleOverlay`.

That is **not implemented yet**.

`BattleOverlay.buildCombatantTokens()` still creates colored `Graphics` circles for attacker and defender. Its animation delays are still explicitly described as placeholder pacing for future real animation timing.

Combat sprite work should remain a separate phase after the map pipeline and factory output are stable.

When combat integration happens, use the existing `CharacterSprite.playAsync()` and per-frame-duration support rather than creating a second animation player.

## 13. Current repository audit findings

The architecture is substantially further along than the old document described, but the checked-in asset pipeline currently has several pieces that do not agree with each other. These should be treated as known reconciliation work, not as the intended final factory contract.

### A. `sheet.png` and `atlas.json` are currently mismatched

The checked-in Brawler `sheet.png` is the newer high-resolution character sheet, while the checked-in `atlas.json` describes a legacy/test atlas with:

```text
frameWidth: 32
frameHeight: 32
columns: 6
```

and nine generated strip rows.

The runtime prefers `atlas.json` whenever it exists. Therefore a stale 32 px atlas beside a 128 px production sheet causes the runtime to crop the wrong rectangles.

**Rule:** never commit a new `sheet.png` without a matching atlas generated for that exact sheet, and never leave a stale atlas next to a manually replaced sheet.

### B. `source/` and the checked-in high-resolution `sheet.png` are not currently the same asset generation

The current `source/` directory contains small legacy/test strip art. The checked-in `sheet.png` contains the newer high-resolution mercenary art.

That means running the packer against the present `source/` directory would not reproduce the checked-in high-resolution sheet.

Before the factory becomes authoritative, replace the source strips with the production 128×128-cell strips, then regenerate both output files from those strips.

### C. The manifest and generated atlas currently disagree about frame geometry

The runtime manifest says:

```text
128 × 128 frames
idle = 1 frame
walk = 6 frames
attack = 5 frames
```

The checked-in atlas says 32×32 cells.

The generated atlas must be regenerated after the production source strips are installed.

### D. Duplicate Brawler manifests exist

Both of these currently exist:

```text
client/src/manifests/brawler.ts
client/src/sprites/manifests/brawler.ts
```

They contain the same data at the time of this audit, but the live runtime imports the second path.

Keep one canonical manifest location. The `sprites/manifests/` location matches the current import and should be treated as canonical unless the project deliberately moves it.

### E. `sharp` package metadata is inconsistent

The packer requires `sharp`.

The root lockfile currently records `sharp` as a client dev dependency, but `client/package.json` does not currently list it.

A clean clone should not depend on an accidental lockfile-only state. Restore `sharp` to `client/package.json` dev dependencies or otherwise formalize the packer's dependency before treating the factory command as guaranteed setup.

### F. Runtime idle bob conflicts with fixed-foot breathing art

The live manifest intentionally moves the entire idle sprite vertically by up to two source pixels. Current art direction is moving toward fixed-root breathing frames instead.

Remove the runtime bob when the real breathing strip lands so art alignment, not whole-sprite translation, controls the idle.

## 14. Recommended factory reconciliation sequence

Before adding more character classes, stabilize Brawler end to end in this order:

1. Decide the production Brawler source strips and place only authoritative inputs under `brawler/source/`.
2. Keep alternate/reference experiments with suffixes if useful, understanding that the current packer skips them.
3. Ensure every production strip uses 128×128 cells and transparent RGBA.
4. Ensure all frames use one fixed ground/root registration point.
5. Update the Brawler runtime manifest to the actual authored frame counts and timings.
6. Disable prototype whole-sprite idle bob when authored breathing frames are used.
7. Restore/formalize the `sharp` dependency.
8. Run `node scripts/pack-character-sheet.mjs brawler --cell 128`.
9. Verify the generated `atlas.json` says 128×128 and matches the actual number of packed columns/rows.
10. Launch the map and verify SE/SW/NE/NW facing, walk transitions, scale, foot placement, and no frame drift.
11. Pass the local gameplay class into `Mercenary` once non-Brawler sheets are ready.
12. Only then extend the same pipeline to Hunter/Scout/Tank/Mage/Summoner/Trapper.

## 15. Adding a new character class

Once Brawler is stable, a new class should not require a new sprite runtime implementation.

For a new class such as `hunter`:

```text
client/src/assets/characters/hunter/source/*.png
client/src/assets/characters/hunter/sheet.png
client/src/assets/characters/hunter/atlas.json
client/src/sprites/manifests/hunter.ts
```

Then:

1. Author valid `{action}_{facing}.png` strips.
2. Add the class manifest.
3. Register the manifest in the sprite-manifest lookup.
4. Run the packer for that class.
5. Let `import.meta.glob` discover its `sheet.png` and `atlas.json` automatically.

Do not add class-specific subclasses of `CharacterSprite` unless a future requirement genuinely cannot be represented by manifest data.

## 16. Asset authoring requirements

Production character art should follow these rules:

- transparent PNG / RGBA;
- one horizontal animation strip per action/facing source file;
- 128×128 frame cells for the current map pipeline;
- authored facings are NE, SE, SW, NW;
- the same character proportions and camera angle across all facings;
- fixed ground/root registration across every frame;
- no background baked into the character strip;
- no baked tile or world shadow in the sprite art;
- no frame spilling into adjacent cells;
- nearest-neighbor-safe pixel detail;
- enough transparent padding that equipment is not clipped;
- animation frame count must match the runtime manifest.

The separate `Mercenary` shadow remains a Pixi `Graphics` child and should not be baked into production character sheets.

## 17. What remains deliberately deferred

### Combat sprites

Map sprites are the first integration target. `BattleOverlay` still uses placeholder circles. Combat animation should use the same sprite/factory data later rather than creating a parallel combat-only asset system.

### Monsters

`MonsterToken` remains a separate system. Do not assume the hunter manifest/factory structure automatically applies to monsters without a deliberate design pass.

### Full animation state machine

There is still no need for a generalized animation graph. `play()`, `playAsync()`, map movement state, looping metadata, and per-frame durations are enough for the current scope.

### Variant selection

Files such as `_alt`, `_still`, and `_heavy` are not currently represented in the atlas key model. If variants become a real gameplay/content feature, extend the manifest and atlas schema explicitly rather than overloading filenames ad hoc.

## 18. Definition of done for the Brawler factory

The Brawler sprite factory can be considered stable when all of the following are true:

- `source/` contains the production 128-cell source strips that reproduce the shipped sheet;
- `sheet.png` is generated from those exact source strips;
- `atlas.json` is generated alongside that exact sheet and reports 128×128 cells;
- manifest frame counts match every source strip;
- there is one canonical Brawler manifest;
- `sharp` is a declared install dependency for the packing workflow;
- idle art stays rooted to one tile position without whole-character bobbing;
- walk frames remain rooted while `Mercenary` handles world translation;
- NE, SE, SW, and NW map movement selects the correct authored facing;
- the local Brawler displays on the map without the placeholder;
- missing class sheets fail safely to placeholders;
- no stale atlas can silently crop a newly replaced sheet;
- combat remains unaffected until its separate sprite-integration phase begins.

## 19. Architectural summary

The current architecture is the right general shape:

```text
Art strips are author-friendly.
The packer owns physical atlas layout.
The generated atlas owns row geometry.
The manifest owns character timing and presentation.
The loader owns texture slicing.
CharacterSprite owns playback.
Mercenary owns world position and movement.
MapScene owns game/map lifecycle.
```

The main work remaining is not another rewrite. It is making the checked-in **source strips, generated atlas, generated sheet, manifest, and package dependency metadata all describe the same asset generation**.

Once that reconciliation is complete, the Brawler pipeline can serve as the template for every future hunter class.
