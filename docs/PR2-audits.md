# Relic Hunter Online — PR2 Audits

> **Purpose:** Records the architecture/state-ownership audit findings for PR2 and the remaining audits required before implementation changes.
>
> **Source of truth:** Current `main` branch of the GitHub repository.
>
> **Scope:** Audit/design document. It does not require immediately moving fields or rewriting production code.

## 1. PR2 Objective

Determine where state semantically belongs before introducing or migrating toward `MatchState`.

Core rule:

> Do not move fields merely because an architecture diagram says they should move. Determine what each field means, who mutates it, who reads it, and whether it is authoritative, derived, or presentation-only.

The audit should prevent duplicate sources of truth.

## 2. `GameSession` Audit

Current significant fields:

```text
character
missionParams
matchLog
mapSeed
relicFound
bossSpawned
chestPlan
chestPlacements
playerSpawn
participants
turnOrder
matchResult
sharedDeck
```

Preliminary classification:

| Field | Current owner | Semantic owner | Target direction |
|---|---|---|---|
| `character` | `GameSession` | player/match selection | authoritative player/match state |
| `missionParams` | `GameSession` | mission/session | audit further |
| `matchLog` | `GameSession` | match/gameplay history | match event/history |
| `mapSeed` | `GameSession` | match/map configuration | `MatchState` / map state |
| `relicFound` | `GameSession` | match gameplay | `MatchState` |
| `bossSpawned` | `GameSession` | match gameplay | `MatchState` |
| `chestPlan` | `GameSession` | map generation/gameplay | `MatchState` / map state |
| `chestPlacements` | `GameSession` | map state | `MatchState` / map state |
| `playerSpawn` | `GameSession` | match/map state | `MatchState` / map state |
| `participants` | `GameSession` | match participants | `MatchState` |
| `turnOrder` | `GameSession` | match/turn state | `MatchState` |
| `matchResult` | `GameSession` | match result | `MatchState` / result |
| `sharedDeck` | `GameSession` | gameplay state | `MatchState` |

### Key conclusion

`GameSession` is already functioning as a **proto-`MatchState`** as well as an application/session object.

The goal is not to create another giant mutable object and blindly copy everything into it.

Instead:

```text
GameSession
    = application/session concerns

MatchState
    = actual match/gameplay state
```

## 3. `MapScene` State Audit

`MapScene` currently owns significant state including:

```text
grid
units
placedChests
monsters
boss
monsterSpawnIndex
exitCardInProgress
turnsTaken
targetingActive
activeCombatUnit
processingEnemyTurns
activeAi
activeMonster
traps
mapWidth
mapHeight
roomCount
mapSeed
```

It also owns substantial presentation/tutorial state.

Examples:

```ts
private units: PilotedMercenary[] = [];
private monsters: MonsterEntity[] = [];
private boss: MonsterEntity | null = null;
private traps: RH.Trap[] = [];
```

These are not naturally "scene state"; they represent simulation state being presented by the scene.

Eventually:

```text
MapScene
    ├── MapHud
    ├── MapController
    └── map presentation
```

while actual simulation state belongs to match/domain state.

**Do not migrate `MapScene` fields until the TurnManager and MercenaryState audits are complete.**

## 4. `units` / `PilotedMercenary` Audit

The current game deliberately represents hunters using `PilotedMercenary`, with:

```text
pilot: "local" | "ai"
```

distinguishing control.

This is a useful existing design and should not be casually replaced.

Future multiplayer may need concepts such as:

```text
participantId
playerId
controlMode
```

allowing:

```text
player A
player B
player C
AI
```

rather than only:

```text
local
AI
```

**Do not change this in PR2.** It is a future ownership/model audit item.

## 5. Character Selection Audit

Current flow:

```text
CharacterCreation
       ↓
GameSession.character
       ↓
MapScene
       ↓
spawnFromCharacter()
```

Target direction:

```text
Character selection UI
       ↓
selection command/request
       ↓
authoritative player/match state
       ↓
client MatchState
       ↓
MapController / entity creation
```

