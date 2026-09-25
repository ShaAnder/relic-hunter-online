import type { VisualPoint } from "../compiler/CompiledFloorVisual";

const EPSILON = 0.000001;

export interface TexturedVertex extends VisualPoint {
	u: number;
	v: number;
}

/**
 * Subtract one convex polygon from one convex textured polygon.
 *
 * The result can contain several convex pieces. UVs are linearly interpolated
 * at each generated intersection so clipping does not distort the texture.
 */
export function subtractConvexPolygon(
	subject: readonly TexturedVertex[],

	clip: readonly VisualPoint[],
): readonly TexturedVertex[][] {
	if (subject.length < 3 || clip.length < 3) {
		return subject.length >= 3 ? [[...subject]] : [];
	}
	const orientation = signedArea(clip) >= 0 ? 1 : -1;
	let remaining: TexturedVertex[][] = [[...subject]];
	const outsidePieces: TexturedVertex[][] = [];

	for (let edgeIndex = 0; edgeIndex < clip.length; edgeIndex++) {
		const a = clip[edgeIndex];
		const b = clip[(edgeIndex + 1) % clip.length];
		const nextRemaining: TexturedVertex[][] = [];

		for (const polygon of remaining) {
			const split = splitAgainstEdge(polygon, a, b, orientation);
			if (split.outside.length >= 3) {
				outsidePieces.push(split.outside);
			}
			if (split.inside.length >= 3) {
				nextRemaining.push(split.inside);
			}
		}
		remaining = nextRemaining;
		if (remaining.length === 0) {
			break;
		}
	}
	/**
	 * Anything still in `remaining` is inside every clip half-plane and is the
	 * intersection itself, so it is intentionally discarded.
	 */
	return outsidePieces;
}

/**
 * Apply several convex occluders sequentially.
 */
export function subtractConvexPolygons(
	subject: readonly TexturedVertex[],
	clips: readonly (readonly VisualPoint[])[],
): readonly TexturedVertex[][] {
	let pieces: readonly TexturedVertex[][] = [[...subject]];
	for (const clip of clips) {
		const next: TexturedVertex[][] = [];
		for (const piece of pieces) {
			next.push(...subtractConvexPolygon(piece, clip));
		}
		pieces = next;
		if (pieces.length === 0) {
			break;
		}
	}
	return pieces;
}

function splitAgainstEdge(
	polygon: readonly TexturedVertex[],
	a: VisualPoint,
	b: VisualPoint,
	orientation: 1 | -1,
): {
	inside: TexturedVertex[];
	outside: TexturedVertex[];
} {
	const inside: TexturedVertex[] = [];
	const outside: TexturedVertex[] = [];
	let previous = polygon[polygon.length - 1];
	let previousDistance = halfPlaneDistance(previous, a, b, orientation);
	let previousInside = previousDistance >= -EPSILON;

	for (const current of polygon) {
		const currentDistance = halfPlaneDistance(current, a, b, orientation);
		const currentInside = currentDistance >= -EPSILON;
		if (previousInside !== currentInside) {
			const denominator = previousDistance - currentDistance;
			const t =
				Math.abs(denominator) < EPSILON ? 0 : previousDistance / denominator;
			const intersection = interpolate(previous, current, t);
			inside.push(intersection);
			outside.push(intersection);
		}
		if (currentInside) {
			inside.push(current);
		} else {
			outside.push(current);
		}
		previous = current;
		previousDistance = currentDistance;
		previousInside = currentInside;
	}

	return {
		inside: dedupeAdjacent(inside),
		outside: dedupeAdjacent(outside),
	};
}

function halfPlaneDistance(
	point: VisualPoint,
	a: VisualPoint,
	b: VisualPoint,
	orientation: 1 | -1,
): number {
	const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
	return cross * orientation;
}

function interpolate(
	a: TexturedVertex,
	b: TexturedVertex,
	t: number,
): TexturedVertex {
	return {
		x: a.x + (b.x - a.x) * t,
		y: a.y + (b.y - a.y) * t,
		u: a.u + (b.u - a.u) * t,
		v: a.v + (b.v - a.v) * t,
	};
}

function signedArea(polygon: readonly VisualPoint[]): number {
	let area = 0;
	for (let index = 0; index < polygon.length; index++) {
		const current = polygon[index];
		const next = polygon[(index + 1) % polygon.length];
		area += current.x * next.y - next.x * current.y;
	}
	return area / 2;
}

function dedupeAdjacent(polygon: readonly TexturedVertex[]): TexturedVertex[] {
	if (polygon.length <= 1) {
		return [...polygon];
	}
	const result: TexturedVertex[] = [];
	for (const vertex of polygon) {
		const previous = result[result.length - 1];
		if (
			previous &&
			Math.abs(previous.x - vertex.x) < EPSILON &&
			Math.abs(previous.y - vertex.y) < EPSILON
		) {
			continue;
		}
		result.push(vertex);
	}
	if (result.length > 1) {
		const first = result[0];
		const last = result[result.length - 1];
		if (
			Math.abs(first.x - last.x) < EPSILON &&
			Math.abs(first.y - last.y) < EPSILON
		) {
			result.pop();
		}
	}
	return result;
}
