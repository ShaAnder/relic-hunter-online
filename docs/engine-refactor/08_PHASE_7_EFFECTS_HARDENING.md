# Phase 7 — Effects, Placeables, Production Hardening, Legacy Retirement

## Purpose

Finish the renderer as a reusable engine: transient effects, authored/procedural world objects, quality profiles, diagnostics, and retirement of the old renderer.

## Add

```text
client/src/rendering/engine/
├── effects/
│   ├── ActiveUpdateScheduler.ts
│   ├── ParticleSystem.ts
│   ├── ParticlePool.ts
│   ├── ParticleDefinitions.ts
│   └── EffectRegistry.ts
├── objects/
│   ├── WorldObjectDefinition.ts
│   ├── WorldObjectRegistry.ts
│   ├── StaticObjectCompiler.ts
│   ├── FacadeCompiler.ts
│   └── CompositeWorldObject.ts
├── quality/
│   ├── RenderQuality.ts
│   ├── BrowserRenderProfile.ts
│   └── DesktopRenderProfile.ts
└── diagnostics/
    ├── RenderStatsPanel.ts
    ├── ChunkDebugOverlay.ts
    └── EngineAssertions.ts
```

## Effects lane

Transient effects are not map geometry.

Use pooled handles, active-only scheduling, and Pixi `ParticleContainer` where its restricted model fits.

Examples:

```text
water splash
impact spark
dust
weather
loot burst
door dust
```

Idle effects do no frame work.

## Particle contract

Definitions describe:

```text
texture/material
lifetime
spawn count
velocity distribution
scale
rotation
alpha curve
depth policy
```

Gameplay emits semantic events; renderer chooses implementation.

## Placeable world objects

Render kinds:

```ts
type WorldObjectRenderKind =
	| "sprite"
	| "facade"
	| "composite"
	| "procedural";
```

`facade` = large authored face when one painter-order anchor is enough.

`composite` = independent depth pieces when an actor must pass in front of one part and behind another.

`procedural` = geometry generated from topology/map data.

A building can combine authored facade art with procedural gameplay topology.

## Static object compilation

Static objects join ground/world batches and chunk invalidation.

Stateful objects stay as dynamic handles.

## Topology decoration

Use Phase 1 topology masks for:

```text
shorelines
road borders
grass transitions
wall trim
roof edges
building joins
```

No frame-time topology discovery.

## Browser / desktop quality profiles

Same renderer, different budgets:

```ts
interface RenderQuality {
	resolutionScale: number;
	antialias: boolean;
	particleBudget: number;
	effectDensity: number;
	materialAnimationQuality:
		| "low"
		| "high";
	chunkCullMargin: number;
}
```

Browser default conservative; desktop wrapper may choose higher quality.

Do not fork gameplay/render architecture for desktop.

## Permanent renderer diagnostics

Dev stats should show:

```text
frame CPU
visible/culled chunks
static mesh count
dynamic object count
triangle count
floor compiles
chunk recompiles
fog dirty chunks
material update time
particle count
```

## Legacy retirement gate

Delete:

```text
client/src/rendering/MapRenderer.ts
client/src/rendering/barrierQuadSurface.ts
```

only after parity for ground, terrain, all barriers, connectors, fog, room focus, lower floor, floor switching, tutorials, spectating, and dynamic-door path.

Do not keep two production renderers.

## Performance targets

```text
idle update CPU            < 4 ms
movement update CPU        < 8 ms
presentation update hitch  < 16 ms ideal
local chunk rebuild        < 16 ms ideal
no routine >50 ms task
60 FPS frame budget        16.67 ms
```

Additional engine targets:

```text
steady-state map geometry allocation = 0
full floor recompiles during movement = 0
full floor recompiles during fog = 0
full floor recompiles during room focus = 0
offscreen chunk render work = 0
static world scene nodes = strata/mesh handles, not per surface
```

## Final benchmark

Repeat the Phase 0 scenario: load, move, enter/leave room, end turns, reveal fog, switch floors, spectate AI, use dynamic objects.

Baseline to beat:

```text
renderer.mapBuild avg 27.35 ms
renderer.mapBuild max 92.80 ms
~2844 top-level ground/world children
```

In the final engine, ordinary gameplay should not call the old full-map build path at all.

## End state

```text
renderer
 = pure visual compiler
 + chunked mesh backend
 + global depth strata
 + compact presentation buffers
 + dynamic world
 + local invalidation
 + shared material engine
 + pooled effects
```

Pixi remains the GPU/render backend. It is no longer the architecture.
