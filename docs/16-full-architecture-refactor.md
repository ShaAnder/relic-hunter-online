# Full Architecture Refactor — Relic Hunter Online

**Status:** Revised master plan + responsive HUD/input routing update  
**Date:** 2026-08-27  
**Scope:** Entire monorepo (`client/`, `shared/`, `server/`, `docs/`)  
**Supersedes:** Earlier map/tutorial-only architecture drafts where they conflict  
**Primary goal:** Finish the separation already emerging in the codebase without replacing one god object with another.

> This copy incorporates the agreed responsive HUD, panel scrolling, touch/drag, and camera/input ownership design. It is intended to replace the previous architecture-plan copy in the repository.

---

## 1. Executive summary

Relic Hunter Online already has several strong architectural foundations:

- `shared/` contains genuinely reusable game-domain logic.
- Entities use composition rather than an inheritance hierarchy.
- Human and AI hunters share the same state shape.
- `TurnManager` is generic over entities with the required traits.
- `OverlayManager` already provides a stack-based global overlay policy.
- The game is intentionally preparing for Colyseus, but multiplayer authority is not part of this refactor.

The main remaining problem is **responsibility concentration in the client**, especially around `MapScene`, combat presentation/orchestration, session/match state, and local input routing.

The refactor therefore has five architectural outcomes:

1. **Thin scene shells.**
2. **Explicit state ownership.**
3. **Commands/orchestration separated from presentation.**
4. **A stable shared domain that can later run on the server.**
5. **Explicit input ownership between HUD surfaces and the camera.**

The most important rule is:

> Do not move code merely to make files smaller. Move code to establish ownership and dependency boundaries.

---

## 2. Goals

1. Keep `shared/` pure and runnable without Pixi, DOM, or tutorial code.
2. Keep `client/` responsible for presentation, local input, camera, and local orchestration.
3. Keep future server authority isolated from Pixi and client UI.
4. Reduce `MapScene` to a scene shell and binding/orchestration role.
5. Prevent `MapWorld` or another extracted class from becoming a replacement god object.
6. Separate match state from application/session state.
7. Make combat orchestration independent from `BattleOverlay`.
8. Make tutorial scripts depend only on a capability-based `TutorialPort`.
9. Give the map HUD one root so map chrome can be hidden/shown in one operation.
10. Make HUD layout responsive to available viewport dimensions.
11. Make scrollable HUD panels consume their own wheel/touch/drag input.
12. Route map gestures to the camera only when no HUD surface owns the gesture.
13. Preserve normal non-tutorial behavior after every refactor phase.
14. Prefer incremental, reviewable PRs over a big-bang rewrite.
15. Make future multiplayer a continuation of the architecture, not a second rewrite.

---

## 3. Non-goals

- Combat-rules redesign.
- Full Colyseus implementation.
- Supabase/auth implementation.
- Unity migration.
- Rewriting tutorial prose.
- Rebuilding every UI screen.
- Creating one global UI god object.
- Reorganizing folders for aesthetic reasons before ownership boundaries exist.
- Rewriting healthy shared systems merely because they are not in the new folder tree.
- Making every HUD panel scrollable regardless of whether its content needs it.
- Putting gameplay authority into `MapHud`.
- Making the camera responsible for deciding the internal behavior of individual HUD widgets.

---

## 4. Architectural principles

### 4.1 Architecture is dependency direction, not folders

Folders are a consequence of ownership.

A file should move when its responsibility has a clear home, not simply because a new folder exists.

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

### 4.2 Shared is domain, not infrastructure

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

---

## 5. State ownership

| State / concern                 | Owner                                      |
| ------------------------------- | ------------------------------------------ |
| Combat rules                    | `shared`                                   |
| Movement rules                  | `shared`                                   |
| AI decisions                    | `shared`                                   |
| Targeting / ZoC rules           | `shared`                                   |
| World-generation rules          | `shared`                                   |
| Actual match/game state         | `MatchState` / future authoritative server |
| Application/session concerns    | `GameSession`                              |
| Pixi display objects            | `client`                                   |
| Camera state                    | `client`                                   |
| Local input mode                | `client`                                   |
| HUD visibility/layout           | `client` / `MapHud`                        |
| HUD scroll position             | `client` / scrollable HUD component        |
| Tutorial progress               | `TutorialRunner`                           |
| Tutorial prose/data             | tutorial scripts                           |
| Overlay lifecycle               | `OverlayManager`                           |
| Network connection              | `client`                                   |
| Authoritative multiplayer state | future `server`                            |

