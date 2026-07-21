import type {
	CharacterData,
	ChestPlan,
	ItemData,
	GridCoord,
} from "@relic-hunter/shared";

/**
 * Lightweight session bag owned by Game.
 * Scenes / overlays read-write this instead of threading constructor params.
 */
export interface MissionParams {
	mapSize: "S" | "M" | "L";
}

export const MAP_SIZE_DIMENSIONS: Record<
	MissionParams["mapSize"],
	{ width: number; height: number }
> = {
	S: { width: 30, height: 30 },
	M: { width: 50, height: 50 },
	L: { width: 70, height: 70 },
};

export interface TurnOrderEntry {
	id: string;
	label: string;
	roll: number;
}

export interface MatchResult {
	won: boolean;
	turnsTaken: number;
	itemsExtracted: number;
}

/** One chest's plan + the tile LoadingOverlay chose for it. */
export interface PlacedChestRecord {
	plan: ChestPlan;
	coord: GridCoord;
}

export interface MatchParticipant {
	id: string;
	label: string;
	coord: GridCoord;
	isLocal: boolean;
}

export class GameSession {
	character: CharacterData | null = null;
	missionParams: MissionParams | null = null;

	mapSeed: number | null = null;

	/** Item plan only — still useful for target lookup. */
	chestPlan: { chests: ChestPlan[]; targetItem: ItemData } | null = null;

	/**
	 * Authoritative chest positions chosen once in LoadingOverlay.
	 * MapScene must place from this list — never re-roll, or the cinematic
	 * and gameplay disagree.
	 */
	chestPlacements: PlacedChestRecord[] | null = null;

	/** Player spawn chosen once in LoadingOverlay (same reason as above). */
	playerSpawn: GridCoord | null = null;
	participants: MatchParticipant[] | null = null;
	turnOrder: TurnOrderEntry[] | null = null;
	matchResult: MatchResult | null = null;
}
