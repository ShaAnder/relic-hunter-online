import type { CharacterData, ChestPlan, ItemData } from "@relic-hunter/shared";

/**
 * Lightweight session bag owned by Game.
 * Scenes read/write this instead of threading constructor params.
 * Survives scene transitions so Lobby still knows the active character.
 */
export interface MissionParams {
	mapSize: "S" | "M" | "L";
}

/* Tile dimensions for each map size */
export const MAP_SIZE_DIMENSIONS: Record<
	MissionParams["mapSize"],
	{ width: number; height: number }
> = {
	S: { width: 30, height: 30 },
	M: { width: 50, height: 50 },
	L: { width: 70, height: 70 },
};

/* Result of the pre-match turn oreder roll - sorted highest-first */
export interface TurnOrderEntry {
	id: string;
	label: string;
	roll: number;
}

/* export interface MatchResult */
export interface MatchResult {
	won: boolean;
	turnsTaken: number;
	itemsExtracted: number;
}

export class GameSession {
	character: CharacterData | null = null;
	missionParams: MissionParams | null = null;

	// Set loading scene, consumed by the map scene - generating the seed
	// once in LoadingScene and reusing it
	mapSeed: number | null = null;

	// Also set chest plan in loading scene, whats the matches target and
	// chest placement
	chestPlan: { chests: ChestPlan[]; targetItem: ItemData } | null = null;

	// Rolled once in LoadingScene. Single-entry today, ready for more once enemies exist.
	turnOrder: TurnOrderEntry[] | null = null;

	// Set by MapScene when the match ends, read by MatchResultScene, cleared on return to Lobby.
	matchResult: MatchResult | null = null;
}
