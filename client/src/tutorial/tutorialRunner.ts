import type { TutorialPort } from "./tutorialPort";
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
 * Drives one TutorialScript end to end against a TutorialPort — never MapScene or DialogueOverlay directly.
 * @author ShaAnder
 */
export class TutorialRunner {
	private port!: TutorialPort;

	private state: TutorialState = {
		totalFailures: 0,
		failuresBySegment: {},
	};

	private activeSegment: TutorialSegment | null = null;
	private activeObjective: TutorialObjective | null = null;
	private pendingResolve: ((outcome: "met" | "failed") => void) | null = null;
	/** Coord right before the last objective — resolves a spawnMonster "behindPlayer" sentinel. */
	private coordBeforeLastObjective: { x: number; y: number } | null = null;

	constructor(
		private createPort: (config: TutorialConfig) => Promise<TutorialPort>,
		private script: TutorialScript,
		private onComplete: () => void,
	) {}

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

		this.port = await this.createPort(config);

		for (const segment of this.script.segments) {
			await this.playDialogue(segment.intro);

			if (segment.clearHandFirst) {
				this.port.clearLocalHand();
			}

			if (segment.giveCard) {
				this.port.giveCard(segment.giveCard);
			}

			if (segment.giveCards) {
				this.port.giveCards(segment.giveCards);
			}

			if (segment.targetTile) {
				this.port.showTutorialTarget(segment.targetTile);
			}

			if (segment.pointAtMonster) {
				const coord = this.port.getTutorialMonsterCoord();
				if (coord) this.port.showTutorialTarget(coord);
			}

			if (segment.uiPointer) {
				this.port.showUiPointer(segment.uiPointer);
			}

			if (segment.moveActor) {
				await this.port.moveStaticActor(
					segment.moveActor.label,
					segment.moveActor.destination,
					segment.moveActor.durationMs,
				);
			}

			if (segment.spawnMonster) {
				const coord =
					segment.spawnMonster.coord === "behindPlayer"
						? (this.coordBeforeLastObjective ?? this.port.getLocalUnitCoord())
						: segment.spawnMonster.coord;
				this.port.spawnTutorialMonster(coord, segment.spawnMonster.tier);
			}

			if (segment.dashMonster) {
				await this.port.dashMonsterToPlayer();
			}

			if (segment.triggerCombat) {
				const guideSpec = segment.triggerCombat.guide;
				let readyResolve: (() => void) | null = null;
				const ready = guideSpec
					? new Promise<void>((r) => {
							readyResolve = r;
						})
					: Promise.resolve();

				const battleDone = this.port.triggerTutorialMonsterAttack(
					segment.triggerCombat.maxRounds,
					segment.triggerCombat.availableActions,
					guideSpec
						? {
								requiredAction: guideSpec.requiredAction,
								grayOthers: guideSpec.grayOthers,
								onWrongAction: async () => {
									this.state.totalFailures += 1;
									this.state.failuresBySegment[segment.id] =
										(this.state.failuresBySegment[segment.id] ?? 0) + 1;

									if (segment.failLine) {
										await this.playDialogue(segment.failLine);
									}
								},
								onReady: () => {
									readyResolve?.();
								},
							}
						: undefined,
				);

				await ready;
				// Intro already played earlier in the loop — a guided fight's
				// dedicated battle intro plays after ready, not before.
				if (segment.battleIntro) {
					await this.playDialogue(segment.battleIntro);
				}

				await battleDone;
			}

			if (segment.objective) {
				await this.runObjectiveWithRetry(segment);
			}

			this.port.hideTutorialTarget();
			this.port.hideUiPointer();

			await this.playDialogue(segment.confirm);
		}

		this.onComplete();
	}

	/** Resolves a DialogueSource against live state — the actual "variable injection". */
	private resolveLines(source: DialogueSource): DialogueLine[] {
		return typeof source === "function" ? source(this.state) : source;
	}

	/**
	 * Waits for the objective. A failed outcome increments failure
	 * counters, plays a fail line, re-gives retryCard if set, and
	 * resets the player to where this attempt started.
	 */
	private async runObjectiveWithRetry(segment: TutorialSegment): Promise<void> {
		this.coordBeforeLastObjective = this.port.getLocalUnitCoord();
		const isMoveGated = !!(segment.targetTile || segment.failZones);
		const startCoord = isMoveGated ? this.coordBeforeLastObjective : null;

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
				this.port.resetLocalUnitToCoord(startCoord);
			}
			if (segment.retryCard) {
				this.port.giveCard(segment.retryCard);
			}
			// Loop — same objective, same pointer/targetTile still showing.
		}
	}

	/** Resolves the source against live state, then delegates entirely to the port. */
	private async playDialogue(source: DialogueSource): Promise<void> {
		await this.port.playDialogue(this.resolveLines(source));
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
