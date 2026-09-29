/**
 * Canonical depth rules shared by the pure visual compiler and the
 * runtime renderer.
 *
 * `depth` remains the exact world-space sorting number.
 * `VisualDepthKey` is only the quantized batching/grouping identity.
 *
 * Keep this file Pixi-free.
 */

export const WORLD_DEPTH_BIAS = {
	terrainFace: 0,
	barrierSegment: 0.1,
	barrierConnector: 0.2,
	chest: 0.3,
	entity: 0.4,
} as const;

/**
 * Current depth biases use tenths, so multiplying by 10 preserves all
 * intentional ordering distinctions exactly:
 *
 * 317.0 -> 3170
 * 317.1 -> 3171
 * 317.2 -> 3172
 */
export const DEPTH_KEY_SCALE = 10;

export type VisualDepthKey = number & {
	readonly __visualDepthKey: unique symbol;
};

export function worldDepthKey(depth: number): VisualDepthKey {
	if (!Number.isFinite(depth)) {
		throw new Error(
			`worldDepthKey: expected a finite depth, received ${depth}`,
		);
	}

	return Math.round(depth * DEPTH_KEY_SCALE) as VisualDepthKey;
}

export function depthFromKey(key: VisualDepthKey): number {
	return key / DEPTH_KEY_SCALE;
}

/**
 * Painter depth for a boundary separating two projected ground contacts.
 *
 * Extended geometry should not inherit the depth of whichever endpoint or
 * polygon vertex happens to project furthest toward the camera. The boundary
 * belongs between the two spaces it separates.
 */
export function worldBoundaryDepth(
	groundY1: number,
	groundY2: number,
	bias = 0,
): number {
	if (
		!Number.isFinite(groundY1) ||
		!Number.isFinite(groundY2) ||
		!Number.isFinite(bias)
	) {
		throw new Error(
			`worldBoundaryDepth: expected finite values, received ` +
				`${groundY1}, ${groundY2}, ${bias}`,
		);
	}
	return (groundY1 + groundY2) / 2 + bias;
}
