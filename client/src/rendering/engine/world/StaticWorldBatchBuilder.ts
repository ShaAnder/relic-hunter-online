import type { VisualQuad, VisualUvs } from "../compiler/CompiledFloorVisual";

import type { StaticWorldBatchData } from "./StaticWorldMeshHandle";

export interface AddedWorldRange {
	firstVertex: number;

	positionOffset: number;

	uvOffset: number;

	vertexCount: number;
}

/**
 * Builds one static-world mesh batch.
 *
 * Ordinary terrain/barriers use addQuad(). Clipped Fence/Glass geometry uses
 * addTriangles(), but both paths finish into the same typed-array contract.
 */
export class StaticWorldBatchBuilder {
	private readonly positions: number[] = [];

	private readonly uvs: number[] = [];

	private readonly indices: number[] = [];

	private readonly presentation: number[] = [];

	private surfaceCount = 0;

	addQuad(
		quad: VisualQuad,

		uvs: VisualUvs,

		presentationCode: number,
	): AddedWorldRange {
		const firstVertex = this.positions.length / 2;

		const positionOffset = this.positions.length;

		const uvOffset = this.uvs.length;

		for (const point of quad) {
			this.positions.push(point.x, point.y);
		}

		this.uvs.push(...uvs);

		this.indices.push(
			firstVertex,
			firstVertex + 1,
			firstVertex + 2,

			firstVertex,
			firstVertex + 2,
			firstVertex + 3,
		);

		this.presentation.push(
			presentationCode,
			presentationCode,
			presentationCode,
			presentationCode,
		);

		this.surfaceCount++;

		return {
			firstVertex,
			positionOffset,
			uvOffset,
			vertexCount: 4,
		};
	}

	/**
	 * Add an already-triangulated surface.
	 *
	 * Vertices are intentionally not shared here. This makes every triangle
	 * range self-contained and easy to patch between normal/focused variants.
	 */
	addTriangles(
		positions: readonly number[],

		uvs: readonly number[],

		presentationCode: number,
	): AddedWorldRange {
		if (positions.length !== uvs.length) {
			throw new Error(
				"StaticWorldBatchBuilder.addTriangles: positions/UV lengths differ",
			);
		}

		if (positions.length % 6 !== 0) {
			throw new Error(
				"StaticWorldBatchBuilder.addTriangles: expected whole triangles",
			);
		}

		const firstVertex = this.positions.length / 2;

		const positionOffset = this.positions.length;

		const uvOffset = this.uvs.length;

		const vertexCount = positions.length / 2;

		this.positions.push(...positions);

		this.uvs.push(...uvs);

		for (let localVertex = 0; localVertex < vertexCount; localVertex++) {
			this.indices.push(firstVertex + localVertex);

			this.presentation.push(presentationCode);
		}

		this.surfaceCount++;

		return {
			firstVertex,
			positionOffset,
			uvOffset,
			vertexCount,
		};
	}

	freeze(): StaticWorldBatchData {
		const vertexCount = this.positions.length / 2;

		return {
			positions: new Float32Array(this.positions),

			uvs: new Float32Array(this.uvs),

			indices: new Uint32Array(this.indices),

			presentation: new Float32Array(this.presentation),

			surfaceCount: this.surfaceCount,

			vertexCount,

			triangleCount: this.indices.length / 3,
		};
	}
}
