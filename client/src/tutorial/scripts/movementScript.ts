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
 * but the area around it. A specific, authored failLine for wandering
 * here — everywhere else wrong on a move-gated segment now fails too
 * (via TutorialRunner's own default gating), just with a generic
 * retry nudge instead of this specific one.
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
 * set drives expression: kessler-neutral for instructional lines,
 * kessler-approve on a genuine success confirm, kessler-disappoint on
 * a failed attempt. Every move segment (targetTile set) is strict —
 * any wrong landing fails via TutorialRunner's own default gating,
 * not just the stem's explicitly-marked danger zone. Kessler is
 * "right"-side throughout this script.
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
				"right",
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
				"right",
				"Now get moving toward that edge up ahead. That's your base range, no card spent.",
			),
			targetTile: EDGE_TARGET,
			failZones: STEM_DANGER_ZONE,
			failLine: linesFor(
				"Kessler",
				"kessler-disappoint",
				"right",
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
				"right",
				"Not bad. That's the easy part done.",
			),
		},
		openActionSegment("end-turn", "endTurn"),
		{
			id: "end-turn-confirm",
			intro: [],
			objective: null,
			confirm: linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
				"Good. Fresh turn.",
			),
		},
		{
			id: "give-card",
			intro: linesFor(
				"Kessler",
				"kessler-neutral",
				"right",
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
				"right",
				"Play that card by dragging it into the zone there, then get moving.",
			),
			targetTile: MID_TARGET,
			uiPointer: { kind: "playZone", side: "up" },
			failZones: STEM_DANGER_ZONE,
			failLine: linesFor(
				"Kessler",
				"kessler-disappoint",
				"right",
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
				"right",
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
				"right",
				"Rest of the way's on your own two feet. Drag it into the zone there, then send it across. Come on.",
			),
			targetTile: NEAR_KESSLER_TARGET,
			uiPointer: { kind: "playZone", side: "up" },
			failZones: STEM_DANGER_ZONE,
			failLine: linesFor(
				"Kessler",
				"kessler-disappoint",
				"right",
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
				"right",
				"There it is. Right on the mark.",
				"Good job rookie",
			),
		},
		{
			id: "outro",
			intro: linesFor(
				"Kessler",
				"kessler-approve",
				"right",
				"Congratulations. You now know how to move.",
				"Everything else you'll learn out here builds on exactly that. Go on.",
				"Maybe there's hope for you yet... thank god I didn't need to bring out the yellow paint.",
			),
			objective: null,
			confirm: [],
		},
	],
};
