# Phase 1 — Renderer Kernel, Pure Visual Compiler, Permanent Fog

## Purpose

Build the architecture the new renderer will stand on before replacing visible rendering.

At the end of this phase:

```text
legacy MapRenderer still draws the game

BUT

the new compiler independently compiles the same floor into
deterministic, Pixi-free visual data.
```

This gives a safe migration path instead of replacing a 1300+ line renderer blind.

## Add

```text
client/src/rendering/engine/
├── compiler/
│   ├── CompiledFloorVisual.ts
│   ├── MapVisualCompiler.ts
│   ├── TileTopologyCompiler.ts
│   ├── VisualIds.ts
│   └── VisualBounds.ts
├── chunks/
│   ├── ChunkCoord.ts
│   └── RenderChunkGrid.ts
├── materials/
│   ├── MaterialKey.ts
│   ├── TileMaterialResolver.ts
│   └── BarrierMaterialResolver.ts
├── presentation/
│   ├── FloorPresentationState.ts
│   └── RenderInvalidation.ts
└── diagnostics/
    └── VisualCompilerDiagnostics.ts
```

Edit:

```text
shared/src/world/FogOfWar.ts
client/src/scenes/MapScene.ts
client/src/rendering/materials/mapMaterialFactory.ts
client/src/rendering/materials/barrierMaterialFactory.ts
```

## 1. Permanent exploration

Remove:

```ts
FOG_DECAY_TURNS
pruneDecayedTiles()
```

Keep:

```ts
exploredTiles: Record<string, number>;
currentlyVisible: Record<string, true>;
```

The number becomes `last turn directly seen`, not expiry time.

`getTileVisibility()` becomes logically:

```ts
if (currentlyVisible[key]) return "visible";
if (exploredTiles[key] !== undefined) return "explored";
return "unseen";
```

Delete the end-turn prune call from `MapScene`.

## 2. Separate material selection from GPU resources

Current `resolveTileMaterial()` returns a Pixi `Texture`, which cannot be part of pure compilation.

Split:

```text
PURE
resolveTileMaterialKey(context)
 -> MaterialKey
 -> deterministic variant
 -> UV policy

GPU
GpuMaterialLibrary.resolve(MaterialKey)
 -> Texture
 -> Shader
 -> render state
```

Do the same for barriers.

The compiler may know `tile:nature:variant-2` or `barrier:full-wall:face`, but never a Pixi Texture.

## 3. Compiled floor format

It must express at least:

```ts
export interface CompiledFloorVisual {
	floorIndex: number;
	width: number;
	height: number;
	chunkSize: number;

	tiles: readonly CompiledTileSurface[];
	terrainSurfaces: readonly CompiledWorldSurface[];
	barrierSurfaces: readonly CompiledBarrierSurface[];
	connectors: readonly CompiledConnectorSurface[];

	chunks: ReadonlyMap<ChunkId, CompiledChunkVisual>;
	bounds: VisualBounds;
}
```

A tile surface should already contain its projected quad, UVs, material key, chunk owner and visibility coord.

World surfaces add `depth` and `depthKey`.

Barrier records also retain semantic/topology data plus both normal and focused positions so room focus never needs a whole-floor rebuild later.

Do not bake fog state into geometry.

## 4. Topology compiler

Precompute N/E/S/W masks for:

```text
same material
renderable neighbor
higher neighbor
lower neighbor
```

This becomes the future seam for shorelines, road edges, grass edges, facade joins, roof boundaries and procedural decoration.

No frame-time topology discovery.

## 5. Deterministic chunks

Use `CHUNK_SIZE = 8`.

A surface belongs to the chunk containing its logical anchor.

Boundary surfaces declare neighboring dependencies. Connectors at chunk boundaries have one canonical owner.

## 6. Diagnostics

Compile current floors through the new compiler while legacy rendering stays active.

Report:

```text
compile duration
tile count
terrain surface count
barrier count
connector count
chunk count
unique material keys
unique depth keys
estimated vertices
estimated triangles
```

Current rough expectations include ~1444 renderable tiles, 499 non-none barriers and ~499 structural connector vertices.

## Instrumentation

Add:

```text
engine.compileFloor
engine.compileTopology
engine.compiledVertices
engine.compiledTriangles
engine.chunkCount
engine.depthKeyCount
```

Compilation may be moderately expensive because it should be rare. It must never happen in the ticker during steady state.

## Acceptance

```text
[ ] Explored fog never decays.
[ ] Live actors remain current-visibility only.
[ ] CompiledFloorVisual has no Pixi imports.
[ ] MapVisualCompiler has no Pixi imports.
[ ] Same map+seed compiles deterministically.
[ ] Compiler counts match current map semantics.
[ ] 8×8 chunk ownership is deterministic.
[ ] No existing visuals change.
[ ] No compiler work runs every frame.
[ ] Tests/typecheck/build pass.
```

Do not begin Phase 2 until the compiler can describe the whole current floor without Pixi.