Important distinction:

`GameSession` is not the same thing as the game's authoritative state.

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

## 6. Target runtime architecture

```text
                    PLAYER INPUT
                          |
                          v
                 +------------------+
                 |  Input ownership |
                 |     routing      |
                 +--------+---------+
                          |
             +------------+------------+
             |                         |
             v                         v
        HUD surface?                 map
             |                         |
             v                         v
       consume gesture            Camera / MapInput
             |
             v
        HUD behavior
```

For gameplay commands:

```text
PLAYER INPUT
     |
     v
MapController
     |
     | commands / intent
     v
+----+-----------+-----------+
|                |           |
v                v           v
movement      combat      turn
|             request      request
v                |           v
shared        BattleHost  TurnRunner
rules
```

The key flow is:

```text
input
  -> ownership decision
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

## 7. Target client structure

Conceptual target:

```text
client/src/
  core/
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
    ScrollablePanel.ts
    TutorialMarkers.ts

  camera/
    CameraController.ts

  input/
    InputRouter.ts
    GestureRouter.ts

  tutorial/
    TutorialPort.ts
    TutorialRunner.ts
    tutorialTypes.ts
    dialogue.ts
    scripts/

  ui/
    generics/
    buttons/
    overlay/
    Hand.ts
    PlayZone.ts
    InventoryPanel.ts
    CharacterPanel.ts
    ...

  scenes/
    MapScene.ts
    ...
```

This is conceptual. Do not mass-move files just to match the tree.

`MapController` is orchestration, not the new world god object.

`MatchState` contains state.

Map systems operate on relevant state.

`MapScene` binds Pixi lifecycle to these components.

---

## 8. MapScene policy

Every scene should:

1. Own its root view.
2. Construct/receive feature modules.
3. Forward lifecycle methods.
4. Forward resize/update where appropriate.
5. Avoid implementing domain rules.
6. Avoid owning combat resolution.
7. Avoid owning tutorial scripts.
8. Avoid becoming a mutable global state store.
9. Avoid becoming the global owner of HUD input routing.

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

---

## 9. MapController

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
- own camera rendering
- own the internal scrolling behavior of HUD panels

---

## 10. Map systems

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

Anti-god-object rule:

If `MapController` starts accumulating hundreds of lines of actual game rules, stop and extract the rule.

If `MapWorld` starts accumulating hundreds of lines of orchestration, stop and introduce/strengthen `MapController`.

---

## 11. Turn architecture

The current project already has a useful generic `TurnManager`.

Preserve that strength.

Do not create separate state models for human and AI hunters unless the domain actually requires them.

The new orchestration should distinguish:

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

## 12. Combat architecture

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

Pure domain rules:

- combat resolution
- targeting
- combat geometry
- ZoC
- domain-level combat calculations

---

## 13. Tutorial architecture

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
  /     |      MapHud MapController BattleHost
```

Tutorial scripts must request capabilities rather than concrete scene/UI objects.

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
getMapScene();
getBattleOverlay();
getHud();
```

---

## 14. MapHud

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
- responsive/compact layout decisions
- exposing HUD interaction surfaces to the input-routing layer

The tutorial should be able to hide map chrome without knowing which individual widgets exist.

Do not make `MapHud` a global UI class shared by unrelated scenes.

---

# 15. Responsive HUD + Input Ownership

This section is a deliberate addition to the architecture plan.

## 15.1 Problem

Small screens have less vertical space.

Panels such as:

- Match Log
- Hunter/Character panels
- Inventory
- other content-heavy HUD surfaces

must become **size-aware** rather than simply shrinking indefinitely.

When a panel's available height becomes constrained:

```text
available viewport
      |
      v
responsive panel layout
      |
      +--> compact dimensions
      |
      +--> constrained content area
      |
      +--> scrolling when content exceeds bounds
```

The goal is to preserve usability rather than force the entire HUD to scale down.

## 15.2 Input ownership rule

The core rule is:

> **The component receiving the gesture owns the gesture.**

A wheel, touch, or drag gesture must be routed to the most specific interactive surface under the pointer.

Conceptually:

```text
Pointer / wheel / touch
          |
          v
     Input Router
          |
     +----+----+
     |         |
 HUD surface  no HUD surface
     |         |
     v         v
