import type { Container } from "pixi.js";

import { perf } from "@/perf/PerfMonitor";

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

import type { VisualDepthKey } from "../world/worldDepthKey";

import { GroundChunkHandle } from "./GroundChunkHandle";

import { GroundDepthStrata } from "./GroundDepthStrata";

/**
 * Temporary CPU-side state for one GPU-compatible ground batch.
 *
 * Depth is part of compatibility now: two tiles may share a material and
 * chunk, but they cannot share one mesh if another surface needs to sort
 * between their projected depths.
 */
interface MutableGroundBatch {
	depthKey: VisualDepthKey;

	material: ResolvedGroundGpuMaterial;

	builder: QuadBatchBuilder;
}

/**
 * Builds and owns the chunked ground rendering layer for one compiled floor.
 *
 * Chunks remain the structural ownership/culling unit, but painter order sits
 * above chunk ownership. Ground meshes are therefore mounted through exact
 * depth strata rather than through one scene-graph Container per chunk.
 */
export class GroundChunkRenderer {
	private readonly materialLibrary = new GpuMaterialLibrary();

	private readonly chunks = new Map<RenderChunkId, GroundChunkHandle>();

	private readonly strata: GroundDepthStrata;

	constructor(root: Container) {
		this.strata = new GroundDepthStrata(root);
	}

	/**
	 * Mounting replaces the currently rendered floor.
	 */
	mount(compiled: CompiledFloorVisual): void {
		this.destroy();

		for (const chunk of compiled.chunks.values()) {
			if (chunk.tiles.length === 0) {
				continue;
			}

			const handle = this.buildChunk(chunk, compiled.width);

			this.chunks.set(chunk.chunkId, handle);
		}

		let meshCount = 0;

		let vertexCount = 0;

		for (const chunk of this.chunks.values()) {
			meshCount += chunk.meshCount;

			vertexCount += chunk.vertexCount;
		}

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

	/**
	 * Return a snapshot rather than exposing the renderer's internal Map.
	 */
	allChunkIds(): ReadonlySet<RenderChunkId> {
		return new Set(this.chunks.keys());
	}

	/**
	 * Release every owned ground mesh and its depth-stratum scene graph.
	 */
	destroy(): void {
		/**
		 * Handles own the actual GPU resources. Destroy them first so every
		 * Mesh detaches itself from whichever depth stratum currently owns it.
		 */
		for (const chunk of this.chunks.values()) {
			chunk.destroy();
		}

		this.chunks.clear();

		/**
		 * Strata own only the lightweight scene-graph Containers left behind
		 * after the mesh resources have been destroyed.
		 */
		this.strata.clear();

		perf.setCounter("engine.groundChunkCount", 0);

		perf.setCounter("engine.groundMeshCount", 0);

		perf.setCounter("engine.groundVertexCount", 0);
	}

	/**
	 * Build all ground meshes belonging structurally to one render chunk.
	 *
	 * Batch compatibility is:
	 *
	 *     exact painter depth
	 *     +
	 *     GPU material
	 *
	 * Chunk identity is already supplied by the outer buildChunk call.
	 */
	private buildChunk(
		chunk: CompiledChunkVisual,

		mapWidth: number,
	): GroundChunkHandle {
		const batches = new Map<string, MutableGroundBatch>();

		for (const tile of chunk.tiles) {
			const material = this.materialLibrary.resolveGround(tile.material);

			/**
			 * Material compatibility alone is insufficient for an isometric
			 * painter-order renderer. Once two depths are baked into one Mesh,
			 * Pixi cannot insert another mesh between those tile surfaces.
			 */
			const batchKey = [tile.depthKey, material.batchKey].join("|");

			let batch = batches.get(batchKey);

			if (!batch) {
				batch = {
					depthKey: tile.depthKey,

					material,

					builder: new QuadBatchBuilder(),
				};

				batches.set(batchKey, batch);
			}

			const tileIndex = tile.coord.y * mapWidth + tile.coord.x;

			batch.builder.addQuad(
				tile.quad,
				tile.uvs,
				tileIndex,
				GroundPresentationCode.Normal,
			);
		}

		const handle = new GroundChunkHandle(chunk.chunkId);

		for (const batch of batches.values()) {
			const data = batch.builder.freeze();

			const meshHandle = createStaticGroundMesh(data, batch.material);

			/**
			 * GroundChunkHandle owns lifetime/presentation for the GPU batch.
			 */
			handle.addBatch(meshHandle);

			/**
			 * GroundDepthStrata owns scene-graph placement.
			 *
			 * addBatch() currently attaches the Mesh to the handle's temporary
			 * chunk Container first; Pixi re-parents it here into the correct
			 * global depth stratum.
			 */
			this.strata.mount(batch.depthKey, chunk.chunkId, meshHandle.mesh);
		}

		return handle;
	}
}
