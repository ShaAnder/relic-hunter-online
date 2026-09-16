import type {
	CharacterData,
	ChestPlan,
	ItemData,
	GridCoord,
	CardData,
	MatchScore,
	RandomFn,
	Grid,
	StaircaseCluster,
} from "@relic-hunter/shared";
import { createSeededRandom } from "@relic-hunter/shared";

export type SelectedMapId =
	| { type: "builtin"; id: "alleyways" }
	| { type: "custom"; id: string };

export interface MissionParams {
	// Dev toggle for now
	fogOfWarEnabled?: boolean;
	selectedMap?: SelectedMapId;
	mapType?: "alleyways";
}

export interface TurnOrderEntry {
	id: string;
	label: string;
	roll: number;
}

export interface HunterScoreEntry {
	label: string;
	accentColor: number;
	characterClass: string;
	matchScore: MatchScore;
}

export interface MatchResult {
	won: boolean;
	turnsTaken: number;
	itemsExtracted: number;
	hunterScores: HunterScoreEntry[];
}

export interface MatchLogEntry {
	message: string;
	timestamp: number;
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
	matchLog: MatchLogEntry[] | null = null;
	mapSeed: number | null = null;
	relicFound = false;
	bossSpawned = false;
	mapEdges: import("@relic-hunter/shared").EdgeGrid | null = null;

	/**
	 * Seed for all match-affecting randomness
	 */
	matchSeed: number | null = null;
	private _rng: RandomFn | null = null;

	/**
	 * The one seeded RNG for this match's gameplay randomness.
	 */
	get rng(): RandomFn {
		if (!this._rng) {
			if (this.matchSeed === null) {
				throw new Error(
					"GameSession.rng accessed before matchSeed was set — set matchSeed first.",
				);
			}
			this._rng = createSeededRandom(this.matchSeed);
		}
		return this._rng;
	}

	/** Item plan only — still useful for target lookup. */
	chestPlan: { chests: ChestPlan[]; targetItem: ItemData } | null = null;

	/**
	 * Authoritative chest positions chosen once in LoadingOverlay.
	 * MapScene must place from this list — never re-roll, or the cinematic
	 * and gameplay disagree.
	 */
	chestPlacements: PlacedChestRecord[] | null = null;

	// Player spawn chosen once in LoadingOverlay
	playerSpawn: GridCoord | null = null;
	// The map itself, generated once in LoadingOverlay
	generatedGrid: Grid | null = null;
	// Per-tile elevation for the current map
	mapElevation: Map<string, number> | null = null;
	// Per-tile transparency for the current map, keyed by coordKey.
	mapTransparent: Map<string, boolean> | null = null;
	// Coord keys of every stairs tile on the current map
	mapStairsTiles: Set<string> | null = null;
	// All compiled floors of the current map plus the staircase links
	// between them - placeholder until edge maps have real multi-floor
	// support (see the project's plan: paint a second floor in the Map
	// Creator, connect via matching stair-connector tiles). Always
	// null for now.
	mapFloors: null = null;
	// Index into mapFloors.floors
	localPlayerFloor = 0;
	// Staircase clusters
	mapStaircaseClusters: StaircaseCluster[] = [];
	participants: MatchParticipant[] | null = null;
	turnOrder: TurnOrderEntry[] | null = null;
	matchResult: MatchResult | null = null;

	/**
	 * The ONE shared deck for the match — built once (see
	 * `buildSharedDeck()` in `shared/game/deck.ts`), shared by every
	 * mercenary on the map. Not per-mercenary — MercenaryState only holds
	 * a `hand`, the deck itself lives here so it survives regardless of
	 * which scene is currently active (relevant once Attack opens a
	 * dedicated BattleScene and drawing still needs to work consistently
	 * across that transition).
	 */
	sharedDeck: CardData[] | null = null;
}

/** The one place any feedback message gets recorded, regardless of which UI
 * triggered it — MapScene's floating text and BattleOverlay's round outcomes both call this alongside their own transient popup. */
export function logMatchEvent(session: GameSession, message: string): void {
	session.matchLog ??= [];
	session.matchLog.push({ message, timestamp: Date.now() });
}
