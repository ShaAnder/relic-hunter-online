import { Mesh, MeshGeometry, Shader } from "pixi.js";
import type { RenderChunkId } from "../chunks/ChunkCoord";
import type { ResolvedStaticWorldGpuMaterial } from "./GpuMaterialLibrary";
import type {
	StaticWorldBatchData,
	StaticWorldMeshHandle,
} from "../world/StaticWorldMeshHandle";
import type { VisualDepthKey } from "../world/worldDepthKey";

/**
 * Presentation wash shared with the current ground renderer.
 *
 * Phase 6 can later centralize these values into a shared material system.
 * For now, keeping the same values preserves visual parity between ground
 * and static world geometry.
 */
const WASH_COLOR = 0x14141e;
const WASH_ALPHA = 0.72;

/**
 * Static-world geometry is structurally stable after mount, but some of its
 * vertex data remains patchable:
 *
 * - aPosition changes when room-focus shortens/restores barriers.
 * - aUV changes because normal/focused barrier geometry may use different UVs.
 * - aPresentation changes for fog, room focus and forced wash.
 *
 * The Mesh itself survives those changes.
 */
const WORLD_VERTEX_SHADER = `
in vec2 aPosition;
in vec2 aUV;
in float aPresentation;
out vec2 vUV;
out float vPresentation;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
	mat3 mvp =
		uProjectionMatrix *
		uWorldTransformMatrix *
		uTransformMatrix;
	gl_Position = vec4(
		(mvp * vec3(
			aPosition,
			1.0
		)).xy,
		0.0,
		1.0
	);
	vUV =
		aUV;
	vPresentation =
		aPresentation;
}
`;

/**
 * Static-world presentation uses the same three-state convention as ground:
 *
 * 0 = Hidden
 * 1 = Washed
 * 2 = Normal
 *
 * Material alpha is applied independently afterward. That matters for
 * translucent world materials such as Fence and Glass.
 */
const WORLD_FRAGMENT_SHADER = `
precision mediump float;
in vec2 vUV;
in float vPresentation;
uniform sampler2D uSampler;
uniform float uUseTexture;
uniform vec3 uFallbackColor;
uniform vec3 uWashColor;
uniform float uWashAlpha;
uniform float uMaterialAlpha;
void main() {
	if (vPresentation < 0.5) {
		discard;
	}
	vec4 baseColor =
		uUseTexture > 0.5
			? texture2D(
				uSampler,
				vUV
			)
			: vec4(
				uFallbackColor,
				1.0
			);
	if (vPresentation < 1.5) {
		baseColor.rgb =
			mix(
				baseColor.rgb,
				uWashColor,
				uWashAlpha
			);
	}
	baseColor.a *=
		uMaterialAlpha;
	gl_FragColor =
		baseColor;
}
`;

/**
 * Identity needed to place the resulting GPU mesh back into Reactor's static
 * world hierarchy.
 *
 * The factory creates GPU resources; it does not decide which depth/chunk a
 * surface belongs to. Those decisions were already made by the compiler and
 * batching stages.
 */
export interface StaticWorldMeshIdentity {
	depthKey: VisualDepthKey;
	chunkId: RenderChunkId;
}

/**
 * Convert one finalized CPU static-world batch into Pixi/GPU resources.
 *
 * Unlike ground meshes, positions and UVs intentionally remain dynamic.
 * Room-focus changes patch existing barrier ranges inside these arrays rather
 * than destroying and recreating the Mesh.
 */
export function createStaticWorldMesh(
	data: StaticWorldBatchData,
	material: ResolvedStaticWorldGpuMaterial,
	identity: StaticWorldMeshIdentity,
): StaticWorldMeshHandle {
	/**
	 * MeshGeometry creates Pixi's standard:
	 *
	 * aPosition
	 * aUV
	 *
	 * attributes from these arrays.
	 */
	const geometry = new MeshGeometry({
		positions: data.positions,
		uvs: data.uvs,
		indices: data.indices,
		topology: "triangle-list",
	});

	/**
	 * Presentation is our custom per-vertex state.
	 *
	 * One quad currently gives all four of its vertices the same value, but
	 * storing it per vertex allows many surfaces to coexist in one Mesh.
	 */
	geometry.addAttribute("aPresentation", {
		buffer: data.presentation,
		format: "float32",
	});

	const positionBuffer = geometry.getBuffer("aPosition");
	const uvBuffer = geometry.getBuffer("aUV");
	const presentationBuffer = geometry.getBuffer("aPresentation");

	/**
	 * These arrays may be mutated in place after mount.
	 *
	 * Setting `static = false` tells Pixi that later Buffer.update() calls are
	 * expected rather than treating the data as permanently immutable.
	 */
	positionBuffer.static = false;
	uvBuffer.static = false;
	presentationBuffer.static = false;

	/**
	 * Buffer lengths should remain stable during presentation/focus patches.
	 * We replace values inside the arrays; we do not resize the geometry.
	 */
	positionBuffer.shrinkToFit = false;
	uvBuffer.shrinkToFit = false;
	presentationBuffer.shrinkToFit = false;

	/**
	 * Triangle topology itself does not change during presentation updates.
	 *
	 * Focus changes move existing vertices; they do not change which vertices
	 * form each triangle.
	 */
	geometry.getIndex().static = true;

	const shader = Shader.from({
		gl: {
			vertex: WORLD_VERTEX_SHADER,
			fragment: WORLD_FRAGMENT_SHADER,
		},
		resources: {
			uSampler: material.texture.source,
			worldUniforms: {
				uUseTexture: {
					value: material.usesTexture ? 1 : 0,
					type: "f32",
				},
				uFallbackColor: {
					value: colorToVec3(material.fallbackColor),
					type: "vec3<f32>",
				},
				uWashColor: {
					value: colorToVec3(WASH_COLOR),
					type: "vec3<f32>",
				},
				uWashAlpha: {
					value: WASH_ALPHA,
					type: "f32",
				},

				/**
				 * Separate material opacity from presentation state.
				 *
				 * A Fence can therefore be translucent while still being
				 * Normal/Washed/Hidden like every other world surface.
				 */
				uMaterialAlpha: {
					value: material.alpha,
					type: "f32",
				},
			},
		},
	});

	const mesh = new Mesh({
		geometry,
		shader,
	});

	/**
	 * The Mesh itself does not own world depth through zIndex.
	 *
	 * WorldDepthStrata places it beneath a Container whose zIndex represents
	 * `depthKey`. This lets whole static batches interleave correctly with
	 * dynamic actors.
	 */
	mesh.label = [
		"static-world",
		identity.depthKey,
		identity.chunkId,
		material.batchKey,
	].join(":");

	return {
		depthKey: identity.depthKey,
		chunkId: identity.chunkId,
		materialKey: material.batchKey,
		mesh,
		geometry,
		shader,
		positionBuffer,
		uvBuffer,
		presentationBuffer,
		data,

		/**
		 * StaticWorldRenderer owns this handle and therefore owns releasing all
		 * Pixi/GPU resources associated with it.
		 */
		destroy: () => {
			mesh.removeFromParent();
			mesh.destroy();
			shader.destroy();
			geometry.destroy(true);
		},
	};
}

/**
 * Convert packed 0xRRGGBB into the normalized 0–1 RGB values expected by GLSL.
 */
function colorToVec3(color: number): Float32Array {
	return new Float32Array([
		((color >> 16) & 0xff) / 255,
		((color >> 8) & 0xff) / 255,
		(color & 0xff) / 255,
	]);
}