consume      camera/map
```

Examples:

```text
Wheel over Match Log
    -> Match Log scrolls
    -> camera does not move
```

```text
Wheel over map
    -> camera responds
```

```text
Touch drag inside Match Log
    -> Match Log scrolls
```

```text
Touch drag on map
    -> camera pans
```

The camera must not blindly consume all wheel/touch/drag events.

## 15.3 Do not hard-code panel rectangles in the camera

Avoid logic such as:

```ts
if (mouseX > log.x && mouseX < log.right) {
	// scroll log
}
```

The camera should not know the geometry or internal behavior of individual HUD panels.

Instead, scrollable surfaces should expose a capability-oriented interaction contract.

Conceptually:

```ts
interface ScrollSurface {
	hitTest(x: number, y: number): boolean;
	handleWheel(delta: number): boolean;
	handleDrag(deltaX: number, deltaY: number): boolean;
}
```

Exact interfaces should be designed after inspecting the existing input/camera implementation; do not introduce abstractions without demonstrated ownership benefit.

## 15.4 Shared scroll behavior

Potentially scrollable HUD panels should use one common interaction model:

```text
ScrollablePanel
  ├── wheel
  ├── pointer/touch drag
  ├── bounds/clamping
  └── gesture consumption
```

Likely candidates include:

```text
LogPanel
HunterSummaryPanel
InventoryPanel
```

but only panels that genuinely need overflow handling should adopt it.

Do not create separate custom scrolling implementations for every panel.

## 15.5 Mobile interaction

The client should support:

```text
drag inside scrollable HUD panel
    -> panel scroll

drag on map
    -> camera pan
```

The implementation must prevent the same gesture from propagating from the panel to the camera.

This is an input-routing concern, not a gameplay-state concern.

## 15.6 Camera ownership

Camera state remains client-local.

The camera owns:

- position
- zoom
- viewport/bounds
- map panning
- camera animation/interpolation

The camera does **not** own:

- Match Log scroll position
- Inventory scroll position
- Hunter panel scroll position
- HUD layout
- gameplay state

## 15.7 Recommended implementation boundary

The eventual client structure may use:

```text
input/
  InputRouter.ts
  GestureRouter.ts

camera/
  CameraController.ts

hud/
  MapHud.ts
  ScrollablePanel.ts
```

These are proposed seams, not mandatory files.

The existing implementation should be inspected before creating them.

## 15.8 Responsive layout rule

`MapHud` should calculate layout from available viewport dimensions.

Conceptually:

```text
viewport dimensions
        |
        v
MapHud.resize(...)
        |
        +--> normal layout
        |
        +--> compact layout
                  |
                  +--> constrained panel height
                  +--> scroll enabled where required
```

Do not make gameplay state depend on HUD dimensions.

---

## 16. OverlayManager

Keep the existing global stack policy.

Overlay visibility must not automatically imply simulation pause.

Each overlay should eventually expose policy such as:

```text
blocksInput
pausesSimulation
```

Examples:

```text
Battle        -> blocks input, pauses local map simulation
Pause         -> blocks input, pauses simulation
Dialogue      -> blocks relevant input, may pause simulation
Notification  -> may not pause simulation
```

---

## 17. GameSession vs MatchState

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

## 18. Shared architecture

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

---

## 19. Server boundary

For this refactor:

```text
server/
  src/
    rooms/
    index.ts
```

is enough.

Do not implement multiplayer here.

Future direction:

```text
server
  -> authoritative MatchState
  -> imports shared
  -> never imports client
