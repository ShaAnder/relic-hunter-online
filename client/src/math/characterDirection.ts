import type { GridCoord } from "@relic-hunter/shared";
import type { CharacterDirection } from "@/types/characterSprite";

export function getCharacterDirection(
	from: GridCoord,
	to: GridCoord,
): CharacterDirection {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	if (dx === 0 && dy === 0) return "se";

	const adx = Math.abs(dx);
	const ady = Math.abs(dy);

	if (adx > ady * 2) return dx > 0 ? "e" : "w";
	if (ady > adx * 2) return dy > 0 ? "s" : "n";

	if (dx > 0 && dy > 0) return "se";
	if (dx > 0 && dy < 0) return "ne";
	if (dx < 0 && dy > 0) return "sw";
	if (dx < 0 && dy < 0) return "nw";
	if (dx > 0) return "e";
	if (dx < 0) return "w";
	if (dy > 0) return "s";
	return "n";
}

/**
 * Map logical facing → authored sheet direction + flipX.
 * Brawler sheet rows cover se / sw / ne / n.
 */
export function resolveSheetDirection(dir: CharacterDirection): {
	sheetDir: CharacterDirection;
	flipX: boolean;
} {
	switch (dir) {
		case "se":
		case "e":
			return { sheetDir: "se", flipX: false };
		case "s":
			return { sheetDir: "se", flipX: true };
		case "sw":
		case "w":
			return { sheetDir: "sw", flipX: false };
		case "ne":
			return { sheetDir: "ne", flipX: false };
		case "nw":
			return { sheetDir: "ne", flipX: true };
		case "n":
			return { sheetDir: "n", flipX: false };
		default:
			return { sheetDir: "se", flipX: false };
	}
}

export function directionUsesFlipX(dir: CharacterDirection): boolean {
	return resolveSheetDirection(dir).flipX;
}

export function directionMirrorSource(
	dir: CharacterDirection,
): CharacterDirection {
	return resolveSheetDirection(dir).sheetDir;
}
