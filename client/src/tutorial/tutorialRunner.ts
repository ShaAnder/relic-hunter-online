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
import type { GridCoord } from "@relic-hunter/shared";

/**
 * Drives one TutorialScript end to end. Each segment: intro dialogue
 * (overlay shown, MapScene paused), an optional card handoff, an
 * optional map/UI pointer, the real objective (overlay hidden, MapScene
 * fully interactive), then confirm dialogue. If a segment defines
 * failZones, a "moved" event landing on one of them doesn't just keep
 * waiting — it plays failLine, resets the player back to where this
 * attempt started, and re-arms the same objective for another try.
 * MapScene never imports this class or knows it exists.
 * @author ShaAnder
 */
export class TutorialRunner {
	private dialogueOverlay: DialogueOverlay;
	private mapScene!: MapScene;

	private activeObjective: TutorialObjective | null = null;
	private activeFailZones: GridCoord[] | null = null;
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
	 * Waits for the objective, but if failZones is set, a wrong-tile
	 * landing plays failLine and resets the player back to exactly
	 * where they stood before this specific attempt — captured once,
	 * before the first try, not re-captured after every failure (or
	 * a second failure would reset to the first failure's spot, not
	 * the segment's actual start).
	 */
	private async runObjectiveWithRetry(segment: TutorialSegment): Promise<void> {
		const startCoord = segment.failZones
			? this.mapScene.getLocalUnitCoord()
			: null;

		while (true) {
			const outcome = await this.waitForOutcome(
				segment.objective!,
				segment.failZones,
			);
			if (outcome === "met") return;

			if (segment.failLine && segment.failLine.length > 0) {
				await this.playDialogue(segment.failLine);
			}
			if (startCoord) {
				this.mapScene.resetLocalUnitToCoord(startCoord);
			}
			// Loop — same objective, same pointer/targetTile still showing.
		}
	}

	/**
	 * Overlay is genuinely shown (blocking MapScene's input entirely)
	 * only for the duration of actual dialogue, then hidden immediately
	 * after — never left up during an objective.
	 */
	private async playDialogue(lines: DialogueLine[]): Promise<void> {
		if (lines.length === 0) return;
		await this.game.overlays.show(this.dialogueOverlay);
		await this.dialogueOverlay.playLines(lines);
		this.game.overlays.hide();
	}

	private waitForOutcome(
		objective: TutorialObjective,
		failZones?: GridCoord[],
	): Promise<"met" | "failed"> {
		this.activeObjective = objective;
		this.activeFailZones = failZones ?? null;
		return new Promise((resolve) => {
			this.pendingResolve = resolve;
		});
	}

	private handleEvent(event: TutorialEvent): void {
		if (!this.activeObjective || !this.pendingResolve) return;

		if (this.activeFailZones && event.type === "moved") {
			const hitFailZone = this.activeFailZones.some(
				(z) => z.x === event.finalCoord.x && z.y === event.finalCoord.y,
			);
			if (hitFailZone) {
				const resolve = this.pendingResolve;
				this.activeObjective = null;
				this.activeFailZones = null;
				this.pendingResolve = null;
				resolve("failed");
				return;
			}
		}

		if (!this.activeObjective.isMet(event)) return;

		const resolve = this.pendingResolve;
		this.activeObjective = null;
		this.activeFailZones = null;
		this.pendingResolve = null;
		resolve("met");
	}
}