Character selection is **not merely client UI navigation state**.

The UI owns:

```text
highlight
hover
preview
selection animation
temporary local selection
```

Authoritative state owns:

```text
playerId → selectedCharacter
```

## 6. `sharedDeck` Audit

`sharedDeck` is gameplay state.

The current implementation keeps it in `GameSession` so it survives scene transitions and can be shared by mercenaries.

Target direction:

```text
MatchState.sharedDeck
```

or an equivalent match-level deck state representation.

Do not introduce a separate `DeckManager` unless a later audit demonstrates a real responsibility boundary.

## 7. Map Seed and Map Setup Audit

`mapSeed` is match state rather than presentation state.

Eventually:

```text
MatchState
    ├── mapSeed
    ├── map configuration
    ├── chest plan
    ├── chest placements
    └── player spawns
```

Development/tutorial-only constants should remain separate where appropriate.

## 8. Chest Plan / Chest Placements

The current implementation treats chest placement as authoritative setup rather than something the scene should reroll.

Conceptually:

```text
MatchState
    └── mapState
          ├── seed
          ├── chestPlan
          └── chestPlacements
```

Exact shape should be decided after the map-state audit.

## 9. `relicFound`, `bossSpawned`, and `turnsTaken`

These are gameplay state.

They should eventually be represented by match/gameplay state.

`turnsTaken` is especially important because it must be reconciled with `TurnManager` and `MercenaryState` before being moved.

## 10. `turnOrder` Audit

Current `GameSession` contains:

```ts
TurnOrderEntry {
    id: string;
    label: string;
    roll: number;
}
```

Turn order is match state, not application UI state.

Eventually the concept should belong to shared/match-domain state.

**Do not move yet.** The `TurnManager` audit must happen first because additional turn-related state and behavior is attached to entities.

## 11. `matchResult` Audit

Current `MatchResult` contains gameplay result information such as:

```text
won
turnsTaken
itemsExtracted
hunterScores
```

This is match-domain result state.

Eventually:

```text
MatchState
    └── result
          ├── outcome
          ├── turnsTaken
          ├── extractedItems
          └── hunterScores
```

A result scene should display this information rather than own it.

## 12. `matchLog` Audit

Current code provides a `logMatchEvent()` helper that mutates:

```text
GameSession.matchLog
```

Both map and battle features use this.

This is match/gameplay history rather than ordinary application-session state.

Longer-term possibilities include:

```text
MatchEvent[]
```

or an explicit event/history feed.

Do not introduce an event-bus architecture solely to replace this field during PR2.

## 13. `BattleOverlay` Audit

`BattleOverlay` is **not currently presentation-only**.

It currently owns or performs:

```text
combat UI
player input
AI combat decisions
combat round resolution
state mutation
HP mutation
score mutation
card removal
surrender resolution
defeat resolution
loot resolution
teleport/outcome resolution
battle completion
```

Current architectural shape:

```text
BattleOverlay
├── combat UI
├── player input
├── AI decisions
├── combat resolution
├── state mutation
├── defeat resolution
├── surrender resolution
├── loot
└── battle result
```

This is too much responsibility for a presentation object.

## 14. Battle Architecture Target

Eventually:

```text
BattleOverlay
├── render
├── input
└── animation/presentation
```

```text
BattleController
├── choose/accept actions
├── resolve round
├── apply combat consequences
├── determine battle end
├── determine result
└── return BattleResult
```

```text
shared
└── combat/game rules
```

Target flow:

```text
MatchState
    ↓
BattleController
    ↓
shared combat rules
    ↓
BattleResult
    ↓
MatchState
```

`BattleOverlay` must not become the authoritative owner of:

```text
damage
HP
score
XP
loot
victory
defeat
mission progress
```

## 15. HUD Audit

The current code confirms that common UI components appear in multiple contexts.

`MapScene` currently owns components including:

