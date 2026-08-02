import type { MercenaryState, AiArchetype } from "@relic-hunter/shared";
import type { AiMemory } from "@relic-hunter/shared";
import type { Mercenary } from "@/entities/Mercenary";
import type { TurnManager } from "@/systems/TurnManager";

export type PilotType = "local" | "ai";

/* One mercenary on the map, regardless of who pilots it */
export interface PilotedMercenary {
	pilot: PilotType;
	state: MercenaryState;
	mercenary: Mercenary;
	turnManager: TurnManager;
	archetype?: AiArchetype;
	memory?: AiMemory;
}
