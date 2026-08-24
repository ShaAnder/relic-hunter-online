/**
 * One line of dialogue — the atomic unit the DialogueOverlay renders.
 * Deliberately generic: tutorials, the eventual shop, and story mode
 * all feed the same shape into the same overlay, none of them aware
 * of why a line is being shown.
 */
export interface DialogueLine {
	speaker: string;
	/** Key into the portrait factory's asset table */
	portraitId: string;
	text: string;
}

/** A named group of lines with a single speaker, for scripting convenience —
 * expands to individual DialogueLines at render time, never stored or passed around as its own type. */
export function linesFor(
	speaker: string,
	portraitId: string,
	...texts: string[]
): DialogueLine[] {
	return texts.map((text) => ({ speaker, portraitId, text }));
}
