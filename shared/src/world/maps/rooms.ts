import type { GridCoord } from "../grid";
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
 * This makes no attempt to distinguish "a building" from "the open
 * street" — both are just rooms, including whichever one happens to
 * be the large open area outside every building. There's no reliable,
 * general way to tell them apart from the data alone, and there's no
 * need to: the only thing consumers of this actually need is "which
 * room is the player in right now," which works identically for a
 * small interior room or a large outdoor one.
 */
export function detectRooms(width: number, height: number, edges: EdgeGrid): Room[] {
	const visited = new Set<string>();
	const rooms: Room[] = [];
	let nextId = 0;

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const startKey = `${x},${y}`;
			if (visited.has(startKey)) continue;

			const cells: GridCoord[] = [];
			const boundaryEdges: Room["boundaryEdges"] = [];
			const queue: GridCoord[] = [{ x, y }];
			visited.add(startKey);

			while (queue.length > 0) {
				const current = queue.pop()!;
				cells.push(current);

				for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
					const next = { x: current.x + dx, y: current.y + dy };
					if (next.x < 0 || next.y < 0 || next.x >= width || next.y >= height) continue;

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
		rooms.find((r) => r.cells.some((c) => c.x === coord.x && c.y === coord.y)) ?? null
	);
}
