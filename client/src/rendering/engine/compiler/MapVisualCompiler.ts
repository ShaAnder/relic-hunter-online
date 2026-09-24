import * as RH from "@relic-hunter/shared";
import { gridToScreen, TILE_HEIGHT, TILE_WIDTH } from "@/math/isoGridMath";
import {
	barrierRenderProfileFor,
	connectorPriorityFor,
	type BarrierRenderProfile,
} from "@/rendering/barrierRenderProfile";
import { fillForTileCode } from "@/rendering/tileFills";
import {
	DEFAULT_RENDER_CHUNK_SIZE,
	renderChunkIdForTile,
	type RenderChunkId,
} from "../chunks/ChunkCoord";
import {
	tileVariantHash,
	type VisualMaterialRef,
} from "../materials/MaterialKey";
import { WORLD_DEPTH_BIAS, worldDepthKey } from "../world/worldDepthKey";
import {
	renderEdgeIdFor,
	type CompiledBarrierSurface,
	type CompiledChunkVisual,
	type CompiledConnectorIncident,
	type CompiledConnectorVisual,
	type CompiledFloorVisual,
	type CompiledTerrainSurface,
	type CompiledTileSurface,
	type VisualPoint,
	type VisualQuad,
	type VisualSurfaceId,
	type VisualUvs,
} from "./CompiledFloorVisual";
import { compileTileTopology } from "./TileTopologyCompiler";

// Preserve the exact ordinary-tile oversize currently
// used by MapRenderer to hide coplanar seams.
const TILE_OVERSIZE = 1.09;
// One normal barrier storey in projected pixels.
const WALL_HEIGHT_PX = TILE_HEIGHT;
// Current room-focus wall-height treatment.
const FOCUSED_WALL_HEIGHT_FRACTION = 0.2;
const FLOOR_COLOR = 0xc8c8c8;
const TERRAIN_SIDE_COLOR = 0x4a4652;
const EPSILON = 0.000001;

/**
 * Explicit UV layout for projected diamond tiles.
 *
 * Phase 2 should visually compare this against the current
 * Graphics.fill({ textureSpace: "local" }) output before legacy ground
 * rendering is disabled.
 */
const TILE_UVS: VisualUvs = [0.5, 0, 1, 0.5, 0.5, 1, 0, 0.5];
const DEFAULT_QUAD_UVS: VisualUvs = [0, 0, 1, 0, 1, 1, 0, 1];

export interface MapVisualCompileOptions {
	mapSeed: number;
	floorIndex: number;
	chunkSize?: number;
	/**
	 * Active floor = 1.
	 *
	 * Current lower-floor underlay uses a different wall scale, so this
	 * is compile-time geometry and must be part of the compiler cache key.
	 */
	wallHeightScale?: number;
}

interface TrueTileCorners {
	top: VisualPoint;
	right: VisualPoint;
	bottom: VisualPoint;
	left: VisualPoint;
	center: VisualPoint;
}

interface BarrierSegmentSkeleton {
	startVertex: RH.GridVertex;
	endVertex: RH.GridVertex;

	centerBase1: VisualPoint;
	centerBase2: VisualPoint;

	foundationCenter1: VisualPoint;
	foundationCenter2: VisualPoint;

	nearBase1: VisualPoint;
	nearBase2: VisualPoint;

	farBase1: VisualPoint;
	farBase2: VisualPoint;

	nearTop1: VisualPoint;
	nearTop2: VisualPoint;

	farTop1: VisualPoint;
	farTop2: VisualPoint;

	foundationNear1: VisualPoint;
	foundationNear2: VisualPoint;

	foundationFar1: VisualPoint;
	foundationFar2: VisualPoint;

	hasFoundation: boolean;

	/**
	 * Architectural ground-contact sorting depth before semantic bias.
	 */
	depth: number;
}

interface BarrierCompiledGeometry {
	face: VisualQuad;
	faceUvs: VisualUvs;
	faceFallbackColor: number;

	top: VisualQuad | null;
	topUvs: VisualUvs | null;
}

interface MutableChunkVisual {
	chunkId: RenderChunkId;
	tiles: CompiledTileSurface[];
	terrainSurfaces: CompiledTerrainSurface[];
	barrierSurfaces: CompiledBarrierSurface[];
	connectors: CompiledConnectorVisual[];
}

