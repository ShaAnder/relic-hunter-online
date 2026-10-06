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
in vec2 aSurfaceUV;

in vec4 aPrimaryAtlasRect;
in vec4 aUnderlayAtlasRect;
in vec4 aEdgeAtlasRect;

in vec4 aPrimaryParams;
in vec4 aEdgeParams;
in vec4 aUnderlayParams;
in vec4 aAnimationParams;

in float aPresentation;

out vec2 vLocalUV;
out vec2 vSurfaceUV;

out vec4 vPrimaryAtlasRect;
out vec4 vUnderlayAtlasRect;
out vec4 vEdgeAtlasRect;

out vec4 vPrimaryParams;
out vec4 vEdgeParams;
out vec4 vUnderlayParams;
out vec4 vAnimationParams;

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

	vLocalUV = aUV;
	vSurfaceUV = aSurfaceUV;

	vPrimaryAtlasRect = aPrimaryAtlasRect;
	vUnderlayAtlasRect = aUnderlayAtlasRect;
	vEdgeAtlasRect = aEdgeAtlasRect;

	vPrimaryParams = aPrimaryParams;
	vEdgeParams =	aEdgeParams;
	vUnderlayParams = aUnderlayParams;
	vAnimationParams = aAnimationParams;

	vPresentation = aPresentation;
}
`;

const GROUND_FRAGMENT_SHADER = `
precision mediump float;

in vec2 vLocalUV;
in vec2 vSurfaceUV;

in vec4 vPrimaryAtlasRect;
in vec4 vUnderlayAtlasRect;
in vec4 vEdgeAtlasRect;

in vec4 vPrimaryParams;
in vec4 vUnderlayParams;
in vec4 vEdgeParams;
in vec4 vAnimationParams;

in float vPresentation;

uniform sampler2D uSampler;
uniform vec3 uWashColor;
uniform float uWashAlpha;

/**
 * Convert normalized 0..1 coordinates inside one material image into the
 * corresponding region of the shared ground texture atlas.
 */
vec2 atlasUv(
	vec2 logicalUv,
	vec4 rect
) {
	return mix(
		rect.xy,
		rect.zw,
		logicalUv
	);
}

/**
 * Alternate complete texture-repeat domains by mirroring them.
 *
 * This reduces obvious wallpaper repetition without independently flipping
 * individual logical map cells.
 */
vec2 mirrorRepeatUv(
	vec2 repeatUv
) {
	vec2 repeatCell =
		floor(repeatUv);

	vec2 uv =
		fract(repeatUv);

	if (
		mod(
			repeatCell.x,
			2.0
		) > 0.5
	) {
		uv.x =
			1.0 - uv.x;
	}

	if (
		mod(
			repeatCell.y,
			2.0
		) > 0.5
	) {
		uv.y =
			1.0 - uv.y;
	}

	return uv;
}

/**
 * Resolve the logical UV used by a material layer.
 *
 * params:
 *     x = sampling mode
 *     y = repeatTilesX
 *     z = repeatTilesY
 *     w = wrap mode
 */
vec2 materialLogicalUv(
	vec2 localUv,
	vec2 surfaceUv,
	vec4 params
) {
	float samplingMode =
		params.x;

	vec2 repeatTiles =
		params.yz;

	float wrapMode =
		params.w;

	if (
		samplingMode > 0.5
	) {
		vec2 repeatUv =
			surfaceUv /
			max(
				repeatTiles,
				vec2(0.0001)
			);

		if (
			wrapMode > 0.5
		) {
			return mirrorRepeatUv(
				repeatUv
			);
		}

		return fract(
			repeatUv
		);
	}

	return localUv;
}

/**
 * Sample one base-material layer.
 */
vec4 sampleMaterialLayer(
	vec2 localUv,
	vec2 surfaceUv,
	vec4 rect,
	vec4 params
) {
	vec2 logicalUv =
		materialLogicalUv(
			localUv,
			surfaceUv,
			params
		);

	return texture2D(
		uSampler,
		atlasUv(
			logicalUv,
			rect
		)
	);
}

/**
 * The compiler's ordinary ground UVs describe a diamond:
 *
 *     top    = 0.5, 0.0
 *     right  = 1.0, 0.5
 *     bottom = 0.5, 1.0
 *     left   = 0.0, 0.5
 *
 * Our reusable edge.png is authored as a square image, so convert that
 * diamond-local coordinate system back into normal square-local UVs before
 * rotating and sampling the edge primitive.
 */
vec2 diamondToSquareUv(
	vec2 uv
) {
	vec2 squareUv =
		vec2(
			uv.x + uv.y - 0.5,
			uv.y - uv.x + 0.5
		);

	return clamp(
		squareUv,
		0.0,
		1.0
	);
}

/**
 * Test one bit of the four-cardinal same-surface topology mask.
 *
 * N = 1
 * E = 2
 * S = 4
 * W = 8
 *
 * Bit SET   = connected.
 * Bit CLEAR = exposed border.
 */
bool maskHasBit(
	float mask,
	float bit
) {
	return
		mod(
			floor(
				mask / bit
			),
			2.0
		) > 0.5;
}

/**
 * edge.png is authored with its border on the NORTH side.
 *
 * Reorient that same primitive for the other three cardinal directions.
 */
vec2 edgeUvNorth(
	vec2 uv
) {
	return uv;
}

vec2 edgeUvEast(
	vec2 uv
) {
	return vec2(
		uv.y,
		1.0 - uv.x
	);
}

vec2 edgeUvSouth(
	vec2 uv
) {
	return vec2(
		1.0 - uv.x,
		1.0 - uv.y
	);
}

vec2 edgeUvWest(
	vec2 uv
) {
	return vec2(
		1.0 - uv.y,
		uv.x
	);
}

