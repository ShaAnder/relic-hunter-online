# Known Issues & Suggestions

Last reconciled: 2026-08-22, verified line-by-line against the live repo (not restated from memory or from prior doc versions).

## Still open — confirmed against actual code

**`processEnemyTurns` is not actually guarded by `try/finally` yet.** This was identified and a fix was given after tonight's real full-game hang (a synchronous throw during boss-token construction silently killed the rest of the async turn sequence, leaving `processingEnemyTurns` stuck `true` and camera input permanently locked). The specific bug that caused that hang is fixed (`TIER_SIZE` now has a `boss` entry), but the general fix — wrapping the function's body so cleanup always runs regardless of what throws — was never actually applied to the file. This means the same class of full-game hang remains possible for any future unhandled error inside this sequence. Real priority for the "next major pass" hardening effort below, but worth applying immediately given how severe the failure mode is.

**Combat AI — objective context not wired.** `CombatAiContext` supports `exitDistance`, `carrierDistance`, and `carryingRelic`, but no real call site in `BattleOverlay.ts` passes any of the three. Deliberately left unresolved — the weekend combat rework is very likely to restructure this scoring model regardless.

**Dual-defend tuning (soft, not a logic bug).** Same reasoning — likely obsoleted by the combat rework rather than worth tuning now.

**Live movement tick-down** and **dual-layer movement range visualization** — both real, scoped, deliberately deferred features. See the two write-ups below in Suggestions for the actual detail on each.

## Fixed — verified directly against the repo, not just claimed

Everything from the previous reconciliation (shared deck reset, dynamic exit spawn, chest spread, HP bars, AI rest threshold, extraction AI, `blocksEscape`, monster loot-block, loot softlock, drag-authored movement, multi-monitor resize, relic-discard confirm popup, trap defense-cards) still holds — re-verified, nothing regressed.

**New this session, all confirmed directly against the live repo:**

**`processEnemyTurns` is not actually guarded by `try/finally` yet.** Fixed added try handling

The temporary stat bonus system — Movement and Defense cards apply a real, visible, overwrite-not-stack bonus for the rest of the turn, shown on the character panel by recoloring the affected stat's own number (white/blue/red) rather than a separate badge, correctly distinguishing "A"/"C" special cards' actual different meanings per stat (defense: immune/1.5x ceiling; attack: 2x/1.5x multiplier), and centrally wiped in `TurnManager.endTurn()` so every turn-ending call site is covered by one change. Feeds into both trap hazard rolls and zone-of-control reaction strikes correctly via a synthetic-card pattern, since both underlying functions (`resolveHazardRoll`, `resolveReactionStrike`) already had correct "A"/"C" handling built in — they just weren't being fed real data.

The Battle Overlay's play zone (`localPlayZone`) is now genuinely added to the display tree and correctly positioned via its own `layout(x, y)` method — was previously either invisible entirely or stuck at the origin, depending on which point in tonight's fixes you were testing against. The battle panels' own stat readout is now a live, synced display (`syncStatDisplay`) instead of a one-time snapshot taken at panel-build time — it genuinely updates the instant a card is chosen, matching the same live behavior the overworld panel already had.

The deck-exhaustion boss is fully built: unique entity outside the normal tier system, spawns exactly once the round the shared deck genuinely empties, always acts last in the turn order after every hunter and every regular monster. Monster frenzy is fully wired: the moment the relic is found, every living regular monster gets a real, permanent movement/attack bump; the boss is correctly exempt. The spawn sequence itself — flashing red alert overlapping with camera shake and boss theme music starting together, then a real camera pan to the boss's spawn location, then a deliberate pause before the boss's own first turn — is built and sequenced correctly. Camera gained a genuine `shake()` method, matching the same Ticker-driven pattern `panTo` already used successfully all session.

## Closed / no longer tracked

Move re-enter after Esc softlock, click-target left bias — both retired by the drag-authored movement rework, the interactions that caused either no longer exist in the current control scheme.

## Suggestions (backlog, unscheduled)

