# Relic Hunter Online — Current Progress Tracker

**Purpose**: Living snapshot of where the project actually is. Update this at the end of every work cycle. Keep entries short — this is a status board, not a journal. Detailed decisions go in ADRs; phase definitions live in `02-development-roadmap.md`.

**Last Updated**: 2026-07-22
**Current Phase**: Phase 1 — Single-Player Core Loop (Vertical Slice push)
**Repo**: https://github.com/ShaAnder/relic-hunter-online (main, commit `089d9d5`)

---

## ✅ Done (verified in repo)

| System                                        | Location                                                                 | Notes                                                                                                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo + npm workspaces                     | root `package.json`                                                      | `@relic-hunter/shared`                                                                                                                                                                                                                                   |
| Scene + Overlay architecture                  | `client/src/core/{scenes,overlays,game,cameras,entities}/`               | `SceneManager` (full-replace) + `OverlayManager` (layers on top without touching the scene) deliberately separate                                                                                                                                        |
| Full scene chain                              | `client/src/scenes/`                                                     | Landing → MainMenu → CharacterCreation/Load → Lobby → MissionSelect → Map → MatchResult                                                                                                                                                                  |
| Character creation + persistence              | `character.ts`, `CharacterRepo.ts`                                       | 6 classes, Universal Base + Class Modifier + 12 points, `localStorage`-backed                                                                                                                                                                            |
| Pre-match cinematic                           | `LoadingOverlay.ts`, `Camera.ts` (`panTo`)                               | Layered as an Overlay on `MissionSelectScene`, not its own Scene — sidesteps `SceneManager`'s update-blocking-during-transition. `Camera.panTo` self-drives via `Ticker.shared` + `performance.now()`, immune to inflated-first-tick-after-blocking-work |
| Item pool + chests + win condition            | `shared/game/{item,chest}.ts`, `MapScene.ts`                             | Every item is a target-candidate — no separate "relic" tier. One shared 10–15 chest plan built once pre-match; target guaranteed in exactly one chest. Win = normal move onto Exit while holding target                                                  |
| **Card deck system — fully wired end-to-end** | `shared/game/{card,deck}.ts`, `TurnManager.ts`, `Hand.ts`, `MapScene.ts` | See breakdown below — this was the major work this cycle                                                                                                                                                                                                 |
| Deck / Inventory UI                           | `ui/DeckTracker.ts`, `ui/InventoryPanel.ts`                              | Both constructed, positioned under `CharacterPanel`, synced on every `syncUI()` call and immediately on chest-open                                                                                                                                       |
| Hand hide/reveal                              | `Hand.ts` (`setHovered`), `MapScene.ts` (`HAND_HOVER_THRESHOLD_PX`)      | Fan tucks to a small peek at screen bottom, reveals on mouse proximity; forced visible during card selection so keyboard nav isn't selecting an invisible hand                                                                                           |
| Exit (E) card                                 | `MapScene.handleExitCard`                                                | Flies to Exit tile; **wins immediately if carrying the target item**, otherwise lingers then flies to a random tile. (Reversed from an earlier "E never wins" decision — this is the current, correct behavior)                                          |
| Pause overlay                                 | `ui/overlay/PauseOverlay.ts`                                             | Same Overlay pattern as the cinematic                                                                                                                                                                                                                    |

### Card deck system — what actually shipped this cycle

