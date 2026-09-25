import { Mesh, MeshGeometry, Shader, type Buffer } from "pixi.js";
import type { MeshBatchData } from "../batching/MeshBatchData";
import type { ResolvedGroundGpuMaterial } from "./GpuMaterialLibrary";

// color we blend toward when fogged
const WASH_COLOR = 0x14141e;
const WASH_ALPHA = 0.72;

/**
 * Runs once per ground vertex on the GPU: transforms its XY position into screen
 * space and passes its UV texture coordinate and presentation state onward to
 * the fragment shader so each resulting pixel knows how it should be rendered.
 */
const GROUND_VERTEX_SHADER = `
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
		(mvp * vec3(aPosition, 1.0)).xy,
		0.0,
		1.0
	);

	vUV = aUV;
	vPresentation = aPresentation;
}
`;

/**
 * Runs for the pixels produced by the ground triangles: hidden presentation is
 * discarded, washed presentation is darkened, and normal presentation is drawn
 * unchanged using either the tile texture or its fallback colour.
 */
const GROUND_FRAGMENT_SHADER = `
precision mediump float;

in vec2 vUV;
in float vPresentation;

uniform sampler2D uSampler;
uniform float uUseTexture;
uniform vec3 uFallbackColor;
uniform vec3 uWashColor;
uniform float uWashAlpha;

void main() {
	if (vPresentation < 0.5) {
		discard;
	}

	vec4 baseColor =
		uUseTexture > 0.5
			? texture2D(uSampler, vUV)
			: vec4(uFallbackColor, 1.0);

	if (vPresentation < 1.5) {
		baseColor.rgb = mix(
			baseColor.rgb,
			uWashColor,
			uWashAlpha
		);
	}

	gl_FragColor = baseColor;
}
`;

/**
 * Owns the Pixi/GPU objects created for one static ground mesh batch.
 *
 * The renderer keeps this handle so it can render the mesh, update only its
 * presentation buffer when visibility changes, and explicitly destroy GPU
 * resources when the chunk is unloaded.
 */
export interface StaticGroundMeshHandle {
	mesh: Mesh<MeshGeometry, Shader>;
	geometry: MeshGeometry;
	shader: Shader;
	presentationBuffer: Buffer;
	data: MeshBatchData;

	destroy(): void;
}

/**
 * Converts one frozen CPU batch into Pixi GPU objects.
 *
 * Static positions/UVs/indices are uploaded once. `aPresentation` is the one
 * dynamic attribute Phase 2 changes for fog/room-focus updates.
 */
export function createStaticGroundMesh(
	data: MeshBatchData,
	material: ResolvedGroundGpuMaterial,
): StaticGroundMeshHandle {
	// Upload the finalized vertex positions, UVs and triangle indices into Pixi geometry.
	const geometry = new MeshGeometry({
		positions: data.positions,
		uvs: data.uvs,
		indices: data.indices,
		topology: "triangle-list",
	});

	// Add RHOSs per-vertex presentation state as a custom GPU attribute.
	// The shader reads this as aPresentation to decide Hidden / Washed / Normal.
	geometry.addAttribute("aPresentation", {
		buffer: data.presentation,
		format: "float32",
	});

	// Ground structure rarely changes, so tell Pixi these buffers are effectively immutable.
	geometry.getBuffer("aPosition").static = true;
	geometry.getBuffer("aUV").static = true;
	geometry.getIndex().static = true;

	// Keep a direct reference to the presentation buffer because fog/focus can update it later.
	const presentationBuffer = geometry.getBuffer("aPresentation");

	// Presentation is intentionally dynamic even though the underlying geometry is static.
	presentationBuffer.static = false;
	// Keep the dynamic buffer capacity stable rather than resizing it during repeated updates.
	presentationBuffer.shrinkToFit = false;
	const shader = Shader.from({
		// Compile/create the GPU shader and connect RHO material values to its uniforms.
		gl: {
			vertex: GROUND_VERTEX_SHADER,
			fragment: GROUND_FRAGMENT_SHADER,
		},
		// Bind the resolved material texture so the fragment shader can sample it through uSampler.
		resources: {
			uSampler: material.texture.source,

			// Convert the TypeScript boolean into the numeric 1/0 value expected by the shader.
			groundUniforms: {
				uUseTexture: {
					value: material.usesTexture ? 1 : 0,
					type: "f32",
				},
				// Supply the material's fallback RGB colour for ground that has no actual texture.
				uFallbackColor: {
					value: colorToVec3(material.fallbackColor),
					type: "vec3<f32>",
				},
				// Control how strongly the normal ground colour is blended toward the wash colour.
				uWashColor: {
					value: colorToVec3(WASH_COLOR),
					type: "vec3<f32>",
				},
				// Supply the material's fallback RGB colour for ground that has no actual texture.
				uWashAlpha: {
					value: WASH_ALPHA,
					type: "f32",
				},
			},
		},
	});

	// Combine geometry and shader into the actual Pixi object that can enter the scene graph.
	const mesh = new Mesh({
		geometry,
		shader,
	});

	return {
		mesh,
		geometry,
		shader,
		presentationBuffer,
		data,
		// Explicitly detach and release the Pixi/GPU resources owned by this ground mesh.
		destroy: () => {
			mesh.removeFromParent();
			mesh.destroy();
			shader.destroy();
			geometry.destroy(true);
		},
	};
}

/**
 * Convert a packed JavaScript 0xRRGGBB colour into normalized GPU RGB values.
 *
 * Each 0–255 colour channel becomes a floating-point value from 0.0–1.0,
 * which is the format expected by the shader's vec3 colour uniforms.
 */
function colorToVec3(color: number): Float32Array {
	return new Float32Array([
		((color >> 16) & 0xff) / 255,

		((color >> 8) & 0xff) / 255,

		(color & 0xff) / 255,
	]);
}

/**
 * LEARNING NOTE:
 * StaticMeshFactory converts a finalized ground batch into a Pixi mesh,
 * uploads structural geometry as static GPU data, keeps presentation
 * state dynamic for cheap fog updates, binds the material resources
 * required by the custom shader, and exposes explicit lifetime management
 * for the resulting rendering resources.
 */
