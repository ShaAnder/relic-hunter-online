/**
 * Card colors. "none" is reserved for the permanent skip/no-card option in
 * the hand UI — it never appears in a real deck.
 */
export type CardColor = "blue" | "red" | "yellow" | "green" | "none";

/** Special card markers — see `04-card-system-design.md` for exact effects per color. */
export type CardSpecial = "A" | "C" | "E";

const CARD_SPECIALS = new Set<CardSpecial>(["A", "C", "E"]);

export interface CardData {
	id: string;
	color: CardColor;
	name: string;
	/** A plain number for numeric cards, or a CardSpecial marker for A/C/E cards. */
	value: number | CardSpecial;
	description: string;
	actionType: "move" | "attack" | "defense" | "stun";
}

/** True if this card is a special (A/C/E, or any future addition) rather than a plain numeric value. */
export function isSpecialCard(
	data: CardData,
): data is CardData & { value: CardSpecial } {
	return CARD_SPECIALS.has(data.value as CardSpecial);
}
