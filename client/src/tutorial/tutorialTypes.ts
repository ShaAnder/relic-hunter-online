import type { CardColor } from "@relic-hunter/shared";
import type { ButtonAction } from "@/ui/buttons/ActionMenu";
import type { DialogueLine } from "./dialogue";

/**
 * Every kind of "the player just did something" moment a tutorial
 * objective might care about. A discriminated union on `type` — add a
 * new event shape here as new tutorials need to detect new things
 */
export type TutorialEvent =
	| { type: "moved"; tilesMoved: number; usedCard: boolean }
	| { type: "cardPlayed"; cardColor: CardColor; actionType: string }
	| { type: "actionMenuOpened" }
	| { type: "combatStarted"; opponentType: "hunter" | "monster" }
	| {
			type: "combatActionChosen";
			action: "attack" | "defend" | "run" | "surrender";
	  }
	| { type: "combatEnded"; won: boolean }
	| { type: "chestOpened"; itemName: string }
	| { type: "inventoryOpened" }
	| { type: "itemDropped" }
	| { type: "reachedExit"; carryingTarget: boolean }
	| { type: "defeated" }
	| { type: "trapTriggered" }
	| { type: "monsterEncountered" }
	| { type: "specialUsed"; specialId: string };

/**
 * One thing the player has to actually do before a segment can advance.
 * isMet is checked against every TutorialEvent MapScene fires while
 * this objective is active
 */
export interface TutorialObjective {
	id: string;
	/** On-screen hint shown for as long as this objective is active — "Drag to move", "Tap Attack", etc. */
	prompt: string;
	isMet: (event: TutorialEvent) => boolean;
}

/**
 * One beat of a tutorial: narrator sets up the moment, player does the
 * thing (or, if objective is null, nothing is required and the runner
 * auto-advances after intro)
 */
export interface TutorialSegment {
	id: string;
	intro: DialogueLine[];
	objective: TutorialObjective | null;
	confirm: DialogueLine[];
}

/** A tutorial's own small, purpose-built map — deliberately
 * tiny and seeded for reproducibility, not the real game's procedural sizing. */
export interface DebugMapSpec {
	width: number;
	height: number;
	seed: number;
	/** Defaults to the same density formula the real game uses if omitted. */
	roomCount?: number;
}

/** The full script for one tutorial topic — what
 * TutorialsMenuScene's real (non-locked) buttons will eventually launch. */
export interface TutorialScript {
	id: string;
	title: string;
	debugMap: DebugMapSpec;
	segments: TutorialSegment[];
}

/**
 * Passed into MapScene to turn it into a tutorial — gates off the
 * heavy systems (AI hunters, monsters, chests) at the exact points
 * MapScene already spawns them, rather than a parallel reimplementation
 */
export interface TutorialConfig {
	script: TutorialScript;
	spawnAiHunters: boolean;
	spawnMonsters: boolean;
	spawnChests: boolean;
	/** Restricts which ActionMenu rows are enabled — null means no restriction, every action stays available. */
	allowedActions: ButtonAction[] | null;
	onTutorialEvent: (event: TutorialEvent) => void;
}
