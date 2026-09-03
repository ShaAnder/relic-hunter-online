import type {
	CharacterData,
	ChestPlan,
	ItemData,
	GridCoord,
	CardData,
	MatchScore,
	RandomFn,
} from "@relic-hunter/shared";
import { createSeededRandom } from "@relic-hunter/shared";

export interface MissionParams {}

export const TEST_MAP_DIMENSIONS = { width: 35, height: 35 };

export interface TurnOrderEntry {
	id: string;
	label: string;
	roll: number;
}

export interface HunterScoreEntry {
	label: string;
	accentColor: number;
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

	/**
	 * Seed for all match-affecting randomness — combat rolls, AI
	 * decisions, loot/chest placement, card shuffling, monster
	 * spawning. Deliberately separate from mapSeed (terrain layout
	 * only) so the two don't become accidentally coupled — the same
	 * mapSeed producing the same layout should not also force the
	 * same combat outcomes.
	 */
	matchSeed: number | null = null;
	private _rng: RandomFn | null = null;

	/**
	 * The one seeded RNG for this match's gameplay randomness. Created
	 * lazily from matchSeed on first access and cached — every caller
	 * gets the same ongoing sequence, not a fresh one each time.
	 * matchSeed must be set before this is first read.
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

	/** Player spawn chosen once in LoadingOverlay (same reason as above). */
	playerSpawn: GridCoord | null = null;
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
