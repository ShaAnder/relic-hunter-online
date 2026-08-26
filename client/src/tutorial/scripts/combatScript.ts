import { linesFor } from "@/tutorial/dialogue";
import type { TutorialScript } from "@/tutorial/tutorialTypes";
import type { GridCoord } from "@relic-hunter/shared";

const PLAYER_SPAWN = { x: 1, y: 1 };
const KESSLER_SPAWN = { x: 2, y: 1 };
const KESSLER_FORWARD = { x: 4, y: 1 };

const YELLOW_CARD_ID = "tutorial_defense_card";

/** Anything behind where the player started counts as "went the wrong way" instead of following Kessler forward. */
const BEHIND_START: GridCoord[] = (() => {
	const tiles: GridCoord[] = [];
	for (let y = 0; y < 8; y++) tiles.push({ x: 0, y });
	return tiles;
})();

/** A single "press this ActionMenu button/row" beat, gated on a real event. */
function pressButtonSegment(
	id: string,
	key: "move" | "endTurn" | "actions" | "attack",
	eventType: string,
) {
	return {
		id,
		intro: [],
		uiPointer: {
			kind: "actionButton" as const,
			key,
			side: "left" as const,
		},
		objective: {
			id: `${id}-objective`,
			prompt: `Press ${key}`,
			isMet: (event: { type: string }) => event.type === eventType,
		},
		confirm: [],
	};
}

/** "Tap No Card" — same helper Movement uses. */
function chooseSkipSegment(id: string) {
	return {
		id,
		intro: [],
		uiPointer: { kind: "skipButton" as const, side: "down" as const },
		objective: {
			id: `${id}-objective`,
			prompt: "Tap No Card",
			isMet: (event: { type: string }) => event.type === "skipChosen",
		},
		confirm: [],
	};
}

/** Hands over one card, waits for it to actually be collected before continuing. */
function giveAndCollectCard(
	id: string,
	card: { id: string; color: "red" | "yellow"; name: string; value: number },
	intro: ReturnType<typeof linesFor>,
) {
	return {
		id,
		intro,
		clearHandFirst: true,
		giveCard: {
			...card,
			description: card.color === "red" ? "+Attack" : "+Defense",
			actionType: (card.color === "red" ? "attack" : "defense") as
				| "attack"
				| "defense",
		},
		uiPointer: { kind: "cardDrawStack" as const, side: "up" as const },
		objective: {
			id: `${id}-objective`,
			prompt: "Tap the card to collect it",
			isMet: (event: { type: string }) => event.type === "cardCollected",
		},
		confirm: [],
	};
}

/**
 * Second real tutorial script — Combat. Kessler spawns next to the
 * player and moves forward first; the player follows. The monster
 * spawns exactly where the player was standing (a live "behindPlayer"
 * resolution, not a guessed fixed coord) and dashes to a tile
 * adjacent to wherever they actually ended up. Three real combat
 * beats: an ungated surprise attack, one guided round with a locked
 * Defend action, then a real, fully-gated, player-driven finale
 * (open Actions → press Attack → select the target → fight) with a
 * full, genuinely strong hand built to comfortably finish a 12-HP
 * monster inside the 3-round cap.
 */
