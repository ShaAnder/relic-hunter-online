import type { Game } from "@/core/game/Game";
import { MapScene } from "@/scenes/MapScene";
import { DialogueOverlay } from "@/ui/overlay/DialogueOverlay";
import type { DialogueLine } from "@/tutorial/dialogue";
import type {
	DialogueSource,
	TutorialConfig,
	TutorialEvent,
	TutorialObjective,
	TutorialScript,
	TutorialSegment,
	TutorialState,
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
 * Maintains a live TutorialState (failure counters) as the script
 * plays out — any of a segment's intro/failLine/confirm can be either
 * a plain DialogueLine[] or a function receiving that state, so a
 * script can genuinely react to how the player's actually doing (e.g.
 * a different outro line if they struggled versus if they didn't).
 *
 * Any segment with a targetTile and/or failZones is a genuinely gated
 * move — a "moved" event that doesn't satisfy the objective isn't
 * just silently ignored while the runner keeps waiting forever. It
 * counts as a real wrong choice: increments the failure counters,
 * plays a fail line, resets the player back to exactly where this
 * attempt started (re-giving retryCard if the segment needs one),
 * and re-arms the same objective. Segments with neither targetTile
 * nor failZones have no "wrong way" to begin with, so they're
 * unaffected.
 *
 * MapScene never imports this class or knows it exists.
 * @author ShaAnder
 */
export class TutorialRunner {
	private dialogueOverlay: DialogueOverlay;
	private mapScene!: MapScene;

	private state: TutorialState = {
		totalFailures: 0,
		failuresBySegment: {},
	};

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

			if (segment.clearHandFirst) {
				this.mapScene.clearLocalHand();
			}

			if (segment.giveCard) {
				this.mapScene.giveCard(segment.giveCard);
			}

			if (segment.giveCards) {
				for (const card of segment.giveCards) {
					this.mapScene.giveCard(card);
				}
			}

			if (segment.targetTile) {
				this.mapScene.showTutorialTarget(segment.targetTile);
			}

			if (segment.uiPointer) {
				this.mapScene.showUiPointer(segment.uiPointer);
			}

			if (segment.moveActor) {
				await this.mapScene.moveStaticActor(
					segment.moveActor.label,
					segment.moveActor.destination,
					segment.moveActor.durationMs,
				);
			}

			if (segment.triggerCombat) {
				await this.mapScene.triggerTutorialMonsterAttack(
					segment.triggerCombat.maxRounds,
				);
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

	/** Resolves a DialogueSource against the live state — the actual "variable injection": a function source gets called with the current TutorialState right before its lines are needed, a plain array passes through unchanged. */
	private resolveLines(source: DialogueSource): DialogueLine[] {
		return typeof source === "function" ? source(this.state) : source;
	}

	/**
	 * Waits for the objective. A "failed" outcome (any wrong move on a
	 * move-gated segment — see class doc) increments the failure
	 * counters, plays a fail line, re-gives retryCard if set, and
	 * resets the player back to exactly where they stood before this
	 * specific attempt — captured once, before the first try.
	 */
	private async runObjectiveWithRetry(segment: TutorialSegment): Promise<void> {
		const isMoveGated = !!(segment.targetTile || segment.failZones);
		const startCoord = isMoveGated ? this.mapScene.getLocalUnitCoord() : null;

		while (true) {
			const outcome = await this.waitForOutcome(segment);
			if (outcome === "met") return;

			this.state.totalFailures += 1;
			this.state.failuresBySegment[segment.id] =
				(this.state.failuresBySegment[segment.id] ?? 0) + 1;

			const failLine = segment.failLine
				? this.resolveLines(segment.failLine)
				: isMoveGated
					? DEFAULT_FAIL_LINE
					: [];
			await this.playDialogue(failLine);

			if (startCoord) {
				this.mapScene.resetLocalUnitToCoord(startCoord);
			}
			if (segment.retryCard) {
				this.mapScene.giveCard(segment.retryCard);
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
	private async playDialogue(source: DialogueSource): Promise<void> {
		const lines = this.resolveLines(source);
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
