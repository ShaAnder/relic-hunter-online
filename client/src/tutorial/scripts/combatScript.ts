import { linesFor } from "@/tutorial/dialogue";
import type { TutorialScript } from "@/tutorial/tutorialTypes";

const PLAYER_SPAWN = { x: 1, y: 1 };
const KESSLER_START = { x: 10, y: 6 };
const KESSLER_APPROACH = { x: 3, y: 2 };
const MONSTER_COORD = { x: 2, y: 2 };

const RED_CARD_ID = "tutorial_attack_card";
const YELLOW_CARD_ID = "tutorial_defense_card";

/** "Press Move"/"Press End Turn" beat — same helper Movement uses, action menu sits at the screen's right edge. */
function openActionSegment(id: string, key: "move" | "endTurn") {
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
			prompt: key === "move" ? "Press Move" : "Press End Turn",
			isMet: (event: { type: string }) =>
				event.type === (key === "move" ? "actionMenuOpened" : "turnEnded"),
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

/** Hands over one card, waits for it to actually be collected from the draw stack before continuing — same pattern Movement's card handoff used. */
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
 * Second real tutorial script — Combat. Player spawns in a corner of a
 * small contained room; Kessler crosses the map to join them. A real,
 * killable monster (spawned via MapScene.spawnTutorialMonster, not the
 * normal random pool) forces a surprise attack the moment the player
 * tries to move — genuine combat, capped to one round via
 * BattleOverlay's maxRounds parameter, so Kessler can walk through
 * what happened before the player's next move. Two more guided,
 * single-round beats follow (an attack card, then a defense card,
 * each handed over on its own so there's no other choice available),
 * before a real, multi-round fight against the same monster with a
 * full hand — the actual finale, player-initiated, real stakes.
 */
export const COMBAT_SCRIPT: TutorialScript = {
	id: "combat",
	title: "Combat",
	debugMap: {
		width: 12,
		height: 8,
		seed: 7,
	},
	playerMovement: 4,
	tutorialMonster: { coord: MONSTER_COORD, tier: "light" },
	staticActors: [{ coord: KESSLER_START, label: "Kessler", color: 0x4a9eff }],
	segments: [
		{
			id: "intro",
			intro: linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
				"Right. New lesson. This time you're not out here alone.",
				"Give me a second, I'm coming to you.",
			),
			objective: null,
			confirm: [],
		},
		{
			id: "kessler-approaches",
			intro: [],
			moveActor: {
				label: "Kessler",
				destination: KESSLER_APPROACH,
				durationMs: 1100,
			},
			objective: null,
			confirm: [],
		},
		openActionSegment("open-move-1", "move"),
		chooseSkipSegment("choose-skip-1"),
		{
			id: "do-first-move",
			intro: linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
				"Go on, get moving. Anywhere's fine.",
			),
			objective: {
				id: "move-any",
				prompt: "Move anywhere",
				isMet: (event) => event.type === "moved" && event.tilesMoved >= 1,
			},
			confirm: [],
		},
		{
			id: "surprise-attack",
			intro: linesFor("Kessler", "kessler-disappoint", "right", "Behind you—!"),
			triggerCombat: { maxRounds: 1 },
			objective: null,
			confirm: linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
				"Okay. Okay — calm down, we can get through this.",
				"Let me actually show you how this works instead of just yelling.",
			),
		},
		{
			id: "explain-combat-cards",
			intro: linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
				"Every card in your hand means something different once a fight starts.",
				"Red cards add straight to your attack. Yellow cards add to your defense — they soak up damage instead of dealing it.",
				"Run and you'll take a free hit on the way out. Surrender and it's over — you lose whatever you're carrying, but you walk away alive.",
				"Let's actually do it. One at a time.",
			),
			objective: null,
			confirm: [],
		},
		giveAndCollectCard(
			"give-red-card",
			{ id: RED_CARD_ID, color: "red", name: "Attack +3", value: 3 },
			linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
				"Here. This is an attack card. Adds straight to your attack roll.",
			),
		),
		{
			id: "attack-round",
			intro: linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
				"It's coming for you again. Play that card when you get the choice.",
			),
			triggerCombat: { maxRounds: 1 },
			objective: null,
			confirm: linesFor(
				"Kessler",
				"kessler-approve",
				"right",
				"There it is. That's what red does for you.",
			),
		},
		giveAndCollectCard(
			"give-yellow-card",
			{ id: YELLOW_CARD_ID, color: "yellow", name: "Defense +2", value: 2 },
			linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
				"This one's yellow. Defense. Play it when surviving matters more than hitting back.",
			),
		),
		{
			id: "defense-round",
			intro: linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
				"Here it comes again. Play the yellow this time.",
			),
			triggerCombat: { maxRounds: 1 },
			objective: null,
			confirm: linesFor(
				"Kessler",
				"kessler-approve",
				"right",
				"Good. That's the other half of it.",
				"There's fancier versions of both those cards too — we'll get to those another time.",
			),
		},
		{
			id: "finale-setup",
			intro: linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
				"Alright. Enough hand-holding.",
				"Here's a real hand. Go finish it.",
			),
			clearHandFirst: true,
			giveCards: [
				{
					id: "tutorial_finale_red_1",
					color: "red",
					name: "Attack +4",
					value: 4,
					description: "+Attack",
					actionType: "attack",
				},
				{
					id: "tutorial_finale_red_2",
					color: "red",
					name: "Attack +2",
					value: 2,
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
			],
			objective: null,
			confirm: [],
		},
		{
			id: "finale-kill",
			intro: linesFor(
				"Kessler",
				"kessler-approve",
				"right",
				"Have at it, kid. Finish this thing.",
			),
			uiPointer: { kind: "actionButton", key: "actions", side: "left" },
			objective: {
				id: "kill-monster",
				prompt: "Attack the monster",
				isMet: (event) => event.type === "combatEnded" && event.won,
			},
			confirm: linesFor(
				"Kessler",
				"kessler-approve",
				"right",
				"That's it. That's combat.",
				"You now know how to fight, how to defend, and when to just leave. That's most of the job right there.",
			),
		},
	],
};