```

---

## 20. Dependency rules

| From             | To                            | Allowed |
| ---------------- | ----------------------------- | ------- |
| client           | shared                        | Yes     |
| server           | shared                        | Yes     |
| shared           | client                        | No      |
| shared           | server                        | No      |
| client           | server implementation         | No      |
| tutorial scripts | MapScene                      | No      |
| tutorial scripts | BattleOverlay                 | No      |
| BattleOverlay    | tutorial scripts              | No      |
| BattleOverlay    | MapScene                      | No      |
| shared           | Pixi/DOM                      | No      |
| camera           | HUD implementation details    | No      |
| HUD panel        | camera implementation details | No      |

The last two rules are intentional: interaction ownership should be mediated by the input-routing boundary rather than by mutual knowledge.

---

## 21. Refactor phases

### Phase A — Baseline and invariants

Before changing behavior:

- document current baseline
- run typecheck/build
- run available tests
- smoke-test a normal match
- smoke-test tutorial if available
- record current commit/tag
- confirm `OverlayManager`
- confirm normal battle behavior

### Phase B — State ownership seam

Before large extraction:

- identify current `GameSession` gameplay state
- identify which state is truly match state
- document ownership
- do not perform a giant rewrite

### Phase C — TutorialPort

Implement:

```text
TutorialPort
TutorialRunner
MapScene adapter
```

First success criterion:

```text
TutorialRunner can run without importing MapScene.
```

### Phase D — MapHud

Extract map chrome into one root.

Requirements:

- one root
- explicit layers
- one-call chrome visibility
- tutorial can hide/show it
- resize remains correct
- remaining map buttons and `ActionMenu` belong to the HUD
- HUD owns presentation/layout, while gameplay consequences remain outside the HUD

### Phase E — BattleController + BattleHost

First centralize battle construction.

Then separate battle orchestration from presentation.

### Phase F — MapController

Create the orchestration seam before extracting every system.

### Phase G — Map systems

Extract one narrow responsibility per PR:

1. `ChestSystem`
2. `MonsterSystem`
3. `TrapSystem`
4. `ExitRelicSystem`
5. `ZoneQuery`
6. turn orchestration cleanup

### Phase H — Folder hygiene

Only now:

- move files to final folders
- remove dead files
- remove duplicate naming
- fix imports
- enforce dependency boundaries

No logic changes in pure move PRs.

### Phase I — Shared API freeze

Audit:

- public exports
- client-only types
- accidental Pixi dependencies
- server-safe functions
- battle/AI entry points

### Phase J — Server skeleton

Only after the above:

- add minimal Colyseus room boundary
- import shared only
- define protocol/state boundary
- do not duplicate domain rules

---

# 22. Camera/Input Rework — dedicated sub-phase

The responsive HUD work belongs with the broader camera/input rework, but should be treated as an explicit sub-phase rather than hidden inside camera movement.

Recommended order:

```text
Camera/Input Rework
│
├── 1. Camera movement
├── 2. Camera bounds
├── 3. Zoom / responsive viewport
├── 4. Pointer/touch gesture interpretation
└── 5. Scroll ownership / gesture routing
      ├── HUD scroll
      ├── camera scroll
      ├── panel drag-to-scroll
      └── mobile drag-to-pan
```

The important architectural separation is:

```text
MapHud
    -> owns HUD presentation and panel interaction

InputRouter / GestureRouter
    -> determines who owns the current gesture

CameraController
    -> owns camera movement

MapController
    -> owns gameplay commands
