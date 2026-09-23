import type * as RH from "@relic-hunter/shared";

import type { RenderChunkId } from "../chunks/ChunkCoord";
import type { VisualMaterialRef } from "../materials/MaterialKey";
import type { VisualDepthKey } from "../world/worldDepthKey";

/**
 * One point in projected screen/world space.
 *
 * The gameplay grid might say:
 *
 *     { x: 10, y: 12 }
 *
 * while the projected renderer position is something like:
 *
 *     { x: -80, y: 440 }
 */
export interface VisualPoint {
	x: number;
	y: number;
}

/**
 * Four projected points describing one GPU-ready surface.
 */
export type VisualQuad = readonly [
	VisualPoint,
	VisualPoint,
	VisualPoint,
	VisualPoint,
];

/**
 * UV pair for every point in a VisualQuad.
 */
export type VisualUvs = readonly [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
];

/**
 * Stable identity for an individual compiled render surface.
 */
export type VisualSurfaceId = string & {
	readonly __visualSurfaceId: unique symbol;
};

/**
 * One renderable ground tile.
 *
 * Fog and room-focus state deliberately do not live here.
 * Those are presentation concerns applied later.
 */
export interface CompiledTileSurface {
	id: VisualSurfaceId;

	coord: RH.GridCoord;

	chunkId: RenderChunkId;

	quad: VisualQuad;
	uvs: VisualUvs;

	material: VisualMaterialRef;

	visibilityCoords: readonly RH.GridCoord[];
}

/**
 * Vertical terrain face between two tiles at different elevations.
 */
export interface CompiledTerrainSurface {
	id: VisualSurfaceId;

	chunkId: RenderChunkId;

	a: RH.GridCoord;
	b: RH.GridCoord;

	direction: "E" | "S";

	quad: VisualQuad;
	uvs: VisualUvs;

	material: VisualMaterialRef;

	/**
	 * Exact legacy-compatible zIndex depth.
	 */
	depth: number;

	/**
	 * Quantized batching/grouping identity derived from depth.
	 */
	depthKey: VisualDepthKey;

	visibilityCoords: readonly RH.GridCoord[];
}

/**
 * One drawable surface of an authored barrier segment.
 *
 * Segment faces and segment tops are separate records because they may
 * use different materials while sharing the same structural edge.
 */
export interface CompiledBarrierSurface {
	id: VisualSurfaceId;

	chunkId: RenderChunkId;

	/**
	 * Stable structural identity.
	 *
	 * Barrier type is deliberately NOT part of edgeId because changing
	 * barrier type is a mutation of the same structural edge slot.
	 */
	edgeId: string;

	edge: RH.StructuralEdgeRef;
	barrier: RH.EdgeBarrier;

	surface: "segment-face" | "segment-top";

	/**
	 * Full-height geometry.
	 */
	normalQuad: VisualQuad;

	/**
	 * Room-focus boundary geometry.
	 */
	focusedQuad: VisualQuad;

	/**
	 * Height changes alter wall-face V coordinates, so focused geometry
	 * needs its own UVs rather than reusing the normal values.
	 */
	normalUvs: VisualUvs;
	focusedUvs: VisualUvs;

	material: VisualMaterialRef;

	depth: number;
	depthKey: VisualDepthKey;

	visibilityCoords: readonly RH.GridCoord[];

	/**
	 * Exact true footprint of the foreground tile used later for
	 * Fence/Glass clipping.
	 *
	 * Null for barrier profiles that do not require terrain occlusion.
	 */
	occluderQuad: VisualQuad | null;
}

/**
 * Contribution from one structural edge to a shared connector/post.
 *
 * Connector height is dynamic under room focus because different incident
 * edges may independently be focused or normal.
 */
export interface CompiledConnectorIncident {
	edgeId: string;

	barrier: RH.EdgeBarrier;

	visibilityCoords: readonly RH.GridCoord[];

	normalHeight: number;
	focusedHeight: number;
}

/**
 * Shared connector/post at one logical topology vertex.
 */
export interface CompiledConnectorVisual {
	id: VisualSurfaceId;

	chunkId: RenderChunkId;

	vertex: RH.GridVertex;

	base: VisualPoint;

	/**
	 * Lowest visible foundation position required by any incident edge.
	 */
	foundationBottomY: number;

	/**
	 * Highest-priority connector profile touching this vertex.
	 */
	barrier: RH.EdgeBarrier;

	/**
	 * All incident barrier contributions.
	 *
	 * Phase 3 uses these to resolve connector height incrementally when
	 * room focus changes.
	 */
	incidents: readonly CompiledConnectorIncident[];

	depth: number;
	depthKey: VisualDepthKey;

	visibilityCoords: readonly RH.GridCoord[];

	/**
	 * True foreground tile footprints that may clip Fence/Glass
	 * connector geometry.
	 */
	occluderQuads: readonly VisualQuad[];

	leftMaterial: VisualMaterialRef;
	rightMaterial: VisualMaterialRef;

	topMaterial: VisualMaterialRef | null;
}

/**
 * Everything owned by one render chunk.
 */
export interface CompiledChunkVisual {
	chunkId: RenderChunkId;

	tiles: readonly CompiledTileSurface[];

	terrainSurfaces: readonly CompiledTerrainSurface[];

	barrierSurfaces: readonly CompiledBarrierSurface[];

	connectors: readonly CompiledConnectorVisual[];
}

/**
 * Complete immutable-style description of one floor's static visual
 * geometry.
 *
 * This contains no Pixi objects, fog state or room-focus state.
 */
export interface CompiledFloorVisual {
	floorIndex: number;
	mapSeed: number;

	width: number;
	height: number;

	chunkSize: number;

	tiles: readonly CompiledTileSurface[];

	terrainSurfaces: readonly CompiledTerrainSurface[];

	barrierSurfaces: readonly CompiledBarrierSurface[];

	connectors: readonly CompiledConnectorVisual[];

	chunks: ReadonlyMap<RenderChunkId, CompiledChunkVisual>;
}

/**
 * Stable structural edge identity.
 *
 * Barrier type is deliberately excluded:
 *
 *     north:4,6
 *
 * remains the same edge even if FullWall becomes Door, Fence, etc.
 */
export function renderEdgeIdFor(edge: RH.StructuralEdgeRef): string {
	return `${edge.orientation}:${edge.x},${edge.y}`;
}
