# Full Architecture Refactor — Relic Hunter Online

**Status:** Revised master plan  
**Date:** 2026-08-26  
**Scope:** Entire monorepo (`client/`, `shared/`, `server/`, `docs/`)  
**Supersedes:** Earlier map/tutorial-only architecture drafts where they conflict  
**Primary goal:** Finish the separation already emerging in the codebase without replacing one god object with another.

---

## 1. Executive summary

Relic Hunter Online already has several strong architectural foundations:

- `shared/` contains genuinely reusable game-domain logic.
- Entities use composition rather than an inheritance hierarchy.
- Human and AI hunters share the same state shape.
- `TurnManager` is generic over entities with the required traits.
- `OverlayManager` already provides a stack-based global overlay policy.
- The game is intentionally preparing for Colyseus, but multiplayer authority is not part of this refactor.

The main remaining problem is **responsibility concentration in the client**, especially around `MapScene`, combat presentation/orchestration, and session/match state.

The refactor therefore has four architectural outcomes:

1. **Thin scene shells.**
2. **Explicit state ownership.**
3. **Commands/orchestration separated from presentation.**
4. **A stable shared domain that can later run on the server.**

The most important rule is:

> Do not move code merely to make files smaller. Move code to establish ownership and dependency boundaries.

---

# 2. Goals

1. Keep `shared/` pure and runnable without Pixi, DOM, or tutorial code.
2. Keep `client/` responsible for presentation, local input, and local orchestration.
3. Keep future server authority isolated from Pixi and client UI.
4. Reduce `MapScene` to a scene shell and binding/orchestration role.
5. Prevent `MapWorld` or another extracted class from becoming a replacement god object.
6. Separate match state from application/session state.
7. Make combat orchestration independent from `BattleOverlay`.
8. Make tutorial scripts depend only on a capability-based `TutorialPort`.
9. Give the map HUD one root so map chrome can be hidden/shown in one operation.
10. Preserve normal non-tutorial behavior after every refactor phase.
11. Prefer incremental, reviewable PRs over a big-bang rewrite.
12. Make future multiplayer a continuation of the architecture, not a second rewrite.

---

# 3. Non-goals

- Combat-rules redesign.
- Full Colyseus implementation.
- Supabase/auth implementation.
- Unity migration.
- Rewriting tutorial prose.
- Rebuilding every UI screen.
- Creating one global UI god object.
- Reorganizing folders for aesthetic reasons before ownership boundaries exist.
- Rewriting healthy shared systems merely because they are not in the new folder tree.

---

# 4. Architectural principles

## 4.1 Architecture is dependency direction, not folders

Folders are a consequence of ownership.

A file should move when its responsibility has a clear home, not simply because a new folder exists.

Bad:

```text
Create world/
Move 20 files
Fix imports
Hope the architecture improved
```

Good:

```text
Define ownership
↓
Define interface
↓
Extract behavior
↓
Prove behavior unchanged
↓
Move file if the resulting ownership warrants it
```

---

## 4.2 Shared is domain, not infrastructure

`shared/` must remain usable by both client and future server.

Allowed:

- game state types
- movement rules
- combat rules
- targeting
- zones of control
- AI decisions
- cards/decks
- world generation
- item/entity rules
- deterministic/pure helpers where appropriate

Forbidden:

- Pixi
- DOM
- browser globals
- scene classes
- UI classes
- tutorial runner/port
- overlay types
- client session objects

Import direction:

```text
client ──────► shared
server ──────► shared

shared ──────► client     NEVER
shared ──────► server     NEVER
client ──────► server     NEVER
```

The client may communicate with a future server through an explicit network/protocol boundary, never by importing server implementation code.

---

# 5. State ownership

This section is mandatory architectural guidance.

| State / concern | Owner |
|---|---|
| Combat rules | `shared` |
| Movement rules | `shared` |
| AI decisions | `shared` |
| Targeting / ZoC rules | `shared` |
| World-generation rules | `shared` |
| Actual match/game state | `MatchState` / future authoritative server |
| Application/session concerns | `GameSession` |
| Pixi display objects | `client` |
| Camera state | `client` |
| Local input mode | `client` |
| HUD visibility/layout | `client` |
| Tutorial progress | `TutorialRunner` |
| Tutorial prose/data | tutorial scripts |
| Overlay lifecycle | `OverlayManager` |
| Network connection | `client` |
| Authoritative multiplayer state | future `server` |

