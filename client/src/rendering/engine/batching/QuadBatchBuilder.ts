import type { VisualQuad, VisualUvs } from "../compiler/CompiledFloorVisual";
import type { MeshBatchData } from "./MeshBatchData";

/**
 * Builds many compiled quads into one indexed mesh.
 *
 * Every quad contributes four unique vertices, while its two triangles reuse
 * those vertices through six index references:
 *
 *     0, 1, 2
 *     0, 2, 3
 *
 * We accumulate ordinary arrays first because repeatedly growing typed arrays
 * would allocate/copy on every tile. `freeze()` performs the one final typed
 * allocation after the batch size is known.
 */
export class QuadBatchBuilder {
	private readonly positions: number[] = [];
	private readonly uvs: number[] = [];
	private readonly indices: number[] = [];
	private readonly presentation: number[] = [];
	private readonly quadTileIndices: number[] = [];

	addQuad(
		quad: VisualQuad,
		uvs: VisualUvs,
		tileIndex: number,
		presentationCode: number,
	): void {
		const baseVertex = this.positions.length / 2;
		for (const point of quad) {
			this.positions.push(point.x, point.y);
		}
		this.uvs.push(...uvs);

		// push whatever our base vertex is into indicies arr
		// to create our "triangles"
		this.indices.push(
			baseVertex,
			baseVertex + 1,
			baseVertex + 2,
			baseVertex,
			baseVertex + 2,
			baseVertex + 3,
		);

		/**
		 * All four vertices belong to the same tile, so they begin with the
		 * same presentation state. Keeping one value per vertex lets the GPU
		 * receive it as a normal vertex attribute.
		 */
		this.presentation.push(
			presentationCode,
			presentationCode,
			presentationCode,
			presentationCode,
		);
		this.quadTileIndices.push(tileIndex);
	}
	freeze(): MeshBatchData {
		const quadCount = this.quadTileIndices.length;

		return {
			positions: new Float32Array(this.positions),
			uvs: new Float32Array(this.uvs),
			indices: new Uint32Array(this.indices),
			presentation: new Float32Array(this.presentation),
			quadTileIndices: new Uint32Array(this.quadTileIndices),
			quadCount,
			vertexCount: quadCount * 4,
			triangleCount: quadCount * 2,
		};
	}
}

/**
 * LEARNING NOTE:
 *
 * The QuadBatchBuilder collects positions, UVs, indices,
 * presentation data, and other quad metadata in normal JavaScript
 * arrays while we’re building the mesh. Then, when the batch is
 * finished, it converts that data into things like Float32Array
 * and Uint32Array, which are tightly packed numeric buffers that
 * are much more suitable for sending to the GPU.
 *
 * easy-to-build JavaScript arrays
 * ↓
 * QuadBatchBuilder
 * ↓
 * typed arrays
 * ↓
 * GPU-friendly buffers
 * ↓
 * renderer
 */
