# Placeholder Assets

Real, temporary stand-ins currently in the game, tracked here so none get forgotten once real assets exist. Checked directly against the repo, not from memory — each entry confirmed by actually reading the relevant file.

## Audio

**Boss theme** — `client/public/audio/boss-theme.mp3`. The only audio file in the project. Placeholder track, used to test whether music timing works at all for the boss spawn sequence — not intended as the final track.

**Overworld / map BGM** — not built yet at all, no file exists. Design direction settled: grounded, post-apocalyptic, rock-based (guitar + real drum kit), layered with a low tribal chant and a sparse pan flute melody, no synth.

**Combat BGM** — not built yet at all, no file exists. Design direction settled: grounded and apocalyptic, percussion-led rather than melodic, slower tempo (~85–100 BPM), heavy low drums and metallic hits over a dissonant low drone, no bright JRPG-style brass or melody.

**Main menu BGM** — not built yet, no file exists. Original direction (PS1-era JRPG main menu style) given but not yet revisited against the rock/tribal direction the other two tracks moved toward — worth checking whether this should shift too before treating it as settled.

**Music generator tools, shortlisted**: Suno (strongest overall, fastest prompt-to-usable-track), Mubert (purpose-built for royalty-free background/looping game music specifically), Soundraw (parameter-based — pick mood/genre/instruments/tempo directly rather than pure text prompting, and specifically flagged in review as lower copyright risk than at least one competitor). Free royalty-free reference tracks for the tribal/rock/chant/flute direction: Pixabay's "tribal ambient," "tribal drums," and "tribal chants" searches.

## Visuals

**Mercenary tokens** (`client/src/entities/Mercenary.ts`) — a solid colored circle (`bodyColor` property), no sprite or character art at all.

**Monster tokens** (`client/src/entities/Monster.ts`) — a plain geometric diamond shape per tier (`drawDiamond(tier)`), no creature art.

**Chest tokens** (`client/src/entities/Chest.ts`) — a simple drawn box (`Graphics`), open/closed state shown by redrawing the same box differently, no real chest sprite.

**Character creation model silhouettes** (`client/src/scenes/CharacterCreationScene.ts`) — each class shown as a basic geometric shape (circle, square, triangle, diamond, hexagon, cross) rather than real character art.

**Dialogue portraits** (`client/src/ui/overlay/DialogueOverlay.ts`) — a colored rounded rectangle with the speaker's first initial, looked up via `colorForPortrait(portraitId)`. Deliberately built as a single, swappable lookup function specifically so real portrait art can replace it later without touching any calling code in tutorials, shop, or story mode.

**Sprite generator, confirmed viable — `PixelLab`.** Real generation result reviewed directly: a mage/witch character, converted from a painted concept-art reference into a clean, detailed pixel sprite — genuinely good fidelity, not the "mush" a lot of these tools produce, and confirmed as the visual quality bar to aim for. Workflow observed: concept/reference image → stylized pixel result, not blind text-to-sprite — likely the more controllable pipeline once real prompts get built for mercenaries and monsters. Prompt-building for the actual character/monster set is explicitly deferred to a later session, not done yet.

**Worth deciding before generating any real batch**: `PixelLab` and most sprite tools default to a pixel-art aesthetic, which doesn't match the current placeholder style (clean flat vector shapes). The confirmed example above happens to be pixel art and was approved as the fidelity target — worth explicitly confirming pixel art is the intended final direction (rather than assuming it by default) before spending real generation credits on a full asset batch.

## Explicitly not placeholders

The favicon (`client/public/favicon.svg`) and the ActionMenu's plain-text button labels (a deliberate design choice over icons, not a temporary stand-in) — neither belongs on this list.