export const COMBAT_SCRIPT: TutorialScript = {
	id: "combat",
	title: "Combat",
	debugMap: {
		width: 12,
		height: 8,
		seed: 7,
		tileOverrides: [],
	},
	playerMovement: 4,
	playerSpawn: PLAYER_SPAWN,
	staticActors: [{ coord: KESSLER_SPAWN, label: "Kessler", color: 0x4a9eff }],
	segments: [
		{
			id: "intro",
			intro: linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
				"Right. New lesson. This time you're not out here alone — I'm right beside you.",
				"Follow me.",
			),
			objective: null,
			confirm: [],
		},
		{
			id: "kessler-forward",
			intro: [],
			moveActor: {
				label: "Kessler",
				destination: KESSLER_FORWARD,
				durationMs: 900,
			},
			objective: null,
			confirm: [],
		},
		pressButtonSegment("open-move-1", "move", "actionMenuOpened"),
		chooseSkipSegment("choose-skip-1"),
		{
			id: "do-follow-move",
			intro: linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
				"Come on, catch up. This way.",
			),
			failZones: BEHIND_START,
			failLine: linesFor(
				"Kessler",
				"kessler-disappoint",
				"right",
				"Wrong way. I said follow me, not wander off.",
			),
			objective: {
				id: "move-any",
				prompt: "Move forward",
				isMet: (event) => event.type === "moved" && event.tilesMoved >= 1,
			},
			confirm: [],
		},
		{
			id: "watch-out",
			intro: linesFor("Kessler", "kessler-disappoint", "right", "Watch out!"),
			spawnMonster: { coord: "behindPlayer", tier: "light" },
			dashMonster: true,
			objective: null,
			confirm: [],
		},
		{
			id: "surprise-attack",
			intro: linesFor(
				"Kessler",
				"kessler-disappoint",
				"right",
				"Fight back or take the hit — go!",
			),
			triggerCombat: { maxRounds: 1 },
			objective: null,
			confirm: linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
				"Don't panic — we can get through this.",
			),
		},
		{
			id: "explain-combat-cards",
			intro: linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
				"Red cards add to your attack. Yellow cards add to your defense.",
				"Run costs you a free hit on the way out. Surrender ends it — you lose what you're carrying, but you walk away.",
			),
			objective: null,
			confirm: [],
		},
		giveAndCollectCard(
			"give-yellow-card",
			{ id: YELLOW_CARD_ID, color: "yellow", name: "Defense +2", value: 2 },
			linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
				"It's coming again. Take this and defend yourself.",
			),
		),
		{
			id: "defense-round",
			intro: [],
			triggerCombat: { maxRounds: 1, availableActions: ["defend"] },
			objective: null,
			confirm: linesFor(
				"Kessler",
				"kessler-approve",
				"right",
				"That's what defense does for you.",
				"But there's no time for banter — take it down.",
			),
		},
		{
			id: "finale-setup",
			intro: [],
			clearHandFirst: true,
			giveCards: [
				{
					id: "tutorial_finale_red_1",
					color: "red",
					name: "Attack +6",
					value: 6,
					description: "+Attack",
					actionType: "attack",
				},
				{
					id: "tutorial_finale_red_2",
					color: "red",
					name: "Attack +5",
					value: 5,
					description: "+Attack",
					actionType: "attack",
				},
				{
					id: "tutorial_finale_yellow_1",
					color: "yellow",
					name: "Defense +3",
					value: 3,
					description: "+Defense",
					actionType: "defense",
				},
				{
					id: "tutorial_finale_yellow_2",
					color: "yellow",
					name: "Defense +2",
					value: 2,
					description: "+Defense",
					actionType: "defense",
				},
			],
			objective: null,
			confirm: [],
		},
		pressButtonSegment(
			"finale-open-actions",
			"actions",
			"actionsSubmenuOpened",
		),
		pressButtonSegment(
			"finale-press-attack",
			"attack",
			"attackTargetingEntered",
		),
		{
			id: "finale-select-target",
			intro: linesFor(
				"Kessler",
				"kessler-approve",
				"right",
				"Quick. Take him down.",
			),
			pointAtMonster: true,
			objective: {
				id: "combat-started",
				prompt: "Tap the monster",
				isMet: (event) => event.type === "combatStarted",
			},
			confirm: [],
		},
		{
			id: "finale-kill",
			intro: [],
			objective: {
				id: "kill-monster",
				prompt: "Finish the fight",
				isMet: (event) => event.type === "combatEnded" && event.won,
			},
			confirm: linesFor(
				"Kessler",
				"kessler-approve",
				"right",
				"That's it. Down for good.",
				"That's combat — attack, defend, and know when to just walk away. Most of the job is exactly that.",
				"You did good today. Go on, get some rest.",
			),
		},
	],
};
