import type { Buffer, Container } from "pixi.js";
import * as RH from "@relic-hunter/shared";
import { perf } from "@/perf/PerfMonitor";
import type { RenderChunkId } from "../chunks/ChunkCoord";
import type {
	CompiledConnectorVisual,
	CompiledFloorVisual,
	VisualQuad,
} from "../compiler/CompiledFloorVisual";
import {
	clipQuadToTriangles,
	padTriangleSurface,
} from "../geometry/ClippedSurface";
import {
	compileConnectorSurfaces,
	type ConnectorSurfaceSlot,
} from "../geometry/ConnectorSurfaceCompiler";

import { updateGpuBuffer } from "../gpu/BufferUpdate";
import {
	GpuMaterialLibrary,
	type ResolvedStaticWorldGpuMaterial,
} from "../gpu/GpuMaterialLibrary";
import { createStaticWorldMesh } from "../gpu/StaticWorldMeshFactory";
import type { FogPresentationBuffer } from "../presentation/FogPresentationBuffer";
import {
	resolveBarrierPresentation,
	resolveConnectorPresentation,
	resolveTerrainPresentation,
	type WorldPresentationCode,
} from "../presentation/WorldPresentation";
import { BarrierFocusBuffer } from "./BarrierFocusBuffer";
import { StaticWorldBatchBuilder } from "./StaticWorldBatchBuilder";
import type { StaticWorldMeshHandle } from "./StaticWorldMeshHandle";
import { WorldDepthStrata } from "./WorldDepthStrata";
import type { VisualDepthKey } from "./worldDepthKey";

/**
 * Temporary CPU-side batch state used while one floor is being assembled.
 *
 * `ranges` remembers where logical terrain/barrier/connector surfaces land
 * inside the final combined typed arrays so presentation and focus changes can
 * patch only those ranges later.
 */
interface MutableWorldBatch {
	depthKey: VisualDepthKey;
	chunkId: RenderChunkId;
	material: ResolvedStaticWorldGpuMaterial;
	builder: StaticWorldBatchBuilder;
	ranges: PendingWorldRange[];
}

interface PendingRangeBase {
	firstVertex: number;
	vertexCount: number;
}

interface PendingTerrainRange extends PendingRangeBase {
	kind: "terrain";
	visibilityCoords: readonly RH.GridCoord[];
}

interface PendingBarrierRange extends PendingRangeBase {
	kind: "barrier";
	edgeId: string;
	positionOffset: number;
	uvOffset: number;
	visibilityCoords: readonly RH.GridCoord[];
	normalPositions: readonly number[];
	focusedPositions: readonly number[];
	normalUvs: readonly number[];
	focusedUvs: readonly number[];
}

interface PendingConnectorRange extends PendingRangeBase {
	kind: "connector";
	connector: CompiledConnectorVisual;
	surface: ConnectorSurfaceSlot;
	positionOffset: number;
	uvOffset: number;

	/**
	 * True when this connector slot has been converted from one quad into
	 * terrain-clipped triangle geometry.
	 */
	clipped: boolean;
}

type PendingWorldRange =
	| PendingTerrainRange
	| PendingBarrierRange
	| PendingConnectorRange;

interface RuntimeRangeBase {
	handle: StaticWorldMeshHandle;
	firstVertex: number;
	vertexCount: number;
}

interface TerrainPresentationRange extends RuntimeRangeBase {
	kind: "terrain";
	visibilityCoords: readonly RH.GridCoord[];
}

interface BarrierPatchRange extends RuntimeRangeBase {
	kind: "barrier";
	edgeId: string;
	positionOffset: number;
	uvOffset: number;
	visibilityCoords: readonly RH.GridCoord[];
	normalPositions: readonly number[];
	focusedPositions: readonly number[];
	normalUvs: readonly number[];
	focusedUvs: readonly number[];
}

interface ConnectorPatchRange extends RuntimeRangeBase {
	kind: "connector";
	connector: CompiledConnectorVisual;
	surface: ConnectorSurfaceSlot;
	positionOffset: number;
	uvOffset: number;