interface MutableConnector {
	vertex: RH.GridVertex;
	base: VisualPoint;
	foundationBottomY: number;
	barrier: RH.EdgeBarrier;
	incidents: CompiledConnectorIncident[];
	visibilityCoords: RH.GridCoord[];
	visibilityCoordKeys: Set<string>;
	occluderQuads: VisualQuad[];
	occluderKeys: Set<string>;
}

/**
 * Converts gameplay map/topology data into backend-neutral static render
 * geometry.
 *
 * IMPORTANT:
 * - no Pixi imports
 * - no Graphics
 * - no Mesh
 * - no Texture
 * - no fog state
 * - no current room-focus state
 *
 * Phase 1 still leaves MapRenderer responsible for what the player sees.
 */
export class MapVisualCompiler {
	compile(
		compiled: RH.CompiledEdgeMap,
		options: MapVisualCompileOptions,
	): CompiledFloorVisual {
		const chunkSize = options.chunkSize ?? DEFAULT_RENDER_CHUNK_SIZE;
		const wallHeightScale = options.wallHeightScale ?? 1;
		const tiles: CompiledTileSurface[] = [];
		const terrainSurfaces: CompiledTerrainSurface[] = [];
		const barrierSurfaces: CompiledBarrierSurface[] = [];
		const connectors: CompiledConnectorVisual[] = [];
		const mutableChunks = new Map<RenderChunkId, MutableChunkVisual>();
		const connectorTouches = new Map<string, MutableConnector>();
		const chunkFor = (chunkId: RenderChunkId): MutableChunkVisual => {
			const existing = mutableChunks.get(chunkId);
			if (existing) {
				return existing;
			}
			const created: MutableChunkVisual = {
				chunkId,
				tiles: [],
				terrainSurfaces: [],
				barrierSurfaces: [],
				connectors: [],
			};
			mutableChunks.set(chunkId, created);
			return created;
		};
		const pushTile = (surface: CompiledTileSurface): void => {
			tiles.push(surface);
			chunkFor(surface.chunkId).tiles.push(surface);
		};
		const pushTerrain = (surface: CompiledTerrainSurface): void => {
			terrainSurfaces.push(surface);
			chunkFor(surface.chunkId).terrainSurfaces.push(surface);
		};
		const pushBarrier = (surface: CompiledBarrierSurface): void => {
			barrierSurfaces.push(surface);
			chunkFor(surface.chunkId).barrierSurfaces.push(surface);
		};

		// ------------------------------------------------------------
		// TILE TOPS
		// ------------------------------------------------------------

		for (let y = 0; y < compiled.grid.height; y++) {
			for (let x = 0; x < compiled.grid.width; x++) {
				const coord: RH.GridCoord = {
					x,
					y,
				};

				const key = RH.coordKey(coord);
				const elevation = compiled.elevation.get(key) ?? 0;

				/**
				 * Void/non-renderable tile.
				 */
				if (!Number.isFinite(elevation)) {
					continue;
				}

				const tileCode = compiled.tileCodes.get(key);
				const trueFootprint = this.tileNeedsTrueFootprint(
					compiled,
					coord,
					elevation,
					tileCode,
				);

				const chunkId = renderChunkIdForTile(coord, chunkSize);
				const id = `tile:${x},${y}` as VisualSurfaceId;
				const fallbackColor = fillForTileCode(tileCode) ?? FLOOR_COLOR;
				const surface: CompiledTileSurface = {
					id,
					coord,
					chunkId,
					quad: this.tileQuad(coord, elevation, trueFootprint),
					uvs: TILE_UVS,
					material: {
						kind: "tile",
						code: tileCode,
						variantHash: tileVariantHash(
							options.mapSeed,
							options.floorIndex,
							coord,
							tileCode,
						),
						fallbackColor,
					},
					/**
					 * Topology is structural data, so calculate it once while the floor is
					 * compiled instead of repeatedly asking the same neighbour questions later.
					 */
					topology: compileTileTopology(compiled, coord),
					visibilityCoords: [coord],
				};
				pushTile(surface);
			}
		}

		// ------------------------------------------------------------
		// TERRAIN FACES
		// ------------------------------------------------------------

		const compileTerrainFace = (
			a: RH.GridCoord,
			b: RH.GridCoord,
			direction: "E" | "S",
		): void => {
			const aElevation = this.elevationAt(compiled, a);
			const bElevation = this.elevationAt(compiled, b);
			if (
				aElevation === undefined ||
				bElevation === undefined ||
				!Number.isFinite(aElevation) ||
				!Number.isFinite(bElevation) ||
				Math.abs(aElevation - bElevation) < EPSILON
			) {
				return;
			}

			/**
			 * Preserve current legacy behaviour exactly:
			 *
			 * the terrain face is emitted only when the loop's source tile
			 * is the higher tile.
			 */
			if (aElevation <= bElevation + EPSILON) {
				return;
			}
			const aCorners = this.trueTileCorners(a, aElevation * TILE_HEIGHT);
			const bCorners = this.trueTileCorners(b, bElevation * TILE_HEIGHT);
			const [a1, a2, b1, b2] =
				direction === "E"
					? [aCorners.right, aCorners.bottom, bCorners.top, bCorners.left]
					: [aCorners.bottom, aCorners.left, bCorners.right, bCorners.top];
			const quad: VisualQuad = [a1, a2, b2, b1];
			const depth =
				Math.max(a1.y, a2.y, b1.y, b2.y) + WORLD_DEPTH_BIAS.terrainFace;
			const chunkId = renderChunkIdForTile(a, chunkSize);
			const surface: CompiledTerrainSurface = {
				id: `terrain:${a.x},${a.y}:${direction}` as VisualSurfaceId,
				chunkId,
				a,
				b,
				direction,
				quad,
				uvs: DEFAULT_QUAD_UVS,
				material: {
					kind: "terrain",
					fallbackColor: TERRAIN_SIDE_COLOR,
				},
				depth,
				depthKey: worldDepthKey(depth),
				visibilityCoords: [a, b],
			};
			pushTerrain(surface);
		};

		for (let y = 0; y < compiled.grid.height; y++) {
			for (let x = 0; x < compiled.grid.width - 1; x++) {
				compileTerrainFace(
					{
						x,
						y,
					},
					{
						x: x + 1,
						y,
					},
					"E",
				);
			}
		}

		for (let y = 0; y < compiled.grid.height - 1; y++) {
			for (let x = 0; x < compiled.grid.width; x++) {
				compileTerrainFace(
					{
						x,
						y,
					},
					{
						x,
						y: y + 1,
					},
					"S",
				);
			}
		}

		// ------------------------------------------------------------
		// BARRIER SEGMENTS + CONNECTOR COLLECTION
		// ------------------------------------------------------------

		const compileBarrierSegment = (
			a: RH.GridCoord,
			b: RH.GridCoord,
			barrier: RH.EdgeBarrier,
		): void => {
			const edge = RH.structuralEdgeForTilePair(a, b, barrier);

			if (!edge) {
				return;
			}

			const profile = barrierRenderProfileFor(barrier);
			const edgeId = renderEdgeIdFor(edge);
			const normalHeight =
				WALL_HEIGHT_PX * profile.heightFraction * wallHeightScale;
			const focusedHeight = normalHeight * FOCUSED_WALL_HEIGHT_FRACTION;
			const normalSkeleton = this.buildBarrierSegmentSkeleton(
				edge,
				compiled,
				normalHeight,
				profile.segmentThicknessPx,
			);
			const focusedSkeleton = this.buildBarrierSegmentSkeleton(
				edge,
				compiled,
				focusedHeight,
				profile.segmentThicknessPx,
			);
			const normalGeometry = this.buildBarrierGeometry(
				edge,
				normalSkeleton,
				profile,
			);
			const focusedGeometry = this.buildBarrierGeometry(
				edge,
				focusedSkeleton,
				profile,
			);
			const depth = normalSkeleton.depth + WORLD_DEPTH_BIAS.barrierSegment;
			const depthKey = worldDepthKey(depth);
			const chunkId = renderChunkIdForTile(a, chunkSize);

			/**
			 * With the current fixed camera and iteration order, `b` is the
			 * +x/+y foreground tile used by the legacy inverse mask.
			 */
			const frontElevation = this.elevationAt(compiled, b);
			const occluderQuad =
				profile.terrainOcclusion === "front-tile" &&
				frontElevation !== undefined &&
				Number.isFinite(frontElevation)
					? this.trueTileQuad(b, frontElevation)
					: null;

			const faceSurface: CompiledBarrierSurface = {
				id: `barrier:${edgeId}:face` as VisualSurfaceId,
				chunkId,
				edgeId,
				edge,
				barrier,
				surface: "segment-face",
				normalQuad: normalGeometry.face,
				focusedQuad: focusedGeometry.face,
				normalUvs: normalGeometry.faceUvs,
				focusedUvs: focusedGeometry.faceUvs,
				material: this.barrierMaterial(
					barrier,
					"segment-face",
					normalGeometry.faceFallbackColor,
					profile.segmentAlpha,
				),
				depth,
				depthKey,
				visibilityCoords: [a, b],
				occluderQuad,
			};
			pushBarrier(faceSurface);

			if (
				profile.showSegmentTop &&
				normalGeometry.top &&
				focusedGeometry.top &&
				normalGeometry.topUvs &&
				focusedGeometry.topUvs
			) {
				const topSurface: CompiledBarrierSurface = {
					id: `barrier:${edgeId}:top` as VisualSurfaceId,
					chunkId,
					edgeId,
					edge,
					barrier,
					surface: "segment-top",
					normalQuad: normalGeometry.top,
					focusedQuad: focusedGeometry.top,
					normalUvs: normalGeometry.topUvs,
					focusedUvs: focusedGeometry.topUvs,
					material: this.barrierMaterial(
						barrier,
						"segment-top",
						profile.segmentTopColor,
						profile.segmentAlpha,
					),
					depth,
					depthKey,
					visibilityCoords: [a, b],
					occluderQuad: null,
				};
				pushBarrier(topSurface);
			}

			if (!profile.showConnector) {
				return;
			}

			this.registerConnector(
				connectorTouches,
				normalSkeleton.startVertex,
				normalSkeleton.centerBase1,
				normalSkeleton.foundationCenter1.y,
				edgeId,
				barrier,
				a,
				b,
				normalHeight,
				focusedHeight,
				occluderQuad,
			);

			this.registerConnector(
				connectorTouches,
				normalSkeleton.endVertex,
				normalSkeleton.centerBase2,
				normalSkeleton.foundationCenter2.y,
				edgeId,
				barrier,
				a,
				b,
				normalHeight,
				focusedHeight,
				occluderQuad,
			);
		};

		/**
		 * East/west tile neighbours.
		 */
		for (let y = 0; y < compiled.grid.height; y++) {
			for (let x = 0; x < compiled.grid.width - 1; x++) {
				const a: RH.GridCoord = {
					x,
					y,
				};

				const b: RH.GridCoord = {
					x: x + 1,
					y,
				};

				const barrier = RH.getEdgeBetween(compiled.edges, a, b);

				if (barrier === RH.EdgeBarrier.None) {
					continue;
				}

				compileBarrierSegment(a, b, barrier);
			}
		}

		/**
		 * North/south tile neighbours.
		 */
		for (let y = 0; y < compiled.grid.height - 1; y++) {
			for (let x = 0; x < compiled.grid.width; x++) {
				const a: RH.GridCoord = {
					x,
					y,
				};

				const b: RH.GridCoord = {
					x,
					y: y + 1,
				};

				const barrier = RH.getEdgeBetween(compiled.edges, a, b);

				if (barrier === RH.EdgeBarrier.None) {
					continue;
				}

				compileBarrierSegment(a, b, barrier);
			}
		}

		// ------------------------------------------------------------
		// FINALIZE SHARED CONNECTORS
		// ------------------------------------------------------------

		for (const connector of connectorTouches.values()) {
			const profile = barrierRenderProfileFor(connector.barrier);
			const depth = connector.base.y + WORLD_DEPTH_BIAS.barrierConnector;

			const ownerCoord: RH.GridCoord = {
				x: this.clamp(connector.vertex.x, 0, compiled.grid.width - 1),
				y: this.clamp(connector.vertex.y, 0, compiled.grid.height - 1),
			};

			const chunkId = renderChunkIdForTile(ownerCoord, chunkSize);

			const connectorVisual: CompiledConnectorVisual = {
				id: `connector:${connector.vertex.x},${connector.vertex.y}` as VisualSurfaceId,
				chunkId,
				vertex: connector.vertex,
				base: connector.base,
				foundationBottomY: connector.foundationBottomY,
				barrier: connector.barrier,
				incidents: connector.incidents,
				depth,
				depthKey: worldDepthKey(depth),
				visibilityCoords: connector.visibilityCoords,
				occluderQuads: connector.occluderQuads,
				leftMaterial: this.barrierMaterial(
					connector.barrier,
					"connector-face",
					profile.connectorLeftColor,
					profile.connectorAlpha,
				),

				rightMaterial: this.barrierMaterial(
					connector.barrier,
					"connector-face",
					profile.connectorRightColor,
					profile.connectorAlpha,
				),

				topMaterial: profile.showConnectorTop
					? this.barrierMaterial(
							connector.barrier,
							"connector-top",
							profile.connectorTopColor,
							profile.connectorAlpha,
						)
					: null,
			};

			connectors.push(connectorVisual);

			chunkFor(chunkId).connectors.push(connectorVisual);
		}

		// ------------------------------------------------------------
		// FREEZE CHUNK SHAPE INTO PUBLIC CONTRACT
		// ------------------------------------------------------------

		const chunks = new Map<RenderChunkId, CompiledChunkVisual>();

		for (const [chunkId, mutable] of mutableChunks) {
			chunks.set(chunkId, {
				chunkId,
				tiles: mutable.tiles,
				terrainSurfaces: mutable.terrainSurfaces,
				barrierSurfaces: mutable.barrierSurfaces,
				connectors: mutable.connectors,
			});
		}

		return {
			floorIndex: options.floorIndex,
			mapSeed: options.mapSeed,
			width: compiled.grid.width,
			height: compiled.grid.height,
			chunkSize,
			tiles,
			terrainSurfaces,
			barrierSurfaces,
			connectors,
			chunks,
		};
	}

