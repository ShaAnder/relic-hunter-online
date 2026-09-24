/**
 * Stable identity for geometry that is safe to submit in one GPU batch.
 *
 * Two surfaces may share a material family but still need different batches
 * when they resolve to different texture variants or render state.
 */
export type MaterialBatchKey = string & {
	readonly __materialBatchKey: unique symbol;
};

export function materialBatchKey(value: string): MaterialBatchKey {
	return value as MaterialBatchKey;
}
