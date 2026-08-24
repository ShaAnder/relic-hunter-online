import { linesFor } from "@/tutorial/dialogue";
import type { TutorialScript } from "@/tutorial/tutorialTypes";
import {
	buildCustomShapeOverrides,
	tShapeWalkableTiles,
} from "@/math/mapShapes";

const KESSLER_COORD = { x: 18, y: 0 };
const EDGE_TARGET = { x: 5, y: 0 };
const MID_TARGET = { x: 13, y: 0 };
const NEAR_KESSLER_TARGET = { x: 17, y: 0 };
const CARD_ID = "tutorial_move_plus3";

/** "Press Move"/"Press End Turn" beat — action menu sits at the screen's right edge, so the pointer sits to its left, never above/below where it'd collide with a neighboring stacked row. */
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

/** The "tap No Card" beat, split from the actual move that follows it — the pointer's job is done the instant skip is chosen, not once the whole move lands. */
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

/**
 * First real tutorial script — Movement. T-shaped map: player and
 * Kessler stand at opposite ends of the horizontal head, the
 * decorative enemy prop sits at the bottom of a wide vertical stem.
 * Every "make a choice" pointer (press Move, press End Turn, tap No
 * Card, pick the card) is its own tiny gated segment, separate from
 * the actual move that follows — the pointer disappears the instant
 * that specific choice is made, not once the whole move completes.
 * Only PlayZone's pointer stays up through the full drag, since it's
 * an ongoing destination reference, not a discrete tap.
 */
export const MOVEMENT_SCRIPT: TutorialScript = {
	id: "movement",
	title: "Movement",
	debugMap: {
		width: 20,
		height: 9,
		seed: 42,
		tileOverrides: buildCustomShapeOverrides(
			20,
			9,
			tShapeWalkableTiles(20, 9, 2, 6, 7),
		),
	},
	playerMovement: 5,
	staticActors: [
		{ coord: KESSLER_COORD, label: "Kessler", color: 0x4a9eff },
		{ coord: { x: 9, y: 8 }, label: "???", color: 0x8b0000 },
	],
	segments: [
		{
			id: "intro",
			intro: linesFor(
				"Kessler",
				"narrator",
				"Oi. You. Fresh meat.",
				"Everyone who wants to eat regular in this line of work learns the same first lesson: how to actually move your feet.",
				"So let's start with the basics. Movement.",
				"Press Move, down there.",
			),
			objective: null,
			confirm: [],
		},
		openActionSegment("open-move-1", "move"),
		chooseSkipSegment("choose-skip-1"),
		{
			id: "do-base-move",
			intro: linesFor(
				"Kessler",
				"narrator",
				"Now get moving toward that edge up ahead. That's your base range, no card spent.",
			),
			targetTile: EDGE_TARGET,
			objective: {
				id: "move-without-card",
				prompt: "Land on the glowing tile",
				isMet: (event) =>
					event.type === "moved" &&
					!event.usedCard &&
					event.finalCoord.x === EDGE_TARGET.x &&
					event.finalCoord.y === EDGE_TARGET.y,
			},
			confirm: linesFor(
				"Kessler",
				"narrator",
				"Not bad. That's the easy part done.",
			),
		},
		openActionSegment("end-turn", "endTurn"),
		{
			id: "end-turn-confirm",
			intro: [],
			objective: null,
			confirm: linesFor("Kessler", "narrator", "Good. Fresh turn."),
		},

		{
			id: "give-card",
			intro: linesFor(
				"Kessler",
				"narrator",
				"Now here's the actual problem.",
				"Whatever's down that stem is watching. Wide open ground between us — you're not walking that on your own two legs, not in one turn.",
				"Here, take this.",
			),
			giveCard: {
				id: CARD_ID,
				color: "blue",
				name: "Move +3",
				value: 3,
				description: "+3 Movement",
				actionType: "move",
			},
			uiPointer: { kind: "cardDrawStack", side: "up" },
			objective: {
				id: "collect-card",
				prompt: "Tap the card to collect it",
				isMet: (event) => event.type === "cardCollected",
			},
			confirm: [],
		},
		openActionSegment("open-move-3", "move"),
		{
			id: "choose-card",
			intro: linesFor("Kessler", "narrator", "Play that card."),
			uiPointer: { kind: "handCard", cardId: CARD_ID, side: "up" },
			objective: {
				id: "choose-card-objective",
				prompt: "Play the blue card",
				isMet: (event) => event.type === "cardChosen",
			},
			confirm: [],
		},
		{
			id: "do-card-move",
			intro: linesFor("Kessler", "narrator", "Now get moving."),
			targetTile: MID_TARGET,
			objective: {
				id: "move-midpoint",
				prompt: "Land on the glowing tile",
				isMet: (event) =>
					event.type === "moved" &&
					event.usedCard === true &&
					event.finalCoord.x === MID_TARGET.x &&
					event.finalCoord.y === MID_TARGET.y,
			},
			confirm: linesFor(
				"Kessler",
				"narrator",
				"Good job. Now get over here — you're not there yet.",
			),
		},
		openActionSegment("end-turn-2", "endTurn"),
		{
			id: "end-turn-2-confirm",
			intro: [],
			objective: null,
			confirm: [],
		},
		openActionSegment("open-move-4", "move"),
		chooseSkipSegment("choose-skip-2"),
		{
			id: "final-move",
			intro: linesFor(
				"Kessler",
				"narrator",
				"Rest of the way's on your own two feet. Drag it into the zone there, then send it across. Come on.",
			),
			targetTile: NEAR_KESSLER_TARGET,
			uiPointer: { kind: "playZone", side: "up" },
			objective: {
				id: "move-to-kessler",
				prompt: "Land on the glowing tile",
				isMet: (event) =>
					event.type === "moved" &&
					event.finalCoord.x === NEAR_KESSLER_TARGET.x &&
					event.finalCoord.y === NEAR_KESSLER_TARGET.y,
			},
			confirm: linesFor(
				"Kessler",
				"narrator",
				"There it is. Right on the mark.",
				"Good job rookie",
			),
		},
		{
			id: "outro",
			intro: linesFor(
				"Kessler",
				"narrator",
				"Congratulations. You now know how to move.",
				"Everything else you'll learn out here builds on exactly that. Go on.",
				"Maybe there's hope for you yet... thank god I didn't need to bring out the yellow paint.",
			),
			objective: null,
			confirm: [],
		},
	],
};