	// ============================================================
	// TILE GEOMETRY
	// ============================================================

	private trueTileCorners(
		coord: RH.GridCoord,
		elevationPx: number,
	): TrueTileCorners {
		const base = gridToScreen(coord);

		const screenY = base.y - elevationPx;

		return {
			top: {
				x: base.x,
				y: screenY - TILE_HEIGHT / 2,
			},
			right: {
				x: base.x + TILE_WIDTH / 2,
				y: screenY,
			},
			bottom: {
				x: base.x,
				y: screenY + TILE_HEIGHT / 2,
			},
			left: {
				x: base.x - TILE_WIDTH / 2,
				y: screenY,
			},
			center: {
				x: base.x,
				y: screenY,
			},
		};
	}

	private trueTileQuad(coord: RH.GridCoord, elevation: number): VisualQuad {
		const corners = this.trueTileCorners(coord, elevation * TILE_HEIGHT);
		return [corners.top, corners.right, corners.bottom, corners.left];
	}

	private tileQuad(
		coord: RH.GridCoord,
		elevation: number,
		trueFootprint: boolean,
	): VisualQuad {
		if (trueFootprint) {
			return this.trueTileQuad(coord, elevation);
		}

		const corners = this.trueTileCorners(coord, elevation * TILE_HEIGHT);
		const halfWidth = (TILE_WIDTH / 2) * TILE_OVERSIZE;
		const halfHeight = (TILE_HEIGHT / 2) * TILE_OVERSIZE;
		const center = corners.center;

		return [
			{
				x: center.x,
				y: center.y - halfHeight,
			},

			{
				x: center.x + halfWidth,
				y: center.y,
			},

			{
				x: center.x,
				y: center.y + halfHeight,
			},

			{
				x: center.x - halfWidth,
				y: center.y,
			},
		];
	}

