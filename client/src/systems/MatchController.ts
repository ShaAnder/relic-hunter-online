import * as RH from "@relic-hunter/shared";
import type { Game } from "@/core/game/Game";
import type { HunterScoreEntry } from "@/core/game/GameSession";
import { MatchResultScene } from "@/scenes/MatchResultScene";

/** Whether the given items array holds this match's target item — pure, no unit/session coupling. */
export function isCarryingTarget(
	items: (RH.ItemData | null)[],
	targetItemId: string | undefined,
): boolean {
	if (!targetItemId) return false;
	return items.some((item) => item?.id === targetItemId);
}

/**
 * Records a match result and transitions to MatchResultScene. Feedback
 * strings (e.g. "escaped with the relic!") stay with the caller —
 * this only ever decides the result and the scene change, both of
 * which genuinely need `game`.
 * @author ShaAnder
 */
export class MatchController {
	constructor(private game: Game) {}

	triggerWin(
		turnsTaken: number,
		itemsExtracted: number,
		hunterScores: HunterScoreEntry[],
	): void {
		this.game.session.matchResult = {
			won: true,
			turnsTaken,
			itemsExtracted,
			hunterScores,
		};
		void this.game.sceneManager.changeScene(new MatchResultScene(this.game));
	}

	triggerLoss(turnsTaken: number, hunterScores: HunterScoreEntry[]): void {
		this.game.session.matchResult = {
			won: false,
			turnsTaken,
			itemsExtracted: 0,
			hunterScores,
		};
		void this.game.sceneManager.changeScene(new MatchResultScene(this.game));
	}
}
