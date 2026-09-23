# Phase 2 — Ground Chunk Mesh Pipeline + Fog Presentation Buffer

## Purpose

Replace the largest scene-graph population — roughly 1444 tile Graphics — with chunked GPU geometry.

This is the first visible switch to the new renderer.

## Add

```text
client/src/rendering/engine/
├── batching/
│   ├── QuadBatchBuilder.ts
│   ├── MeshBatchData.ts
│   └── MaterialBatchKey.ts
├── gpu/
│   ├── GpuMaterialLibrary.ts
│   ├── StaticMeshFactory.ts
│   └── BufferUpdate.ts
├── floor/
│   ├── FloorRenderer.ts
│   ├── GroundChunkRenderer.ts
│   └── GroundChunkHandle.ts
└── presentation/
    ├── FogPresentationBuffer.ts
    ├── FogChunkHandle.ts
    └── PresentationDiff.ts
```

## Ground batching

For each 8×8 chunk, group tile quads by GPU material batch key:

```text
material family
texture variant
blend state
shader family
```

Example:

```text
chunk 2,3
  road-variant-0 mesh
  pavement-variant-1 mesh
  grass-variant-2 mesh
```

Do not force texture arrays/atlases yet.

## QuadBatchBuilder

The builder accumulates ordinary arrays for positions/UVs/indices and freezes them into typed arrays when a chunk is mounted or rebuilt.

Each quad = 4 vertices + 6 indices.

Never allocate one `Float32Array` per quad.

## GPU objects

Use Pixi v8 `MeshGeometry` + `Mesh` for chunk batches.

Static ground does not need per-frame geometry updates.

## Fog data

CPU-side contract:

```ts
enum FogCode {
	Unseen = 0,
	Explored = 1,
	Visible = 2,
}
```

Store one compact `Uint8Array(width * height)` plus previous-state/dirty tracking.

`FogPresentationBuffer` tracks dirty tile indices and dirty chunk IDs.

## Fog rendering

Do not create one wash Graphics per tile.

Use:

```text
static chunk ground mesh
+
one chunk presentation mesh / presentation shader data
```

Overlay geometry is built once.

Fog updates modify only presentation data for dirty chunks. No new Graphics/Mesh/Container/geometry during reveal.

A simple dedicated fog shader is acceptable here; Phase 6 later generalizes the material engine.

## Ground root

```text
activeFloorRoot
├── groundRoot
│   ├── GroundChunk 0,0
│   ├── GroundChunk 1,0
│   └── ...
├── worldDepthRoot
└── overlays
```

Ground chunks may be ordinary chunk containers because ground never needs to interleave with actors.

## Migration

During Phase 2:

```text
NEW:
tile tops
tile materials
fog over tile tops

LEGACY:
terrain faces
barriers
connectors
```

Use a dev feature flag for ground backend selection.

## Material parity

Preserve current deterministic variant hashing based on map seed, floor, coord and tile code.

## Metrics

Add:

```text
engine.groundChunkCount
engine.groundMeshCount
engine.groundVertexCount
engine.fogDirtyChunks
engine.fogUpdateMs
```

The top-level ground object count should collapse by roughly an order of magnitude.

## Acceptance

```text
[ ] New ground visually matches legacy.
[ ] Texture variants are identical.
[ ] Elevation positions are identical.
[ ] True-footprint seam behavior is preserved.
[ ] Unseen/explored/visible semantics are correct.
[ ] Fog changes allocate zero new ground geometry.
[ ] Ground movement/fog does not call legacy full map build.
[ ] Ground object count collapses substantially.
[ ] Typecheck/build/tests pass.
```
