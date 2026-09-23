# Engine Rendering Contract

These are the non-negotiable rules for Phases 1–7.

## Shared owns semantics

`@relic-hunter/shared` continues to own `Grid`, `EdgeGrid`, `EdgeBarrier`, elevation, traversal, line of sight, rooms/privacy, fog knowledge, map generation, and structural topology.

The renderer must not invent gameplay semantics such as `BrickWall` or `ConcreteTraversal`.

## Compiled visual data is Pixi-free

Everything under `client/src/rendering/engine/compiler/` must be testable without a Pixi `Application`.

No `Texture`, `Container`, `Graphics`, `Mesh`, or `Shader` inside compiled floor data. Use stable IDs such as `MaterialKey`, `ChunkId`, `SurfaceId`, and `DepthKey`.

## Static geometry and presentation are separate

Static geometry changes for terrain elevation, added/destroyed barriers, map regeneration, static building placement/removal, or structural topology changes.

Presentation changes for fog, room focus, selection, lower-floor wash, and camera state.

A presentation change must never trigger a whole-floor compile.

## Stable visual IDs

Examples:

```text
tile:10,12
terrain:E:10,12
barrier:north:10,12
connector:11,12
prop:building-3:facade-east
```

Stable IDs enable local mutation, debugging, profiling, and future multiplayer reconciliation.

## Chunks are structural invalidation units

Initial chunk size: `8 x 8` logical tiles. A 40×40 map is about 25 chunks.

Chunk ownership is for compilation, geometry storage, invalidation, culling, and GPU lifetime. It is not the final painter-order hierarchy.

## World depth uses global strata

Do not put an entire chunk's world geometry under one chunk parent because it must interleave with actors and geometry from other chunks.

Use:

```text
worldDepthRoot sortableChildren=true
children:
    static depth-stratum containers
    dynamic actors
    dynamic doors
    chests
```

Preserve `WORLD_DEPTH_BIAS`. Use deterministic depth keys such as `Math.round(projectedDepth * 10)` so current 0.1 biases remain distinct.

The root sorts tens/hundreds of strata plus dynamic objects, not ~1400 static objects.

## Safe batching rule

Batch together only geometry sharing:

```text
same depth key
same GPU material/shader
same texture resource
compatible blend state
compatible presentation representation
```

Never combine arbitrary world surfaces just because they share a texture.

## Fog knowledge is permanent after discovery

Transitions:

```text
unseen -> visible
visible -> explored
explored -> visible
```

Remove `explored -> unseen after 5 turns`.

Keep `exploredTiles: Record<string, number>` as last-seen metadata. Static map knowledge may remain washed while explored. Live actors still require current visibility.

## No per-tile Pixi object contract

Common path:

```text
many tile quads
 -> one/few chunk material meshes
```

A normal tile must not require its own Container + Graphics + wash object.

## Zero steady-state geometry allocation

During idle, actor movement, fog reveal, camera pan, water animation, and grass animation, map geometry allocation should be zero.

Allocate typed arrays/meshes during floor compile, chunk mount, or local structural invalidation only.

## Animated materials scale by family

One water material clock, one grass material clock. Never one JS update per animated tile.

## Dynamic things stay dynamic

Do not bake animated doors, destructible barriers, actors, changing chests, or temporary FX into static batches.

## Masks are a last resort

Current Fence/Glass inverse masks should be replaced by compile-time clipping/triangulation for the normal static path.

## Culling is chunk-level

Do not perform per-tile viewport culling.

## Legacy renderer is temporary

Keep `client/src/rendering/MapRenderer.ts` as a known-good reference while migrating. Do not add new engine architecture to it. Remove it only after Phase 7 parity/performance gates pass.
