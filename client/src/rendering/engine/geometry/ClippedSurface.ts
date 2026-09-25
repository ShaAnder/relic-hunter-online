import type { VisualQuad, VisualUvs } from "../compiler/CompiledFloorVisual";
import { subtractConvexPolygons, type TexturedVertex } from "./PolygonClip";
import { triangulateConvexFan } from "./Triangulate";

export interface TriangleSurfaceData {
	positions: readonly number[];
	uvs: readonly number[];
	vertexCount: number;
}

export function clipQuadToTriangles(
	quad: VisualQuad,
	uvs: VisualUvs,
	occluders: readonly VisualQuad[],
): TriangleSurfaceData {
	const source = quadToTexturedVertices(quad, uvs);
	const pieces = subtractConvexPolygons(source, occluders);
	const triangles: TexturedVertex[] = [];

	for (const piece of pieces) {
		triangles.push(...triangulateConvexFan(piece));
	}

	const positions: number[] = [];
	const resultUvs: number[] = [];

	for (const vertex of triangles) {
		positions.push(vertex.x, vertex.y);
		resultUvs.push(vertex.u, vertex.v);
	}

	return {
		positions,
		uvs: resultUvs,
		vertexCount: triangles.length,
	};
}

/**
 * Normal/focused clipping can produce different triangle counts.
 *
 * GPU buffers cannot change shape during an ordinary focus update, so the
 * smaller variant is padded with degenerate triangles up to a fixed capacity.
 * Degenerate triangles have zero area and therefore emit no pixels.
 */
export function padTriangleSurface(
	data: TriangleSurfaceData,
	targetVertexCount: number,
	fallbackQuad: VisualQuad,
	fallbackUvs: VisualUvs,
): TriangleSurfaceData {
	if (targetVertexCount % 3 !== 0) {
		throw new Error(
			"padTriangleSurface: target vertex count must be a multiple of 3",
		);
	}

	if (data.vertexCount > targetVertexCount) {
		throw new Error(
			"padTriangleSurface: data exceeds allocated vertex capacity",
		);
	}

	const positions = [...data.positions];
	const uvs = [...data.uvs];
	const fallbackX = fallbackQuad[0].x;
	const fallbackY = fallbackQuad[0].y;
	const fallbackU = fallbackUvs[0];
	const fallbackV = fallbackUvs[1];

	while (positions.length / 2 < targetVertexCount) {
		/**
		 * One zero-area triangle.
		 */
		for (let vertex = 0; vertex < 3; vertex++) {
			positions.push(fallbackX, fallbackY);
			uvs.push(fallbackU, fallbackV);
		}
	}
	return {
		positions,
		uvs,
		vertexCount: targetVertexCount,
	};
}

function quadToTexturedVertices(
	quad: VisualQuad,
	uvs: VisualUvs,
): readonly TexturedVertex[] {
	return [
		{
			x: quad[0].x,
			y: quad[0].y,
			u: uvs[0],
			v: uvs[1],
		},
		{
			x: quad[1].x,
			y: quad[1].y,
			u: uvs[2],
			v: uvs[3],
		},
		{
			x: quad[2].x,
			y: quad[2].y,
			u: uvs[4],
			v: uvs[5],
		},
		{
			x: quad[3].x,
			y: quad[3].y,
			u: uvs[6],
			v: uvs[7],
		},
	];
}
