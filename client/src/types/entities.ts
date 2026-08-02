import type { MercenaryState, AiArchetype } from "@relic-hunter/shared";
import type { AiMemory } from "@relic-hunter/shared";
import type { Mercenary } from "@/entities/Mercenary";
import type { TurnManager } from "@/systems/TurnManager";
import type { MonsterState } from "@relic-hunter/shared";
import { MonsterToken } from "@/entities/Monster";

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

/* One Monster on the map, always AI piloted */
export interface MonsterEntity {
	state: MonsterState;
	token: MonsterToken;
}
