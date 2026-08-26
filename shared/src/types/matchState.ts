import type { GridCoord, TileType } from "../world/grid";
import type { MercenaryState } from "./mercenary";
import type { MonsterState } from "./monster";
import type { ChestPlan } from "../entities/chest";
import type { Trap } from "../entities/traps";
import type { AiArchetype } from "../ai/mercenaryAI";
import type { AiMemory } from "../ai/aiMemory";

/** Candidate shape only — not yet wired into any runtime code. */

/**
 * Per-turn flags, candidate for folding onto participant state.
 * @author ShaAnder
 */
export interface TurnState {
	apRemaining: number;
	baseAp: number;
	hasMovedThisTurn: boolean;
	movementRemaining: number;
	hasAttackedThisTurn: boolean;
	hasRestedThisTurn: boolean;
	hasUsedSpecialThisTurn: boolean;
}

/**
 * One hunter's match state — data only, no Pixi token or TurnManager instance.
 * @author ShaAnder
 */
export interface MatchParticipant {
	id: string;
	pilot: "local" | "ai";
	state: MercenaryState;
	turn: TurnState;
	archetype?: AiArchetype;
	memory?: AiMemory;
}

/** One monster's match state — data only, no Pixi token. */
export interface MatchMonster {
	state: MonsterState;
}

/** Map generation config — the exact inputs buildMap() needs. */
export interface MapConfig {
	width: number;
	height: number;
	seed: number;
	roomCount: number;
	tileOverrides?: { coord: GridCoord; type: TileType }[];
}

/** One chest's match state — data only, no Pixi token. */
export interface MatchChest {
	coord: GridCoord;
	plan: ChestPlan;
	isOpen: boolean;
}

/** Whose phase it currently is. */
export type TurnPhase = "player" | "aiResolution";

/** One participant's final score line. */
export interface MatchResultEntry {
	participantId: string;
	label: string;
	matchScore: MercenaryState["matchScore"];
}

/** Final match outcome. */
export interface MatchResult {
	won: boolean;
	turnsTaken: number;
	itemsExtracted: number;
	scores: MatchResultEntry[];
}

/**
 * Candidate MatchState shape — see full-architecture-audit.md for citations.
 * @author ShaAnder
 */
export interface MatchState {
	participants: MatchParticipant[];
	monsters: MatchMonster[];
	boss: MatchMonster | null;
	monsterSpawnIndex: number;

	map: MapConfig;
	chests: MatchChest[];
	traps: Trap[];

	relicFound: boolean;
	bossSpawned: boolean;
	turnsTaken: number;
	turnPhase: TurnPhase;

	result: MatchResult | null;
}