	/**
	 * Clipped connector ranges have fixed-capacity triangle data rather than
	 * four ordinary quad vertices. Focus changes must regenerate that clipped
	 * triangle data while keeping the same buffer length.
	 */
	clipped: boolean;
}

type RuntimeWorldRange =
	| TerrainPresentationRange
	| BarrierPatchRange
	| ConnectorPatchRange;

export interface StaticWorldPresentationInput {
	fog: FogPresentationBuffer;
	mapWidth: number;
	focusRoom: RH.Room | null;
	forceWashed: boolean;
}

/**
 * Runtime owner for the active floor's batched static world geometry.
 *
 * Static terrain, barriers and connectors are grouped by exact world depth,
 * render chunk and compatible material. Fog and room-focus changes mutate
 * existing GPU buffers instead of rebuilding Mesh objects.
 */
export class StaticWorldRenderer {
	private readonly materialLibrary = new GpuMaterialLibrary();
	private readonly strata: WorldDepthStrata;
	private readonly meshes: StaticWorldMeshHandle[] = [];
	private readonly ranges: RuntimeWorldRange[] = [];
	private readonly barrierRangesByEdge = new Map<string, BarrierPatchRange[]>();
	private readonly connectorRangesById = new Map<
		string,
		ConnectorPatchRange[]
	>();
	private readonly connectorIdsByIncidentEdge = new Map<string, Set<string>>();
	private readonly focus = new BarrierFocusBuffer();

	constructor(worldDepthRoot: Container) {
		this.strata = new WorldDepthStrata(worldDepthRoot);
	}