Always-visible relic-holder indicator. Passive item value for non-confrontational play. A "fake exit" / decoy-exit consequence as a companion to the real hidden exit. Interactive tutorial to replace the static Help page. Equal-cost path alternates for AI movement.

**Live movement tick-down on the character panel.** As the player drags out a move, the panel's Mov stat should visibly count down in real time from the full budget toward zero as the path grows, rather than staying static until the move commits. `MoveController` already computes remaining budget internally to drive the existing blue range preview — this just needs that value exposed and the panel refreshed on every drag update, not per-frame.

**Dual-layer movement range visualization.** Currently only one range layer exists — the dynamic blue preview that shrinks as you drag. The ask is a second, independent layer: a dimmer, static rendering of the character's full possible range for the turn, computed once and left alone, with the existing dynamic layer rendered brighter on top of it so both are visible and clearly distinguishable at once.

**Boss-triggered AI extraction bias.** Once the boss spawns, every AI hunter — Aggressive included — should gain a strong bias toward finding the relic and reaching the exit. Aggressive specifically should still engage hunters and monsters more readily than other archetypes even after this shift, but should weigh a genuinely closer item pickup over picking a fight. Not built — design note only, captured in full in `09-enemy-ai-design.md`.

**Boss kills the relic carrier = instant loss.** Deliberately different from every other defeat consequence in the game, which all currently use the same stay-down-and-recover-next-turn model. If the boss specifically defeats whoever is carrying the relic, the match should end immediately as a loss — no recovery, no continuing. Not built — design note only, captured in full in `09-enemy-ai-design.md`.

**Rough audio system.** A minimal `AudioController` (play/stop, keyed tracks, no preloading, no crossfade, no mixing) is in place purely to test whether music timing works at all for the boss sequence. A real audio system — likely Howler.js or the Web Audio API directly, with actual preloading and crossfading — is its own future pass once audio is confirmed worth building out properly.

**UI factory — a real architectural change, not just a tidy-up.** `MapScene.setHudVisible()` currently hand-lists every HUD element (`characterPanel`, `deckTracker`, `inventoryPanel`, `bagButton`, `buttonBar`, `refocusButton`, `logPanel`, `inspectButton`, `hand`, `playZone`, plus both tutorial marker containers) to toggle `.visible` during dialogue/narrative moments — a genuine hack, explicitly acknowledged as such rather than a real fix. Every new HUD element added to `MapScene` from now on needs a matching line added here by hand, or it silently stays interactive during dialogue. The proposed fix: a UI factory that every HUD element is constructed and registered through, owned directly by `MapScene`, so narrative-lock is a single call at the source (the factory itself iterating its own registered elements) rather than a manually-maintained list that can silently drift out of sync as the HUD grows. Worth building as part of whatever pass eventually formalizes UI construction generally, alongside the already-logged "formal UI scale factory / `ScaledContainer` base class" idea from earlier — the two are closely related and likely belong in the same refactor pass, not two separate ones.

## Explicitly not bugs

Random teleport on surrender/knockout is by design. AI using its own pathfinding helpers while the player authors paths by drag is an intentional, accepted asymmetry.

## Next major pass

Full combat rework — 3-round sequential resolution, a new Special action category, ranged classes becoming debuff/setup tools rather than direct damage sources, zones of control narrowing to Brawler specifically. Fully designed in `docs/14-combat-rework-design.md`. Several items above are deliberately left unresolved until after this lands, since the rework is likely to restructure or obsolete the systems they'd otherwise be fixing.

**After the combat rework and its subsequent testing pass**: a deliberate codebase-wide hardening effort — auditing turn-flow and other multi-step async sequences for missing `try/finally` guards around state that must always reset (player-control locks, camera input locks, `processingEnemyTurns`-style flags). `processEnemyTurns` was the first, immediate case of this — see "Still open" above, since the actual fix for it hasn't landed yet despite being identified.

**After the combat rework**: tutorial levels / an interactive onboarding flow, replacing the current static Help page. Per tonight's stated plan, this is the last major piece before the game is considered feature-complete for its current phase.
