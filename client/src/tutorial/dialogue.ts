/**
 * One line of dialogue — the atomic unit the DialogueOverlay renders.
 * Deliberately generic: tutorials, the eventual shop, and story mode
 * all feed the same shape into the same overlay, none of them aware
 * of why a line is being shown.
 */
export interface DialogueLine {
	speaker: string;
	/** Key into the portrait factory's asset table — not a raw URL, so swapping art later never touches script content. */
	portraitId: string;
	/** Which screen edge this speaker's portrait sits on. Whichever side last spoke stays visible when the other side starts talking — a real back-and-forth, not one portrait swapped out per line. */
	side: "left" | "right";
	text: string;
}

/** A named group of lines with a single speaker/side, for scripting convenience — expands to individual DialogueLines at render time, never stored or passed around as its own type. */
export function linesFor(
	speaker: string,
	portraitId: string,
	side: "left" | "right",
	...texts: string[]
): DialogueLine[] {
	return texts.map((text) => ({ speaker, portraitId, side, text }));
}
