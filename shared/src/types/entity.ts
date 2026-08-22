import type { GridCoord } from "../world/grid";
import type { MercenaryStats } from "./mercenary";
import type { CardData } from "../cards/card";
import type { ItemData } from "../items/item";
import type { CharacterClass } from "./mercenary";

/**
 * Every single entity on the map has exactly this, no exceptions —
 * hunters, monsters, any future entity type. Everything else is an
 * optional, composable trait layered on top via intersection types
 */
export interface EntityCore {
	id: string;
	coord: GridCoord;
	stats: MercenaryStats;
	currentHp: number;
}

/** Draws from and plays the shared card deck. Hunters have this; monsters don't. */
export interface HasHand {
	hand: CardData[];
}

/** Carries a public, lootable inventory. Ties in hpCeiling since the knockout-heal mechanic
 * only applies to entities that can be looted at all. */
export interface HasItems {
	items: (ItemData | null)[];
	hpCeiling: number;
}

/** Belongs to one of the six playable classes — governs ranged/melee/caster targeting rules. */
export interface HasCharacterClass {
	characterClass: CharacterClass;
}

export interface HasName {
	name: string;
}

export interface HasStatus {
	stunnedTurnsRemaining: number;
}

export interface MatchScore {
	damageDealt: number;
	itemsScore: number;
	/** Reverse metric — starts high, decreases per card used. */
	cardsRemaining: number;
	environmentalScore: number;
	tacticalScore: number;
	/** Capped elsewhere at the point */
	objectiveTurnsHeld: number;
}

export interface HasMatchScore {
	matchScore: MatchScore;
}

export interface TemporaryStatBonus {
	attack: number | "A" | "C";
	defense: number | "A" | "C";
	movement: number;
}

export interface HasTemporaryStatBonus {
	temporaryStatBonus: TemporaryStatBonus;
}

export interface HasSpecial {
	special: string | null;
}

export interface StatusEffect {
	id: string;
	turnsRemaining: number;
}

export interface HasStatusEffects {
	statusEffects: StatusEffect[];
}

/**
 * Adds or refreshes a status effect — takes the longer of the two
 * durations if it's already present, rather than stacking or resetting blindly.
 */
export function applyStatusEffect(
	target: HasStatusEffects,
	id: string,
	turns: number,
): void {
	const existing = target.statusEffects.find((e) => e.id === id);
	if (existing) {
		existing.turnsRemaining = Math.max(existing.turnsRemaining, turns);
	} else {
		target.statusEffects.push({ id, turnsRemaining: turns });
	}
}

/**
 * Ticks every active effect down by one turn, removing anything that's expired.
 * Called at the affected unit's own turn boundary — independent of whoever inflicted it.
 */
export function tickStatusEffects(target: HasStatusEffects): void {
	target.statusEffects = target.statusEffects
		.map((e) => ({ ...e, turnsRemaining: e.turnsRemaining - 1 }))
		.filter((e) => e.turnsRemaining > 0);
}

/** Entity items */
export function hasName(entity: EntityCore): entity is EntityCore & HasName {
	return "name" in entity;
}

export function hasHand(entity: EntityCore): entity is EntityCore & HasHand {
	return "hand" in entity;
}

export function hasItems(entity: EntityCore): entity is EntityCore & HasItems {
	return "items" in entity;
}

export function hasStatus(
	entity: EntityCore,
): entity is EntityCore & HasStatus {
	return "stunnedTurnsRemaining" in entity;
}

export function hasCharacterClass(
	entity: EntityCore,
): entity is EntityCore & HasCharacterClass {
	return "characterClass" in entity;
}