	/**
	 * Replace the currently mounted static world with one compiled floor.
	 *
	 * All expensive geometry/topology decisions have already happened in the
	 * compiler. This method only batches those records and creates GPU meshes.
	 */
	mount(compiled: CompiledFloorVisual): void {
		this.destroy();
		const batches = new Map<string, MutableWorldBatch>();

		// ------------------------------------------------------------
		// TERRAIN
		// ------------------------------------------------------------

		for (const surface of compiled.terrainSurfaces) {
			const material = this.materialLibrary.resolveWorld(surface.material);

			const batch = this.batchFor(
				batches,
				surface.depthKey,
				surface.chunkId,
				material,
			);
			const added = batch.builder.addQuad(surface.quad, surface.uvs, 2);

			batch.ranges.push({
				kind: "terrain",
				firstVertex: added.firstVertex,
				vertexCount: added.vertexCount,
				visibilityCoords: surface.visibilityCoords,
			});
		}

		// ------------------------------------------------------------
		// BARRIERS
		// ------------------------------------------------------------

		for (const surface of compiled.barrierSurfaces) {
			const material = this.materialLibrary.resolveWorld(surface.material);
			const batch = this.batchFor(
				batches,
				surface.depthKey,
				surface.chunkId,
				material,
			);

			/**
			 * Fence/Glass surfaces that intersect a foreground tile are clipped
			 * into triangles at mount time instead of receiving a permanent
			 * inverse Pixi mask.
			 */
			if (surface.occluderQuad) {
				const normalClipped = clipQuadToTriangles(
					surface.normalQuad,
					surface.normalUvs,
					[surface.occluderQuad],
				);

				const focusedClipped = clipQuadToTriangles(
					surface.focusedQuad,
					surface.focusedUvs,
					[surface.occluderQuad],
				);

				/**
				 * Normal/focused clipping may produce different triangle counts.
				 * Allocate enough capacity for both and pad the smaller variant
				 * with degenerate triangles so room focus never resizes buffers.
				 */
				const capacity = Math.max(
					3,
					normalClipped.vertexCount,
					focusedClipped.vertexCount,
				);

				const normal = padTriangleSurface(
					normalClipped,
					capacity,
					surface.normalQuad,
					surface.normalUvs,
				);

				const focused = padTriangleSurface(
					focusedClipped,
					capacity,
					surface.focusedQuad,
					surface.focusedUvs,
				);

				const added = batch.builder.addTriangles(
					normal.positions,
					normal.uvs,
					2,
				);

				batch.ranges.push({
					kind: "barrier",
					edgeId: surface.edgeId,
					firstVertex: added.firstVertex,
					vertexCount: added.vertexCount,
					positionOffset: added.positionOffset,
					uvOffset: added.uvOffset,
					visibilityCoords: surface.visibilityCoords,
					normalPositions: normal.positions,
					focusedPositions: focused.positions,
					normalUvs: normal.uvs,
					focusedUvs: focused.uvs,
				});

				continue;
			}

			const added = batch.builder.addQuad(
				surface.normalQuad,
				surface.normalUvs,
				2,
			);

			batch.ranges.push({
				kind: "barrier",
				edgeId: surface.edgeId,
				firstVertex: added.firstVertex,
				vertexCount: added.vertexCount,
				positionOffset: added.positionOffset,
				uvOffset: added.uvOffset,
				visibilityCoords: surface.visibilityCoords,
				normalPositions: quadPositions(surface.normalQuad),
				focusedPositions: quadPositions(surface.focusedQuad),
				normalUvs: [...surface.normalUvs],
				focusedUvs: [...surface.focusedUvs],
			});
		}

		// ------------------------------------------------------------
		// CONNECTORS
		// ------------------------------------------------------------

		for (const connector of compiled.connectors) {
			const normalHeight = this.resolveConnectorHeight(
				connector,
				new Set<string>(),
			);
			const surfaces = compileConnectorSurfaces(connector, normalHeight);
			for (const surface of surfaces) {
				const material = this.materialLibrary.resolveWorld(surface.material);
				const batch = this.batchFor(
					batches,
					connector.depthKey,
					connector.chunkId,
					material,
				);

				/**
				 * Fence/Glass connectors can also pass behind raised foreground
				 * terrain. Their clipped variants use fixed-capacity triangle
				 * ranges so focus-height changes still patch in place.
				 */
				if (connector.occluderQuads.length > 0) {
					const capacity = this.clippedConnectorCapacity(
						connector,
						surface.slot,
					);
					const clipped = this.clippedConnectorSurface(
						connector,
						normalHeight,
						surface.slot,
						capacity,
					);
					const added = batch.builder.addTriangles(
						clipped.positions,
						clipped.uvs,
						2,
					);

					batch.ranges.push({
						kind: "connector",
						connector,
						surface: surface.slot,
						firstVertex: added.firstVertex,
						vertexCount: added.vertexCount,
						positionOffset: added.positionOffset,
						uvOffset: added.uvOffset,
						clipped: true,
					});

					continue;
				}

				const added = batch.builder.addQuad(surface.quad, surface.uvs, 2);

				batch.ranges.push({
					kind: "connector",
					connector,
					surface: surface.slot,
					firstVertex: added.firstVertex,
					vertexCount: added.vertexCount,
					positionOffset: added.positionOffset,
					uvOffset: added.uvOffset,
					clipped: false,
				});
			}

			/**
			 * Reverse index used by focus updates:
			 *
			 * changed structural edge -> connectors whose height may depend on it
			 */
			for (const incident of connector.incidents) {
				let connectorIds = this.connectorIdsByIncidentEdge.get(incident.edgeId);
				if (!connectorIds) {
					connectorIds = new Set<string>();
					this.connectorIdsByIncidentEdge.set(incident.edgeId, connectorIds);
				}
				connectorIds.add(connector.id);
			}
		}

		// ------------------------------------------------------------
		// FINALIZE GPU BATCHES
		// ------------------------------------------------------------

		let vertexCount = 0;

		for (const batch of batches.values()) {
			const data = batch.builder.freeze();
			const handle = createStaticWorldMesh(data, batch.material, {
				depthKey: batch.depthKey,
				chunkId: batch.chunkId,
			});

			for (const pending of batch.ranges) {
				const runtime: RuntimeWorldRange = {
					...pending,
					handle,
				};
				this.ranges.push(runtime);
				if (runtime.kind === "barrier") {
					let edgeRanges = this.barrierRangesByEdge.get(runtime.edgeId);
					if (!edgeRanges) {
						edgeRanges = [];
						this.barrierRangesByEdge.set(runtime.edgeId, edgeRanges);
					}
					edgeRanges.push(runtime);
				}
				if (runtime.kind === "connector") {
					let connectorRanges = this.connectorRangesById.get(
						runtime.connector.id,
					);
					if (!connectorRanges) {
						connectorRanges = [];
						this.connectorRangesById.set(runtime.connector.id, connectorRanges);
					}

					connectorRanges.push(runtime);
				}
			}

			this.meshes.push(handle);
			this.strata.mount(handle);
			vertexCount += data.vertexCount;
		}

		perf.setCounter("engine.staticDepthStrata", this.strata.stratumCount);
		perf.setCounter("engine.staticWorldMeshCount", this.meshes.length);
		perf.setCounter("engine.staticWorldVertices", vertexCount);

		/**
		 * The new static path clips Fence/Glass geometry directly, so normal
		 * static rendering owns no permanent Pixi inverse masks.
		 */
		perf.setCounter("engine.staticMaskCount", 0);
	}

