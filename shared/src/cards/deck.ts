import type { CardData } from "./card";
import type { RandomFn } from "../math/random";

/**
 * Fisher-Yates shuffle. Used here (rather than sort-by-random-key, a common
 * but statistically biased shortcut) so every permutation of the input is
 * equally likely.
 */
function shuffle<T>(items: T[], rng: RandomFn): T[] {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

let deckCardCounter = 0;

/** Unique id for a generated deck card. Not globally meaningful — just needs to not collide within one deck. */
function nextCardId(prefix: string): string {
	deckCardCounter += 1;
	return `${prefix}_${deckCardCounter}`;
}

/** Push `count` copies of one card definition (minus id) onto a target array, each with a fresh id. */
function pushCopies(
	target: CardData[],
	count: number,
	template: Omit<CardData, "id">,
): void {
	for (let i = 0; i < count; i++) {
		target.push({ ...template, id: nextCardId(template.color) });
	}
}

/**
 * 26 Blue cards: 2× E (the hard cap — E is a gamble/reposition tool, not
 * something to spam) + 8 each of Move 1/2/3 (24, evenly split three ways).
 */
function buildBlueCards(): CardData[] {
	const cards: CardData[] = [];
	pushCopies(cards, 2, {
		color: "blue",
		name: "Exit (E)",
		value: "E",
		description:
			"Teleport to exit — wins if carrying the target item, otherwise random teleport",
		actionType: "move",
	});
	pushCopies(cards, 8, {
		color: "blue",
		name: "Move +1",
		value: 1,
		description: "+1 Movement",
		actionType: "move",
	});
	pushCopies(cards, 8, {
		color: "blue",
		name: "Move +2",
		value: 2,
		description: "+2 Movement",
		actionType: "move",
	});
	pushCopies(cards, 8, {
		color: "blue",
		name: "Move +3",
		value: 3,
		description: "+3 Movement",
		actionType: "move",
	});
	return cards;
}

/**
 * 33 Red cards: 4 each of Attack 1-6 (24) + 5× A + 4× C (9).
 */
function buildRedCards(): CardData[] {
	const cards: CardData[] = [];
	for (let value = 1; value <= 6; value++) {
		pushCopies(cards, 4, {
			color: "red",
			name: `Attack +${value}`,
			value,
			description: `+${value} Attack`,
			actionType: "attack",
		});
	}
	pushCopies(cards, 5, {
		color: "red",
		name: "Double Dmg (A)",
		value: "A",
		description: "Attack stat ×2, applied before defense",
		actionType: "attack",
	});
	pushCopies(cards, 4, {
		color: "red",
		name: "Critical (C)",
		value: "C",
		description: "Attack stat ×1.5, applied before defense",
		actionType: "attack",
	});
	return cards;
}

/**
 * 20 Yellow cards: Def 1/3 get 4 copies, Def 2/4 get 3 (14 total) + 4× A +
 * 2× C (6).
 */
function buildYellowCards(): CardData[] {
	const cards: CardData[] = [];
	pushCopies(cards, 4, {
		color: "yellow",
		name: "Def +1",
		value: 1,
		description: "+1 Defense",
		actionType: "defense",
	});
	pushCopies(cards, 3, {
		color: "yellow",
		name: "Def +2",
		value: 2,
		description: "+2 Defense",
		actionType: "defense",
	});
	pushCopies(cards, 4, {
		color: "yellow",
		name: "Def +3",
		value: 3,
		description: "+3 Defense",
		actionType: "defense",
	});
	pushCopies(cards, 3, {
		color: "yellow",
		name: "Def +4",
		value: 4,
		description: "+4 Defense",
		actionType: "defense",
	});
	pushCopies(cards, 4, {
		color: "yellow",
		name: "Nullify (A)",
		value: "A",
		description: "Negates the hit entirely, or instantly disarms a trap",
		actionType: "defense",
	});
	pushCopies(cards, 2, {
		color: "yellow",
		name: "Double Def (C)",
		value: "C",
		description:
			"Doubles defense this exchange — bypasses the attack-stance half rule",
		actionType: "defense",
	});
	return cards;
}

/**
 * 21 Green cards — all Stun, the only real Green card as of Phase 1.
 */
function buildGreenCards(): CardData[] {
	const cards: CardData[] = [];
	pushCopies(cards, 21, {
		color: "green",
		name: "Stun",
		value: 1,
		description: "Stun trap",
		actionType: "stun",
	});
	return cards;
}

/**
 * Build the ONE shared deck for the match — 100 cards total (26 Blue / 33
 * Red / 20 Yellow / 21 Green), shuffled once. This is not per-mercenary:
 * every hunter on the map draws from this same deck, turn by turn, until
 * it's exhausted.
 */
export function buildSharedDeck(rng: RandomFn): CardData[] {
	const deck = [
		...buildBlueCards(),
		...buildRedCards(),
		...buildYellowCards(),
		...buildGreenCards(),
	];
	return shuffle(deck, rng);
}

/** Max cards any hunter can hold — player or AI. Single source of truth. */
export const MAX_HAND_SIZE = 5;

/**
 * Draw up to `count` cards from `deck` into `hand`, capped by MAX_HAND_SIZE
 * and by whatever's left in the deck. Mutates both arrays in place. Used
 * identically by TurnManager (player) and enemy AI turn processing — one
 * draw implementation, not two that could quietly diverge.
 * @param hand - mutated in place
 * @param deck - mutated in place, shift() removes from the front
 * @param count - cards to attempt to draw
 */
export function drawCardsInto(
	hand: CardData[],
	deck: CardData[],
	count: number,
): void {
	const roomInHand = MAX_HAND_SIZE - hand.length;
	const actualDraw = Math.min(count, roomInHand, deck.length);

	for (let i = 0; i < actualDraw; i++) {
		const card = deck.shift();
		if (card) hand.push(card);
	}
}
