# Known Issues & Suggestions

Last reconciled: 2026-08-21, verified line-by-line against the live repo (not restated from memory or from prior doc versions).

## Still open — confirmed against actual code

**Multi-monitor / resize layout.** Confirmed still broken — `Game.ts` still uses `window.addEventListener("resize", ...)`. Root cause traced precisely: `Game.ts` initializes the PixiJS Application with `resizeTo: container`, which fires its own genuine `"resize"` event on `app.renderer` whenever the container's actual size changes — this is not guaranteed to correlate with the browser's generic `window.resize` event firing, which is the actual gap. Confirmed fix, not yet applied: replace the `window.addEventListener("resize", ...)` line with `this.app.renderer.on("resize", () => this.handleResize());`. No `requestAnimationFrame` wrapper needed once this is the trigger — PixiJS's own resize event only fires once real dimensions have already settled.

**Relic-discard is blocked, but only via the older, less clear mechanism.** Confirmed: `InventoryPanel.ts` still uses the original `isBlockedRelicDrop` approach — dimming the drop button and setting its `eventMode` to `"none"` so it's simply unclickable for the relic specifically. This does work; the relic genuinely cannot be dropped. A better version was designed — an active confirm popup that explains _why_ ("You cannot drop the target relic") with a Cancel option, replacing the silent disabled-button approach — but that redesign has not actually been applied to the file yet.

**Combat AI — objective context not wired.** Confirmed: `CombatAiContext` (in `shared/src/ai/mercenaryAI.ts`) genuinely supports `exitDistance`, `carrierDistance`, and `carryingRelic` fields, and the scoring logic reads them correctly. But all three real call sites in `BattleOverlay.ts` (`runAutoFight`'s two branches, `resolveLocalChoice`) omit all three fields entirely from the context object they build — not passed as `null`, just absent. The objective-aware "tactical warp" surrender logic is fully built and permanently inert as a result. Deliberately not being wired further right now — the weekend combat rework is very likely to restructure this scoring model regardless, so wiring live data into a system about to be rebuilt would likely be wasted effort.

**Monster frenzy is still fully unwired.** Confirmed: `relicFound` is set in `MapScene.ts` when the relic is found, but does not appear anywhere in `shared/src/ai/monsterAI.ts`. Nothing about monster behavior currently changes when the relic is found, despite the flag existing.

**Trap rolls never receive a real card, even though the function supports one.** Confirmed: `resolveHazardRoll` (in `shared/src/entities/traps.ts`) correctly handles an optional `victimCard` — an "A" card grants full immunity, a "C" card applies a 1.5x defense ceiling, a numeric card adds its value to the ceiling. But the one real call site in `MapScene.ts` calls it as `RH.resolveHazardRoll(unit.state.stats)` — no second argument, ever, for anyone. The function is correct; nothing feeds it real data. This likely also explains the earlier "trap rolls landing on 1 too often" report — a low-defense hunter with no possible card involved is rolling a genuinely degenerate low-range die every time.

**Surrender item-picker still shows the wrong icon.** Confirmed: `InventoryPanel.setMode`'s icon logic only distinguishes `"lootable"` from everything else — `"surrendering"` falls into the same `else` branch as `"own"` and shows a plain Drop icon rather than something that reads as Give, even though the underlying click logic correctly routes to `onGive` in that mode. This was diagnosed a while back but a fix was never actually delivered for it.

**Dual-defend tuning (soft, not a logic bug).** Healthy-hunter attack bias was raised to reduce AI-vs-AI mutual Defend loops. If playtests still show frequent turtle trades — especially Balanced or Treasure archetypes against each other — `attackBase` may need nudging up further. Not verified either way this pass; flagged as low-priority since the weekend rework changes combat resolution entirely regardless.

## Fixed — verified directly against the repo, not just claimed

Shared deck resets on every match start (`sharedDeck = null` in both the constructor and the `[R]` dev shortcut). Exit spawns dynamically, deliberately far from wherever the relic was actually found (`pickExitFarFrom`, with a real fallback), rather than existing anywhere on the map until the relic is found. Chest placement uses genuine spread logic (`pickSpreadWalkableTile`) instead of pure random placement. HP bars on all three surfaces (CharacterPanel, HunterSummaryPanel, BattleOverlay) correctly reference true original max HP, not the post-knockout ceiling. AI rest threshold is genuinely 0.25, not 0.5. AI extraction behavior (a real "sticky" `extracting` flag in AI memory) and `CombatAiContext`-based scored combat choices are both genuinely implemented. `BattleOverlay.blocksEscape` correctly prevents mid-battle Escape-key dismissal. Monsters cannot receive surrender or defeat loot, checked in both directions (monster-as-attacker and monster-as-defender). The loot/surrender softlock is fixed — `onHide` genuinely resolves any pending loot promise and clears both panels' handlers, so an overlay closing mid-sequence can't leave anything hanging. Player movement is now a real drag-authored path system — not click-to-target — with dynamic remaining range computed from the path's tip, confirm-only-on-locked-destination, and right-click clearing the path without exiting move mode entirely.

## Closed / no longer tracked

**Move re-enter after Esc softlock** — the control scheme this bug lived in was fully replaced by the drag-authored movement system; the specific interaction that caused it doesn't exist anymore.

**Click-target left bias** — moot now that destinations are authored by dragging a route rather than a single discrete click; there's no comparable "which pixel did you click" ambiguity in the new system.

## Suggestions (backlog, unscheduled)

Always-visible relic-holder indicator. Passive item value for non-confrontational play. A "fake exit" / decoy-exit consequence as a companion to the real hidden exit. Interactive tutorial to replace the static Help page. Equal-cost path alternates for AI movement (the player already effectively gets this via drag-authored paths; AI pathing still always resolves to one route).

## Explicitly not bugs

Random teleport on surrender/knockout is by design. AI using its own pathfinding helpers while the player authors paths by drag is an intentional, accepted asymmetry, not something to unify.

## Next major pass

Full combat rework — 3-round sequential resolution, a new Special action category, ranged classes becoming debuff/setup tools rather than direct damage sources, zones of control narrowing to Brawler specifically. Fully designed in `docs/14-combat-rework-design.md`. Several items above (combat AI objective wiring, dual-defend tuning) are deliberately left unresolved until after this lands, since the rework is likely to restructure or obsolete the systems they'd otherwise be fixing.
