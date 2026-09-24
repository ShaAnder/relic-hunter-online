/**
 * Frozen CPU-side geometry for one mesh batch.
 *
 * JavaScript arrays are convenient while building geometry. Typed arrays are
 * the compact representation Pixi/GPU buffers consume once the batch is done.
 */
export interface MeshBatchData {
	positions: Float32Array;
	uvs: Float32Array;
	indices: Uint32Array;

	/**
	 * One presentation value per vertex. The geometry never changes for fog;
	 * only these numbers are updated.
	 */
	presentation: Float32Array;

	/**
	 * One logical tile index per quad. This lets presentation updates map a
	 * chunk mesh back to the tile whose four vertices it owns.
	 */
	quadTileIndices: Uint32Array;

	quadCount: number;
	vertexCount: number;
	triangleCount: number;
}
