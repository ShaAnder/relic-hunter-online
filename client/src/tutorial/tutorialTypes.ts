import type {
	CardColor,
	CardData,
	GridCoord,
	TileType,
} from "@relic-hunter/shared";
import type { ButtonAction } from "@/ui/buttons/ActionMenu";
import type { DialogueLine } from "./dialogue";

/**
 * Every kind of "the player just did something" moment a tutorial
 * objective might care about. A discriminated union on `type` — add a
 * new event shape here as new tutorials need to detect new things.
 * MapScene fires these through TutorialConfig.onTutorialEvent as the
 * relevant action actually happens, not synthesized after the fact.
 */
export type TutorialEvent =
	| {
			type: "moved";
			tilesMoved: number;
			usedCard: boolean;
			finalCoord: GridCoord;
	  }
	| { type: "cardPlayed"; cardColor: CardColor; actionType: string }
	| { type: "actionMenuOpened" }
	| { type: "turnEnded" }
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
 * this objective is active — return true the first time it's
 * satisfied, false otherwise.
 */
export interface TutorialObjective {
	id: string;
	/** On-screen hint shown for as long as this objective is active. */
	prompt: string;
	isMet: (event: TutorialEvent) => boolean;
}

/**
 * One beat of a tutorial: narrator sets up the moment, player does the
 * thing (or, if objective is null, nothing is required and the runner
 * auto-advances after intro), narrator confirms, then the next
 * segment begins.
 */
export interface TutorialSegment {
	id: string;
	intro: DialogueLine[];
	/** If set, handed to the player's hand (via MapScene.giveCard) right after intro plays, before the objective becomes active. */
	giveCard?: CardData;
	/** If set, MapScene highlights this tile (glow + bobbing arrow) for as long as this segment's objective is active — a generic "move here" pointer, not specific to this one tutorial. */
	targetTile?: GridCoord;
	objective: TutorialObjective | null;
	confirm: DialogueLine[];
}

/** A tutorial's own small, purpose-built map — deliberately tiny and seeded for reproducibility, not the real game's procedural sizing. */
export interface DebugMapSpec {
	width: number;
	height: number;
	seed: number;
	roomCount?: number;
	/** If set, the map starts as an all-Floor grid at width×height and each of these gets applied via Grid's own setTileType — a hand-authored layout, not procedural generation. */
	tileOverrides?: { coord: GridCoord; type: TileType }[];
}

/** A purely visual, non-interactive token placed at a fixed coord for a tutorial's staging. */
export interface StaticActorSpec {
	coord: GridCoord;
	label: string;
	color: number;
}

/** The full script for one tutorial topic. */
export interface TutorialScript {
	id: string;
	title: string;
	debugMap: DebugMapSpec;
	staticActors?: StaticActorSpec[];
	/** Overrides the test character's base movement stat for this
	 * tutorial specifically — doesn't touch the real game's spawn defaults. */
	playerMovement?: number;
	segments: TutorialSegment[];
}

/**
 * Passed into MapScene to turn it into a tutorial — gates off the
 * heavy systems at the exact points MapScene already spawns them.
 * MapScene never needs to know a runner or script exists at all.
 */
export interface TutorialConfig {
	script: TutorialScript;
	spawnAiHunters: boolean;
	spawnMonsters: boolean;
	spawnChests: boolean;
	allowedActions: ButtonAction[] | null;
	playerMovement?: number;
	onTutorialEvent: (event: TutorialEvent) => void;
}