```text
CharacterPanel
DeckTracker
InventoryPanel
BagButton
LogsButton
LogPanel
InspectButton
HunterSummaryPanel
Hand
PlayZone
ActionMenu
RefocusButton
```

`BattleOverlay` also owns/reuses components such as:

```text
Hand
PlayZone
InventoryPanel
CombatActionMenu
```

Target:

```text
Reusable UI components
        │
        ├── MapHud
        │     ├── Hand
        │     ├── PlayZone
        │     └── InventoryPanel
        │
        └── BattleHud
              ├── Hand
              ├── PlayZone
              └── InventoryPanel
```

There should be one implementation of `Hand`, `PlayZone`, etc., not separate copies.

HUD components display state; they do not own gameplay state.

## 16. Tutorial Audit

`MapScene` currently contains substantial tutorial-specific state and behavior:

```text
tutorialConfig
tutorialTargetMarker
tutorialActorTokens
tutorialActorCoords
tutorialMonster
uiPointerMarker
activeUiPointerTarget
```

and methods for:

```text
setHudVisible()
moveStaticActor()
spawnTutorialMonster()
getTutorialMonsterCoord()
dashMonsterToPlayer()
```

Creating `TutorialPort` immediately would produce an adapter over the current giant `MapScene`, preserving coupling rather than removing it.

Therefore:

> **TutorialPort should come after the relevant map/HUD/controller seams exist.**

Target:

```text
Tutorial script
      ↓
TutorialRunner
      ↓
TutorialPort
      ↓
client feature adapters
      ├── MapHud
      ├── MapController
      └── BattleHost
```

## 17. State Categories

Every audited value should eventually be placed into one of four categories.

### Authoritative gameplay state

```text
player identity
selected character
selected loadout
party/match membership
ready state
mission state
turn state
map state
entity state
combat state
score
progression
rewards
relic state
match result
```

### Application/session state

```text
connection state
session lifecycle
current player/session identity
current match reference
application lifecycle
```

### Client presentation state

```text
current visual screen
selected UI tab
hover
focus
open/closed panels
animation state
camera position
camera mode
HUD layout
local input mode
temporary visual effects
```

### Derived/transient state

```text
movement range
target highlights
HP percentage display
camera interpolation
button enabled/disabled state
combat previews
map highlighting
temporary animation progress
```

Prefer:

```text
source state
    ↓
derived calculation
    ↓
presentation
```

over duplicate mutable sources of truth.

## 18. UI Navigation vs Authoritative State

### Client-only UI navigation

```text
current tab
hover
focus
expanded panel
collapsed panel
open inventory tab
animation
menu transition
camera state
```

### Authoritative session/match progression

```text
joined match
selected character
selected loadout
ready state
entered mission
match completed
```

Do not classify something as client-only merely because it currently lives inside a UI or scene class.

Classify it according to what the state actually means.

## 19. GameSession vs MatchState

### GameSession

Eventually represents:

```text
connection/session lifecycle
current authenticated player
current match reference
application lifecycle
client session state
```

It must not become a global mutable bucket containing all gameplay state.

### MatchState

Eventually represents:

```text
participants
selected characters
selected loadouts
map state
entity state
turn state
combat state
objectives
score
progression
rewards
relic state
```

Conceptually:

```text
GameSession
    │
    │ references/participates in
    ▼
MatchState
```

Later:

```text
                 Server
                   │
                   ▼
          Authoritative MatchState
                   │
                   │ synchronized state
                   ▼
              Client MatchState
                   │
           ┌───────┴───────┐
           ▼               ▼
      controllers       presentation
```

## 20. Remaining Audits Required Before Implementation

### Audit A — TurnManager

Inspect:

- all fields
- all mutable state
- AP/action state
- movement state
- card/hand state
- turn lifecycle
- callbacks
- dependencies
- reads/writes to `GameSession`
- reads/writes to `PilotedMercenary`
- reads/writes to `MercenaryState`

Determine:

```text
what is entity state?
what is match state?
what is controller/orchestration state?
what is derived?
```

### Audit B — PilotedMercenary / MercenaryState