### Important distinction

`GameSession` is not the same thing as the game's authoritative state.

The target concept is:

```text
GameSession
  application/session concerns
       |
       v
   MatchState
  actual game state
```

Later:

```text
Colyseus server
       |
       v
 authoritative MatchState
       |
       v
 client MatchState projection
```

Do not let `GameSession` become a general-purpose mutable bucket for gameplay.

---

# 6. Target runtime architecture

```text
                    PLAYER INPUT
                         |
                         v
                +------------------+
                |  MapController   |
                | orchestration    |
                +--------+---------+
                         |
              commands / intent
                         |
        +----------------+----------------+
        |                |                |
        v                v                v
   movement         combat request     turn request
        |                |                |
        v                v                v
     shared          BattleHost       TurnRunner
     rules               |
                         v
                  BattleController
                         |
                         v
                     shared
                   combat rules
                         |
                         v
                    BattleResult
                         |
                         v
                 MatchState update
                         |
                         v
                 presentation/events
                    /          \
                   v            v
                Map view      MapHud
```

The key flow is:

```text
input
  -> command/intent
  -> controller/orchestrator
  -> domain/state operation
  -> result/event
  -> presentation
```

Avoid:

```text
Pixi button
  -> directly mutate game state
  -> directly update five UI widgets
  -> directly construct BattleOverlay
```

---

# 7. Target client structure

This is a conceptual target. Do not perform a mass move just to match this tree.

```text
client/src/
  main.ts

  core/
    game/
      Game.ts
      GameSession.ts
    scenes/
      Scene.ts
      SceneManager.ts
    overlays/
      Overlay.ts
      OverlayManager.ts
    cameras/
      Camera.ts
      TurnCamera.ts
    audio/

  match/
    MatchState.ts
    MatchController.ts
    TurnRunner.ts

  map/
    MapController.ts
    MapRenderer.ts
    input/
      MapInput.ts
    systems/
      ChestSystem.ts
      MonsterSystem.ts
      TrapSystem.ts
      ExitRelicSystem.ts
      ZoneQuery.ts

  combat/
    BattleHost.ts
    BattleController.ts
    TutorialCombatGuide.ts

  hud/
    MapHud.ts
    TutorialMarkers.ts

  entities/
    Mercenary.ts
    Monster.ts
    Card.ts
    ...

  systems/
    TurnManager.ts
    MoveController.ts

  ui/
    generics/
    buttons/
    overlay/
    Hand.ts
    PlayZone.ts
    InventoryPanel.ts
    CharacterPanel.ts
    ...

  tutorial/
    TutorialPort.ts
    TutorialRunner.ts
    tutorialTypes.ts
    dialogue.ts
    scripts/
      movementScript.ts
      combatScript.ts

  math/
  assets/
  portraits/
  icons/

  scenes/
    MapScene.ts
    TutorialScene.ts
    MainMenuScene.ts
    CharacterCreationScene.ts
    LobbyScene.ts
    MissionSelectScene.ts
    LoadGameScene.ts
    MatchResultScene.ts
    ...

  debug/
  types/
```

### Important

`MapController` is orchestration. It is not the new world god object.

`MatchState` contains state.

Map systems operate on the relevant state.

`MapScene` binds Pixi lifecycle to these components.

---

# 8. MapScene policy

Every scene should:

1. Own its root view.
2. Construct/receive feature modules.
3. Forward lifecycle methods.
4. Forward resize/update where appropriate.
5. Avoid implementing domain rules.
6. Avoid owning combat resolution.
7. Avoid owning tutorial scripts.
8. Avoid becoming a mutable global state store.

Target:

```text
MapScene
  -> creates/receives map presentation
  -> binds MapController
  -> binds MapHud
  -> binds camera
  -> binds TutorialPort adapter
  -> forwards lifecycle
```

Target size:

**~800–1000 lines or less is a guideline, not a success criterion by itself.**

The real success criterion is that its remaining lines are mostly lifecycle, wiring, and scene-specific presentation.

---

# 9. MapController

