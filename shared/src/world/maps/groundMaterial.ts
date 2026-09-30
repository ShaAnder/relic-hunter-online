/**
 * Stable serialized identity for an authored ground material.
 *
 * This is only an ID. Texture URLs, Pixi resources and shaders remain in the
 * client renderer. The brand exists only at TypeScript compile time.
 */
export type GroundMaterialId = string & {
	readonly __groundMaterialId: unique symbol;
};

const MATERIAL_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

/**
 * Construct a validated authored material ID.
 *
 * Example:
 *     floor.concrete.clean
 */
export function groundMaterialId(value: string): GroundMaterialId {
	if (!MATERIAL_ID_PATTERN.test(value)) {
		throw new Error(`Invalid ground material id: ${value}`);
	}

	return value as GroundMaterialId;
}

export function isGroundMaterialId(value: unknown): value is GroundMaterialId {
	return typeof value === "string" && MATERIAL_ID_PATTERN.test(value);
}
