import type { TexturedVertex } from "./PolygonClip";
/**
 * Every polygon emitted by PolygonClip remains convex because it is produced by
 * repeatedly splitting a convex polygon with straight half-planes.
 *
 * A fan is therefore sufficient; no general concave triangulator is required.
 */
export function triangulateConvexFan(
	polygon: readonly TexturedVertex[],
): readonly TexturedVertex[] {
	if (polygon.length < 3) {
		return [];
	}
	const triangles: TexturedVertex[] = [];
	for (let index = 1; index < polygon.length - 1; index++) {
		triangles.push(polygon[0], polygon[index], polygon[index + 1]);
	}
	return triangles;
}
