# Phase 3 — Terrain + Barrier Mesh Pipeline + Global Depth Strata

## Purpose

Move terrain faces, wall segments, fence/glass panels, barrier tops and connectors out of individual Pixi objects while preserving painter order with actors.

## Add

```text
client/src/rendering/engine/
├── world/
│   ├── StaticWorldRenderer.ts
│   ├── WorldDepthStrata.ts
│   ├── WorldDepthKey.ts
│   ├── StaticWorldMeshHandle.ts
│   └── BarrierFocusBuffer.ts
├── geometry/
│   ├── TerrainSurfaceCompiler.ts
│   ├── BarrierSurfaceCompiler.ts
│   ├── ConnectorSurfaceCompiler.ts
│   ├── PolygonClip.ts
│   └── Triangulate.ts
└── diagnostics/
    └── DepthDebugOverlay.ts
```

Keep using `barrierRenderProfile.ts`, shared wall topology and `WORLD_DEPTH_BIAS`.

## Global depth strata

Use a small sortable root:

```text
worldDepthRoot sortableChildren=true

├── StaticStratum depth=300.0
├── StaticStratum depth=300.1
├── StaticStratum depth=300.2
├── hunter A z=307.4
├── monster B z=318.4
├── chest z=340.3
└── StaticStratum depth=360.1
```

The root now sorts static strata + genuinely dynamic objects, not every static wall/terrain object.

## Depth key

Preserve existing 0.1 biases:

```ts
const DEPTH_KEY_SCALE = 10;

const depthKey =
	Math.round(
		depth * DEPTH_KEY_SCALE,
	);
```

Do not use broad bands that alter painter order.

## Static batching inside a stratum

Recommended first layout:

```text
depth stratum
  -> chunk
      -> material mesh
```

Each mesh handle retains `depthKey`, `chunkId`, `materialKey`.

This supports correct global painter order plus later local culling/replacement.

## Terrain

Compile terrain faces once. Runtime neighbor-elevation discovery disappears.

## Barriers

Move the generic barrier pipeline out of `MapRenderer`:

```text
EdgeBarrier
 -> BarrierRenderProfile
 -> StructuralEdgeRef
 -> junction/foundation heights
 -> projected skeleton
 -> visible surfaces
 -> UVs
 -> batches
```

The compiler emits geometry records, not Pixi children.

## Focused room walls

Each focusable barrier stores normal + focused vertex positions and its exact mesh-buffer range.

Room change:

```text
old boundary set
new boundary set
 -> changed edge IDs only
 -> patch those position ranges
 -> one GPU upload per affected mesh
```

No Mesh destruction and no floor compile.

## Fence/Glass occlusion

Retire permanent inverse Pixi masks in the static path.

Compile-time approach:

```text
barrier face
 -> clip/subtract foreground terrain-top polygon
 -> triangulate visible polygon
 -> batch triangles
```

Keep regression tests around raised terrain, foundations, connectors and chunk boundaries.

## Connectors

Compile one canonical connector per grid vertex using existing connector priority rules. Store incident barrier IDs.

## Migration

At the end of Phase 3, the engine renders:

```text
tile tops
terrain faces
static barriers
connectors
fog
```

The legacy active-floor MapRenderer should no longer be mounted, though its source remains for reference until Phase 7.

## Metrics

```text
engine.staticDepthStrata
engine.staticWorldMeshCount
engine.staticWorldVertices
engine.barrierFocusPatchMs
engine.barrierFocusPatchedEdges
engine.maskCount
```

Normal static mask target: `0`.

## Acceptance

```text
[ ] Terrain parity.
[ ] FullWall/LowWall/Fence/Glass parity.
[ ] Door placeholder parity.
[ ] Connector parity.
[ ] No static Fence/Glass inverse masks.
[ ] Room focus patches affected buffers only.
[ ] Room focus causes zero full-floor rebuilds.
[ ] Static world root child count collapses.
[ ] Actor painter order remains correct.
[ ] Fog/focus cause zero geometry allocation.
```
