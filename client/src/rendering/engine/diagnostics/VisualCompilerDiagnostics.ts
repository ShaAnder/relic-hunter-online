import type { CompiledFloorVisual } from "../compiler/CompiledFloorVisual";

/**
 * A small summary of what one floor compile produced.
 *
 * This is diagnostic information only.
 *
 * It does NOT affect rendering and it does NOT modify the compiled floor.
 * Its purpose is to let us answer questions such as:
 *
 * - How many tiles did we compile?
 * - How many terrain/wall surfaces exist?
 * - How many chunks did the floor get divided into?
 * - Roughly how much geometry will this floor eventually send to the GPU?
 *
 * This becomes useful during the refactor because we can compare builds
 * and catch accidental increases in renderer complexity.
 */
export interface VisualCompilerSnapshot {
	tiles: number;
	terrainSurfaces: number;
	barrierSurfaces: number;
	connectors: number;
	chunks: number;
	depthKeys: number;
	estimatedVertices: number;
	estimatedTriangles: number;
}

/**
 * Our compiler represents tile tops, terrain faces and wall faces as quads:
 * four projected corner points describing one visible surface.
 *
 * GPUs render triangles, not arbitrary four-sided polygons, so each quad
 * is split into two triangles:
 *
 *     0 -------- 1
 *     | \        |
 *     |   \      |
 *     |     \    |
 *     3 -------- 2
 *
 * Triangle A = 0, 1, 2
 * Triangle B = 0, 2, 3
 *
 * Therefore, in our current geometry representation:
 *
 *     1 quad = 4 stored vertices = 2 triangles
 *
 * These constants let diagnostics estimate how much GPU geometry the
 * compiled floor will eventually contain.
 */
const VERTICES_PER_QUAD = 4;
const TRIANGLES_PER_QUAD = 2;

/**
 * Build a readonly diagnostic summary from an already compiled floor
 * Diagnostics do not compile anything by themselves they are passive and observe
 * the compiled data
 */
export function createVisualCompilerSnapshot(
	compiled: CompiledFloorVisual,
): VisualCompilerSnapshot {
	// WE use a set to store distinct depth strata
	const depthKeys = new Set<number>();

	// ONLY if they are not ground tile tops
	for (const surface of compiled.terrainSurfaces) {
		depthKeys.add(surface.depthKey);
	}

	// we do the same for connectors
	for (const connector of compiled.connectors) {
		depthKeys.add(connector.depthKey);
	}

	/**
	 * Tiles, terrain surfaces and barrier surfaces are already represented
	 * as one quad each in CompiledFloorVisual.
	 */
	const tileQuadCount = compiled.tiles.length;
	const terrainQuadCount = compiled.terrainSurfaces.length;
	const barrierQuadCount = compiled.barrierSurfaces.length;

	/**
	 * Connectors are slightly different.
	 *
	 * During Phase 1 we store the DATA needed to generate their geometry
	 * rather than storing the final quads themselves.
	 *
	 * A connector will later produce:
	 *
	 *     left face  = 1 quad
	 *     right face = 1 quad
	 *     top face   = optionally 1 quad
	 *
	 * The compiled connector already tells us whether a top material
	 * exists, so we can make a useful geometry estimate now.
	 */
	let connectorQuadCount = 0;

	for (const connector of compiled.connectors) {
		// Every connector has left and right faces.
		connectorQuadCount += 2;

		// Some connector profiles also have a top face.
		if (connector.topMaterial !== null) {
			connectorQuadCount += 1;
		}
	}

	// Total estimated number of quads the current compiled floor describes.
	const estimatedQuads =
		tileQuadCount + terrainQuadCount + barrierQuadCount + connectorQuadCount;

	/**
	 * Convert our quad estimate into vertex/triangle estimates
	 *
	 * EG:
	 *
	 *    10 quads x 4 vertices = 40 vertices
	 *    10 quads x 2 triangles = 20 triangles
	 */
	const estimatedVertices = estimatedQuads * VERTICES_PER_QUAD;
	const estimatedTriangles = estimatedQuads * TRIANGLES_PER_QUAD;

	// now we return our computed tiles / surfaces / connectors
	return {
		tiles: compiled.tiles.length,
		terrainSurfaces: compiled.terrainSurfaces.length,
		barrierSurfaces: compiled.barrierSurfaces.length,
		connectors: compiled.connectors.length,

		// get the number of chunks we have in our map
		chunks: compiled.chunks.size,
		// Set.size gives the number of UNIQUE depth keys collected above.
		depthKeys: depthKeys.size,

		estimatedVertices,
		estimatedTriangles,
	};
}

/**
 * Learning note — quads and triangles:
 * Your game thinks in concepts such as tiles and walls, but the GPU ultimately needs geometric primitives.
 * The compiler first converts those concepts into four-point surfaces, or quads. Those quads are then represented
 * as two triangles because triangle rasterization is the basic surface operation GPUs are built around.
 * The four corner vertices can be reused by an index buffer to describe both triangles without duplicating
 * all six triangle corners.
 */
