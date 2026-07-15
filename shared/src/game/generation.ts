// shared/src/game/generation.ts
import { Grid, TileType, type GridCoord } from "./grid";
import { createSeededRandom } from "./random";

/**
 * Configuration options for dungeon generation.
 * All fields are optional — defaults are provided inside the function.
 */
export interface DungeonGenerationOptions {
	// For deterministic generation (same seed = same map)
	seed?: number;
	// How many rooms to try placing
	roomCount?: number;
	// Smallest possible room (width & height)
	minRoomSize?: number;
	// Largest possible room (width & height)
	maxRoomSize?: number;
}

/**
 * Internal representation of a rectangular room.
 * Only used inside this file — nothing outside generation.ts needs to know
 * about rooms specifically, it only ever sees the finished Grid.
 */
interface Room {
	x: number;
	y: number;
	width: number;
	height: number;
}

// Fallback values for any option the caller doesn't provide.
const DEFAULT_OPTIONS: Required<DungeonGenerationOptions> = {
	seed: 1,
	roomCount: 8,
	minRoomSize: 3,
	maxRoomSize: 6,
};

/**
 * Generates a dungeon using a simple room + corridor algorithm:
 * scatter some non-overlapping rectangular rooms, then connect them
 * with corridors, one after another.
 *
 * This is a "spike" implementation meant for quick testing of map size and
 * rendering. It's intentionally simple — no smart pathfinding, no elevation
 * variation, no fancy room shapes. Good enough to prove generation works at
 * a decent scale; not the final generator.
 *
 * @param width   Total width of the map in tiles
 * @param height  Total height of the map in tiles
 * @param options Optional configuration
 */
export function generateDungeon(
	width: number,
	height: number,
	options: DungeonGenerationOptions = {},
): Grid {
	// Fill in any missing options with defaults.
	const opts = { ...DEFAULT_OPTIONS, ...options };
	// One seeded generator for this whole dungeon — same seed always
	// reproduces the exact same layout, useful for testing.
	const random = createSeededRandom(opts.seed);
	// Start with every tile as a Wall. Generation below carves Floor tiles
	// out of it — easier to "dig rooms out of solid rock" than to build
	// walls around open floor.
	const grid = new Grid(width, height, TileType.Wall);

	// Step 1: Come up with a set of rooms that don't overlap each other.
	const rooms = placeRooms(width, height, opts, random);

	// Step 2: Turn each room's footprint into actual Floor tiles on the grid.
	for (const room of rooms) {
		carveRoom(grid, room);
	}

	// Step 3: Connect each room to the next one with a corridor, so the
	// whole dungeon is reachable in one connected path (room 1 → 2 → 3 → ...).
	for (let i = 1; i < rooms.length; i++) {
		carveCorridor(grid, roomCenter(rooms[i - 1]), roomCenter(rooms[i]), random);
	}

	// Step 4: Drop the exit in the center of the last room in the chain.
	if (rooms.length > 0) {
		const lastRoom = rooms[rooms.length - 1];
		grid.setTileType(roomCenter(lastRoom), TileType.Exit);
	}

	return grid;
}

/**
 * Tries random room positions/sizes until it has placed roomCount rooms
 * that don't overlap, or gives up after too many failed attempts (so a
 * tightly packed map can't loop forever trying to fit one more room in).
 */
function placeRooms(
	width: number,
	height: number,
	opts: Required<DungeonGenerationOptions>,
	random: () => number,
): Room[] {
	const rooms: Room[] = [];
	const maxAttemps = opts.roomCount * 10;

	let attempts = 0;

	while (rooms.length < opts.roomCount && attempts < maxAttemps) {
		attempts++;

		// Pick a random room size within the configured range.
		const roomWidth = randomInt(opts.minRoomSize, opts.maxRoomSize, random);
		const roomHeight = randomInt(opts.minRoomSize, opts.maxRoomSize, random);

		// Pick a random top-left corner, staying 1 tile clear of the map edge.
		const x = randomInt(1, width - roomWidth - 1, random);
		const y = randomInt(1, height - roomHeight - 1, random);

		const candidate: Room = { x, y, width: roomWidth, height: roomHeight };

		// Only keep this room if it doesn't collide with one we already placed.
		if (!overlapCheck(candidate, rooms)) {
			rooms.push(candidate);
		}
	}

	return rooms;
}

/**
 * Checks whether a candidate room overlaps ANY already-placed room.
 *
 * Two rectangles overlap only if they overlap on both the x-range AND the
 * y-range at the same time — so all four comparisons below have to be true
 * together for a given room to count as a collision, not just one of them.
 */
function overlapCheck(candidate: Room, existingRooms: Room[]): boolean {
	return existingRooms.some(
		(room) =>
			candidate.x < room.x + room.width &&
			candidate.x + candidate.width > room.x &&
			candidate.y < room.y + room.height &&
			candidate.y + candidate.height > room.y,
	);
}

// Turns every tile inside a room's rectangle into a Floor tile —
// this is the actual "digging out" step.
function carveRoom(grid: Grid, room: Room): void {
	for (let x = room.x; x < room.x + room.width; x++) {
		for (let y = room.y; y < room.y + room.height; y++) {
			grid.setTileType({ x, y }, TileType.Floor);
		}
	}
}

/**
 * Carves a corridor connecting two points with one bend — either
 * horizontal-then-vertical or vertical-then-horizontal. Which order is
 * picked randomly each time, purely so corridors don't all bend the same
 * way and look repetitive.
 */
function carveCorridor(
	grid: Grid,
	from: GridCoord,
	to: GridCoord,
	random: () => number,
): void {
	let current = { ...from };

	if (random() < 0.5) {
		current = cHorizonal(grid, current, to.x);
		cVertical(grid, current, to.y);
	} else {
		current = cVertical(grid, current, to.y);
		cHorizonal(grid, current, to.x);
	}
}

// The middle tile of a room. Used both to measure distance between rooms
// and as the actual point corridors connect to.
function roomCenter(room: Room): GridCoord {
	return {
		x: Math.floor(room.x + room.width / 2),
		y: Math.floor(room.y + room.height / 2),
	};
}

// Carves a straight horizontal line of Floor tiles from "from" until it
// reaches targetX, staying on the same row (y stays fixed).
function cHorizonal(grid: Grid, from: GridCoord, targetX: number): GridCoord {
	const step = targetX > from.x ? 1 : -1;
	let x = from.x;

	while (x !== targetX) {
		grid.setTileType({ x, y: from.y }, TileType.Floor);
		x += step;
	}

	grid.setTileType({ x: targetX, y: from.y }, TileType.Floor);
	return { x: targetX, y: from.y };
}

// Same idea as cHorizonal, but carves a straight vertical line instead
// (x stays fixed, y moves toward targetY).
function cVertical(grid: Grid, from: GridCoord, targetY: number): GridCoord {
	const step = targetY > from.y ? 1 : -1;
	let y = from.y;

	while (y !== targetY) {
		grid.setTileType({ x: from.x, y }, TileType.Floor);
		y += step;
	}

	grid.setTileType({ x: from.x, y: targetY }, TileType.Floor);
	return { x: from.x, y: targetY };
}

/**
 * Returns a random whole number between min and max, inclusive of both ends.
 */
function randomInt(min: number, max: number, random: () => number): number {
	// If the range is invalid or zero-width, just return min rather than
	// erroring — happens when a room genuinely can't fit (e.g. max room
	// size larger than the map itself).
	if (max <= min) return min;
	return Math.floor(random() * (max - min + 1)) + min;
}
