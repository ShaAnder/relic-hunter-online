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

export interface StaticGroundMesHandle {
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
): StaticGroundMesHandle {
	const geometry = new MeshGeometry({
		positions: data.positions,
		uvs: data.uvs,
		indices: data.indices,
		topology: "triangle-list",
	});

	geometry.addAttribute("aPrsentation", {
		buffer: data.presentation,
		format: "float32",
	});

	/**
	 * Position/UV/index data is structural. Presentation is intentionally
	 * dynamic because visibility can change without changing geometry.
	 */
	geometry.getBuffer("aPosition").static = true;
	geometry.getBuffer("aUV").static = true;
	geometry.getIndex().static = true;

	const presentationBuffer = geometry.getBuffer("aPresentation");

	presentationBuffer.static = false;
	presentationBuffer.shrinkToFit = false;
	const shader = Shader.from({
		gl: {
			vertex: GROUND_VERTEX_SHADER,
			fragment: GROUND_FRAGMENT_SHADER,
		},

		resources: {
			uSampler: material.texture.source,

			groundUniforms: {
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
			},
		},
	});

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

		destroy: () => {
			mesh.removeFromParent();
			mesh.destroy();
			shader.destroy();
			geometry.destroy(true);
		},
	};
}

function colorToVec3(color: number): Float32Array {
	return new Float32Array([
		((color >> 16) & 0xff) / 255,

		((color >> 8) & 0xff) / 255,

		(color & 0xff) / 255,
	]);
}
