/**
 * Registry of every custom map currently saved to disk under
 * shared/src/world/maps/custom/ — regenerated automatically by the
 * local save-custom-map dev endpoint (see
 * client/vite-plugins/saveCustomMap.ts) every time a map is saved or
 * deleted. Never edit this file by hand; it will be overwritten.
 *
 * Alleyways used to live here — it's been promoted to the shipped
 * official map (see alleywaysEdgeBlueprint.ts) and removed from this
 * registry, since it's no longer a player-saved custom map.
 */

export interface CustomMapEntry {
	name: string;
	blueprint: number[][];
}

export const CUSTOM_MAPS: CustomMapEntry[] = [];