	/**
	 * Apply fog/room-focus presentation to already-mounted static world meshes.
	 *
	 * Structural Mesh objects remain alive. Only the affected position, UV and
	 * presentation buffer values are changed.
	 */
	updatePresentation(input: StaticWorldPresentationInput): void {
		const endFocusPerf = perf.start("engine.barrierFocusPatchMs");
		const focusDiff = this.focus.update(input.focusRoom);

		const patchedEdges = this.patchBarrierFocus(
			focusDiff.changedEdgeIds,
			focusDiff.focusedEdgeIds,
		);

		const patchedConnectors = this.patchConnectorFocus(
			focusDiff.changedEdgeIds,
			focusDiff.focusedEdgeIds,
		);

		perf.setCounter("engine.barrierFocusPatchedEdges", patchedEdges);
		perf.setCounter("engine.connectorFocusPatched", patchedConnectors);
		endFocusPerf();

		const focusCellKeys = input.focusRoom
			? new Set(input.focusRoom.cells.map((coord) => RH.coordKey(coord)))
			: null;

		const changedPresentationBuffers = new Set<Buffer>();

		for (const range of this.ranges) {
			const next: WorldPresentationCode =
				range.kind === "terrain"
					? resolveTerrainPresentation(
							range.visibilityCoords,
							input.mapWidth,
							input.fog,
							focusCellKeys,
							input.forceWashed,
						)
					: range.kind === "barrier"
						? resolveBarrierPresentation(
								range.visibilityCoords,
								input.mapWidth,
								input.fog,
								input.focusRoom !== null,
								focusDiff.focusedEdgeIds.has(range.edgeId),
								input.forceWashed,
							)
						: resolveConnectorPresentation(
								range.connector,
								input.mapWidth,
								input.fog,
								input.focusRoom !== null,
								focusDiff.focusedEdgeIds,
								input.forceWashed,
							);

			if (
				writePresentationRange(
					range.handle.data.presentation,
					range.firstVertex,
					range.vertexCount,
					next,
				)
			) {
				changedPresentationBuffers.add(range.handle.presentationBuffer);
			}
		}
		for (const buffer of changedPresentationBuffers) {
			updateGpuBuffer(buffer);
		}
	}

