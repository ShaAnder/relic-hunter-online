import type { MercenaryState, AiArchetype } from "@relic-hunter/shared";
import type { AiMemory } from "@relic-hunter/shared";
import type { MonsterState, GridCoord } from "@relic-hunter/shared";
import type { Mercenary } from "@/entities/Mercenary";
import type { MonsterToken } from "@/entities/Monster";
import type { TurnManager } from "@/systems/TurnManager";
import type { Container } from "pixi.js";

export type PilotType = "local" | "ai";

/**
 * Anything that can be animated along a grid path and queried for
 * whether it's currently mid-move. Mercenary and MonsterToken both
 * already satisfy this shape structurally
 */
export interface MovableToken {
	readonly view: Container;
	readonly isAnimating: boolean;
	moveAlongPath(path: GridCoord[], durationMsOverride?: number): Promise<void>;
}

/** One hunter on the map, regardless of who pilots it. */
export interface PilotedMercenary {
	pilot: PilotType;
	state: MercenaryState;
	mercenary: Mercenary;
	turnManager: TurnManager;
	archetype?: AiArchetype;
	memory?: AiMemory;
}

/** One monster on the map, always AI-piloted. */
export interface MonsterEntity {
	state: MonsterState;
	token: MonsterToken;
}
