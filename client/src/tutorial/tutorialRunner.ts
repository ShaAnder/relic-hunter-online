import type { Game } from "@/core/game/Game";
import { MapScene } from "@/scenes/MapScene";
import { DialogueOverlay } from "@/ui/overlay/DialogueOverlay";
import type { DialogueLine } from "@/tutorial/dialogue";
import type {
	TutorialConfig,
	TutorialEvent,
	TutorialObjective,
	TutorialScript,
} from "@/tutorial/tutorialTypes";

/**
 * Drives one TutorialScript end to end: builds the TutorialConfig,
 * launches MapScene with it, then walks every segment — intro dialogue
 * (overlay shown, MapScene paused), an optional card handoff, an
 * optional target-tile marker, the real objective (overlay hidden,
 * MapScene fully interactive), then confirm dialogue. MapScene never
 * imports this class or knows it exists; it only ever calls the
 * onTutorialEvent callback and exposes giveCard/showTutorialTarget as
 * plain public methods.
 * @author ShaAnder
 */
export class TutorialRunner {
	private dialogueOverlay: DialogueOverlay;
	private mapScene!: MapScene;

	private activeObjective: TutorialObjective | null = null;
	private pendingObjectiveResolve: (() => void) | null = null;

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
				await this.waitForObjective(segment.objective);
			}

			this.mapScene.hideTutorialTarget();
			this.mapScene.hideUiPointer();

			await this.playDialogue(segment.confirm);
		}

		this.onComplete();
	}

	/**
	 * Overlay is genuinely shown (blocking MapScene's input entirely, via
	 * the same overlays.isOpen check every scene handler already respects)
	 * only for the duration of actual dialogue, then hidden immediately
	 * after — never left up during an objective.
	 */
	private async playDialogue(lines: DialogueLine[]): Promise<void> {
		if (lines.length === 0) return;
		await this.game.overlays.show(this.dialogueOverlay);
		await this.dialogueOverlay.playLines(lines);
		this.game.overlays.hide();
	}

	private waitForObjective(objective: TutorialObjective): Promise<void> {
		this.activeObjective = objective;
		return new Promise((resolve) => {
			this.pendingObjectiveResolve = resolve;
		});
	}

	private handleEvent(event: TutorialEvent): void {
		if (!this.activeObjective || !this.pendingObjectiveResolve) return;
		if (!this.activeObjective.isMet(event)) return;

		const resolve = this.pendingObjectiveResolve;
		this.activeObjective = null;
		this.pendingObjectiveResolve = null;
		resolve();
	}
}
