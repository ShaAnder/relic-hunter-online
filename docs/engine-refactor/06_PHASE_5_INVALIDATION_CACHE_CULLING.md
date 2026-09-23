# Phase 5 — Local Invalidation, Floor Cache, Chunk Culling

## Purpose

Make structural change local. By now static meshes are stable; this phase stops treating a structural edit as a floor-wide event.

## Add

```text
client/src/rendering/engine/
├── invalidation/
│   ├── RenderInvalidation.ts
│   ├── RenderInvalidationQueue.ts
│   ├── StructuralRevision.ts
│   └── ChunkDependencyIndex.ts
├── floor/
│   ├── FloorRenderCache.ts
│   ├── FloorRenderInstance.ts
│   └── LowerFloorUnderlay.ts
└── culling/
    ├── ChunkVisibilitySystem.ts
    ├── CameraWorldBounds.ts
    └── CullStats.ts
```

## Invalidation categories

```ts
type RenderInvalidation =
	| { kind: "presentation"; tileKeys: readonly string[] }
	| { kind: "barrier-presentation"; edgeKeys: readonly string[] }
	| { kind: "dynamic-object"; objectIds: readonly string[] }
	| { kind: "chunk-geometry"; chunkIds: readonly string[] }
	| { kind: "floor-geometry" };
```

The last case is rare.

## Chunk dependencies

Precompute boundary relationships:

```text
tile change
 -> owner chunk
 -> adjacent chunk when boundary topology depends on it

barrier change
 -> edge owner chunk
 -> endpoint connector owner chunks

vertex/connector change
 -> incident barrier chunks
```

Do not rediscover this during invalidation.

## Structural mutation example

```text
wall destroyed
 -> authoritative EdgeBarrier changes
 -> structural revision++
 -> dependency lookup
 -> dirty chunks {2,3, 3,3}
 -> recompile those chunks only
 -> replace matching GPU handles
```

Unchanged chunks keep their GPU resources.

## Floor cache

Cache `FloorRenderInstance` by:

```text
floorIndex
structural revision
material revision
```

Switching back to an unchanged floor should reuse compiled/GPU resources.

Use a small LRU only if future maps have many floors.

## Lower-floor underlay

The underlay is its own cached `FloorRenderInstance`.

Overrides:

```text
force washed
wall height scale
Y offset
no dynamic actors
no player fog
```

Do not rebuild it because active-floor fog changes.

## Chunk culling

Cull by chunk handle, not tile.

Ground chunk containers can be toggled directly.

World meshes keep `chunkId` even when inserted under global depth strata, so culling toggles those mesh handles.

## Camera cadence

Recompute visible chunk set only when camera/zoom/viewport/floor changes enough to affect the set. Keep a one-chunk safety margin.

The engine should own chunk culling because it already knows chunk bounds; recursive scene-bound culling is not the primary architecture.

## Geometry invalidation rules

Does NOT invalidate static geometry:

```text
fog
camera
actor movement
room-focus buffer patch
water/grass clocks
particles
door open/close
```

Does invalidate local geometry:

```text
wall add/destroy
terrain elevation structural change
static building add/remove
static topology/material change
editor structural change
```

Floor-wide invalidation:

```text
map regeneration
complete floor replacement
compiler schema revision during development
```

## Metrics

```text
engine.dirtyChunks
engine.chunkRecompileMs
engine.chunkMeshesReplaced
engine.floorCacheHits
engine.floorCacheMisses
engine.visibleChunks
engine.culledChunks
```

## Acceptance

```text
[ ] Wall destruction recompiles local dependent chunks only.
[ ] Connectors remain correct across chunk boundaries.
[ ] Returning to unchanged floor hits cache.
[ ] Lower-floor underlay does not rebuild on movement/fog.
[ ] Offscreen chunks stop rendering.
[ ] Camera movement allocates no geometry.
[ ] Fog invalidates no geometry.
[ ] Door animation invalidates no static chunks.
[ ] Full-floor compile is rare and measured.
```
