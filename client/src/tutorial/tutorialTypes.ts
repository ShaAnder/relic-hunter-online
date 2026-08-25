import type {
	CardColor,
	CardData,
	GridCoord,
	TileType,
} from "@relic-hunter/shared";
import type { ButtonAction, RowKey } from "@/ui/buttons/ActionMenu";
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
	| { type: "cardCollected" }
	| { type: "skipChosen" }
	| { type: "cardChosen" }
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
	prompt: string;
	isMet: (event: TutorialEvent) => boolean;
}

/**
 * A screen-space UI element a tutorial segment can point a bobbing
 * arrow at — distinct from targetTile (a fixed map coordinate), since
 * these positions can move frame to frame (a hand card shifting as it
 * splays, an ActionMenu submenu toggling). Each variant maps to one
 * small query method already added to the relevant component. `side`
 * is required, not defaulted — the right side genuinely depends on
 * context (skipButton needs "down" so it doesn't collide with
 * PlayZone above it; actionButton needs "left" so it doesn't collide
 * with neighboring stacked rows), not something safe to guess per-kind.
 */
export type TutorialUiPointerTarget = (
	| { kind: "actionButton"; key: RowKey }
	| { kind: "handCard"; cardId?: string }
	| { kind: "playZone" }
	| { kind: "skipButton" }
	| { kind: "cardDrawStack" }
) & { side: "up" | "down" | "left" | "right" };

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
	/** If set, MapScene highlights this tile (glow + bobbing arrow) for as long as this segment's objective is active. */
	targetTile?: GridCoord;
	/** If set, a bobbing arrow points at this UI element for as long as this segment's objective is active — tracked live every frame. */
	uiPointer?: TutorialUiPointerTarget;
	/**
	 * Coordinates that count as a genuine wrong choice, not just "not
	 * there yet" — e.g. walking toward the decorative enemy prop. If a
	 * "moved" event's finalCoord lands on one of these, the segment
	 * doesn't just keep waiting: it plays failLine, resets the player
	 * back to where they stood before this attempt, and re-arms the
	 * same objective for another try.
	 */
	failZones?: GridCoord[];
	/** Shown (with whatever portrait the line specifies — typically the disappointed one) when a failZone is hit. */
	failLine?: DialogueLine[];
	objective: TutorialObjective | null;
	confirm: DialogueLine[];
}

/** A tutorial's own small, purpose-built map — deliberately tiny and seeded for reproducibility, not the real game's procedural sizing. */
export interface DebugMapSpec {
	width: number;
	height: number;
	seed: number;
	roomCount?: number;
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
	/** Overrides the test character's base movement stat for this tutorial specifically — doesn't touch the real game's spawn defaults. */
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