`MapController` is the orchestration seam that prevents `MapScene` and `MapWorld` from becoming god objects.

Responsibilities:

- receive high-level map commands
- coordinate map systems
- request combat through `BattleHost`
- coordinate turn progression
- publish results/events needed by presentation
- bridge local UI intent to domain operations

It should NOT:

- contain Pixi layout
- own every map rule
- duplicate shared combat/movement rules
- become the authoritative multiplayer server
- contain tutorial prose

Conceptually:

```ts
MapController
  -> move
  -> requestCombat
  -> endTurn
  -> inspect
  -> interactWithChest
  -> triggerMapEvent
```

The controller should delegate rules to the appropriate domain/system code.

---

# 10. Map systems

Candidate systems:

```text
map/systems/
  ChestSystem
  MonsterSystem
  TrapSystem
  ExitRelicSystem
  ZoneQuery
```

A system should have a narrow reason to change.

For example:

```text
ChestSystem
  chest discovery
  chest interaction
  chest-related state changes
```

It should not own:

```text
camera
HUD
tutorial dialogue
combat overlay
global session state
```

## Important anti-god-object rule

If `MapController` starts accumulating hundreds of lines of actual game rules, stop and extract the rule.

If `MapWorld` starts accumulating hundreds of lines of orchestration, stop and introduce/strengthen `MapController`.

---

# 11. Turn architecture

The current project already has a useful generic `TurnManager`.

Preserve that strength.

Do not create separate state models for human and AI hunters unless the domain actually requires them.

The current architecture deliberately treats human and AI hunters as the same shape, distinguished by `pilot`.

The new orchestration should therefore distinguish:

```text
who provides the command
```

rather than:

```text
what kind of entity exists
```

Possible future shape:

```text
TurnRunner
  -> determines active participant
  -> obtains command from local input or AI
  -> applies command
  -> advances turn
```

AI decision-making remains in `shared`.

---

# 12. Combat architecture

## 12.1 Responsibilities

### `BattleHost`

Client-side integration seam.

Responsibilities:

- create/start the client battle presentation
- receive battle requests
- connect battle lifecycle to the map
- translate final battle results back to map orchestration

It is the only place allowed to construct `BattleOverlay`.

### `BattleController`

Combat flow/orchestration.

Responsibilities:

- battle state lifecycle
- action sequencing
- calling shared combat rules
- producing battle results/events
- coordinating animation timing where necessary

It should not know about arbitrary map UI.

### `BattleOverlay`

Presentation/input.

Responsibilities:

- arena
- tokens
- panels
- HP display
- action UI
- animations
- player interaction
- tutorial guide presentation

It should not be responsible for changing arbitrary map state.

### `shared/combat`

Pure domain rules.

Responsibilities:

- combat resolution
- targeting
- combat geometry
- ZoC
- domain-level combat calculations

---

# 13. Battle flow

Target:

```text
MapController
     |
     | request battle
     v
BattleHost
     |
     +----> BattleController
                 |
                 +----> shared combat
                 |
                 +----> BattleResult
     |
     v
BattleOverlay
     |
     | presentation/input
     v
BattleResult
     |
     v
MapController / MatchState
```

Invariant:

```text
new BattleOverlay()
```

must exist only inside `BattleHost`.

Invariant:

```text
BattleOverlay
```

must not import tutorial scripts or `MapScene`.

Invariant:

```text
BattleController
```

must be usable without Pixi-specific rendering concerns.

---

# 14. Tutorial architecture

```text
Tutorial scripts
       |
       v
TutorialRunner
       |
       v
TutorialPort
       |
       v
Map adapter
  /     |      \
MapHud MapController BattleHost
```

### Scripts

Contain:

- tutorial data
- dialogue
- segment definitions
- expected actions
- failure lines

They must not import:

- `MapScene`
- `BattleOverlay`
- concrete Pixi widgets

### Runner

Owns:

- segment sequencing
- dialogue sequencing
- exclusive vs `showOnTop` dialogue
- failure counters
- waiting for combat completion
- calling the port

### Port

Capability-oriented API.

Good:

```ts
showDialogue(...)
setHudVisible(...)
showMarker(...)
giveCard(...)
runCombat(...)
waitForMove(...)
```

Bad:

```ts
getMapScene()
getBattleOverlay()
getHud()
```

