import { Assets, Texture } from "pixi.js";

/**
 * Auto-discovers every portrait PNG under assets/portraits/ at build
 * time — no manual per-file imports, ever. Drop a new PNG in that
 * folder following the {CharacterName}{Expression}.png convention
 * (e.g. KesslerApprove.png) and it's automatically available, no code
 * changes needed anywhere in this file.
 */
const portraitModules = import.meta.glob("../assets/portraits/*.png", {
	eager: true,
	import: "default",
}) as Record<string, string>;

interface PortraitEntry {
	characterId: string;
	expression: string;
	url: string;
}

/** Parses "KesslerApprove.png" into {characterId: "kessler", expression: "approve"} — splits on capital letters, assumes exactly one character name followed by one expression name. */
function parseFilename(path: string): {
	characterId: string;
	expression: string;
} {
	const filename = path.split("/").pop() ?? "";
	const nameOnly = filename.replace(/\.png$/i, "");
	const parts = nameOnly.split(/(?=[A-Z])/).filter(Boolean);
	const characterId = (parts[0] ?? "unknown").toLowerCase();
	const expression = parts.slice(1).join("").toLowerCase() || "neutral";
	return { characterId, expression };
}

const PORTRAIT_TABLE: PortraitEntry[] = Object.entries(portraitModules).map(
	([path, url]) => ({ ...parseFilename(path), url }),
);

/**
 * Which way a character's art is naturally drawn facing — the factory
 * only flips a portrait when the side it's actually being displayed on
 * doesn't match this. Add an entry here for any character whose art
 * faces the other way; unlisted characters default to "left".
 */
const NATURAL_FACING: Record<string, "left" | "right"> = {
	kessler: "left",
};

const textureCache = new Map<string, Texture>();

/** A combined "characterId-expression" id (e.g. "kessler-neutral") — split once here so DialogueLine.portraitId can stay a single string, matching every existing script's linesFor calls. */
function splitPortraitId(portraitId: string): {
	characterId: string;
	expression: string;
} {
	const dash = portraitId.indexOf("-");
	if (dash === -1) return { characterId: portraitId, expression: "neutral" };
	return {
		characterId: portraitId.slice(0, dash),
		expression: portraitId.slice(dash + 1),
	};
}

/** Whether real art exists for this portraitId — DialogueOverlay uses this to choose between loading real art and the colored-placeholder fallback. */
export function hasRealPortrait(portraitId: string): boolean {
	const { characterId, expression } = splitPortraitId(portraitId);
	return PORTRAIT_TABLE.some(
		(e) => e.characterId === characterId && e.expression === expression,
	);
}

/** Loads (and caches) the texture for a portraitId. Only call after confirming hasRealPortrait. */
export async function loadPortraitTexture(
	portraitId: string,
): Promise<Texture> {
	const cached = textureCache.get(portraitId);
	if (cached) return cached;

	const { characterId, expression } = splitPortraitId(portraitId);
	const entry = PORTRAIT_TABLE.find(
		(e) => e.characterId === characterId && e.expression === expression,
	);
	if (!entry) {
		throw new Error(`No portrait art found for "${portraitId}"`);
	}

	const texture = await Assets.load(entry.url);
	textureCache.set(portraitId, texture);
	return texture;
}

/**
 * Whether a portrait needs to be horizontally flipped to correctly
 * face into the conversation from the side it's actually being shown
 * on — e.g. art naturally drawn facing left, displayed on the right
 * side of the strip, needs flipping so the character looks toward the
 * center rather than off-screen. Callers apply this to a Sprite's own
 * scale.x sign; this function only decides yes/no, it doesn't touch
 * any rendering itself.
 */
export function needsFlipForSide(
	portraitId: string,
	side: "left" | "right",
): boolean {
	const { characterId } = splitPortraitId(portraitId);
	const natural = NATURAL_FACING[characterId] ?? "left";
	return natural !== side;
}
