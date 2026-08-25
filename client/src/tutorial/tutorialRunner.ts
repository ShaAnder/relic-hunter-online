import type { Game } from "@/core/game/Game";
import { MapScene } from "@/scenes/MapScene";
import { DialogueOverlay } from "@/ui/overlay/DialogueOverlay";
import type { DialogueLine } from "@/tutorial/dialogue";
import type {
	TutorialConfig,
	TutorialEvent,
	TutorialObjective,
	TutorialScript,
	TutorialSegment,
} from "@/tutorial/tutorialTypes";

const DEFAULT_FAIL_LINE: DialogueLine[] = [
	{
		speaker: "Kessler",
		portraitId: "kessler-disappoint",
		side: "right",
		text: "Not quite. Let's try that again.",
	},
];

/**
 * Drives one TutorialScript end to end. Each segment: intro dialogue
 * (overlay shown, MapScene's HUD faded and input blocked), an
 * optional card handoff, an optional map/UI pointer, the real
 * objective (overlay hidden, HUD restored, MapScene fully
 * interactive), then confirm dialogue.
 *
 * Any segment with a targetTile and/or failZones is a genuinely gated
 * move — a "moved" event that doesn't satisfy the objective isn't
 * just silently ignored while the runner keeps waiting forever. It
 * counts as a real wrong choice: plays a fail line (the segment's own
 * failLine if it authored one for that specific wrong move, otherwise
 * a generic retry nudge), resets the player back to exactly where
 * this attempt started, and re-arms the same objective. A player
 * can't wander the map trying every tile until one happens to work —
 * every move-based segment is strict by default. Segments with
 * neither targetTile nor failZones (press this button, tap that
 * option) have no "wrong way" to begin with, so they're unaffected —
 * they just keep waiting for the right event type.
 *
 * MapScene never imports this class or knows it exists.
 * @author ShaAnder
 */
export class TutorialRunner {
	private dialogueOverlay: DialogueOverlay;
	private mapScene!: MapScene;

	private activeSegment: TutorialSegment | null = null;
	private activeObjective: TutorialObjective | null = null;
	private pendingResolve: ((outcome: "met" | "failed") => void) | null = null;

	constructor(
		private game: Game,
		private script: TutorialScript,
		private onComplete: () => void,
	) {
		this.dialogueOverlay = new DialogueOverlay(game);
	}

	async start(): Promise<void> {
		const config: TutorialConfig = {
			script: this.script,
			spawnAiHunters: false,
			spawnMonsters: false,
			spawnChests: false,
			allowedActions: null,
			playerMovement: this.script.playerMovement,
			onTutorialEvent: (event) => this.handleEvent(event),
		};

		this.mapScene = new MapScene(this.game, config);
		await this.game.sceneManager.changeScene(this.mapScene);

		for (const segment of this.script.segments) {
			await this.playDialogue(segment.intro);

			if (segment.giveCard) {
				this.mapScene.giveCard(segment.giveCard);
			}

			if (segment.targetTile) {
				this.mapScene.showTutorialTarget(segment.targetTile);
			}

			if (segment.uiPointer) {
				this.mapScene.showUiPointer(segment.uiPointer);
			}

			if (segment.objective) {
				await this.runObjectiveWithRetry(segment);
			}

			this.mapScene.hideTutorialTarget();
			this.mapScene.hideUiPointer();

			await this.playDialogue(segment.confirm);
		}

		this.onComplete();
	}

	/**
	 * Waits for the objective. A "failed" outcome (any wrong move on a
	 * move-gated segment — see class doc) plays a fail line and resets
	 * the player back to exactly where they stood before this specific
	 * attempt — captured once, before the first try, not re-captured
	 * after every failure.
	 */
	private async runObjectiveWithRetry(segment: TutorialSegment): Promise<void> {
		const isMoveGated = !!(segment.targetTile || segment.failZones);
		const startCoord = isMoveGated ? this.mapScene.getLocalUnitCoord() : null;

		while (true) {
			const outcome = await this.waitForOutcome(segment);
			if (outcome === "met") return;

			const failLine =
				segment.failLine && segment.failLine.length > 0
					? segment.failLine
					: isMoveGated
						? DEFAULT_FAIL_LINE
						: [];
			await this.playDialogue(failLine);

			if (startCoord) {
				this.mapScene.resetLocalUnitToCoord(startCoord);
			}
			// Loop — same objective, same pointer/targetTile still showing.
		}
	}

	/**
	 * Overlay is genuinely shown (blocking MapScene's input entirely)
	 * and the HUD faded only for the duration of actual dialogue, then
	 * both restored immediately after — never left up during an
	 * objective, since MapScene's own update() stops running the
	 * instant an overlay is open and can't drive the fade itself.
	 */
	private async playDialogue(lines: DialogueLine[]): Promise<void> {
		if (lines.length === 0) return;
		this.mapScene.setHudVisible(false);
		await this.game.overlays.show(this.dialogueOverlay);
		await this.dialogueOverlay.playLines(lines);
		this.game.overlays.hide();
		this.mapScene.setHudVisible(true);
	}

	private waitForOutcome(segment: TutorialSegment): Promise<"met" | "failed"> {
		this.activeSegment = segment;
		this.activeObjective = segment.objective;
		return new Promise((resolve) => {
			this.pendingResolve = resolve;
		});
	}

	private handleEvent(event: TutorialEvent): void {
		if (!this.activeObjective || !this.pendingResolve || !this.activeSegment) {
			return;
		}

		if (this.activeObjective.isMet(event)) {
			this.resolveOutcome("met");
			return;
		}

		// Any "moved" event that didn't satisfy isMet, on a segment that
		// actually cares where the player ends up, is a genuine wrong
		// choice — not just the specific tiles hand-listed in
		// failZones. This is what makes every move segment strict by
		// default rather than a soft suggestion a player can ignore
		// indefinitely.
		if (
			event.type === "moved" &&
			(this.activeSegment.targetTile || this.activeSegment.failZones)
		) {
			this.resolveOutcome("failed");
		}
	}

	private resolveOutcome(outcome: "met" | "failed"): void {
		const resolve = this.pendingResolve!;
		this.activeSegment = null;
		this.activeObjective = null;
		this.pendingResolve = null;
		resolve(outcome);
	}
}