	private elevationAt(
		compiled: RH.CompiledEdgeMap,
		coord: RH.GridCoord,
	): number | undefined {
		return compiled.elevation.get(RH.coordKey(coord));
	}

	/**
	 * Preserve current MapRenderer behaviour.
	 *
	 * Ordinary coplanar tiles are oversized to hide seams.
	 *
	 * A tile touching:
	 *
	 * - a lower finite neighbour, or
	 * - a different tile material
	 *
	 * uses its true authored footprint instead.
	 */
	private tileNeedsTrueFootprint(
		compiled: RH.CompiledEdgeMap,
		coord: RH.GridCoord,
		elevation: number,
		code: RH.EdgeMapTileCode | undefined,
	): boolean {
		const neighbours: RH.GridCoord[] = [
			{
				x: coord.x + 1,
				y: coord.y,
			},
			{
				x: coord.x - 1,
				y: coord.y,
			},
			{
				x: coord.x,
				y: coord.y + 1,
			},
			{
				x: coord.x,
				y: coord.y - 1,
			},
		];

		for (const neighbour of neighbours) {
			if (
				neighbour.x < 0 ||
				neighbour.y < 0 ||
				neighbour.x >= compiled.grid.width ||
				neighbour.y >= compiled.grid.height
			) {
				continue;
			}
			const key = RH.coordKey(neighbour);
			const otherElevation = compiled.elevation.get(key);
			const otherCode = compiled.tileCodes.get(key);
			if (
				otherElevation !== undefined &&
				Number.isFinite(otherElevation) &&
				elevation - otherElevation > EPSILON
			) {
				return true;
			}
			if (otherCode !== code) {
				return true;
			}
		}
		return false;
	}

