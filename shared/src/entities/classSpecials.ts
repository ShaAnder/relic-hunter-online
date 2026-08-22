import { CharacterClass } from "../types/mercenary";

export interface ClassSpecialDefinition {
	id: string;
	apCost: number;
	name: string;
	/** Stance check for stance based specials */
	isStance: boolean;
}

/** Special tracker for each class, Null means not built yet */
export const CLASS_SPECIALS: Record<
	CharacterClass,
	ClassSpecialDefinition | null
> = {
	brawler: { id: "overwatch", name: "Overwatch", apCost: 1, isStance: true },
	tank: null,
	hunter: null,
	scout: null,
	mage: null,
	summoner: null,
};

export function getClassSpecial(
	characerClass: CharacterClass,
): ClassSpecialDefinition | null {
	return CLASS_SPECIALS[characerClass];
}
