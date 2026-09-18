import type { Grid, GridCoord } from "../grid";
import { type EdgeGrid, EdgeBarrier, getEdgeBetween } from "../edgeGrid";

export interface Room {
	id: number;
	cells: GridCoord[];
	/** Every wall/door edge that borders this room — one entry per bordering edge, given as the two cells it sits between. This is what a renderer shrinks/highlights when the player is standing inside this room. */
	boundaryEdges: { a: GridCoord; b: GridCoord; barrier: EdgeBarrier }[];
}

/**
 * Splits every cell in the grid into rooms — maximal regions
 * connected only through open (EdgeBarrier.None) edges. A door
 * deliberately does NOT connect two cells for this purpose, even
 * though a door is fully passable for movement: the room on each side
 * of a doorway needs to stay a distinct, separately-identifiable
 * space, or entering a building and the open street outside it would
 * collapse into a single "room" the moment a door connects them.
 *
 * Non-walkable cells (void, river) are skipped entirely — they aren't
 * real, occupiable space, so they never start a room and are never
 * pulled into one as a neighbor, regardless of what's on the edges
 * around them.
 *
 * This makes no attempt to distinguish "a building" from "the open
 * street" — both are just rooms, including whichever one happens to
 * be the large open area outside every building. There's no reliable,
 * general way to tell them apart from the data alone — that's what
 * findOutsideRoom (below) is for, using size as the distinguishing
 * signal instead.
 */
export function detectRooms(grid: Grid, edges: EdgeGrid): Room[] {
	const { width, height } = grid;
	const visited = new Set<string>();
	const rooms: Room[] = [];
	let nextId = 0;

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const startKey = `${x},${y}`;
			if (visited.has(startKey)) continue;
			if (!grid.isWalkable({ x, y })) {
				visited.add(startKey);
				continue;
			}

			const cells: GridCoord[] = [];
			const boundaryEdges: Room["boundaryEdges"] = [];
			const queue: GridCoord[] = [{ x, y }];
			visited.add(startKey);

			while (queue.length > 0) {
				const current = queue.pop()!;
				cells.push(current);

				for (const [dx, dy] of [
					[1, 0],
					[-1, 0],
					[0, 1],
					[0, -1],
				]) {
					const next = { x: current.x + dx, y: current.y + dy };
					if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height)
						continue;
					if (!grid.isWalkable(next)) continue;

					const barrier = getEdgeBetween(edges, current, next);
					if (barrier === EdgeBarrier.None) {
						const nextKey = `${next.x},${next.y}`;
						if (!visited.has(nextKey)) {
							visited.add(nextKey);
							queue.push(next);
						}
					} else {
						boundaryEdges.push({ a: current, b: next, barrier });
					}
				}
			}

			rooms.push({ id: nextId++, cells, boundaryEdges });
		}
	}

	return rooms;
}

/** Finds whichever room (if any) contains coord — the common "what room is the player standing in" lookup. */
export function findRoomAt(rooms: Room[], coord: GridCoord): Room | null {
	return (
		rooms.find((r) =>
			r.cells.some((c) => c.x === coord.x && c.y === coord.y),
		) ?? null
	);
}

/**
 * Identifies which room is "the outside" — the open street network,
 * as opposed to an actual building interior — as whichever room has
 * the most cells. The connected street network will be far larger
 * than any single building's interior on any realistic map, so size
 * alone reliably picks it out. Returns null only if rooms is empty.
 *
 * This exists because the room-focus effect (shrinking a room's own
 * boundary walls, dimming everything else) must NOT apply while the
 * player is simply standing in the street — the street is a room too
 * by detectRooms' own definition, and its boundary walls are the
 * exact same walls every building sees from the other side. Skipping
 * this check is what makes every building look permanently
 * shrunk/lowered even from outside.
 */
export function findOutsideRoom(rooms: Room[]): Room | null {
	if (rooms.length === 0) return null;
	return rooms.reduce((largest, r) =>
		r.cells.length > largest.cells.length ? r : largest,
	);
}

/**
 * Building privacy rule.
 *
 * Outside/public space is visible normally.
 * A building interior is visible only while the observer is inside
 * that same room.
 *
 * This rule is deliberately independent of fog of war.
 */
export function canSeeRoomContent(
	rooms: Room[],
	observer: GridCoord,
	target: GridCoord,
): boolean {
	const observerRoom = findRoomAt(rooms, observer);
	const targetRoom = findRoomAt(rooms, target);

	if (!observerRoom || !targetRoom) {
		return false;
	}

	// Entity visibility is room-local.
	//
	// Outside is itself one room, so:
	// outside -> outside = visible
	// outside -> building = hidden
	// building -> outside = hidden
	// building A -> building A = visible
	// building A -> building B = hidden
	return observerRoom.id === targetRoom.id;
}
