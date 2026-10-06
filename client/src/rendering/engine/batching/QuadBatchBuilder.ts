import type { VisualQuad, VisualUvs } from "../compiler/CompiledFloorVisual";
import type { MeshBatchData } from "./MeshBatchData";

export type GpuVec4 = readonly [number, number, number, number];

export interface GroundQuadGpuData {
	surfaceUvs: VisualUvs;

	primaryAtlasRect: GpuVec4;
	underlayAtlasRect: GpuVec4;
	edgeAtlasRect: GpuVec4;

	primaryParams: GpuVec4;
	underlayParams: GpuVec4;
	animationParams: GpuVec4;
}

/**
 * Builds many compiled quads into one indexed mesh.
 *
 * JavaScript arrays are cheap to append while the exact batch size is unknown.
 * `freeze()` performs the one final conversion to tightly packed GPU buffers.
 */
export class QuadBatchBuilder {
	private readonly positions: number[] = [];
	private readonly uvs: number[] = [];
	private readonly surfaceUvs: number[] = [];

	private readonly primaryAtlasRects: number[] = [];
	private readonly underlayAtlasRects: number[] = [];
	private readonly edgeAtlasRects: number[] = [];

	private readonly primaryParams: number[] = [];
	private readonly underlayParams: number[] = [];
	private readonly animationParams: number[] = [];

	private readonly indices: number[] = [];
	private readonly presentation: number[] = [];
	private readonly quadTileIndices: number[] = [];

	addQuad(
		quad: VisualQuad,
		uvs: VisualUvs,
		tileIndex: number,
		presentationCode: number,
		gpu: GroundQuadGpuData,
	): void {
		const baseVertex = this.positions.length / 2;

		for (const point of quad) {
			this.positions.push(point.x, point.y);
		}

		this.uvs.push(...uvs);
		this.surfaceUvs.push(...gpu.surfaceUvs);

		for (let vertex = 0; vertex < 4; vertex++) {
			this.primaryAtlasRects.push(...gpu.primaryAtlasRect);
			this.underlayAtlasRects.push(...gpu.underlayAtlasRect);
			this.edgeAtlasRects.push(...gpu.edgeAtlasRect);

			this.primaryParams.push(...gpu.primaryParams);
			this.underlayParams.push(...gpu.underlayParams);
			this.animationParams.push(...gpu.animationParams);
		}

		this.indices.push(
			baseVertex,
			baseVertex + 1,
			baseVertex + 2,
			baseVertex,
			baseVertex + 2,
			baseVertex + 3,
		);

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
			surfaceUvs: new Float32Array(this.surfaceUvs),

			primaryAtlasRects: new Float32Array(this.primaryAtlasRects),
			underlayAtlasRects: new Float32Array(this.underlayAtlasRects),
			edgeAtlasRects: new Float32Array(this.edgeAtlasRects),

			primaryParams: new Float32Array(this.primaryParams),
			underlayParams: new Float32Array(this.underlayParams),
			animationParams: new Float32Array(this.animationParams),

			indices: new Uint32Array(this.indices),
			presentation: new Float32Array(this.presentation),
			quadTileIndices: new Uint32Array(this.quadTileIndices),

			quadCount,
			vertexCount: quadCount * 4,
			triangleCount: quadCount * 2,
		};
	}
}
