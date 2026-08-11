# Known Issues & Suggestions

## Still open

The shared deck doesn't reset when a new match starts after a previous one has finished, which means a fresh game can begin with a deck that's already partially depleted from whatever match came before it rather than the fully intact deck a new match is supposed to have. This is confirmed and unfixed — nothing in the current match-start or reset flow actually clears or rebuilds `sharedDeck`, so the old one just carries over silently.

The HP bar doesn't correctly represent a hunter who's been knocked out and revived at reduced strength. The bar calculates its own "full" reference point from the hunter's current HP ceiling, but that ceiling is exactly the number that shrinks after a knockout — so a hunter revived at half their original maximum shows a completely full bar, because the bar is measuring itself against the new, smaller number rather than the hunter's true original max HP. This is fully understood and just needs the fix applied: the bar's ratio calculation needs to use the hunter's real original maximum as its reference, while the ceiling still correctly caps how high their actual current HP can climb.

AI hunters seem to Rest more than feels right. The likely explanation, after checking the actual logic, is a tuning gap rather than a broken rule — the rest-triggering threshold is genuinely percentage-based (a hunter rests if their HP ratio drops below 0.5, not some flat number), but the amount of HP a single Rest actually restores may just be small relative to that threshold, meaning a badly hurt hunter needs several consecutive rests to climb back over the line. That would look identical to "won't stop resting" from the outside without the threshold itself being wrong. This needs the actual heal-per-rest value checked against the threshold directly, and it's worth also confirming there isn't a second, different rest-triggering path elsewhere that hasn't been found yet.

It's still possible to discard the item that's the actual win condition for the match, and nothing currently stops or warns about it. This needs an actual decision rather than a code fix — either discarding the relic specifically should be blocked outright, or it should be allowed and treated as a real consequence of the player's own choice. Both are defensible; neither has been decided yet.

The report that a defeated hunter's teleport-away feels delayed has a fairly clear likely explanation once you look at how it's implemented: the actual teleport is an instant, synchronous repositioning with no animation or delay built into it at all, which strongly suggests the "delay" being observed isn't the teleport itself lagging — it's more likely that the camera simply isn't looking at that hunter at the moment it happens, so the player doesn't actually see the change until the camera happens to focus on them again, which naturally tends to line up with their next turn. That's a reasonable theory based on how the code is structured, but it hasn't been directly traced and confirmed, so it stays open rather than closed.

## Fixed this session

Monsters could previously choose to Defend, Run, or Surrender in a fight despite there being a flag specifically meant to force them into always attacking — the flag existed as a parameter but was never actually checked anywhere the decision got made. It's genuinely wired in now, in both places a monster's combat choice gets decided.

Defeated monsters used to go through the same knockout-and-revival sequence a hunter uses, ending up alive at reduced HP and teleported elsewhere instead of actually dying. They now die outright and get properly removed from the board — pulled from the active monster list, their visual token destroyed, not just left sitting at zero HP.

AI hunters used to sometimes take a zone-of-control hit while approaching a target, then immediately flee instead of attacking, because the damage taken mid-approach was being factored into the same-turn decision about whether the fight was worth having. The engagement decision now specifically uses the hunter's HP from before it moved, so a ZoC tick taken on the way in can't retroactively cancel the fight it was risked for.

Hunters and monsters used to be able to walk straight through each other on the map, which is fixed — every relevant movement calculation now correctly treats a living monster's tile as blocked, the same as a hunter's.

Clicking on an open UI panel — inventory, match log, hunter inspection — while in the middle of aiming a move used to be able to commit a move to wherever the cursor happened to be. Fixed with two separate layers: hovering over an open panel no longer lets a move preview even form underneath it, and committing a move independently re-validates that the actual clicked tile is a genuinely legal destination regardless.

Camera input — pan and especially zoom — used to be able to leak through during AI and monster turns, including a real timing gap in the brief pause between individual units acting where the camera's lock would briefly release entirely. Input is now blocked at the source for the whole AI-and-monster phase, and the lock state itself no longer has that gap.

The camera didn't used to track monster turns at all, only hunter turns, so it would just sit still while monsters acted somewhere off-screen. It now follows monster turns using the same mechanism it already used for hunters.

## Ideas explicitly rejected

A few ideas came up during the kiting and movement-balance discussion and were turned down for real reasons — recorded here so they don't get quietly re-proposed later without anyone remembering why they didn't survive scrutiny the first time.

A flat power penalty for carrying the relic was rejected because it creates a "hot potato" incentive — players avoiding the objective outright, or hovering nearby waiting to snipe it from whoever's brave enough to actually pick it up — which works directly against the "grab it and run" identity the objective is supposed to have.

A forced delay at the exit, requiring a carrier to stand still and exposed for several turns before actually winning, was rejected because it punishes a legitimately-built evasion character at the exact moment their whole strategy was supposed to pay off, regardless of how well they played to get there. It was also flagged as inconsistent with the reasoning behind rejecting a hard stat cap elsewhere — both ideas tell a player "no" outright rather than just making something harder.

Making the relic carrier more "visible" as a way to help enemies find them was dropped once it was pointed out that the camera already follows whoever's currently acting on their turn — visibility was never actually a scarce resource in the first place, so a mechanic built around adding more of it wasn't solving anything real.

## Ideas worth doing eventually, not scheduled

An interactive tutorial to replace the current static Help page is still just an idea — nothing beyond the existing text page exists yet.

A "bind" or "lock" combat card that would force a longer, multi-round engagement instead of the current single simultaneous exchange has come up as a suggestion, inspired by similar lock-in mechanics in other games, meant to occasionally prevent a fight from just being over in one exchange.

A rare item that expands hand size or otherwise alters the shared deck's composition has been floated as flavor — explicitly meant to create weird, non-obviously-optimal interactions rather than a clean, obviously-correct pickup.

Switching combat from its current simultaneous-resolution model to a sequential one — attacker resolves before defender — is fully designed but deliberately unbuilt. The consequence is understood and real: surrender still always wins outright regardless of order, and most action pairings don't actually change since they were never order-dependent in the first place, but a mutual double-attack changes meaningfully, since the attacker would always land their hit first, and a defender who'd be killed by that hit would never get the chance to land their own — mutual destruction becomes impossible where it's currently possible. That's a genuine balance shift, not just a mechanical rearrangement, and it needs its own dedicated pass where that consequence can be confirmed as actually wanted, rather than being folded into an unrelated change.

An icon pass on cards, inventory slots, and the row of header buttons is still outstanding. The radial action wheel is the one place this is actually finished — all six of its nodes use real sourced icons through the texture-loading pipeline built this session. Everything else still uses hand-drawn placeholder shapes.
