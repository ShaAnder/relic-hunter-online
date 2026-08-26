# Relic Hunter Online — State Ownership Audit

This document defines the state-ownership model for the full architecture
refactor.

The purpose is to distinguish:

1. authoritative gameplay state;
2. application/session state;
3. client presentation state;
4. derived/transient state.

This document is an ownership audit and design target. It does not by
itself require moving or rewriting existing fields. Current fields should
be classified before implementation changes are made.

---

## 1. Core ownership principle

The most important distinction is:

> The client may present, request, and temporarily derive state, but it
> must not be the authoritative owner of multiplayer gameplay state.

The eventual architecture is:

```text
                    AUTHORITATIVE STATE
                           │
                           ▼
                    Server / MatchState
                           │
                  authoritative updates
                           │
                           ▼
                    Client MatchState
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
        Controllers                  Presentation
             │                           │
             ▼                           ▼
       gameplay intent              HUD / scenes
```

The exact networking implementation is intentionally outside the scope
of this audit.

---

# 2. State categories

Every important piece of state should eventually belong to one of four
categories.

## 2.1 Authoritative gameplay state

This is state whose value affects the actual game and therefore must
eventually be controlled by the authoritative match/server.

Examples include:

- player identity
- selected character
- selected loadout
- party membership
- match membership
- ready state
- mission state
- turn state
- map state
- entity state
- combat state
- score
- progression
- rewards
- relic state
- chest state
- monster state
- gameplay-relevant events/results

The client may display or optimistically represent some of this state,
but the authoritative value must not ultimately be determined by the
client.

---

## 2.2 Application/session state

This describes the player's application/session rather than the
simulation itself.

Examples may include:

- active connection state
- current session lifecycle
- current match reference
- authentication/session information
- application-level navigation state

These fields require an audit because some concepts that appear to be
"session" state can actually represent authoritative match state.

In particular:

- character selection is authoritative gameplay/session state;
- joining a match is authoritative;
- ready state is authoritative;
- meaningful mission/match progression is authoritative.

The client may own the presentation of these states, but not their
authoritative values.

---

## 2.3 Client presentation state

This state exists to render and operate the local interface.

Examples:

- current visual screen
- selected UI tab
- hover state
- focus state
- open/closed panels
- animation state
- camera position
- camera mode
- HUD layout
- local input mode
- temporary visual effects
- local transition state

This state does not need to be replicated as gameplay state.

For example:

```text
"Inventory tab is currently selected"
```

is client presentation state.

But:

```text
"Player owns these inventory items"
```

is authoritative gameplay state.

---

## 2.4 Derived/transient state

Derived state can be calculated from authoritative or presentation
state and should generally not become an independent source of truth.

Examples:

- calculated movement range
- valid target highlights
- displayed HP percentage
- camera interpolation
- UI button enabled/disabled state
- derived score display
- temporary animation progress
- calculated combat preview
- map highlighting

When possible:

```text
source state
    ↓
derived calculation
    ↓
presentation
```

rather than:

```text
source state
    ↓
duplicated mutable state
    ↓
another source of truth
```

---

# 3. Authoritative state

The following concepts should ultimately be authoritative.

## 3.1 Player identity

Authoritative:

```text
playerId
account/user identity
match participant identity
```

Client-side representations are projections of this state.

---

## 3.2 Character selection

The selected character is authoritative.

The client owns:

```text
character selection screen
highlighted character
preview
hover state
selection animation
```

The authoritative state is:

```text
playerId → selectedCharacter
```

The eventual flow is:

```text
Client
  │
  │ select character
  ▼
Server
  │
  │ validate
  ▼
Authoritative match/session state
```

The client must not be able to unilaterally establish the authoritative
character selection.

---

## 3.3 Loadout

The selected loadout is authoritative when it affects gameplay.

Client:

```text
selected card UI
drag/drop
hover
preview
```

Authoritative:

```text
player's actual loadout
```

---

## 3.4 Party and match membership

Authoritative:

```text
who is in the party
who is in the match
which player controls which participant
```

Client:

```text
party screen
player list presentation
selection highlight
animations
```

---

## 3.5 Ready state

Authoritative:

```text
player is ready
```

Client:

```text
ready button state
visual animation
local pending input
```

---

## 3.6 Turn state

Authoritative:

```text
current turn
active participant
turn phase
available gameplay actions
```

Client presents:

```text
whose turn it is
available buttons
timers
animations
```

The client should not ultimately decide that a turn has advanced.

---

# 4. Gameplay state

The following state belongs to the match/simulation rather than
application UI.

## 4.1 Map state

Examples:

```text
map layout
tiles
doors
chests
traps
exits
relic state
map objectives
```

The client renders this state.

It should not become the authoritative owner of it.

---

## 4.2 Entity state

Examples:

```text
entity identity
position
HP
status effects
action points
movement state
inventory
equipment
cards
pilot
AI-relevant state
```

The authoritative value belongs to the match state/domain.

---

## 4.3 Combat state

Examples:

```text
participants
combatants
current combat phase
actions
targets
damage
effects
combat outcome
```

Combat rules remain in `shared`.

The client provides presentation and input.

The eventual authoritative server applies/validates combat outcomes.

---

## 4.4 Score and progression

Score/progression must not be owned by presentation classes.

Examples:

```text
victory points
kills
mission progress
XP
rewards
relic progress
match result
```

A UI component can display these values.

It should not be the source of truth.

---

# 5. GameSession vs MatchState

This is one of the most important refactor boundaries.

## GameSession

`GameSession` represents application/session-level concerns.

Potential responsibilities:

```text
connection/session lifecycle
current authenticated player
current match reference
application lifecycle
client session state
```

It must not become:

```text
a global mutable bucket containing all gameplay state
```

---

## MatchState

`MatchState` represents actual gameplay/match state.

Potential responsibilities:

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

The conceptual relationship is:

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

The client `MatchState` should therefore be thought of as a client
representation/projection of authoritative match state once multiplayer
is introduced.

---

# 6. UI navigation state

UI navigation needs a deliberate distinction.

## Client-only UI state

These remain client-side:

```text
current tab
hovered item
focused button
expanded panel
collapsed panel
open inventory tab
animation state
menu transition
camera state
```

Example:

```text
InventoryPanel.activeTab = "cards"
```

is client presentation state.

---

## Authoritative navigation/session state

Some things that look like navigation actually represent meaningful
game/session progression.

Examples:

```text
joined match
selected character
selected loadout
ready state
entered mission
match completed
```

Those should be authoritative where they affect the match.

Therefore:

> Do not classify state as client-only merely because it is currently
> stored by a UI or scene class.

Classify it according to what the state actually means.

---

# 7. HUD state

HUD objects are presentation.

They may display authoritative state:

```text
HP
AP
cards
score
turn
objectives
inventory
```

but they do not own those values.

For example:

```text
MatchState
    │
    ├── player HP
    ├── action points
    └── hand
          │
          ▼
        MapHud
          │
          ▼
      presentation
```

The same gameplay information may be presented by:

```text
MapHud
BattleHud
CharacterPanel
AdventurePanel
```

without duplicating ownership of the underlying state.

---

# 8. Combat state ownership

Combat should eventually follow:

```text
                MatchState
                    │
                    ▼
            BattleController
                    │
                    ▼
              shared combat
                    │
                    ▼
              BattleResult
                    │
                    ▼
               MatchState
```

Presentation:

```text
BattleOverlay
    │
    ├── displays combat state
    ├── accepts local player input
    └── displays results/animations
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

It presents those values and communicates player intent.

---

# 9. Tutorial state

Tutorial progression is a special case.

Tutorial-specific progression can be client-side when the tutorial is a
client experience, but tutorial actions that change actual gameplay must
go through the same gameplay/state boundaries as normal gameplay.

The desired architecture is:

```text
Tutorial script
      │
      ▼
TutorialRunner
      │
      ▼
TutorialPort
      │
      ├── MapHud
      ├── MapController
      └── BattleHost
```

Tutorial scripts should not directly mutate authoritative gameplay state.

For example:

```text
Tutorial:
"Give the player a card."
```

should eventually call a capability through the appropriate boundary,
rather than directly modifying arbitrary match-state fields.

---

# 10. State ownership audit table

Before moving fields out of `GameSession`, create an inventory using
this table.

| Field | Current owner | Semantic owner | Authoritative? | Derived? | Client-only? | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |

The same audit should eventually be performed for significant state
held by:

```text
MapScene
MapWorld
BattleOverlay
TurnManager
TutorialRunner
HUD/UI components
```

Do not automatically move every field.

The purpose of the audit is to understand what the field means before
changing its ownership.

---

# 11. Ownership rules for the refactor

## Rule 1

If a value determines the actual outcome of the game, it must not be
owned exclusively by client presentation.

## Rule 2

If a value only determines how the local interface looks or behaves,
it should normally remain client-side.

## Rule 3

If a value is derived from authoritative state, prefer calculating it
rather than creating another mutable source of truth.

## Rule 4

UI components display state; they do not become the owner of gameplay
state.

## Rule 5

Scenes coordinate presentation/lifecycle; they do not become global
gameplay-state stores.

## Rule 6

`GameSession` must not become a replacement for `MatchState`.

## Rule 7

`MatchState` must not contain Pixi, DOM, or other presentation objects.

## Rule 8

The future server should be able to own authoritative `MatchState`
without importing client code.

## Rule 9

The shared domain should remain usable without Pixi or browser APIs.

## Rule 10

Do not move state solely because a new class or folder exists.
Move it when semantic ownership is clear.

---

# 12. Refactor target

The eventual architecture should make this relationship clear:

```text
                    SERVER
                      │
                      ▼
             authoritative state
                      │
                      ▼
                 MatchState
                      │
          ┌───────────┴───────────┐
          │                       │
          ▼                       ▼
   client controllers        presentation
          │                       │
          │                ┌──────┴──────┐
          │                ▼             ▼
          │             MapHud       BattleHud
          │
          ▼
       shared
        rules
```

The exact implementation may change as the codebase evolves.

The ownership principle should not.

---

# 13. Current PR scope

This document does not require immediate implementation.

PR1 establishes the architecture rules and audit target.

The next implementation phase should inspect the actual fields currently
held by `GameSession` and classify them before creating or migrating
`MatchState`.

No gameplay state should be moved merely to make the architecture
diagram look complete.

---

# Final rule

> Put state where its meaning says it belongs, not where it happens to
> be convenient today.
