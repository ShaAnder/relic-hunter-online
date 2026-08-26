# Relic Hunter Online — Architecture Rules

This document defines the dependency and ownership rules for the
full architecture refactor.

The goal is to establish boundaries before extracting large pieces
of the client.

## Package boundaries

```text
client  ──────► shared
server  ──────► shared

shared  ──────► client     FORBIDDEN
shared  ──────► server     FORBIDDEN
client  ──────► server     FORBIDDEN
```

The client may communicate with a future server through an explicit
network/protocol boundary. It must not import server implementation
code.

## Shared

`shared/` contains game-domain logic that must be usable by both the
client and future authoritative server.

Allowed:

- game state types
- entity/domain types
- movement rules
- combat rules
- targeting
- zones of control
- AI decisions
- cards/decks
- world generation
- items
- deterministic/pure game helpers

Forbidden:

- PixiJS
- DOM/browser APIs
- client scene classes
- UI classes
- tutorial implementation
- overlay types
- client session objects

## Client

`client/` owns:

- Pixi presentation
- local input
- camera
- HUD/UI
- scene lifecycle
- local presentation state
- client-side orchestration
- network transport/client connection

Client presentation must not become the authoritative source of
gameplay state.

## Server

`server/` will eventually own:

- authoritative match state
- player/session validation
- authoritative commands
- multiplayer rooms
- network protocol handling

The current architecture refactor does not implement multiplayer.

## State ownership

### Eventually authoritative/server-side

- player identity
- selected character
- selected loadout
- party/match membership
- ready state
- mission/match membership
- turn state
- gameplay state
- score/progression
- combat results
- rewards
- relic state
- map state

### Client presentation/local state

- current visual screen
- selected UI tab
- hover/focus
- open/closed panels
- animation state
- camera state
- HUD layout
- local input mode
- temporary visual state

A distinction must be maintained between a client's presentation of
state and authoritative game state.

## GameSession vs MatchState

`GameSession` is application/session state.

`MatchState` is gameplay state.

Do not allow `GameSession` to become a general-purpose mutable
gameplay-state container.

The eventual direction is:

```text
GameSession
    |
    v
MatchState
    ^
    |
future authoritative server
```

## Scenes

Scenes are shells.

A scene should:

1. own its root view;
2. construct or receive feature modules;
3. forward lifecycle methods;
4. handle scene-specific presentation;
5. avoid implementing domain rules;
6. avoid becoming a global gameplay-state store.

## Tutorial

Tutorial scripts must not import:

- `MapScene`
- `BattleOverlay`
- concrete Pixi UI components

Tutorial behavior should eventually use:

```text
Tutorial scripts
    ↓
TutorialRunner
    ↓
TutorialPort
    ↓
client feature adapters
```

The tutorial requests capabilities rather than concrete scene objects.

## Combat

`BattleOverlay` is presentation/input.

`BattleController` is combat flow/orchestration.

`BattleHost` is the client integration seam.

`shared` owns combat rules.

Only `BattleHost` should construct `BattleOverlay`.

## HUD

HUD composition is context-specific.

Reusable UI components may be hosted by different HUD compositions.

For example:

```text
Reusable components
    |
    +── MapHud
    |
    +── BattleHud
```

There should not be duplicated implementations of common components
such as the hand, play zone, or adventure panel merely because they
appear in multiple contexts.

## Refactor rule

> Extract responsibility, not lines.

A refactor is successful when ownership and dependency direction become
clearer, not merely when a large file becomes smaller.
