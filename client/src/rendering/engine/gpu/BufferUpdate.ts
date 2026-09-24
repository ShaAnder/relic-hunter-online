import type { Buffer } from "pixi.js";

/**
 * Tell Pixi that CPU-side typed-array data already owned by this Buffer changed.
 *
 * We mutate the existing array in place, then upload it. No new geometry or
 * replacement buffer is required for a normal presentation change.
 */
export function updateGpuBuffer(buffer: Buffer): void {
	buffer.update();
}