	destroy(): void {
		for (const mesh of this.meshes) {
			mesh.destroy();
		}

		this.meshes.length = 0;
		this.ranges.length = 0;

		this.barrierRangesByEdge.clear();
		this.connectorRangesById.clear();
		this.connectorIdsByIncidentEdge.clear();

		this.strata.clear();
		this.focus.reset();

		perf.setCounter("engine.barrierFocusPatchedEdges", 0);
		perf.setCounter("engine.connectorFocusPatched", 0);
		perf.setCounter("engine.staticDepthStrata", 0);
		perf.setCounter("engine.staticWorldMeshCount", 0);
		perf.setCounter("engine.staticWorldVertices", 0);
		perf.setCounter("engine.staticMaskCount", 0);
	}

	private batchFor(
		batches: Map<string, MutableWorldBatch>,
		depthKey: VisualDepthKey,
		chunkId: RenderChunkId,
		material: ResolvedStaticWorldGpuMaterial,
	): MutableWorldBatch {
		const key = [depthKey, chunkId, material.batchKey].join("|");
		const existing = batches.get(key);
		if (existing) {
			return existing;
		}
		const created: MutableWorldBatch = {
			depthKey,
			chunkId,
			material,
			builder: new StaticWorldBatchBuilder(),
			ranges: [],
		};
		batches.set(key, created);
		return created;
	}

	/**
	 * Patch only barrier surfaces belonging to structural edges whose focused
	 * state changed.
	 */
	private patchBarrierFocus(
		changedEdgeIds: ReadonlySet<string>,
		focusedEdgeIds: ReadonlySet<string>,
	): number {
		const changedPositionBuffers = new Set<Buffer>();
		const changedUvBuffers = new Set<Buffer>();
		let patchedEdges = 0;
		for (const edgeId of changedEdgeIds) {
			const ranges = this.barrierRangesByEdge.get(edgeId);
			if (!ranges || ranges.length === 0) {
				continue;
			}
			const focused = focusedEdgeIds.has(edgeId);
			for (const range of ranges) {
				copyNumbers(
					range.handle.data.positions,
					range.positionOffset,
					focused ? range.focusedPositions : range.normalPositions,
				);
				copyNumbers(
					range.handle.data.uvs,
					range.uvOffset,
					focused ? range.focusedUvs : range.normalUvs,
				);
				changedPositionBuffers.add(range.handle.positionBuffer);
				changedUvBuffers.add(range.handle.uvBuffer);
			}
			patchedEdges++;
		}

		for (const buffer of changedPositionBuffers) {
			updateGpuBuffer(buffer);
		}
		for (const buffer of changedUvBuffers) {
			updateGpuBuffer(buffer);
		}
		return patchedEdges;
	}

	/**
	 * Connector height is the tallest currently active contribution from all
	 * structural edges touching that connector.
	 */
	private resolveConnectorHeight(
		connector: CompiledConnectorVisual,
		focusedEdgeIds: ReadonlySet<string>,
	): number {
		let height = 0;

		for (const incident of connector.incidents) {
			height = Math.max(
				height,
				focusedEdgeIds.has(incident.edgeId)
					? incident.focusedHeight
					: incident.normalHeight,
			);
		}
		return height;
	}