```

This work should **not** be implemented as ad-hoc camera checks against specific panel rectangles.

---

## 23. PR cadence

Recommended:

1. `docs: revise full architecture refactor plan`
2. `chore(refactor): establish baseline and architecture checks`
3. `refactor(session): document and isolate match state ownership`
4. `feat(tutorial): introduce TutorialPort`
5. `refactor(map): extract MapHud`
6. `refactor(input): responsive HUD and gesture ownership`
7. `refactor(combat): introduce BattleHost`
8. `refactor(combat): separate BattleController from BattleOverlay`
9. `refactor(map): introduce MapController`
10. `refactor(map): extract ChestSystem`
11. `refactor(map): extract MonsterSystem`
12. `refactor(map): extract TrapSystem`
13. `refactor(map): extract ExitRelicSystem`
14. `refactor(map): extract ZoneQuery and turn orchestration`
15. `chore(client): folder hygiene`
16. `chore(shared): freeze public API`
17. `chore(server): add authority boundary`

Keep each PR reviewable.

---

## 24. Definition of done for an extraction

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

For input work, additionally answer:

### Gesture ownership

- Which surface owns wheel input?
- Which surface owns drag input?
- What happens when the pointer is over no HUD surface?
- Can the gesture leak from a HUD panel to the camera?

If these questions cannot be answered, the extraction is probably premature.

---

## 25. Testing strategy

The refactor needs two kinds of tests.

### Domain tests

For `shared` and pure client logic:

- movement
- targeting
- ZoC
- combat
- AI decisions
- chest/trap rules where extracted
- turn progression

These should not require Pixi.

### Client smoke tests

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
11. test compact viewport
12. scroll Match Log
13. scroll any other constrained HUD panel
14. drag inside a HUD panel on mobile/touch
15. drag on map to pan camera
16. verify HUD gestures never move the camera
17. verify map gestures never scroll a HUD panel

---

## 26. Risk register

| Risk                                      | Mitigation                                                          |
| ----------------------------------------- | ------------------------------------------------------------------- |
| MapWorld becomes new god object           | Use `MapController` + narrow systems + explicit state               |
| MapController becomes new god object      | Keep rules in shared/systems; controller only orchestrates          |
| GameSession becomes global mutable state  | Explicit MatchState ownership                                       |
| BattleHost becomes combat god object      | Split BattleController from presentation                            |
| Tutorial regresses                        | TutorialPort before major MapScene extraction                       |
| UI breaks during extraction               | MapHud first; visual smoke tests                                    |
| AI regresses                              | Extract late; preserve shared AI; smoke-test full enemy phase       |
| Import cycles                             | Move logic first, folders later                                     |
| Folder churn hides behavior changes       | Separate move-only PRs                                              |
| Multiplayer requires another rewrite      | Keep MatchState and shared domain server-safe                       |
| Over-abstraction                          | Every abstraction must have a concrete ownership/dependency benefit |
| Combat rework sneaks in                   | Keep combat rules unchanged during architecture work                |
| HUD becomes unusable on small screens     | Responsive height constraints + scrolling                           |
| HUD scroll moves camera                   | Explicit gesture ownership/input routing                            |
| Mobile panel drag pans camera             | Panel consumes the gesture before camera                            |
| Camera learns HUD internals               | Route through input/gesture boundary                                |
| Multiple custom scrolling implementations | Common scroll interaction model                                     |
| Responsive layout changes gameplay        | Keep viewport/layout state client-local                             |

---

## 27. Success metrics

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
- Compact viewport HUD remains usable.
- Scrollable HUD surfaces consume their own wheel/drag gestures.
- Map dragging pans the camera only when no HUD surface owns the gesture.
- HUD drag never accidentally pans the camera.
- Camera code does not contain hard-coded knowledge of individual HUD panels.

---

## 28. Immediate execution plan

The current work has already reached the MapHud extraction stage.

### Current checkpoint

```text
State ownership audit
        ✓
Tutorial/architecture planning
        ✓
MapHud root
        ✓
Common HUD extraction
        ✓
Remaining map controls
        ← current completion target
ActionMenu
        ← current completion target
Final MapHud cleanup
        ↓
Camera/Input Rework
        ↓
Responsive HUD + gesture ownership
        ↓
BattleHost
        ↓
BattleController
        ↓
MapController
        ↓
Map systems
```

### Next implementation step

Finish the current MapHud extraction completely before starting camera/input work.

Specifically:

1. Verify the remaining map buttons are owned by `MapHud`.
2. Verify `ActionMenu` is owned by `MapHud`.
3. Verify gameplay callbacks remain outside `MapHud`.
4. Verify HUD interactive surfaces are exposed through the HUD boundary.
5. Run architecture/type/build checks.
6. Complete the MapHud smoke test.

Only after that should the camera/input rework begin.

---

## 29. First camera/input checkpoint

Before implementing gesture routing:

```text
Audit current camera input
        ↓
Audit current Pixi pointer/wheel listeners
        ↓
Audit LogPanel / Hunter panel / Inventory interaction
        ↓
Define gesture ownership
        ↓
Define smallest necessary interface
        ↓
Implement panel scroll
        ↓
Implement camera fallback
        ↓
Implement mobile drag
        ↓
Test event consumption
```

Do not start by creating a large generic input framework.

Start from the actual current event flow and extract only the boundary that is demonstrated to be necessary.

---

## 30. Final rule

> Extract responsibility, not lines.

The purpose of this refactor is not to make every file small.

The purpose is to make it obvious:

- where game rules live,
- where game state lives,
- where orchestration lives,
- where presentation lives,
- where input ownership lives,
- where camera state lives,
- where tutorial behavior lives,
- and where future server authority will live.

If a change makes those answers clearer, it is probably a good refactor.

If it only moves 300 lines from one file to another, it probably is not.
