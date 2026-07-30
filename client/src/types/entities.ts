import type { MercenaryState, AiArchetype } from "@relic-hunter/shared";
import type { AiMemory } from "@relic-hunter/shared";
import type { Mercenary } from "@/entities/Mercenary";

/** One hunter on the map — live state paired with its visual token. */
export interface EnemyEntity {
	state: MercenaryState;
	mercenary: Mercenary;
	archetype: AiArchetype;
	memory: AiMemory;
}
