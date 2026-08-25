import { linesFor } from "@/tutorial/dialogue";
import type { TutorialScript } from "@/tutorial/tutorialTypes";
import {
	buildCustomShapeOverrides,
	tShapeWalkableTiles,
} from "@/math/mapShapes";
import type { GridCoord } from "@relic-hunter/shared";

const KESSLER_COORD = { x: 18, y: 0 };
const EDGE_TARGET = { x: 5, y: 0 };
const MID_TARGET = { x: 13, y: 0 };
const NEAR_KESSLER_TARGET = { x: 17, y: 0 };
const CARD_ID = "tutorial_move_plus3";

/**
 * Lower stem, near the decorative enemy prop — not the prop's exact
 * tile (that's already unwalkable via the static-actor blocking fix),
 * but the area around it. Wandering down here mid-attempt counts as a
 * genuine wrong choice, not just "hasn't reached the target yet".
 */
const STEM_DANGER_ZONE: GridCoord[] = (() => {
	const tiles: GridCoord[] = [];
	for (let x = 7; x <= 11; x++) {
		for (let y = 5; y <= 8; y++) {
			tiles.push({ x, y });
		}
	}
	return tiles;
})();

/** "Press Move"/"Press End Turn" beat — action menu sits at the screen's right edge, so the pointer sits to its left. */
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

/** The "tap No Card" beat, split from the actual move that follows it. */
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
 * First real tutorial script — Movement. Kessler's own real portrait
 * set now drives expression: kessler-neutral for instructional lines,
 * kessler-approve on a genuine success confirm, kessler-disappoint
 * when the player wanders into the stem's danger zone instead of
 * toward the actual objective — which also resets them back to where
 * this specific attempt started and re-arms the same objective.
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
				"kessler-neutral",
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
				"kessler-neutral",
				"Now get moving toward that edge up ahead. That's your base range, no card spent.",
			),
			targetTile: EDGE_TARGET,
			failZones: STEM_DANGER_ZONE,
			failLine: linesFor(
				"Kessler",
				"kessler-disappoint",
				"Not that way. Whatever's down there, you don't want its attention yet.",
				"Look, let's try that again.",
			),
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
				"kessler-approve",
				"Not bad. That's the easy part done.",
			),
		},
		openActionSegment("end-turn", "endTurn"),
		{
			id: "end-turn-confirm",
			intro: [],
			objective: null,
			confirm: linesFor("Kessler", "kessler-neutral", "Good. Fresh turn."),
		},
		{
			id: "give-card",
			intro: linesFor(
				"Kessler",
				"kessler-neutral",
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
			id: "do-card-move",
			intro: linesFor(
				"Kessler",
				"kessler-neutral",
				"Play that card by dragging it into the zone there, then get moving.",
			),
			targetTile: MID_TARGET,
			uiPointer: { kind: "playZone", side: "up" },
			failZones: STEM_DANGER_ZONE,
			failLine: linesFor(
				"Kessler",
				"kessler-disappoint",
				"You're drifting toward the stem again. Stay on course.",
				"Look, let's try that again.",
			),
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
				"kessler-approve",
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
				"kessler-neutral",
				"Rest of the way's on your own two feet. Drag it into the zone there, then send it across. Come on.",
			),
			targetTile: NEAR_KESSLER_TARGET,
			uiPointer: { kind: "playZone", side: "up" },
			failZones: STEM_DANGER_ZONE,
			failLine: linesFor(
				"Kessler",
				"kessler-disappoint",
				"Not toward me, toward the stem? Come on, focus.",
				"Look, let's try that again.",
			),
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
				"kessler-approve",
				"There it is. Right on the mark.",
				"Good job rookie",
			),
		},
		{
			id: "outro",
			intro: linesFor(
				"Kessler",
				"kessler-approve",
				"Congratulations. You now know how to move.",
				"Everything else you'll learn out here builds on exactly that. Go on.",
				"Maybe there's hope for you yet... thank god I didn't need to bring out the yellow paint.",
			),
			objective: null,
			confirm: [],
		},
	],
};
