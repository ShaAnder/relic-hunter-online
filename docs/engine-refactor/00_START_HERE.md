# Relic Hunter — Engine Renderer Rebuild, Phases 1–7

Target public repository state: `42d1f9982ccaea14001dd8b57eb03dd5752036bc`  
Commit: `rebuild renderer for generic wall building`

Phase 0 performance instrumentation stays exactly as-is.

The previous Phase 1/2 persistent-per-Pixi-object plan is **superseded** by this package. Do not apply the old Phase 1/2 renderer changes first.

## Why the roadmap changed

Phase 0 baseline:

```text
renderer.fullBuilds               22
scene.legacyPresentationRebuilds  18
renderer.mapBuild avg             27.35 ms
renderer.mapBuild max             92.80 ms
scene rebuild avg                 34.28 ms
scene rebuild max                 92.90 ms
renderer.groundChildren           1444
renderer.worldChildren            1400
```

The old plan fixed full-map reconstruction but still left thousands of individually managed Pixi objects. This roadmap fixes both problems:

```text
OLD

game map
 -> tile Graphics
 -> tile Graphics
 -> wall Container
 -> MeshSimple
 -> connector Container
 -> masks
 -> thousands of scene nodes


NEW

game map
 -> pure visual compiler
 -> chunked geometry
 -> depth-stratum batches
 -> small number of Mesh objects
 -> compact presentation buffers
 -> dynamic actors/world objects separately
```

## North-star rule

> Compile structure once. Batch static geometry. Keep presentation state compact. Update only dirty data. Keep dynamic objects out of static batches.

## Final renderer shape

```text
SHARED / AUTHORITATIVE MAP
CompiledEdgeMap
       |
       v
PURE CLIENT COMPILATION
MapVisualCompiler
TileTopologyCompiler
       |
       v
CompiledFloorVisual
(no Pixi imports)
       |
       +-------------------------+
       |                         |
       v                         v
STATIC GPU WORLD            PRESENTATION STATE
ground chunks               fog / explored / visible
terrain strata              room focus
barrier strata              highlights
static props                floor wash
       |                         |
       +-------------+-----------+
                     v
                 FloorRenderer
                     |
          +----------+----------+
          |                     |
          v                     v
   static depth strata       dynamic world
   batched meshes            actors
                             doors
                             chests
                             interactive props

MaterialEngine
 -> shared shaders
 -> shared material clocks
 -> water / grass / future ambience

EffectEngine
 -> pooled particles
 -> transient effects
 -> active-only updates
```

## Phase order

```text
Phase 0  DONE — instrumentation baseline
Phase 1  Renderer kernel + pure compiler + permanent fog semantics
Phase 2  Ground chunk mesh pipeline + GPU-oriented fog presentation
Phase 3  Terrain/barrier mesh pipeline + depth strata + mask removal
Phase 4  Dynamic world + event-driven entity visibility + doors
Phase 5  Local invalidation + floor cache + chunk culling
Phase 6  Material/shader engine + animated water/grass
Phase 7  Effects/placeables/topology hardening + legacy renderer retirement
```

`CompiledFloorVisual` stays Pixi-free so a future backend can consume the same compiled visual data without rewriting map semantics.