The tutorial asks for capabilities, not objects.

---

# 15. MapHud

`MapHud` owns the map's presentation chrome under one root.

Suggested layers:

```text
MapHud
  ├── chrome
  ├── hand
  ├── modals
  └── markers
```

Responsibilities:

- HUD layout
- widget ownership
- visibility
- resize
- map-specific presentation updates

API should allow:

```ts
setChromeVisible(...)
setLayerVisible(...)
resize(...)
```

The tutorial should be able to hide map chrome without knowing which individual widgets exist.

Do not make `MapHud` a global UI class shared by unrelated scenes.

---

# 16. OverlayManager

Keep the existing global stack policy.

Conceptually:

```text
show()
hide()
showOnTop()
hideTop()
```

However, overlay visibility must not automatically imply simulation pause.

Each overlay should eventually declare or expose policy such as:

```text
blocksInput
pausesSimulation
```

Examples:

```text
Battle    -> blocks input, pauses local map simulation
Pause     -> blocks input, pauses simulation
Dialogue  -> blocks relevant input, may pause simulation
Notification -> may not pause simulation
```

This becomes important for multiplayer.

---

# 17. GameSession vs MatchState

This is a deliberate refactor seam.

### `GameSession`

Application-level concerns:

- current player/character selection
- current match reference
- navigation/session state
- client-only lifecycle

### `MatchState`

Gameplay state:

- participants
- map state
- turns
- relic state
- chest state
- monster state
- gameplay-relevant match log/state where appropriate

Do not put Pixi objects in `MatchState`.

Do not put browser/session concerns in `MatchState`.

The future server should be able to own `MatchState` without importing client code.

---

# 18. Shared architecture

Current shared structure is already healthy:

```text
shared/src/
  ai/
  combat/
  cards/
  entities/
  items/
  math/
  types/
  world/
  index.ts
```

Do not rewrite it simply to satisfy a folder diagram.

Protect it first.

Rules:

- no Pixi
- no DOM
- no tutorial
- no client session types
- no overlay types
- no browser-only APIs
- deliberate `index.ts` public API

Later, if needed, introduce clearer conceptual separation such as:

```text
domain/
rules/
```

but only when real ownership pressure justifies it.

---

# 19. Server boundary

For this refactor:

```text
server/
  src/
    rooms/
    index.ts
```

is enough.

Do not implement multiplayer here.

The server milestone begins when authoritative state is ready.

Future direction:

```text
server
  -> authoritative MatchState
  -> imports shared
  -> never imports client
```

The client communicates through an explicit protocol/network adapter.

---

# 20. Dependency rules

| From | To | Allowed |
|---|---|---|
| client | shared | Yes |
| server | shared | Yes |
| shared | client | No |
| shared | server | No |
| client | server implementation | No |
| tutorial scripts | MapScene | No |
| tutorial scripts | BattleOverlay | No |
| BattleOverlay | tutorial scripts | No |
| BattleOverlay | MapScene | No |
| shared | Pixi/DOM | No |

These should eventually be enforced by tooling.

Start with convention and tests; add lint/path restrictions once the structure stabilizes.

---

# 21. Refactor phases

## Phase A — Baseline and invariants

Before changing behavior:

- document current baseline
- run typecheck/build
- run available tests
- smoke-test a normal match
- smoke-test tutorial if available
- record current commit/tag
- confirm `OverlayManager`
- confirm normal battle behavior

Deliverable:

```text
pre-full-architecture-refactor
```

Acceptance:

- baseline build passes
- baseline play loop works
- no gameplay changes

---

## Phase B — State ownership seam

Before large extraction:

- identify current `GameSession` gameplay state
- identify which state is truly match state
- document ownership
- do not perform a giant rewrite

Deliverable:

- state ownership table
- candidate `MatchState` interface
- no gameplay behavior change

---

## Phase C — TutorialPort

Implement:

```text
TutorialPort
TutorialRunner
MapScene adapter
```

Requirements:

- scripts import no scene/UI implementation
- failure text remains script-owned
- combat waits through the port
- tutorial calls capabilities rather than objects

Acceptance:

- tutorial completes
- wrong-action failure behavior remains correct
- normal match remains unchanged

---

## Phase D — MapHud