	/**
	 * Only connectors incident to a changed focus edge need their geometry
	 * recalculated.
	 */
	private patchConnectorFocus(
		changedEdgeIds: ReadonlySet<string>,
		focusedEdgeIds: ReadonlySet<string>,
	): number {
		const affectedConnectorIds = new Set<string>();
		for (const edgeId of changedEdgeIds) {
			const connectorIds = this.connectorIdsByIncidentEdge.get(edgeId);
			if (!connectorIds) {
				continue;
			}
			for (const connectorId of connectorIds) {
				affectedConnectorIds.add(connectorId);
			}
		}

		const changedPositionBuffers = new Set<Buffer>();
		const changedUvBuffers = new Set<Buffer>();

		for (const connectorId of affectedConnectorIds) {
			const ranges = this.connectorRangesById.get(connectorId);
			if (!ranges || ranges.length === 0) {
				continue;
			}
			const connector = ranges[0].connector;
			const height = this.resolveConnectorHeight(connector, focusedEdgeIds);

			/**
			 * Ordinary connector ranges can reuse these quads directly. Clipped
			 * ranges regenerate their triangle representation below.
			 */
			const surfaces = compileConnectorSurfaces(connector, height);
			for (const range of ranges) {
				if (range.clipped) {
					const clipped = this.clippedConnectorSurface(
						connector,
						height,
						range.surface,
						range.vertexCount,
					);
					copyNumbers(
						range.handle.data.positions,
						range.positionOffset,
						clipped.positions,
					);
					copyNumbers(range.handle.data.uvs, range.uvOffset, clipped.uvs);
				} else {
					const surface = surfaces.find(
						(entry) => entry.slot === range.surface,
					);
					if (!surface) {
						throw new Error(
							`StaticWorldRenderer: connector ${connector.id} lost ${range.surface} surface`,
						);
					}
					copyNumbers(
						range.handle.data.positions,
						range.positionOffset,
						quadPositions(surface.quad),
					);
					copyNumbers(range.handle.data.uvs, range.uvOffset, surface.uvs);
				}
				changedPositionBuffers.add(range.handle.positionBuffer);
				changedUvBuffers.add(range.handle.uvBuffer);
			}
		}
		for (const buffer of changedPositionBuffers) {
			updateGpuBuffer(buffer);
		}
		for (const buffer of changedUvBuffers) {
			updateGpuBuffer(buffer);
		}
		return affectedConnectorIds.size;
	}

	/**
	 * Every possible connector focus height is one of its incidents' normal or
	 * focused heights. Evaluating that finite set tells us the largest clipped
	 * triangle range this connector slot can ever need.
	 */
	private connectorCandidateHeights(
		connector: CompiledConnectorVisual,
	): readonly number[] {
		const heights = new Set<number>();
		for (const incident of connector.incidents) {
			heights.add(incident.normalHeight);
			heights.add(incident.focusedHeight);
		}
		return [...heights];
	}

	private clippedConnectorCapacity(
		connector: CompiledConnectorVisual,
		slot: ConnectorSurfaceSlot,
	): number {
		let capacity = 3;

		for (const height of this.connectorCandidateHeights(connector)) {
			const surface = compileConnectorSurfaces(connector, height).find(
				(entry) => entry.slot === slot,
			);
			if (!surface) {
				continue;
			}
			const clipped = clipQuadToTriangles(
				surface.quad,
				surface.uvs,
				connector.occluderQuads,
			);
			capacity = Math.max(capacity, clipped.vertexCount);
		}
		return capacity;
	}

	private clippedConnectorSurface(
		connector: CompiledConnectorVisual,
		height: number,
		slot: ConnectorSurfaceSlot,
		capacity: number,
	) {
		const surface = compileConnectorSurfaces(connector, height).find(
			(entry) => entry.slot === slot,
		);
		if (!surface) {
			throw new Error(
				`StaticWorldRenderer: connector ${connector.id} lost ${slot} surface`,
			);
		}
		const clipped = clipQuadToTriangles(
			surface.quad,
			surface.uvs,
			connector.occluderQuads,
		);
		return padTriangleSurface(clipped, capacity, surface.quad, surface.uvs);
	}
}

function quadPositions(quad: VisualQuad): readonly number[] {
	return [
		quad[0].x,
		quad[0].y,
		quad[1].x,
		quad[1].y,
		quad[2].x,
		quad[2].y,
		quad[3].x,
		quad[3].y,
	];
}

function copyNumbers(
	target: Float32Array,
	offset: number,
	values: readonly number[],
): void {
	for (let index = 0; index < values.length; index++) {
		target[offset + index] = values[index];
	}
}

function writePresentationRange(
	presentation: Float32Array,
	firstVertex: number,
	vertexCount: number,
	next: number,
): boolean {
	let changed = false;
	for (let localVertex = 0; localVertex < vertexCount; localVertex++) {
		const index = firstVertex + localVertex;
		if (presentation[index] === next) {
			continue;
		}
		presentation[index] = next;
		changed = true;
	}
	return changed;
}