- **One shared 75-card deck per match** (not per-mercenary) — 20 Blue / 25 Red / 15 Yellow / 15 Green, built once via `buildSharedDeck()`, exact fixed composition with capped specials (≤2 Blue-E, ≤5 of any Red/Yellow special). Lives on `GameSession.sharedDeck`, survives scene transitions.
- **`MercenaryState` now holds `hand: CardData[]`** — no personal deck field; every hunter draws from the one shared pool. `CardData` itself moved to `shared/game/card.ts` (was previously duplicated locally in the client's visual `Card.ts`, which now correctly imports it instead).
- **Hand economy**: starts at 4 cards (just fixed — was landing at 5 due to double-counting the constructor's implicit first draw), caps at 5, draws 1 at turn start, Rest draws up to 2. No reshuffle on deck exhaustion — draws simply stop (boss-spawn consequence designed, not yet built — see Next Up).
- **`Hand.ts` renders real data, not a test array** — `syncFromHand(mercState.hand)` rebuilds the fan from the actual hand every time `TurnManager` fires `onChanged`. The permanent "No Card" skip slot is synthesized fresh each sync, never part of real hand data.
- **Dead code removed**: `TurnManager.beginMovement` had a vestigial J/Q/K/A face-card value converter (leftover from an early generic-playing-card prototype) that was provably unreachable — both real call sites already coerce to a plain number before calling it. Signature tightened to `cardValue: number`.

## 🔨 Next Up — This Is the Actual Blocker

Per `09-enemy-ai-design.md`'s locked sequencing, and confirmed by re-reading the repo this session:

1. **Real combat resolution** — `handleAttack()` still just spends AP and shows a feedback stub. No damage math, no HP changes exist anywhere. **Nothing below this can start until it lands.**
2. **One static enemy mercenary** — `GameSession.participants` currently only ever contains the player; no enemy entity exists to fight even once combat math works.
3. **Enemy AI** (Balanced → Aggressive → Treasure-Hunter)
4. **Relic theft / knockout sequence** (`07-knockout-loot-design.md`) — needs an HP-to-zero event, which needs #1
5. **Class mechanics beyond flat stats** — no Summoner build, no per-class abilities yet
6. **Monsters**, including the deck-exhaustion boss (`09-enemy-ai-design.md`'s boss addition) — same prerequisites as #3

## ⚠️ Known Tech Debt / Watch List

| Item                                                             | Risk         | Notes                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MapScene.ts` well over 900 lines                                | High, rising | Flagged repeatedly; every new feature (deck UI, hover-reveal, win-check) adds to it. `MapRenderer.ts`/`InputHandler.ts` remain built-but-unused. Combat resolution will add real complexity here — worth deciding now whether the split happens before or after |
| No real combat resolution                                        | High         | The actual blocker for the rest of the vertical slice, see Next Up                                                                                                                                                                                              |
| Yellow/Green cards beyond numeric values are feedback-text stubs | Medium       | Defense/Trap real effects still not implemented                                                                                                                                                                                                                 |
| Unused fields (`tileCount`, `lastGenerationMs`, `lastRenderMs`)  | Trivial      | Lint warnings only, from `refreshStatsText()` being commented out                                                                                                                                                                                               |
| `client/src/counter.ts`                                          | Trivial      | Leftover Vite scaffold file, never deleted                                                                                                                                                                                                                      |

## 📓 Session Log (newest first)

- **2026-07-22** — Fixed a real bug in `dealStartingHand()`: it called `drawCards(STARTING_HAND_SIZE)` which draws _that many more_, not _up to that total_ — since the constructor already draws 1 card implicitly, this landed hands at 5 (maxed) instead of the intended starting size of 4. Now computes `needed = STARTING_HAND_SIZE - hand.length` first. Removed genuinely dead J/Q/K/A face-card conversion code from `TurnManager.beginMovement` (both real callers already pass a plain number; the string-handling branch was unreachable). Confirmed full read-through: chests, win condition, Exit-card reversal, DeckTracker, InventoryPanel, and hand hover-reveal are all correctly wired from last session. Card deck system is genuinely complete and playable end-to-end.
- **2026-07-21/22 (deck system build)** — Extracted `CardData` to `shared/game/card.ts` (was duplicated in client). Built the one-shared-75-card-deck model (20/25/15/15, capped specials) after two design corrections mid-session (first per-mercenary independent decks, then a dealt-from-one-pool model, landing on one shared match-wide deck). Wired `Hand.ts` to render real `mercState.hand` data instead of a static test array — this was the actual "why can't I see my deck" bug. Added `DeckTracker` and `InventoryPanel`, wired hand hide/reveal-on-hover, reversed the Exit card to win on target-carry.
- **2026-07-20** — Chests + win condition landed. Pre-match cinematic rebuilt as an `Overlay` (was a `Scene`, which deadlocked — `SceneManager` blocks a scene's `update()` for its whole `onEnter()`, which permanently hung any `Camera.panTo()` awaited from inside it). `Camera.panTo()` made self-driving via `Ticker.shared` + `performance.now()`.
- **(earlier)** — Full scene chain, character creation + persistence, card system to spec, AP turn system, pause functionality.