Extract map chrome into one root.

Requirements:

- one root
- explicit layers
- one-call chrome visibility
- tutorial can hide/show it
- resize remains correct

Acceptance:

- map looks identical
- dialogue can hide chrome
- normal controls remain functional

---

## Phase E — BattleController + BattleHost

First centralize battle construction.

Then separate battle orchestration from presentation.

Requirements:

- only `BattleHost` constructs `BattleOverlay`
- battle result is explicit
- overlay does not mutate arbitrary map state
- tutorial uses the same host seam

Acceptance:

- hunter vs hunter works
- hunter vs monster works
- monster defeat behavior unchanged
- loot/surrender behavior unchanged
- tutorial combat works

---

## Phase F — MapController

Create the orchestration seam before extracting every system.

Requirements:

- scene sends commands to controller
- controller coordinates map systems
- scene stops owning large game-flow branches
- no new world god object

Acceptance:

- movement works
- turn progression works
- combat entry works
- chests/traps/exits still work
- AI/monster turns work

---

## Phase G — Map systems

Extract one narrow responsibility per PR:

1. `ChestSystem`
2. `MonsterSystem`
3. `TrapSystem`
4. `ExitRelicSystem`
5. `ZoneQuery`
6. turn orchestration cleanup

Each extraction:

- no unrelated logic changes
- typecheck
- build
- smoke-test affected behavior

---

## Phase H — Folder hygiene

Only now:

- move files to final folders
- remove dead files
- remove duplicate naming
- fix imports
- enforce dependency boundaries

No logic changes in pure move PRs.

---

## Phase I — Shared API freeze

Audit:

- public exports
- client-only types
- accidental Pixi dependencies
- server-safe functions
- battle/AI entry points

---

## Phase J — Server skeleton

Only after the above:

- add minimal Colyseus room boundary
- import shared only
- define protocol/state boundary
- do not duplicate domain rules

---

# 22. PR cadence

Recommended:

1. `docs: revise full architecture refactor plan`
2. `chore(refactor): establish baseline and architecture checks`
3. `refactor(session): document and isolate match state ownership`
4. `feat(tutorial): introduce TutorialPort`
5. `refactor(map): extract MapHud`
6. `refactor(combat): introduce BattleHost`
7. `refactor(combat): separate BattleController from BattleOverlay`
8. `refactor(map): introduce MapController`
9. `refactor(map): extract ChestSystem`
10. `refactor(map): extract MonsterSystem`
11. `refactor(map): extract TrapSystem`
12. `refactor(map): extract ExitRelicSystem`
13. `refactor(map): extract ZoneQuery and turn orchestration`
14. `chore(client): folder hygiene`
15. `chore(shared): freeze public API`
16. `chore(server): add authority boundary`

Keep each PR reviewable.

---

# 23. Definition of done for an extraction

Every extraction PR should answer:

### Ownership

- What responsibility moved?
- Who owns it now?
- Who owns the state it mutates?

### Dependency

- What can import the new module?
- What must never import it?

### Behavior

- What existing behavior must remain identical?
- What manual smoke test proves it?

### Testability

- Can the extracted logic be tested without Pixi?

### Multiplayer

- Could the same domain operation eventually be invoked by a server?

If these questions cannot be answered, the extraction is probably premature.

---

# 24. Testing strategy

The refactor needs two kinds of tests.

## Domain tests

For `shared` and pure client logic:

- movement
- targeting
- ZoC
- combat
- AI decisions
- chest/trap rules where extracted
- turn progression

These should not require Pixi.

## Smoke tests

After every client extraction:

1. load map
2. move
3. spend a card/AP
4. enter combat
5. finish combat
6. interact with map object
7. complete/end a turn
8. run AI/monster phase
9. test tutorial path where relevant
10. resize window

---

# 25. Risk register

