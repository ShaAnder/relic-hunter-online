# Phase 4 — Dynamic World, Event-Driven Visibility, Doors

## Purpose

Separate genuinely dynamic things from static GPU world geometry and remove brute-force per-frame entity visibility work.

## Add

```text
client/src/rendering/engine/
├── dynamic/
│   ├── DynamicWorldRenderer.ts
│   ├── DynamicWorldHandle.ts
│   ├── DynamicBarrierRenderer.ts
│   ├── DoorView.ts
│   └── DynamicDepthController.ts
├── visibility/
│   ├── EntityVisibilitySystem.ts
│   ├── VisibilityRevision.ts
│   └── VisibilityEvents.ts
└── objects/
    ├── WorldObjectTypes.ts
    └── WorldObjectRegistry.ts
```

## Dynamic objects remain individual

Hunters, monsters, chests, doors and stateful interactive props are appropriate individual views because they actually change.

The engine win is that they now share their sortable parent with only a small static-strata set.

## Depth updates

```text
stationary actor:
    no zIndex write

moving actor:
    update only when projected ground-contact Y changed

teleport/floor switch:
    one immediate update
```

No static child changes during actor movement.

## Event-driven visibility

Replace the `MapScene.update()` sweep across hunters/monsters/chests.

Visibility recomputes only when relevant inputs change:

```text
observer coord
fog currentlyVisible revision
viewed floor
room/privacy context
entity coord/floor
spawn/despawn
LOS-changing structure
```

Idle frames should perform zero entity visibility checks.

## Visibility semantics

```text
static map:
    unseen / explored / visible

dynamic live entity:
    current visibility only
```

Explored terrain must not leak a hunter/monster standing there now.

## Doors

Move doors out of static barrier batches before animation.

Shared/server state:

```ts
type DoorState =
	| "closed"
	| "opening"
	| "open"
	| "closing";
```

`CompiledFloorVisual` emits a dynamic barrier anchor; `DynamicBarrierRenderer` owns the view.

Door open/close does not rebuild neighboring static walls. Permanent structural destruction does.

## World-object seam

Use:

```ts
type WorldObjectRenderKind =
	| "sprite"
	| "facade"
	| "composite"
	| "procedural";

type WorldObjectLifetime =
	| "static"
	| "stateful"
	| "transient";
```

This supports authored buildings and future placeables without adding gameplay wall semantics.

## MapScene direction

Move toward renderer events such as:

```text
setViewedFloor
setObserver
onFogChanged
onEntityMoved
onEntitySpawned
onEntityRemoved
```

Do not create a replacement god object.

## Metrics

```text
engine.visibilityRecomputes
engine.entitiesVisibilityChecked
engine.dynamicDepthWrites
engine.dynamicObjectCount
engine.doorUpdates
```

Idle targets: visibility checks `0`, dynamic depth writes `0`.

## Acceptance

```text
[ ] Hunters/monsters/chests depth correctly.
[ ] Idle frames do not visibility-scan all entities.
[ ] One moving actor does not update unrelated actors.
[ ] Explored areas do not leak live entities.
[ ] Door has a dynamic anchor/stateful rendering path.
[ ] Door state does not rebuild static floor geometry.
[ ] Spectator/privacy/LOS rules remain correct.
[ ] Gameplay rules stay outside renderer code.
```
