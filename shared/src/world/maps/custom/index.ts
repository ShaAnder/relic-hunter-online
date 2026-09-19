/**
 * Registry of every custom map currently saved to disk under
 * shared/src/world/maps/custom/ — regenerated automatically by the
 * local save-custom-map dev endpoint (see
 * client/vite-plugins/saveCustomMap.ts) every time a map is saved or
 * deleted. Never edit this file by hand; it will be overwritten.
 */
import {
	Alleyways_NAME,
	Alleyways_FLOORS,
	Alleyways_GROUND_FLOOR_INDEX,
} from "./Alleyways";
import { Tower_NAME, Tower_FLOORS, Tower_GROUND_FLOOR_INDEX } from "./Tower";
import {
	ZZ_Small_Elevation_Test_NAME,
	ZZ_Small_Elevation_Test_FLOORS,
	ZZ_Small_Elevation_Test_GROUND_FLOOR_INDEX,
} from "./ZZ_Small_Elevation_Test";
import { MapFloorDefinition } from "../mapBundle";

export interface CustomMapEntry {
	name: string;
	floors: MapFloorDefinition[];
	groundFloorIndex: number;
}

export const CUSTOM_MAPS: CustomMapEntry[] = [
	{
		name: Alleyways_NAME,
		floors: Alleyways_FLOORS,
		groundFloorIndex: Alleyways_GROUND_FLOOR_INDEX,
	},
	{
		name: Tower_NAME,
		floors: Tower_FLOORS,
		groundFloorIndex: Tower_GROUND_FLOOR_INDEX,
	},
	{
		name: ZZ_Small_Elevation_Test_NAME,
		floors: ZZ_Small_Elevation_Test_FLOORS,
		groundFloorIndex: ZZ_Small_Elevation_Test_GROUND_FLOOR_INDEX,
	},
];