| Risk | Mitigation |
|---|---|
| MapWorld becomes new god object | Use `MapController` + narrow systems + explicit state |
| MapController becomes new god object | Keep rules in shared/systems; controller only orchestrates |
| GameSession becomes global mutable state | Explicit MatchState ownership |
| BattleHost becomes combat god object | Split BattleController from presentation |
| Tutorial regresses | TutorialPort before major MapScene extraction |
| UI breaks during extraction | MapHud first; visual smoke tests |
| AI regresses | Extract late; preserve shared AI; smoke-test full enemy phase |
| Import cycles | Move logic first, folders later |
| Folder churn hides behavior changes | Separate move-only PRs |
| Multiplayer requires another rewrite | Keep MatchState and shared domain server-safe |
| Over-abstraction | Every abstraction must have a concrete ownership/dependency benefit |
| Combat rework sneaks in | Keep combat rules unchanged during architecture work |

---

# 26. Success metrics

The refactor is successful when:

- `MapScene` is mostly wiring/lifecycle/presentation.
- `new BattleOverlay()` exists only in `BattleHost`.
- `BattleOverlay` does not own map state transitions.
- `BattleController` can coordinate combat without scene knowledge.
- Tutorial scripts import neither `MapScene` nor `BattleOverlay`.
- Map chrome can be hidden with one `MapHud` operation.
- `GameSession` is not the authoritative match-state bucket.
- `shared` builds without Pixi/DOM.
- Extracted map systems can be tested without Pixi where their logic permits.
- Normal non-tutorial gameplay remains behaviorally unchanged.
- A future server can consume shared rules without moving client UI code.
- No new god object replaces `MapScene`.

---

# 27. Immediate execution plan

## Step 1 — Create the architecture branch

Create a branch from the current working baseline:

```bash
git switch -c refactor/full-architecture
```

Do not make gameplay changes yet.

---

## Step 2 — Baseline

Run:

```bash
npm install
npm run build
```

Also run the project's available test/typecheck commands if present.

Then manually verify:

- map loads
- movement works
- combat opens
- combat resolves
- monster behavior works
- tutorial path works if applicable
- resize works

Record the starting commit.

---

## Step 3 — Establish architecture checks

Before extracting code, add lightweight checks for:

- shared must not import client
- shared must not import Pixi
- tutorial scripts must not import scenes
- tutorial scripts must not import BattleOverlay
- BattleOverlay must not import tutorial scripts
- client must not import server

Start with the simplest mechanism available in the project. Do not over-engineer linting before the structure settles.

---

## Step 4 — State audit

Make a short inventory of `GameSession`:

```text
FIELD
CURRENT OWNER
ACTUAL SEMANTIC OWNER
CLIENT-ONLY?
GAMEPLAY STATE?
FUTURE SERVER STATE?
```

Do not move fields blindly.

The goal is to identify the eventual `MatchState` seam.

---

## Step 5 — TutorialPort

Implement the smallest useful interface.

Do not extract unrelated MapScene code.

The first success criterion is:

```text
TutorialRunner can run without importing MapScene.
```

The scene supplies the port implementation.

---

## Step 6 — MapHud

Extract the existing map chrome without changing visual behavior.

First move ownership.

Then improve the internal structure if needed.

---

## Step 7 — BattleHost

Find every construction site of `BattleOverlay`.

Make one host responsible for construction.

Do not redesign combat rules in this PR.

---

# 28. First implementation checkpoint

After the first three implementation PRs, the architecture should look approximately like:

```text
MapScene
  |
  +--> TutorialPort adapter
  |
  +--> MapHud
  |
  +--> BattleHost
  |
  +--> existing healthy systems
```

Not yet:

```text
MapScene
  |
  +--> 14 new abstractions
  +--> MapWorld
  +--> MapController
  +--> 8 systems
  +--> 5 adapters
```

The first milestone is **better seams**, not maximum decomposition.

---

# 29. Current architectural baseline

The repository already establishes several principles worth preserving:

- composition-based entities
- shared AI/combat logic
- generic `TurnManager`
- unified hunter representation for human and AI
- shared battle presentation for hunter/monster combat
- state-aware camera behavior
- planned Colyseus networking
- npm workspace separation between client/shared/server

The refactor should build on these strengths rather than replacing them.

---

# 30. Final rule

> Extract responsibility, not lines.

The purpose of this refactor is not to make every file small.

The purpose is to make it obvious:

- where game rules live,
- where game state lives,
- where orchestration lives,
- where presentation lives,
- where tutorial behavior lives,
- and where future server authority will live.

If a change makes those answers clearer, it is probably a good refactor.

If it only moves 300 lines from one file to another, it probably is not.
