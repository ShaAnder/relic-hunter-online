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

/**
 * First real tutorial script — Movement. T-shaped map: player and
 * Kessler stand at opposite ends of the horizontal head (now long
 * enough that even a card-boosted move can't cover it in one go), the
 * decorative enemy prop sits at the bottom of a wide vertical stem.
 * Three real, separately-gated movements: base move to the edge, a
 * card-boosted move to a midpoint, a fresh-turn base move the rest of
 * the way to Kessler's side — each checked by exact landing tile, not
 * just "moved some amount".
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
				"So let's start with the basics. Movemen.",
				"To begin... drag out from yourself onto the map to plot a path, then let go to lock it in. Simple as that.",
			),
			objective: null,
			confirm: [],
		},
		{
			id: "base-move",
			intro: linesFor(
				"Kessler",
				"narrator",
				'Press Move, open your hand — you\'ll see "No Card" sitting in there.',
				"Tap it, then get moving toward that edge up ahead. That's your base range, no card spent.",
			),
			targetTile: EDGE_TARGET,
			objective: {
				id: "move-without-card",
				prompt: "Move → No Card → land on the glowing tile",
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
		{
			id: "end-turn",
			intro: linesFor(
				"Kessler",
				"narrator",
				"You've spent this turn's legs already. End it - you'll get a fresh set of AP and a new hand to work with.",
			),
			objective: {
				id: "end-turn",
				prompt: "End your turn",
				isMet: (event) => event.type === "turnEnded",
			},
			confirm: linesFor("Kessler", "narrator", "Good. Fresh turn."),
		},
		{
			id: "card-move",
			intro: linesFor(
				"Kessler",
				"narrator",
				"Now here's the actual problem.",
				"Whatever's down that stem is watching. Wide open ground between us - you're not walking that on your own two legs, not in one turn.",
				"Here, take this.",
			),
			giveCard: {
				id: "tutorial_move_plus3",
				color: "blue",
				name: "Move +3",
				value: 3,
				description: "+3 Movement",
				actionType: "move",
			},
			targetTile: MID_TARGET,
			objective: {
				id: "move-midpoint",
				prompt: "Move → play the blue card → land on the glowing tile",
				isMet: (event) =>
					event.type === "moved" &&
					event.usedCard === true &&
					event.finalCoord.x === MID_TARGET.x &&
					event.finalCoord.y === MID_TARGET.y,
			},
			confirm: linesFor(
				"Kessler",
				"narrator",
				"Good job. Now get over here - you're not there yet.",
			),
		},
		{
			id: "end-turn-2",
			intro: linesFor(
				"Kessler",
				"narrator",
				"Same as before - end your turn, get your legs back.",
			),
			objective: {
				id: "end-turn-2",
				prompt: "End your turn",
				isMet: (event) => event.type === "turnEnded",
			},
			confirm: [],
		},
		{
			id: "final-move",
			intro: linesFor(
				"Kessler",
				"narrator",
				"Rest of the way's on your own two feet. Come on.",
			),
			targetTile: NEAR_KESSLER_TARGET,
			objective: {
				id: "move-to-kessler",
				prompt: "Move → No Card → land on the glowing tile",
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
