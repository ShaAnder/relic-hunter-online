import type { GridCoord } from "../world/grid";
import {
	type EntityCore,
	type HasHand,
	type HasItems,
	type HasCharacterClass,
	type HasName,
	type HasMatchScore,
	type HasSpecial,
	HasStatus,
	HasTemporaryStatBonus,
	HasStatusEffects,
} from "./entity";

/** Starting card-efficiency score, and how much each spent card costs. Reverse metric — starts high, decreases per card used. */
const STARTING_CARD_SCORE = 10000;
const CARD_SPEND_PENALTY = 100;

export type CharacterClass =
	| "tank"
	| "brawler"
	| "hunter"
	| "scout"
	| "mage"
	| "summoner";

/**
 * A char permanent stats - set at char creation, changes via level up,
 * unchanged during a match for now we will use spd/atk/def/hp
 */
export interface MercenaryStats {
	movement: number;
	attack: number;
	defense: number;
	maxHp: number;
	ap: number;
}

/** A hunter's live state during a match */
export type MercenaryState = EntityCore &
	HasHand &
	HasItems &
	HasCharacterClass &
	HasName &
	HasMatchScore &
	HasStatus &
	HasSpecial &
	HasStatusEffects &
	HasTemporaryStatBonus;

export function createMercenary(
	id: string,
	coord: GridCoord,
	stats: MercenaryStats,
	characterClass: CharacterClass = "brawler",
	name: string = "Hunter",
): MercenaryState {
	return {
		id,
		coord,
		stats,
		characterClass,
		name,
		currentHp: stats.maxHp,
		hpCeiling: stats.maxHp,
		items: new Array(6).fill(null),
		hand: [],
		matchScore: {
			damageDealt: 0,
			itemsScore: 0,
			cardsRemaining: STARTING_CARD_SCORE,
			environmentalScore: 0,
			tacticalScore: 0,
			objectiveTurnsHeld: 0,
		},
		stunnedTurnsRemaining: 0,
		temporaryStatBonus: { attack: 0, defense: 0, movement: 0 },
		special: null,
		statusEffects: [],
	};
}

/**
 * Removes a card from a hunter's hand and applies its cost to their
 * card-efficiency score in one step — the two always happen together,
 * so this replaces every place that used to just splice the hand
 * directly and risk forgetting the score side of it. Safe to call
 * with a card id that isn't actually in hand (e.g. already removed);
 * it's a no-op in that case rather than an error.
 */
export function spendCard(state: MercenaryState, cardId: string): void {
	const idx = state.hand.findIndex((c) => c.id === cardId);
	if (idx === -1) return;
	state.hand.splice(idx, 1);
	state.matchScore.cardsRemaining = Math.max(
		0,
		state.matchScore.cardsRemaining - CARD_SPEND_PENALTY,
	);
}
