/**
 * Registry of every custom map currently saved to disk under
 * shared/src/world/maps/custom/ — regenerated automatically by the
 * local save-custom-map dev endpoint (see
 * client/vite-plugins/saveCustomMap.ts) every time a map is saved or
 * deleted. Never edit this file by hand; it will be overwritten.
 */
import { Alleyways_NAME, Alleyways_BLUEPRINT } from "./Alleyways";

export interface CustomMapEntry {
	name: string;
	blueprint: number[][];
}

export const CUSTOM_MAPS: CustomMapEntry[] = [
	{ name: Alleyways_NAME, blueprint: Alleyways_BLUEPRINT },
];