/**
 * Sample the reusable structured-border primitive.
 */
vec4 sampleBorderPrimitive(
	vec2 localUv,
	vec4 rect
) {
	return texture2D(
		uSampler,
		atlasUv(
			localUv,
			rect
		)
	);
}

/**
 * The border replaces the base appearance only where the border primitive has
 * alpha. Transparent areas leave the continuous base material unchanged.
 */
vec4 applyBorderSample(
	vec4 baseColor,
	vec4 border
) {
	baseColor.rgb =
		mix(
			baseColor.rgb,
			border.rgb,
			border.a
		);

	baseColor.a =
		max(
			baseColor.a,
			border.a
		);

	return baseColor;
}

void main() {
	if (
		vPresentation < 0.5
	) {
		discard;
	}

	/**
	 * Start with the primary continuous/tile material.
	 */
	vec4 baseColor =
		sampleMaterialLayer(
			vLocalUV,
			vSurfaceUV,
			vPrimaryAtlasRect,
			vPrimaryParams
		);

	/**
	 * edgeParams:
	 *     x = edge mode
	 *     y = sameSurfaceMask
	 *     z = reserved
	 *     w = reserved
	 */
	float edgeMode =
		vEdgeParams.x;

	float sameSurfaceMask =
		vEdgeParams.y;

	/**
	 * Structured border materials such as Warm Flagstone.
	 *
	 * The topology mask tells us which sides are exposed. One square edge
	 * primitive is converted from diamond-local UV space, rotated, and composed
	 * once for each exposed side.
	 */
	if (
		edgeMode > 0.5 &&
		edgeMode < 1.5
	) {
		vec2 edgeLocalUv =
			diamondToSquareUv(
				vLocalUV
			);

		// North exposed.
		if (
			!maskHasBit(
				sameSurfaceMask,
				1.0
			)
		) {
			baseColor =
				applyBorderSample(
					baseColor,
					sampleBorderPrimitive(
						edgeUvNorth(
							edgeLocalUv
						),
						vEdgeAtlasRect
					)
				);
		}

		// East exposed.
		if (
			!maskHasBit(
				sameSurfaceMask,
				2.0
			)
		) {
			baseColor =
				applyBorderSample(
					baseColor,
					sampleBorderPrimitive(
						edgeUvEast(
							edgeLocalUv
						),
						vEdgeAtlasRect
					)
				);
		}

		// South exposed.
		if (
			!maskHasBit(
				sameSurfaceMask,
				4.0
			)
		) {
			baseColor =
				applyBorderSample(
					baseColor,
					sampleBorderPrimitive(
						edgeUvSouth(
							edgeLocalUv
						),
						vEdgeAtlasRect
					)
				);
		}

		// West exposed.
		if (
			!maskHasBit(
				sameSurfaceMask,
				8.0
			)
		) {
			baseColor =
				applyBorderSample(
					baseColor,
					sampleBorderPrimitive(
						edgeUvWest(
							edgeLocalUv
						),
						vEdgeAtlasRect
					)
				);
		}
	}

	/**
	 * Organic coverage materials such as Warm Grass keep their complete
	 * topology-mask images because irregular combined silhouettes are useful
	 * there.
	 */
	else if (
		edgeMode > 1.5
	) {
		vec4 underlay =
			sampleMaterialLayer(
				vLocalUV,
				vSurfaceUV,
				vUnderlayAtlasRect,
				vUnderlayParams
			);

		vec4 coverageSample =
			texture2D(
				uSampler,
				atlasUv(
					vLocalUV,
					vEdgeAtlasRect
				)
			);

		float coverage =
			coverageSample.r;

		baseColor =
			mix(
				underlay,
				baseColor,
				coverage
			);
	}

	/**
	 * Fog/focus presentation remains independent from surface construction.
	 */
	if (
		vPresentation < 1.5
	) {
		baseColor.rgb =
			mix(
				baseColor.rgb,
				uWashColor,
				uWashAlpha
			);
	}

	gl_FragColor =
		baseColor;
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
	geometry.addAttribute("aSurfaceUV", {
		buffer: data.surfaceUvs,
		format: "float32x2",
	});

	geometry.addAttribute("aPrimaryAtlasRect", {
		buffer: data.primaryAtlasRects,
		format: "float32x4",
	});

	geometry.addAttribute("aUnderlayAtlasRect", {
		buffer: data.underlayAtlasRects,
		format: "float32x4",
	});

	geometry.addAttribute("aEdgeAtlasRect", {
		buffer: data.edgeAtlasRects,
		format: "float32x4",
	});

	geometry.addAttribute("aPrimaryParams", {
		buffer: data.primaryParams,
		format: "float32x4",
	});

	geometry.addAttribute("aEdgeParams", {
		buffer: data.edgeParams,
		format: "float32x4",
	});

	geometry.addAttribute("aUnderlayParams", {
		buffer: data.underlayParams,
		format: "float32x4",
	});

	geometry.addAttribute("aAnimationParams", {
		buffer: data.animationParams,
		format: "float32x4",
	});

	// Ground structure rarely changes, so tell Pixi these buffers are effectively immutable.
	geometry.getBuffer("aPosition").static = true;
	geometry.getBuffer("aUV").static = true;
	geometry.getBuffer("aSurfaceUV").static = true;
	geometry.getBuffer("aPrimaryAtlasRect").static = true;
	geometry.getBuffer("aUnderlayAtlasRect").static = true;
	geometry.getBuffer("aEdgeAtlasRect").static = true;
	geometry.getBuffer("aPrimaryParams").static = true;
	geometry.getBuffer("aEdgeParams").static = true;
	geometry.getBuffer("aUnderlayParams").static = true;
	geometry.getBuffer("aAnimationParams").static = true;

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
