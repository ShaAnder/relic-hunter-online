import type { GameSession } from "@/core/game/GameSession";
import { gridToScreen } from "@/math/isoGridMath";

/**
 * World position of whoever currently has the turn.
 * Prefers turnOrder[0] → participants roster.
 * Falls back to playerSpawn / first participant so single-hunter still works.
 */
export function getActiveHunterWorldPos(session: GameSession): {
	x: number;
	y: number;
} {
	const order = session.turnOrder;
	const roster = session.participants;

	if (order && order.length > 0 && roster && roster.length > 0) {
		const activeId = order[0].id;
		const match = roster.find((p) => p.id === activeId);
		if (match) return gridToScreen(match.coord);
	}

	// Fallbacks
	if (session.playerSpawn) return gridToScreen(session.playerSpawn);
	if (roster && roster.length > 0) return gridToScreen(roster[0].coord);

	return { x: 0, y: 0 };
}
