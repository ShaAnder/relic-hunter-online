# Environment Material / Topology System — Current Design and Deferred Expansion

Status: **foundation partially implemented; base ground textures are the current priority; topology-driven decoration and wall materials are intentionally deferred.**

This document describes the intended environment rendering architecture for Relic Hunter Online and the minimal seam that should exist now so the system can expand later without another renderer rewrite.

The current implementation already has:

- semantic tile identity in `EdgeMapTileCode`;
- semantic edge/barrier identity in `EdgeBarrier`;
- default elevation by tile type;
- authored elevation overrides;
- a `MapRenderer` that owns final geometry;
- a client-side material loader/resolver;
- Road as the first textured ground material;
- deterministic texture selection by map seed / floor / coordinate.

The next production priority is **finish the basic texture set**, not build every topology/decal feature immediately.

---

## 1. Core design rule

Environment data should be split into four layers:

```text
SEMANTICS
"What is this in gameplay?"

        ↓

MATERIAL
"What is it made of / how should it look?"

        ↓

TOPOLOGY
"What structure or surrounding context is it part of?"

        ↓

DECORATION
"What visual wear / markings / detail should appear here?"

        ↓

FINAL RENDER
```

The higher a concept is in that stack, the more likely it is to affect gameplay.

The lower a concept is, the more likely it is presentation-only.

Examples:

```text
Road vs River              semantic
Road default elevation     semantic/default
Asphalt vs concrete        material
Avenue vs alley            topology/context
Crack vs dust              decoration
Fog / room wash            render state
```

This separation is intentional.

Do not create new gameplay tile codes for cosmetic variation.

Bad:

```text
CrackedRoad
DustyRoad
MarkedRoad
BrickWall
StoneWall
WoodWall
```

Preferred:

```text
Road + asphalt + alley topology + crack overlay
FullWall + brick material
Door + wood material
```

---

## 2. Ground pipeline

The target ground pipeline is:

```text
logical tile
    ↓
EdgeMapTileCode
    ↓
gameplay defaults
    ↓
explicit authored overrides
    ↓
base visual material
    ↓
derived topology/context
    ↓
optional decoration overlays
    ↓
MapRenderer
```

For current terrain:

```text
Road       → default elevation step -2
Pavement   → default elevation step  0
Floor      → default elevation step  0
Nature     → default elevation step  0
```

An explicit elevation override always wins over the material default.

Conceptually:

```ts
resolvedElevation =
	explicitElevationOverride
	?? defaultElevationForTileType(type);
```

The material system must never become authoritative for traversal.

Traversal continues to use shared gameplay data.

---

## 3. Edge / wall pipeline

Walls and edges require one extra distinction:

```text
edge
 ↓
barrier type
 ↓
gameplay behavior
 ↓
visual material
 ↓
wall topology
 ↓
surface decoration
 ↓
MapRenderer
```

Barrier type answers gameplay questions:

```text
FullWall
Door
LowWall
Fence
Glass
None
```

Material answers visual questions:

```text
Brick
Stone
Wood
Concrete
Metal
```

These are separate concepts.

For example:

```text
FullWall + Brick
FullWall + Concrete
LowWall  + Stone
Door     + Wood
Door     + Metal
```

Do not create `BrickWall`, `StoneWall`, `WoodWall`, etc. as new barrier enums unless they genuinely behave differently in gameplay.

---

## 4. Current source-of-truth split

### Shared package

`shared` owns gameplay identity and map structure.

Relevant current types:

```text
EdgeMapTileCode
EdgeBarrier
MapFloorDefinition
MapBundle
CompiledEdgeMap
```

`shared` is responsible for:

- tile identity;
- edge/barrier identity;
- walkability;
- traversal legality;
- default elevation;
- authored elevation;
- map compilation.

It should not know PNG filenames, texture variants, anime-style surface treatment, cracks, lane markings, dust, or wall art.

### Client package

`client` owns presentation.

Relevant current areas:

```text
client/src/rendering/MapRenderer.ts
client/src/rendering/materials/mapMaterialFactory.ts
client/src/rendering/materials/roadMaterial.ts
client/src/assets/map/...
```

The client is responsible for:

- texture discovery/loading;
- deterministic material variation;
- topology analysis;
- optional overlays;
- wall face materials;
- fog / room wash presentation;
- Map Creator preview metadata.

---

## 5. Current material system

Road is the first textured material.

The current material pipeline is roughly:

```text
EdgeMapTileCode.Road
        ↓
ROAD_TEXTURE_URLS
        ↓
preloadMapMaterials()
        ↓
resolveTileTexture(...)
        ↓
MapRenderer.tileDrawable(...)
```

Texture selection is deterministic from:

```text
mapSeed
floorIndex
tile x
tile y
tile code
```

This is correct and should remain.

Never use `Math.random()` during rendering.

Rebuilding the map must not reshuffle material variation.

---

## 6. Minimal future-proofing seam to add now

Before adding the rest of the base textures, evolve the resolver contract from:

```ts
Texture | undefined
```

to:

```ts
ResolvedTileMaterial
```

The purpose is not to implement topology/decorations now.

The purpose is to make sure adding them later does not require changing the entire renderer API again.

Recommended type:

```ts
export interface ResolvedTileOverlay {
	texture: Texture;
	alpha: number;
}

export interface ResolvedTileMaterial {
	baseTexture?: Texture;
	overlays: readonly ResolvedTileOverlay[];
}
```

Recommended resolver context:

```ts
export interface TileMaterialResolveContext {
	code: EdgeMapTileCode | undefined;
	coord: GridCoord;
	compiled: CompiledEdgeMap;
	mapSeed: number;
	floorIndex: number;
}
```

Recommended public resolver:

```ts
export function resolveTileMaterial(
	context: TileMaterialResolveContext,
): ResolvedTileMaterial;
```

For now it can simply return:

```ts
{
	baseTexture: resolvedBaseTexture,
	overlays: [],
}
```

`compiled` is passed now even though it is not yet needed.

That is deliberate.

Future topology code will need neighboring tiles.

Adding it to the context now avoids another public API change later.

---

## 7. Renderer contract

`MapRenderer` should remain responsible for geometry.

The material system should not replace tile geometry with arbitrary Sprites.

A tile should still use the existing polygon, elevation placement, depth order, oversize/seam rules, fog wash, and room-focus wash.

The render order should become:

```text
tile polygon
    ↓
base texture or fallback color
    ↓
zero or more material overlays
    ↓
fog / room wash
```

Conceptually:

```ts
g.poly(poly);

if (material?.baseTexture) {
	g.fill({
		texture: material.baseTexture,
		textureSpace: "local",
	});
} else {
	g.fill(fallbackColor);
}

for (const overlay of material?.overlays ?? []) {
	g.poly(poly);

	g.fill({
		texture: overlay.texture,
		textureSpace: "local",
		alpha: overlay.alpha,
	});
}

if (washed) {
	g.poly(poly);

	g.fill({
		color: WASH_COLOR,
		alpha: WASH_ALPHA,
	});
}
```

The renderer should not know whether an overlay means:

```text
crack
dust
lane marker
oil stain
moss
graffiti
```

It only draws the resolved material.

---

## 8. Current production priority: base texture pass

Do not build full topology/decorations yet.

The next milestone is to establish a coherent visual language for the map.

Recommended order:

```text
1. Road
2. Pavement
3. Interior Floor
4. Nature
5. River
6. Stair / connector surfaces
7. Wall materials
```

Each base texture should answer:

- palette;
- saturation;
- contrast;
- anime/cel-shaded treatment;
- line/detail density;
- scale of texture noise;
- how readable units remain on top.

A coherent base world is more valuable right now than procedural surface detail.

---

## 9. Ground material expansion

Once the base visual style is established, the material registry can grow to something like:

```ts
interface TileTextureFamily {
	urls: readonly string[];
}
```

with entries for:

```text
Road
Pavement
Floor
Nature
River
```

A first pass can still use one family per semantic tile type.

Later, optional authored material variants can exist without changing gameplay identity.

Example future relationship:

```text
Floor + concrete
Floor + wood
Floor + ceramic tile

Pavement + concrete
Pavement + stone slab

Nature + grass
Nature + dirt
```

That requires saved material metadata only if the artist/map author needs to choose between multiple materials for the same gameplay tile type.

Until that requirement is real, do not expand the saved map format.

---

## 10. Road topology — deferred design

Topology is presentation-derived context.

A Road tile remains:

```ts
EdgeMapTileCode.Road
```

The client may later infer:

```text
standard
alley
avenue
square
intersection
dead end
```

from surrounding Road tiles.

The first requested topology rule is:

```text
road width = 3
AND
straight run >= 15 tiles
    ↓
avenue / main road
```

An avenue may receive:

```text
cleaner asphalt
center-line markings
reduced crack/dust frequency
```

A narrow side road may receive:

```text
alley classification
more cracks
more dust
no formal lane marking
```

A compact road block may receive:

```text
square / courtyard classification
plain asphalt
no directional lane markings
```

Do not store these labels in the map data initially.

Derive them from topology.

---

## 11. Road decoration — deferred design

Road decoration should be transparent overlay art rather than baked combinations wherever practical.

Future asset layout:

```text
client/src/assets/map/tiles/road/
├── base/
│   ├── road_01.png
│   └── ...
│
└── overlays/
    ├── cracks/
    │   ├── crack_01.png
    │   └── crack_02.png
    │
    ├── dust/
    │   ├── dust_01.png
    │   └── dust_02.png
    │
    ├── repairs/
    │   └── patch_01.png
    │
    └── markings/
        ├── dash_x.png
        └── dash_y.png
```

All tile overlays should use the same authoring contract as the base tile:

```text
512 × 256
2:1 isometric diamond coordinate system
transparent background
no baked border
```

Overlay selection should remain deterministic.

---

## 12. Road marking orientation

Do not rotate a finished isometric tile 90 degrees in screen space.

A screen-space 90-degree rotation does not correspond cleanly to the two isometric grid axes.

For directional markings, provide orientation-aware overlays:

```text
dash_x.png
dash_y.png
```

Then topology decides which one applies.

This keeps the renderer simple and prevents projection errors.

---

## 13. Wall material system — deferred design

Wall geometry already has useful separation in `MapRenderer`.

The renderer resolves:

```text
top face
left face
right face
foundation
corner geometry
```

That is the correct skeleton for future wall materials.

A future wall material definition can look conceptually like:

```ts
interface WallMaterialDefinition {
	top: TextureFamily;
	leftFace: TextureFamily;
	rightFace: TextureFamily;
	foundation?: TextureFamily;
}
```

Potential materials:

```text
brick
stone
wood
concrete
metal
```

The edge barrier remains responsible for:

```text
height behavior
movement blocking
sight blocking
low-wall behavior
door behavior
glass transparency
```

The material only determines the visual surface.

---

## 14. Wall topology — deferred design

Topology should be derived from connected structural edges.

Useful future classifications:

```text
straight
end
corner
T-junction
cross-junction
height transition
foundation transition
```

The current wall topology / junction resolver should remain the geometry authority.

Material code must consume resolved wall geometry, not re-derive wall heights independently.

---

## 15. Map Creator architecture

The current Map Creator uses flat hard-coded palettes:

```text
Tiles
Edges
Elevation
```

That is acceptable for the current base-texture phase.

The eventual editor should become category-driven.

Target UI:

```text
GROUND
 ├─ Interior
 │   └─ Floor
 ├─ Streets
 │   ├─ Road
 │   └─ Pavement
 ├─ Nature
 │   ├─ Nature
 │   └─ River
 └─ Traversal
     ├─ Stair Bottom
     ├─ Stair Step
     ├─ Stair Top
     ├─ Stair Connector
     ├─ Ladder Bottom
     └─ Ladder Top

EDGES
 ├─ Wall
 ├─ Low Wall
 ├─ Door
 ├─ Fence
 └─ Glass

ELEVATION
 ├─ Raise
 ├─ Lower
 ├─ Set 0
 └─ Material Default
```

Later, when multiple materials exist per semantic type:

```text
GROUND
 ├─ Interior Floor
 │   ├─ Concrete
 │   ├─ Wood
 │   └─ Tile
 │
 ├─ Road
 │   └─ Asphalt
 │
 └─ Pavement
     ├─ Concrete
     └─ Stone
```

For edges:

```text
EDGES
 ├─ Full Wall
 │   ├─ Brick
 │   ├─ Concrete
 │   ├─ Stone
 │   └─ Wood
 │
 ├─ Door
 │   ├─ Wood
 │   └─ Metal
 │
 ├─ Low Wall
 ├─ Fence
 └─ Glass
```

The editor should eventually generate those menus from visual registry metadata rather than duplicating labels/colors manually.

Do not implement the full registry-driven editor until the base material set is known.

---

## 16. Minimal Map Creator seam

The next Map Creator refactor should be organizational only.

Instead of one flat `TILE_PALETTE`, introduce categories in client-only metadata.

Example:

```ts
type PaletteCategory =
	| "ground"
	| "street"
	| "nature"
	| "traversal"
	| "edge"
	| "elevation";
```

A palette entry can later gain:

```ts
category: PaletteCategory;
```

The current `code`, elevation behavior, and save format remain unchanged.

This allows collapsible menus/submenus later without touching map serialization.

---

## 17. Saved-map format rule

Do not add presentation-only topology or decoration data to `MapFloorDefinition`.

Current canonical map shape:

```ts
interface MapFloorDefinition {
	blueprint: number[][];
	elevationSteps: Record<string, number>;
}
```

should remain sufficient during the base texture pass.

Only expand the saved format when there is a real authoring requirement that cannot be derived.

Examples that may justify future saved visual metadata:

```text
"This exact building floor must be wood, not concrete"
"This exact wall is brick"
"This artist-placed decal must appear here"
```

Examples that should stay derived:

```text
"This road is 3-wide and long"
"This edge is a corner"
"This road tile belongs to an alley"
"This wall segment is part of a T-junction"
```

---

## 18. Networking / multiplayer boundary

Environment presentation should remain client-derived wherever possible.

For multiplayer, the server/network state should care about authoritative map/gameplay data:

```text
tile identity
edge barriers
authored elevation
actor state
game state
```

It should not need to replicate:

```text
which crack texture was picked
which dust overlay appears
which deterministic asphalt variant is visible
which wall face texture variant was chosen
```

Those can be deterministically reconstructed by each client from:

```text
map data
map seed
floor index
coordinates
material registry
```

This is one reason deterministic rendering is important.

It keeps visual richness out of multiplayer synchronization.

---

## 19. Performance rule

Do not rebuild the entire map every animation step for visual-state changes.

The recent player-movement jitter exposed the cost of full `MapRenderer.build()` calls while moving.

As materials become richer, static environment rendering will become more expensive.

Long-term rendering should move toward:

```text
static geometry/material layer
        +
dynamic fog/focus layer
        +
dynamic entities
```

rather than rebuilding:

```text
tiles
textures
terrain faces
walls
corners
```

whenever fog/room focus changes.

This optimization is separate from the material system but increasingly important as the environment becomes more detailed.

---

## 20. Implementation phases

### Phase M0 — current foundation

Already present:

```text
semantic tile codes
semantic barriers
default elevation
authored elevation overrides
Road texture loading
deterministic base variant selection
MapRenderer textured tile fill
```

### Phase M1 — minimal future-proof seam

Do now:

```text
resolveTileTexture()
        ↓
resolveTileMaterial()

Texture | undefined
        ↓
ResolvedTileMaterial

pass CompiledEdgeMap in resolve context
overlays = []
```

No topology logic yet.

### Phase M2 — basic texture pass

Do next:

```text
Road
Pavement
Floor
Nature
River
stairs/connectors
```

Establish the game's actual visual style.

### Phase M3 — Map Creator organization

Add:

```text
collapsible categories
submenus
texture previews
registry-driven labels
```

No new gameplay data required.

### Phase M4 — road topology

Add:

```text
roadTopology.ts

standard
alley
avenue
square
intersection
```

Derived client-side.

### Phase M5 — road decoration

Add:

```text
cracks
dust
patches
lane markings
```

as transparent deterministic overlays.

### Phase M6 — wall materials

Add:

```text
brick
stone
wood
concrete
metal
```

mapped onto existing resolved wall geometry.

### Phase M7 — wall topology decoration

Add context-aware:

```text
corners
caps
junction details
foundation treatments
damage/moss/graffiti
```

without changing gameplay barriers.

---

## 21. Immediate acceptance criteria

For the current base-texture milestone:

```text
[ ] Road uses the new material resolver object.
[ ] overlays exists but is empty.
[ ] Resolver receives CompiledEdgeMap.
[ ] Road remains deterministic by seed/floor/coord.
[ ] Missing texture falls back to tileFills color.
[ ] Pavement gets a base texture.
[ ] Floor gets a base texture.
[ ] Nature gets a base texture.
[ ] River gets a base texture.
[ ] Fog / room wash still renders correctly.
[ ] Elevation boundaries still render correctly.
[ ] No gameplay or map serialization changes.
```

Once those are true, stop material-system work and move on.

The architecture is sufficiently prepared for topology/decorations later.

---

## 22. Architectural invariants

These should remain true as the system expands:

1. `shared` owns gameplay semantics.
2. `client` owns texture/material presentation.
3. Rendering elevation never becomes traversal authority.
4. Explicit authored elevation overrides material defaults.
5. Cosmetic material variation does not create new gameplay tile types.
6. Wall material does not replace barrier behavior.
7. Topology is derived where practical.
8. Decoration is visual-only unless deliberately promoted to gameplay.
9. Material variation is deterministic.
10. Map rendering consumes resolved context; it does not invent gameplay state.
11. Multiplayer does not synchronize deterministic cosmetic choices.
12. The Map Creator should eventually read presentation metadata from registries instead of duplicating it.

---

## 23. Short version

The environment system should ultimately read as:

```text
GROUND

semantic tile
    ↓
material
    ↓
default elevation
    ↓
authored elevation override
    ↓
topology
    ↓
decoration
    ↓
render
```

and:

```text
WALLS

barrier type
    ↓
gameplay behavior
    ↓
material
    ↓
topology
    ↓
decoration
    ↓
render
```

For now:

```text
wire the material object seam
finish the basic textures
stop
```

Topology, procedural decoration, wall materials, and Map Creator submenus can then be added on top without replacing the foundation.