	// ============================================================
	// BARRIER GEOMETRY
	// ============================================================

	private vertexScreenPoint(
		vertex: RH.GridVertex,
		elevation: number,
	): VisualPoint {
		const projected = gridToScreen({
			x: vertex.x,
			y: vertex.y,
		});

		return {
			x: projected.x,
			y: projected.y - TILE_HEIGHT / 2 - elevation * TILE_HEIGHT,
		};
	}

	private perpOffset(
		p1: VisualPoint,
		p2: VisualPoint,
		distance: number,
	): VisualPoint {
		const dx = p2.x - p1.x;
		const dy = p2.y - p1.y;
		const length = Math.hypot(dx, dy);
		if (length === 0) {
			return {
				x: 0,
				y: 0,
			};
		}

		return {
			x: (-dy / length) * distance,
			y: (dx / length) * distance,
		};
	}

	private buildBarrierSegmentSkeleton(
		edge: RH.StructuralEdgeRef,
		compiled: RH.CompiledEdgeMap,
		height: number,
		thicknessPx: number,
	): BarrierSegmentSkeleton {
		const [startVertex, endVertex] = RH.structuralEdgeVertices(edge);

		const startElevation = RH.resolveWallJunctionHeight(
			compiled,
			edge,
			startVertex,
		);

		const endElevation = RH.resolveWallJunctionHeight(
			compiled,
			edge,
			endVertex,
		);

		const foundationElevation =
			RH.edgeFoundationHeight(compiled, edge) ??
			Math.min(startElevation, endElevation);

		const centerBase1 = this.vertexScreenPoint(startVertex, startElevation);
		const centerBase2 = this.vertexScreenPoint(endVertex, endElevation);
		const foundationCenter1 = this.vertexScreenPoint(
			startVertex,
			foundationElevation,
		);
		const foundationCenter2 = this.vertexScreenPoint(
			endVertex,
			foundationElevation,
		);

		/**
		 * Thickness uses the plan-view edge at elevation zero.
		 *
		 * Terrain slope therefore cannot visually change barrier width.
		 */
		const raw1 = this.vertexScreenPoint(startVertex, 0);
		const raw2 = this.vertexScreenPoint(endVertex, 0);
		const offset = this.perpOffset(raw1, raw2, thicknessPx);

		const nearBase1: VisualPoint = {
			x: centerBase1.x + offset.x,
			y: centerBase1.y + offset.y,
		};

		const nearBase2: VisualPoint = {
			x: centerBase2.x + offset.x,
			y: centerBase2.y + offset.y,
		};

		const farBase1: VisualPoint = {
			x: centerBase1.x - offset.x,
			y: centerBase1.y - offset.y,
		};

		const farBase2: VisualPoint = {
			x: centerBase2.x - offset.x,
			y: centerBase2.y - offset.y,
		};

		const foundationNear1: VisualPoint = {
			x: foundationCenter1.x + offset.x,
			y: foundationCenter1.y + offset.y,
		};

		const foundationNear2: VisualPoint = {
			x: foundationCenter2.x + offset.x,
			y: foundationCenter2.y + offset.y,
		};

		const foundationFar1: VisualPoint = {
			x: foundationCenter1.x - offset.x,
			y: foundationCenter1.y - offset.y,
		};

		const foundationFar2: VisualPoint = {
			x: foundationCenter2.x - offset.x,
			y: foundationCenter2.y - offset.y,
		};

		const up = (point: VisualPoint): VisualPoint => ({
			x: point.x,
			y: point.y - height,
		});

		return {
			startVertex,
			endVertex,
			centerBase1,
			centerBase2,
			foundationCenter1,
			foundationCenter2,
			nearBase1,
			nearBase2,
			farBase1,
			farBase2,
			nearTop1: up(nearBase1),
			nearTop2: up(nearBase2),
			farTop1: up(farBase1),
			farTop2: up(farBase2),
			foundationNear1,
			foundationNear2,
			foundationFar1,
			foundationFar2,
			hasFoundation:
				Math.abs(foundationCenter1.y - centerBase1.y) > EPSILON ||
				Math.abs(foundationCenter2.y - centerBase2.y) > EPSILON,

			/**
			 * Important:
			 *
			 * foundation skirts may extend downward, but they must not alter
			 * the architectural depth of the wall itself.
			 */
			depth: Math.max(centerBase1.y, centerBase2.y),
		};
	}

