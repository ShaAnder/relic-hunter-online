import type {
	CardColor,
	CardData,
	GridCoord,
	MonsterTier,
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
 * these positions can move frame to frame. `side` is required — the
 * right side genuinely depends on context (skipButton needs "down" so
 * it doesn't collide with PlayZone above it; actionButton needs "left"
 * so it doesn't collide with neighboring stacked rows).
 */
export type TutorialUiPointerTarget = (
	| { kind: "actionButton"; key: RowKey }
	| { kind: "handCard"; cardId?: string }
	| { kind: "playZone" }
	| { kind: "skipButton" }
	| { kind: "cardDrawStack" }
) & { side: "up" | "down" | "left" | "right" };

/**
 * Live counters TutorialRunner maintains as a script actually plays
 * out — the "variables" a script can react to. Deliberately just two
 * generic counters for now (a running total, and a per-segment
 * breakdown) rather than a large bespoke state object per script;
 * add fields here only once a real script needs something these two
 * genuinely can't express.
 */
export interface TutorialState {
	/** How many times ANY segment in this script has failed so far. */
	totalFailures: number;
	/** Per-segment failure counts, keyed by segment id. */
	failuresBySegment: Record<string, number>;
}

/**
 * Anywhere a script provides dialogue lines, it can give either a
 * plain static array (the common case) or a function that receives
 * the live TutorialState and returns the lines to show — the actual
 * "variable injection" mechanism. E.g. an outro segment can check
 * state.totalFailures and return a different closing line for a
 * player who struggled versus one who didn't.
 */
export type DialogueSource =
	| DialogueLine[]
	| ((state: TutorialState) => DialogueLine[]);

/**
 * One beat of a tutorial: narrator sets up the moment, player does the
 * thing (or, if objective is null, nothing is required and the runner
 * auto-advances after intro), narrator confirms, then the next
 * segment begins.
 */
export interface TutorialSegment {
	id: string;
	intro: DialogueSource;
	/** If set, handed to the player's hand (via MapScene.giveCard) right after intro plays, before the objective becomes active. Only fires once, before the first attempt — see retryCard for the failed-attempt case. */
	giveCard?: CardData;
	/** Like giveCard, but for handing over several cards at once (e.g. "here's a full hand, go finish it") rather than guiding toward one specific card. */
	giveCards?: CardData[];
	/** If set alongside giveCard, MapScene.clearLocalHand runs first — guarantees giveCard's card is the ONLY one in hand, not appended to whatever was already there from earlier in the script. */
	clearHandFirst?: boolean;
	/** If set, MapScene highlights this tile (glow + bobbing arrow) for as long as this segment's objective is active. */
	targetTile?: GridCoord;
	/** If set, a bobbing arrow points at this UI element for as long as this segment's objective is active — tracked live every frame. */
	uiPointer?: TutorialUiPointerTarget;
	/**
	 * Coordinates that count as a genuine wrong choice, not just "not
	 * there yet". If a "moved" event's finalCoord lands on one of
	 * these, the segment doesn't just keep waiting: it plays failLine,
	 * resets the player back to where they stood before this attempt,
	 * and re-arms the same objective for another try.
	 */
	failZones?: GridCoord[];
	/** Shown when a failure occurs. Falls back to a generic retry nudge if this segment doesn't author its own. */
	failLine?: DialogueSource;
	/**
	 * Re-given on every failed retry of THIS segment specifically —
	 * distinct from giveCard, which only fires once. Needed whenever
	 * the segment's own objective requires a card that was already
	 * consumed attempting the move — playing a card removes it from
	 * the hand the moment it's played, whether the resulting move was
	 * the right one or not.
	 */
	retryCard?: CardData;
	/**
	 * If set, TutorialRunner awaits MapScene.moveStaticActor directly
	 * for this segment instead of waiting on a player-driven objective
	 * — a scripted visual beat (e.g. Kessler walking across the map),
	 * not something the player does anything to trigger.
	 */
	moveActor?: { label: string; destination: GridCoord; durationMs?: number };
	/**
	 * If set, TutorialRunner awaits MapScene.triggerTutorialMonsterAttack
	 * directly for this segment — a forced combat beat MapScene itself
	 * initiates on cue, not something gated on a player-fired event.
	 * Distinct from a normal objective for the same reason moveActor
	 * is: nothing here is "wait for the player to do X", it's "make
	 * this scripted thing happen, then continue".
	 */
	triggerCombat?: { maxRounds: number };
	objective: TutorialObjective | null;
	confirm: DialogueSource;
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
	/** A single, controlled, genuinely killable monster spawned at match start via MapScene.spawnTutorialMonster — not the normal random-position pool. */
	tutorialMonster?: { coord: GridCoord; tier: MonsterTier };
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
