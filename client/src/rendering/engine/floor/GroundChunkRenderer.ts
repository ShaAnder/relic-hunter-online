import type { Container } from "pixi.js";
import { perf } from "@/perf/PerfMonitor";
import type { MaterialBatchKey } from "../batching/MaterialBatchKey";
import { QuadBatchBuilder } from "../batching/QuadBatchBuilder";
import type { RenderChunkId } from "../chunks/ChunkCoord";
import type {
	CompiledChunkVisual,
	CompiledFloorVisual,
} from "../compiler/CompiledFloorVisual";
import {
	GpuMaterialLibrary,
	type ResolvedGroundGpuMaterial,
} from "../gpu/GpuMaterialLibrary";
import { createStaticGroundMesh } from "../gpu/StaticMeshFactory";
import type { FogPresentationBuffer } from "../presentation/FogPresentationBuffer";
import { GroundPresentationCode } from "../presentation/PresentationDiff";
import { GroundChunkHandle } from "./GroundChunkHandle";

// Temporary build-time state for one material-compatible ground batch.
interface MutableGroundBatch {
	material: ResolvedGroundGpuMaterial;
	builder: QuadBatchBuilder;
}

/**
 * Builds and owns the chunked ground rendering layer for one compiled floor.
 *
 * Compiled tiles are grouped first by render chunk and then by compatible GPU
 * material. Each group becomes one static mesh batch, allowing large parts of
 * the floor to render without creating one Pixi object per tile.
 */
export class GroundChunkRenderer {
	// Shared material resolver/cache used while building every ground chunk.
	private readonly materialLibrary = new GpuMaterialLibrary();
	// Runtime lookup from logical chunk ID to the mounted GPU resources for that chunk.
	private readonly chunks = new Map<RenderChunkId, GroundChunkHandle>();

	constructor(private readonly root: Container) {}
	// Mounting replaces the current floor, so release all previously owned chunk resources first.
	mount(compiled: CompiledFloorVisual): void {
		this.destroy();
		// Empty chunks need no runtime container or GPU meshes.
		for (const chunk of compiled.chunks.values()) {
			if (chunk.tiles.length === 0) {
				continue;
			}
			const handle = this.buildChunk(chunk, compiled.width);
			this.chunks.set(chunk.chunkId, handle);
			this.root.addChild(handle.view);
		}

		let meshCount = 0;
		let vertexCount = 0;
		// Record structural renderer metrics so chunking/batching costs can be profiled at runtime.
		for (const chunk of this.chunks.values()) {
			meshCount += chunk.meshCount;
			vertexCount += chunk.vertexCount;
		}
		// diagnostic counters
		perf.setCounter("engine.groundChunkCount", this.chunks.size);
		perf.setCounter("engine.groundMeshCount", meshCount);
		perf.setCounter("engine.groundVertexCount", vertexCount);
	}

	updatePresentation(
		dirtyChunkIds: ReadonlySet<RenderChunkId>,
		mapWidth: number,
		fog: FogPresentationBuffer,
		focusCellKeys: ReadonlySet<string> | null,
		forceWashed: boolean,
	): void {
		for (const chunkId of dirtyChunkIds) {
			this.chunks
				.get(chunkId)
				?.updatePresentation(mapWidth, fog, focusCellKeys, forceWashed);
		}
	}

	// Return a snapshot of all currently mounted chunk IDs without exposing the internal Map.
	allChunkIds(): ReadonlySet<RenderChunkId> {
		return new Set(this.chunks.keys());
	}

	/**
	 * Destroy every owned ground chunk and reset renderer metrics.
	 * Chunk destruction cascades into destruction of each batch's Pixi/GPU resources.
	 */
	destroy(): void {
		for (const chunk of this.chunks.values()) {
			chunk.destroy();
		}

		this.chunks.clear();
		perf.setCounter("engine.groundChunkCount", 0);
		perf.setCounter("engine.groundMeshCount", 0);
		perf.setCounter("engine.groundVertexCount", 0);
	}

	// Group this chunk's tiles by GPU-compatible material so each group can become one mesh.
	private buildChunk(
		chunk: CompiledChunkVisual,
		mapWidth: number,
	): GroundChunkHandle {
		// Reuse the builder for an existing material batch, or create it on first encounter.
		const batches = new Map<MaterialBatchKey, MutableGroundBatch>();

		for (const tile of chunk.tiles) {
			const material = this.materialLibrary.resolveGround(tile.material);
			// Reuse the builder for an existing material batch, or create it on first encounter.
			let batch = batches.get(material.batchKey);
			if (!batch) {
				batch = {
					material,
					builder: new QuadBatchBuilder(),
				};
				batches.set(material.batchKey, batch);
			}
			// Flatten the tile coordinate so the batch can later map each quad back to fog/presentation state.
			const tileIndex = tile.coord.y * mapWidth + tile.coord.x;

			// Append this tile's geometry and world lookup metadata to its material batch.
			// Presentation begins Normal and is corrected by the dynamic visibility pass.
			batch.builder.addQuad(
				tile.quad,
				tile.uvs,
				tileIndex,
				GroundPresentationCode.Normal,
			);
		}

		const handle = new GroundChunkHandle(chunk.chunkId);
		// Finalize each material batch and create the actual Pixi/GPU mesh owned by this chunk.
		for (const batch of batches.values()) {
			const data = batch.builder.freeze();

			handle.addBatch(createStaticGroundMesh(data, batch.material));
		}

		return handle;
	}
}

/**
 * LEARNING NOTE:
 *
 * GroundChunkRenderer orchestrates the ground rendering pipeline by taking
 * compiled floor chunks, grouping their tiles into material-compatible mesh
 * batches, creating and mounting the resulting GPU meshes, and forwarding
 * presentation updates only to chunks that actually changed.
 */