	private barrierEdgeUv(
		edge: RH.StructuralEdgeRef,
		profile: BarrierRenderProfile,
	): readonly [number, number] {
		const edgeAxis = edge.orientation === "north" ? edge.x : edge.y;

		return [
			edgeAxis * profile.faceUvPerEdge,
			(edgeAxis + 1) * profile.faceUvPerEdge,
		];
	}

	private centerTopPoint(
		nearTop: VisualPoint,
		farTop: VisualPoint,
	): VisualPoint {
		return {
			x: (nearTop.x + farTop.x) / 2,
			y: (nearTop.y + farTop.y) / 2,
		};
	}

	private buildBarrierGeometry(
		edge: RH.StructuralEdgeRef,
		skeleton: BarrierSegmentSkeleton,
		profile: BarrierRenderProfile,
	): BarrierCompiledGeometry {
		const [u1, u2] = this.barrierEdgeUv(edge, profile);

		if (profile.geometryKind === "panel") {
			const top1 = this.centerTopPoint(skeleton.nearTop1, skeleton.farTop1);
			const top2 = this.centerTopPoint(skeleton.nearTop2, skeleton.farTop2);
			const bottom1 = profile.extendSegmentToFoundation
				? skeleton.foundationCenter1
				: skeleton.centerBase1;
			const bottom2 = profile.extendSegmentToFoundation
				? skeleton.foundationCenter2
				: skeleton.centerBase2;

			const face: VisualQuad = [top1, top2, bottom2, bottom1];

			const v1 =
				(Math.max(1, bottom1.y - top1.y) / WALL_HEIGHT_PX) *
				profile.faceUvPerStorey;

			const v2 =
				(Math.max(1, bottom2.y - top2.y) / WALL_HEIGHT_PX) *
				profile.faceUvPerStorey;

			return {
				face,
				faceUvs: [u1, 0, u2, 0, u2, v2, u1, v1],
				faceFallbackColor:
					edge.orientation === "north"
						? profile.segmentLeftColor
						: profile.segmentRightColor,
				top: null,
				topUvs: null,
			};
		}

		/**
		 * Solid barriers are prisms.
		 *
		 * Only the camera-facing long side is rendered, matching the current
		 * renderer and avoiding doubled wall faces.
		 */
		const nearDepth = (skeleton.nearBase1.y + skeleton.nearBase2.y) / 2;
		const farDepth = (skeleton.farBase1.y + skeleton.farBase2.y) / 2;
		const frontIsNear = nearDepth >= farDepth;
		const frontBase1 = frontIsNear ? skeleton.nearBase1 : skeleton.farBase1;
		const frontBase2 = frontIsNear ? skeleton.nearBase2 : skeleton.farBase2;
		const frontTop1 = frontIsNear ? skeleton.nearTop1 : skeleton.farTop1;
		const frontTop2 = frontIsNear ? skeleton.nearTop2 : skeleton.farTop2;
		const frontFoundation1 = frontIsNear
			? skeleton.foundationNear1
			: skeleton.foundationFar1;

		const frontFoundation2 = frontIsNear
			? skeleton.foundationNear2
			: skeleton.foundationFar2;

		const frontBottom1 =
			profile.extendSegmentToFoundation && skeleton.hasFoundation
				? frontFoundation1
				: frontBase1;

		const frontBottom2 =
			profile.extendSegmentToFoundation && skeleton.hasFoundation
				? frontFoundation2
				: frontBase2;

		const face: VisualQuad = [frontTop1, frontTop2, frontBottom2, frontBottom1];

		const v1 =
			(Math.max(1, frontBottom1.y - frontTop1.y) / WALL_HEIGHT_PX) *
			profile.faceUvPerStorey;

		const v2 =
			(Math.max(1, frontBottom2.y - frontTop2.y) / WALL_HEIGHT_PX) *
			profile.faceUvPerStorey;

		const top: VisualQuad = [
			skeleton.nearTop1,
			skeleton.nearTop2,
			skeleton.farTop2,
			skeleton.farTop1,
		];

		return {
			face,
			faceUvs: [u1, 0, u2, 0, u2, v2, u1, v1],
			faceFallbackColor: frontIsNear
				? profile.segmentLeftColor
				: profile.segmentRightColor,
			top: profile.showSegmentTop ? top : null,
			topUvs: profile.showSegmentTop ? [u1, 0, u2, 0, u2, 1, u1, 1] : null,
		};
	}

