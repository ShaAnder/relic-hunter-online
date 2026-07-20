import type { CharacterData } from "@relic-hunter/shared";

/**
 * Lightweight session bag owned by Game.
 * Scenes read/write this instead of threading constructor params.
 * Survives scene transitions so Lobby still knows the active character.
 */
export interface MissionParams {
	mapSize: "S" | "M" | "L";
}

export class GameSession {
	character: CharacterData | null = null;
	missionParams: MissionParams | null = null;
}