Inspect:

- identity
- pilot/control mode
- HP
- AP
- movement
- inventory
- cards
- score
- status effects
- turn-related fields
- AI-related state

Determine whether existing entity state is already the correct domain owner.

**Do not duplicate entity state inside `MatchState` without a reason.**

### Audit C — MapWorld

Inspect:

- map generation state
- grid
- rooms
- entities
- traps
- chests
- exits
- map metadata
- generation inputs
- generation outputs

Determine what belongs to:

```text
map domain state
map generation
presentation
controller/orchestration
```

### Audit D — MapScene mutations

For every significant `MapScene` field, record:

```text
field
who writes it
who reads it
why it exists
whether it survives scene transitions
whether it affects gameplay
whether it is derived
whether it is presentation-only
```

### Audit E — BattleOverlay mutations

For every mutation in `BattleOverlay`, record:

```text
mutation
source
target
reason
domain rule involved?
presentation only?
should move to BattleController?
should move to shared?
should update MatchState?
```

### Audit F — Tutorial dependencies

Inventory every tutorial script dependency on:

```text
MapScene
BattleOverlay
HUD components
GameSession
gameplay state
entity state
```

Do not implement `TutorialPort` until this dependency graph is understood.

## 21. Target Architecture

```text
                    AUTHORITATIVE MATCH STATE
                              │
                              ▼
                         MatchState
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
          players            map             combat
             │                │                │
             ▼                ▼                ▼
      character/loadout     seed/chests     battle state
      turns/scores          relics          results
```

Application layer:

```text
GameSession
│
├── current player/session identity
├── connection/session lifecycle
├── current match reference
└── application lifecycle
```

Map presentation:

```text
MapScene
│
├── MapHud
├── MapController
└── map presentation
```

Battle presentation:

```text
BattleOverlay
│
├── BattleHud
└── combat presentation
```

Combat orchestration:

```text
BattleController
    ↓
shared combat rules
    ↓
BattleResult
```

Tutorial:

```text
Tutorial scripts
      ↓
TutorialRunner
      ↓
TutorialPort
      ↓
feature adapters
```

## 22. Important Non-Goals

Do not:

- rewrite combat;
- introduce multiplayer networking;
- create a giant `MatchState` containing duplicate entity state;
- move every `MapScene` field into `MatchState`;
- replace `PilotedMercenary` just to prepare for multiplayer;
- introduce `DeckManager` without a demonstrated need;
- create `TutorialPort` before map/battle seams are ready;
- duplicate HUD components;
- move client-only navigation state to the server;
- refactor unrelated gameplay bugs.

## 23. PR2 Implementation Gate

PR2 should remain an audit/documentation phase until these are answered:

- [ ] What exactly belongs in `GameSession`?
- [ ] What exactly belongs in `MatchState`?
- [ ] What state already belongs correctly to `MercenaryState`?
- [ ] What state does `TurnManager` own?
- [ ] What state does `MapWorld` own?
- [ ] Which `MapScene` fields are simulation state?
- [ ] Which `MapScene` fields are presentation state?
- [ ] Which `MapScene` fields are temporary orchestration?
- [ ] Which `BattleOverlay` mutations belong in `BattleController`?
- [ ] Which combat rules belong in `shared`?
- [ ] Which tutorial dependencies require `TutorialPort`?
- [ ] Which HUD components can be reused between MapHud and BattleHud?

Only after these questions are answered should the implementation PR begin creating/migrating `MatchState`.

## 24. Recommended Next Audit

Audit in this order:

```text
TurnManager
    ↓
PilotedMercenary / MercenaryState
    ↓
MapWorld
```

These define the domain/entity ownership underneath `MapScene`.

Only after this audit should the exact `MatchState` shape be written.

## Final Refactor Principles

> **Put state where its meaning says it belongs, not where it happens to be convenient today.**

> **Extract responsibility, not lines.**

A successful refactor should make ownership, dependency direction, and future authoritative boundaries clearer without duplicating state or changing gameplay behavior.