	// ============================================================
	// CONNECTORS
	// ============================================================

	private registerConnector(
		connectors: Map<string, MutableConnector>,
		vertex: RH.GridVertex,
		base: VisualPoint,
		foundationBottomY: number,
		edgeId: string,
		barrier: RH.EdgeBarrier,
		a: RH.GridCoord,
		b: RH.GridCoord,
		normalHeight: number,
		focusedHeight: number,
		occluderQuad: VisualQuad | null,
	): void {
		const vertexKey = `${vertex.x},${vertex.y}`;
		let connector = connectors.get(vertexKey);

		if (!connector) {
			connector = {
				vertex,
				base,
				foundationBottomY,
				barrier,
				incidents: [],
				visibilityCoords: [],
				visibilityCoordKeys: new Set<string>(),
				occluderQuads: [],
				occluderKeys: new Set<string>(),
			};
			connectors.set(vertexKey, connector);
		}

		connector.foundationBottomY = Math.max(
			connector.foundationBottomY,
			foundationBottomY,
		);

		if (
			connectorPriorityFor(barrier) > connectorPriorityFor(connector.barrier)
		) {
			connector.barrier = barrier;
		}

		const incident: CompiledConnectorIncident = {
			edgeId,
			barrier,
			visibilityCoords: [a, b],
			normalHeight,
			focusedHeight,
		};
		connector.incidents.push(incident);
		this.addConnectorVisibilityCoord(connector, a);
		this.addConnectorVisibilityCoord(connector, b);

		if (occluderQuad) {
			/**
			 * The foreground tile is always `b` under the current canonical
			 * barrier iteration.
			 */
			const occluderKey = RH.coordKey(b);
			if (!connector.occluderKeys.has(occluderKey)) {
				connector.occluderKeys.add(occluderKey);
				connector.occluderQuads.push(occluderQuad);
			}
		}
	}

	private addConnectorVisibilityCoord(
		connector: MutableConnector,
		coord: RH.GridCoord,
	): void {
		const key = RH.coordKey(coord);
		if (connector.visibilityCoordKeys.has(key)) {
			return;
		}
		connector.visibilityCoordKeys.add(key);
		connector.visibilityCoords.push(coord);
	}

	// ============================================================
	// MATERIAL HELPERS
	// ============================================================

	private barrierMaterial(
		barrier: RH.EdgeBarrier,
		surface:
			| "segment-face"
			| "segment-top"
			| "connector-face"
			| "connector-top",
		fallbackColor: number,
		alpha: number,
	): VisualMaterialRef {
		return {
			kind: "barrier",
			barrier,
			surface,
			fallbackColor,
			alpha,
		};
	}

	// ============================================================
	// GENERAL
	// ============================================================

	private clamp(value: number, min: number, max: number): number {
		return Math.max(min, Math.min(max, value));
	}
}
