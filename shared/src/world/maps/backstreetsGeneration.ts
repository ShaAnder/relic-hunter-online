import type { GridCoord } from "../grid";
import type { RandomFn } from "../../math/random";
import {
	type MapBlueprint,
	BlueprintCode,
	createBlueprint,
	setCode,
	inBounds,
} from "../blueprint";

export interface BackstreetsOptions {
	seed?: number;
	/** How many junctions to scatter — roughly, how dense the alley network feels. */
	junctionCount?: number;
	/** Each junction connects to this many of its nearest neighbors before connectivity repair. Higher = more loops, more redundant routes. */
	neighborsPerJunction?: number;
	/** Width, in tiles, of the single main alleyway path. */
	mainAlleyWidth?: number;
	/** Width, in tiles, of every other alley. */
	sideAlleyWidth?: number;
}

const DEFAULTS: Required<BackstreetsOptions> = {
	seed: 1,
	junctionCount: 14,
	neighborsPerJunction: 3,
	mainAlleyWidth: 3,
	sideAlleyWidth: 1,
};

interface Edge {
	a: number;
	b: number;
}

/**
 * Generates the alley-network layer of a backstreets map: a genuine
 * graph of interconnected alleys, not a linear chain. Buildings are not
 * placed here; this only carves the alley network. A later pass fills
 * the remaining wall space with buildings (see backstreetsBuildings.ts
 * once that phase lands).
 */
export function generateBackstreetsAlleys(
	width: number,
	height: number,
	options: BackstreetsOptions = {},
	rng?: RandomFn,
): { blueprint: MapBlueprint; junctions: GridCoord[] } {
	const opts = { ...DEFAULTS, ...options };
	const random = rng ?? createFallbackRandom(opts.seed);
	const bp = createBlueprint(width, height, BlueprintCode.Wall);

	const junctions = scatterJunctions(width, height, opts.junctionCount, random);
	const edges = connectNearestNeighbors(junctions, opts.neighborsPerJunction);
	repairConnectivity(junctions, edges);

	const mainPathEdges = findMainAlleyEdges(junctions, edges);
	const mainPathSet = new Set(mainPathEdges.map((e) => edgeKey(e)));

	for (const edge of edges) {
		const isMain = mainPathSet.has(edgeKey(edge));
		carveAlley(
			bp,
			junctions[edge.a],
			junctions[edge.b],
			isMain ? opts.mainAlleyWidth : opts.sideAlleyWidth,
			random,
		);
	}

	// Junctions themselves always become floor — an edge carved wide
	// doesn't guarantee the junction's own tile got touched if it sits
	// at a corner two narrow edges only clip.
	for (const j of junctions) {
		setCode(bp, j, BlueprintCode.Floor);
	}

	return { blueprint: bp, junctions };
}

