/**
 * Registry of every custom map currently saved to disk under
 * shared/src/world/maps/custom/ — regenerated automatically by the
 * local save-custom-map dev endpoint (see
 * client/vite-plugins/saveCustomMap.ts) every time a map is saved or
 * deleted. Never edit this file by hand; it will be overwritten.
 */
import { Alleyways_NAME, Alleyways_FLOORS, Alleyways_GROUND_FLOOR_INDEX } from "./Alleyways";
import { Tower_NAME, Tower_FLOORS, Tower_GROUND_FLOOR_INDEX } from "./Tower";

export interface CustomMapEntry {
	name: string;
	floors: number[][][];
	groundFloorIndex: number;
}

export const CUSTOM_MAPS: CustomMapEntry[] = [
	{ name: Alleyways_NAME, floors: Alleyways_FLOORS, groundFloorIndex: Alleyways_GROUND_FLOOR_INDEX },
	{ name: Tower_NAME, floors: Tower_FLOORS, groundFloorIndex: Tower_GROUND_FLOOR_INDEX },
];
