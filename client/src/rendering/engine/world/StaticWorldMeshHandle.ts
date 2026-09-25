import type { Buffer, Mesh, MeshGeometry, Shader } from "pixi.js";
import type { MaterialBatchKey } from "../batching/MaterialBatchKey";
import type { RenderChunkId } from "../chunks/ChunkCoord";
import type { VisualDepthKey } from "./worldDepthKey";

/**
 * CPU-side typed arrays owned by one static-world GPU batch.
 *
 * Positions and UVs remain mutable because focused room walls and connectors
 * can patch existing geometry without rebuilding the Mesh.
 */
export interface StaticWorldBatchData {
	positions: Float32Array;
	uvs: Float32Array;
	indices: Uint32Array;
	presentation: Float32Array;

	/**
	 * Logical render surfaces added to this batch.
	 * Most are quads, but clipped Fence/Glass surfaces can be triangle lists.
	 */
	surfaceCount: number;
	vertexCount: number;
	triangleCount: number;
}

/**
 * Runtime ownership record for one static-world mesh.
 *
 * The logical identities stay attached to the GPU object so later phases can
 * replace/cull one chunk without rediscovering where the mesh belongs.
 */
export interface StaticWorldMeshHandle {
	readonly depthKey: VisualDepthKey;
	readonly chunkId: RenderChunkId;
	readonly materialKey: MaterialBatchKey;
	readonly mesh: Mesh<MeshGeometry, Shader>;
	readonly geometry: MeshGeometry;
	readonly shader: Shader;
	readonly positionBuffer: Buffer;
	readonly uvBuffer: Buffer;
	readonly presentationBuffer: Buffer;
	readonly data: StaticWorldBatchData;
	destroy(): void;
}
