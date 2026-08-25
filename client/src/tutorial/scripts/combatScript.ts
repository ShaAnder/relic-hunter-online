import { linesFor } from "@/tutorial/dialogue";
import type { TutorialScript } from "@/tutorial/tutorialTypes";

const PLAYER_SPAWN = { x: 1, y: 1 };
const KESSLER_SPAWN = { x: 2, y: 1 };
const KESSLER_FORWARD = { x: 4, y: 1 };

const YELLOW_CARD_ID = "tutorial_defense_card";

/** "Press Move"/"Press End Turn" beat — same helper Movement uses. */
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
 * Second real tutorial script — Combat. Kessler spawns right next to
 * the player and moves forward first — "follow me" — the player
 * matches. The monster doesn't exist until right after that move: it
 * spawns exactly where the player WAS standing (via spawnMonster's
 * "behindPlayer" resolution, not a fixed coord — the player's actual
 * destination isn't known in advance), then dashes to a tile adjacent
 * to wherever they ended up, then attacks. Three real combat beats:
 * an ungated surprise attack, one guided round with a locked Defend
 * action, then a real, player-driven finale with a full hand.
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
		openActionSegment("open-move-1", "move"),
		chooseSkipSegment("choose-skip-1"),
		{
			id: "do-follow-move",
			intro: linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
				"Come on, catch up.",
			),
			objective: {
				id: "move-any",
				prompt: "Move forward",
				isMet: (event) => event.type === "moved" && event.tilesMoved >= 1,
			},
			confirm: [],
		},
		{
			id: "monster-appears",
			intro: [],
			spawnMonster: { coord: "behindPlayer", tier: "light" },
			dashMonster: true,
			objective: null,
			confirm: [],
		},
		{
			id: "surprise-attack",
			intro: [],
			triggerCombat: { maxRounds: 1 },
			objective: null,
			confirm: linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
				"Don't panic. Don't panic — we can get through this.",
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
				"Good. That's what yellow does for you.",
			),
		},
		{
			id: "finale-setup",
			intro: linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
				"Okay. We've got this.",
				"Take these.",
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
				{
					id: "tutorial_finale_yellow_2",
					color: "yellow",
					name: "Defense +1",
					value: 1,
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
				"Quick. Take him down.",
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
