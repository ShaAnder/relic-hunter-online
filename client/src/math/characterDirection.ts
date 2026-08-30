import type { GridCoord } from "@relic-hunter/shared";
import type { CharacterDirection } from "@/types/characterSprite";

/**
 * Pure grid-math helper — same home as isoGridMath, no Pixi.
 * Maps a step (from → to) to one of eight facings for sprite flip/sheet choice.
 */
export function getCharacterDirection(
	from: GridCoord,
	to: GridCoord,
): CharacterDirection {
	const dx = to.x - from.x;
	const dy = to.y - from.y;

	if (dx === 0 && dy === 0) return "se";

	// Iso grid: +x and +y both step "down" on screen in different diagonals.
	// Use dominant axis; ties prefer the more "horizontal" screen feel (e/w).
	const adx = Math.abs(dx);
	const ady = Math.abs(dy);

	if (adx > ady * 2) {
		// Mostly pure x-change on grid → east/west-ish in our projection
		return dx > 0 ? "e" : "w";
	}
	if (ady > adx * 2) {
		return dy > 0 ? "s" : "n";
	}

	// Diagonals
	if (dx > 0 && dy > 0) return "se";
	if (dx > 0 && dy < 0) return "ne";
	if (dx < 0 && dy > 0) return "sw";
	if (dx < 0 && dy < 0) return "nw";

	// Axis-aligned residual
	if (dx > 0) return "e";
	if (dx < 0) return "w";
	if (dy > 0) return "s";
	return "n";
}

/**
 * Which authored views we generate vs mirror.
 * PixelLab output is SE-facing; N/NE/E/SE are unique; S/SW/W/NW use flipX
 * on the mirrored partner (exact pairing tuned once real art lands).
 */
export function directionUsesFlipX(dir: CharacterDirection): boolean {
	return dir === "sw" || dir === "w" || dir === "nw" || dir === "s";
}

/** Partner direction to sample when flipX is used (placeholder pairing). */
export function directionMirrorSource(
	dir: CharacterDirection,
): CharacterDirection {
	switch (dir) {
		case "s":
			return "n";
		case "sw":
			return "se";
		case "w":
			return "e";
		case "nw":
			return "ne";
		default:
			return dir;
	}
}
