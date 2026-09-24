import { Container } from "pixi.js";
import type { RenderChunkId } from "../chunks/ChunkCoord";
import type { StaticGroundMeshHandle } from "../gpu/StaticMeshFactory";
import { updateGpuBuffer } from "../gpu/BufferUpdate";
import type { FogPresentationBuffer } from "../presentation/FogPresentationBuffer";
import { resolveGroundPresentationCode } from "../presentation/PresentationDiff";

/**
 * Runtime owner for the renderable meshes belonging to one logical ground chunk.
 *
 * A chunk contains a small number of material-compatible mesh batches rather
 * than one Pixi object per tile. It also updates the batches' dynamic
 * presentation data when fog or room focus changes.
 */
export class GroundChunkHandle {
	// pixi scene graph container that groups all material meshes for the chunk
	readonly view = new Container();
	// GPU mesh batches owned by this chunk, normally grouped by compatible material.
	private readonly batches: StaticGroundMeshHandle[] = [];

	constructor(readonly chunkId: RenderChunkId) {
		this.view.label = `ground-chunk:${chunkId}`;
	}
	/**
	 * Transfer a ground mesh batch into this chunk's runtime ownership and
	 * attach its Pixi mesh to the chunk container for rendering.
	 */
	addBatch(batch: StaticGroundMeshHandle): void {
		this.batches.push(batch);
		this.view.addChild(batch.mesh);
	}

	/**
	 * Recalculate Hidden / Washed / Normal presentation for this chunk.
	 *
	 * Only CPU presentation values that actually changed are rewritten, and a
	 * GPU buffer upload is triggered only for batches containing such changes.
	 */
	updatePresentation(
		mapWidth: number,
		fog: FogPresentationBuffer,
		focusCellKeys: ReadonlySet<string> | null,
		forceWashed: boolean,
	): void {
		for (const batch of this.batches) {
			let changed = false;
			// quadTileIndices maps each batched render quad back to its logical map tile.
			for (
				let quadIndex = 0;
				quadIndex < batch.data.quadTileIndices.length;
				quadIndex++
			) {
				const tileIndex = batch.data.quadTileIndices[quadIndex];
				// Convert the flattened tile index back into its map coordinate.
				const x = tileIndex % mapWidth;
				const y = Math.floor(tileIndex / mapWidth);
				// Tiles outside the active room focus are rendered using the washed presentation.
				const outsideFocusedRoom =
					focusCellKeys !== null && !focusCellKeys.has(`${x},${y}`);
				// Combine fog, room focus and forced wash state into the final shader presentation code.
				const next = resolveGroundPresentationCode(
					fog.codeAtIndex(tileIndex),
					outsideFocusedRoom,
					forceWashed,
				);
				// Each independent ground quad owns four consecutive presentation vertices.
				const firstVertex = quadIndex * 4;

				for (let localVertex = 0; localVertex < 4; localVertex++) {
					const vertexIndex = firstVertex + localVertex;
					// Leave unchanged vertex data untouched so unnecessary GPU updates can be avoided.
					if (batch.data.presentation[vertexIndex] === next) {
						continue;
					}
					batch.data.presentation[vertexIndex] = next;
					changed = true;
				}

				// Synchronize the dynamic presentation buffer only when this batch actually changed.
				if (changed) {
					updateGpuBuffer(batch.presentationBuffer);
				}
			}
		}
	}

	// Lightweight diagnostics for tracking mesh and geometry cost per render chunk.
	get meshCount(): number {
		return this.batches.length;
	}

	get vertexCount(): number {
		let total = 0;
		for (const batch of this.batches) {
			total += batch.data.vertexCount;
		}
		return total;
	}

	/**
	 * Release every mesh/GPU resource owned by this chunk, then detach and
	 * destroy the chunk's Pixi container.
	 */
	destroy(): void {
		for (const batch of this.batches) {
			batch.destroy();
		}
		this.batches.length = 0;
		this.view.removeFromParent();
		this.view.destroy();
	}
}

/**
 * LEARNING NOTE:
 * GroundChunkHandle owns the batched meshes for one render chunk,
 * recalculates per-tile presentation when visibility changes, and
 * uploads only changed presentation data while leaving the chunk's
 * static geometry untouched.
 */
