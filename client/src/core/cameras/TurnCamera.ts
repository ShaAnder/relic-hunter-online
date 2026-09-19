import type { GameSession } from "@/core/game/GameSession";
import { gridToScreenElevated } from "@/math/isoGridMath";

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
	const elevation =
		session.mapFloors?.[session.viewedFloor]?.elevation ??
		session.mapElevation ??
		undefined;

	if (order && order.length > 0 && roster && roster.length > 0) {
		const activeId = order[0].id;
		const match = roster.find((p) => p.id === activeId);

		if (match) {
			return gridToScreenElevated(match.coord, elevation);
		}
	}

	if (session.playerSpawn) {
		return gridToScreenElevated(session.playerSpawn, elevation);
	}

	if (roster && roster.length > 0) {
		return gridToScreenElevated(roster[0].coord, elevation);
	}

	return {
		x: 0,
		y: 0,
	};
}
