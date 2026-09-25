import type { RenderChunkId } from "../chunks/ChunkCoord";
import { renderChunkIdForTile } from "../chunks/ChunkCoord";
import type { StaticGroundMeshHandle } from "../gpu/StaticMeshFactory";
import { updateGpuBuffer } from "../gpu/BufferUpdate";
import type { FogPresentationBuffer } from "../presentation/FogPresentationBuffer";
import { resolveGroundPresentationCode } from "../presentation/PresentationDiff";

/**
 * Runtime owner for the floor-wide ordered ground mesh.
 *
 * The historical class name is retained during the renderer migration so this
 * performance correction does not introduce a separate rename/refactor. Chunk
 * identity still matters for dirty presentation updates, but it no longer
 * controls scene-graph batching.
 */
export class GroundChunkHandle {
	constructor(
		private readonly batch: StaticGroundMeshHandle,
		private readonly chunkSize: number,
	) {}

	/**
	 * Recalculate presentation only for tiles belonging to dirty render chunks.
	 *
	 * Structural geometry and painter order never change during this update;
	 * only the per-vertex Hidden / Washed / Normal attribute is patched.
	 */
	updatePresentation(
		dirtyChunkIds: ReadonlySet<RenderChunkId>,
		mapWidth: number,
		fog: FogPresentationBuffer,
		focusCellKeys: ReadonlySet<string> | null,
		forceWashed: boolean,
	): void {
		if (dirtyChunkIds.size === 0) {
			return;
		}

		let changed = false;

		for (
			let quadIndex = 0;
			quadIndex < this.batch.data.quadTileIndices.length;
			quadIndex++
		) {
			const tileIndex = this.batch.data.quadTileIndices[quadIndex];

			const x = tileIndex % mapWidth;
			const y = Math.floor(tileIndex / mapWidth);

			const chunkId = renderChunkIdForTile(
				{
					x,
					y,
				},
				this.chunkSize,
			);

			if (!dirtyChunkIds.has(chunkId)) {
				continue;
			}

			const outsideFocusedRoom =
				focusCellKeys !== null &&
				!focusCellKeys.has(`${x},${y}`);

			const next = resolveGroundPresentationCode(
				fog.codeAtIndex(tileIndex),
				outsideFocusedRoom,
				forceWashed,
			);

			const firstVertex = quadIndex * 4;

			for (let localVertex = 0; localVertex < 4; localVertex++) {
				const vertexIndex = firstVertex + localVertex;

				if (this.batch.data.presentation[vertexIndex] === next) {
					continue;
				}

				this.batch.data.presentation[vertexIndex] = next;
				changed = true;
			}
		}

		if (changed) {
			updateGpuBuffer(this.batch.presentationBuffer);
		}
	}

	get meshCount(): number {
		return 1;
	}

	get vertexCount(): number {
		return this.batch.data.vertexCount;
	}

	destroy(): void {
		this.batch.destroy();
	}
}

/**
 * LEARNING NOTE:
 *
 * Chunking and painter order are different concerns. Chunks identify which
 * data became dirty; they do not need to become separate scene-graph parents.
 * Keeping the whole static ground in one ordered mesh preserves painter order
 * while chunk IDs still let presentation work skip unrelated tiles.
 */