function edgeKey(e: Edge): string {
	return e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`;
}

/**
 * Random junction positions with a minimum spacing so they don't clump
 * simple rejection sampling
 */
function scatterJunctions(
	width: number,
	height: number,
	count: number,
	random: RandomFn,
): GridCoord[] {
	const junctions: GridCoord[] = [];
	const minSpacing = Math.max(
		4,
		Math.floor(Math.min(width, height) / (count / 2)),
	);
	const maxAttempts = count * 30;

	let attempts = 0;
	while (junctions.length < count && attempts < maxAttempts) {
		attempts++;
		const candidate = {
			x: 2 + Math.floor(random() * (width - 4)),
			y: 2 + Math.floor(random() * (height - 4)),
		};
		const tooClose = junctions.some(
			(j) => manhattan(j, candidate) < minSpacing,
		);
		if (!tooClose) junctions.push(candidate);
	}
	return junctions;
}

/** Each junction connects to its k nearest neighbors
 * deduped — this is what produces a real graph
 * (multiple edges per node) instead of a chain (exactly one).
 */
function connectNearestNeighbors(junctions: GridCoord[], k: number): Edge[] {
	const seen = new Set<string>();
	const edges: Edge[] = [];

	for (let i = 0; i < junctions.length; i++) {
		const distances = junctions
			.map((j, idx) => ({ idx, dist: manhattan(junctions[i], j) }))
			.filter((d) => d.idx !== i)
			.sort((a, b) => a.dist - b.dist)
			.slice(0, k);

		for (const { idx } of distances) {
			const key = i < idx ? `${i}-${idx}` : `${idx}-${i}`;
			if (seen.has(key)) continue;
			seen.add(key);
			edges.push({ a: i, b: idx });
		}
	}
	return edges;
}

/**
 * Union-find over the edge list — if nearest-neighbor
 * connecting happened to leave any junctions in a separate
 * island, connect the closest pair across islands until
 * everything's reachable.
 */
function repairConnectivity(junctions: GridCoord[], edges: Edge[]): void {
	const parent = junctions.map((_, i) => i);
	const find = (i: number): number => {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]];
			i = parent[i];
		}
		return i;
	};
	const union = (a: number, b: number) => {
		parent[find(a)] = find(b);
	};
	for (const e of edges) union(e.a, e.b);

	let guard = junctions.length;
	while (guard-- > 0) {
		const roots = new Set(junctions.map((_, i) => find(i)));
		if (roots.size <= 1) return;

		// Connect the closest pair of junctions that currently sit in
		// different components.
		let best: Edge | null = null;
		let bestDist = Infinity;
		for (let i = 0; i < junctions.length; i++) {
			for (let j = i + 1; j < junctions.length; j++) {
				if (find(i) === find(j)) continue;
				const dist = manhattan(junctions[i], junctions[j]);
				if (dist < bestDist) {
					bestDist = dist;
					best = { a: i, b: j };
				}
			}
		}
		if (!best) return;
		edges.push(best);
		union(best.a, best.b);
	}
}

/** BFS shortest path between the two junctions farthest apart (by tile distance) — that path becomes the main alleyway. */
function findMainAlleyEdges(junctions: GridCoord[], edges: Edge[]): Edge[] {
	if (junctions.length < 2) return [];

	let farA = 0;
	let farB = 1;
	let farDist = -1;
	for (let i = 0; i < junctions.length; i++) {
		for (let j = i + 1; j < junctions.length; j++) {
			const dist = manhattan(junctions[i], junctions[j]);
			if (dist > farDist) {
				farDist = dist;
				farA = i;
				farB = j;
			}
		}
	}

	const adjacency = new Map<number, number[]>();
	for (const e of edges) {
		if (!adjacency.has(e.a)) adjacency.set(e.a, []);
		if (!adjacency.has(e.b)) adjacency.set(e.b, []);
		adjacency.get(e.a)!.push(e.b);
		adjacency.get(e.b)!.push(e.a);
	}

	const cameFrom = new Map<number, number>();
	const visited = new Set<number>([farA]);
	const queue = [farA];
	while (queue.length > 0) {
		const current = queue.shift()!;
		if (current === farB) break;
		for (const next of adjacency.get(current) ?? []) {
			if (visited.has(next)) continue;
			visited.add(next);
			cameFrom.set(next, current);
			queue.push(next);
		}
	}

	const pathEdges: Edge[] = [];
	let node = farB;
	while (cameFrom.has(node)) {
		const prev = cameFrom.get(node)!;
		pathEdges.push({ a: prev, b: node });
		node = prev;
	}
	return pathEdges;
}

/** Carves a width-tile-wide corridor between two points, one bend, thickened by painting the perpendicular neighbors of each straight run. */
function carveAlley(
	bp: MapBlueprint,
	from: GridCoord,
	to: GridCoord,
	width: number,
	random: RandomFn,
): void {
	const bendAtX = random() < 0.5;
	const corner = bendAtX ? { x: to.x, y: from.y } : { x: from.x, y: to.y };

	paintThickLine(bp, from, corner, width);
	paintThickLine(bp, corner, to, width);
}

function paintThickLine(
	bp: MapBlueprint,
	from: GridCoord,
	to: GridCoord,
	width: number,
): void {
	const half = Math.floor(width / 2);
	const horizontal = from.y === to.y;

	if (horizontal) {
		const step = to.x >= from.x ? 1 : -1;
		for (let x = from.x; x !== to.x + step; x += step) {
			for (let w = -half; w <= half; w++) {
				const coord = { x, y: from.y + w };
				if (inBounds(bp, coord)) setCode(bp, coord, BlueprintCode.Floor);
			}
		}
	} else {
		const step = to.y >= from.y ? 1 : -1;
		for (let y = from.y; y !== to.y + step; y += step) {
			for (let w = -half; w <= half; w++) {
				const coord = { x: from.x + w, y };
				if (inBounds(bp, coord)) setCode(bp, coord, BlueprintCode.Floor);
			}
		}
	}
}

function manhattan(a: GridCoord, b: GridCoord): number {
	return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Only used if no rng is supplied — every real call site should pass the match's own seeded RandomFn instead, same as every other generator. */
function createFallbackRandom(seed: number): RandomFn {
	let state = seed || 1;
	return () => {
		state = (state * 1103515245 + 12345) & 0x7fffffff;
		return state / 0x7fffffff;
	};
}
