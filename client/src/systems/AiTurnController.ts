import * as RH from "@relic-hunter/shared";
import type { Game } from "@/core/game/Game";
import type { CameraController } from "@/core/cameras/CameraController";
import type { MapController } from "@/systems/MapController";
import type { PilotedMercenary, MonsterEntity } from "@/types/entities";

/**
 * Callbacks AiTurnController needs back into MapScene — presentation
 * (feedback, labels, target marker), scene-lifecycle operations this
 * controller doesn't own (setting player controls visible, beginning
 * the next player turn, syncing UI), and the handful of shared, pure
 * queries (adjacentTiles, spawn-tile search) that also serve non-AI
 * callers and so stay on MapScene rather than duplicate here.
 */
export interface AiTurnCallbacks {
	showFeedback(message: string): void;
	getUnitLabel(unit: PilotedMercenary): string;
	showTargetMarker(target: { view: { x: number; y: number } }): void;
	hideTargetMarker(): void;
	delay(ms: number): Promise<void>;
	getUnits(): PilotedMercenary[];
	getLocalUnit(): PilotedMercenary;
	getGrid(): RH.Grid;
	adjacentTiles(coord: RH.GridCoord): RH.GridCoord[];
	pickEnemySpawnTile(used: Set<string>): RH.GridCoord | null;
	setPlayerControlsVisible(visible: boolean): void;
	beginPlayerTurn(): void;
	syncUI(): void;
	syncDeckTracker(): void;
	showBossAlert(ms: number): Promise<void>;
	playBossAudio(): void;
	isTutorial(): boolean;
}

/**
 * Owns the AI turn loop end to end — enemy hunters, monsters, the
 * boss, deck-exhaustion boss spawn, fallback behavior.
 * @author ShaAnder
 */
export class AiTurnController {
	processingEnemyTurns = false;
	activeAi: PilotedMercenary | null = null;
	activeMonster: MonsterEntity | null = null;

	constructor(
		private game: Game,
		private camera: CameraController,
		private mapController: MapController,
		private cb: AiTurnCallbacks,
	) {}

	private toCombatant(state: RH.MercenaryState): RH.AiCombatant {
		return {
			id: state.id,
			coord: state.coord,
			stats: state.stats,
			currentHp: state.currentHp,
			items: state.items.filter((i): i is RH.ItemData => i !== null),
		};
	}

	/** Every living combatant except excludeId. */
	private buildOtherCombatants(excludeId: string): RH.AiCombatant[] {
		return this.cb
			.getUnits()
			.filter((u) => u.state.id !== excludeId && u.state.currentHp > 0)
			.map((u) => this.toCombatant(u.state));
	}

	private get screenSize(): { width: number; height: number } {
		return {
			width: this.game.app.screen.width,
			height: this.game.app.screen.height,
		};
	}

	async processEnemyTurns(): Promise<void> {
		this.processingEnemyTurns = true;
		this.camera.setInputLocked(true);
		this.cb.setPlayerControlsVisible(false);

		try {
			const BETWEEN_AI_MS = 1200;

			const aiUnits = this.cb.getUnits().filter((u) => u.pilot === "ai");
			let isFirst = true;
			for (const unit of aiUnits) {
				if (!isFirst) {
					await this.cb.delay(BETWEEN_AI_MS);
				}
				isFirst = false;

				if (unit.state.currentHp <= 0) {
					await this.processRecoveryTurn(unit);
					continue;
				}

				// Stun: full turn skip — no startTurn(), no draw, no move/attack.
				if (unit.state.stunnedTurnsRemaining > 0) {
					unit.state.stunnedTurnsRemaining -= 1;
					this.cb.showFeedback(
						`🪤 ${this.cb.getUnitLabel(unit)} is stunned and skips their turn`,
					);
					this.mapController.trySpawnMonster();
					continue;
				}

				const drawn = unit.turnManager.startTurn();
				unit.state.hand.push(...drawn);
				await this.processOneEnemyTurn(unit);
				this.mapController.trySpawnMonster();
			}

			this.cb.syncDeckTracker();
			await this.checkDeckExhaustion();
			await this.processMonsterTurns();

			if (
				this.mapController.monsterSystem.bossEntity &&
				this.mapController.monsterSystem.bossEntity.state.currentHp > 0
			) {
				await this.cb.delay(400);
				await this.processOneMonsterTurn(
					this.mapController.monsterSystem.bossEntity,
				);
			}
		} finally {
			this.processingEnemyTurns = false;
			this.camera.setInputLocked(false);
			this.cb.beginPlayerTurn();
			this.cb.syncUI();
		}
	}

	private async processOneEnemyTurn(unit: PilotedMercenary): Promise<void> {
		// AI units always have both — guard for the type
		if (!unit.archetype || !unit.memory) return;
		this.activeAi = unit;
		this.camera.centerOn(
			{ x: unit.mercenary.view.x, y: unit.mercenary.view.y },
			this.screenSize.width,
			this.screenSize.height,
		);
		const targetItemId = this.game.session.chestPlan?.targetItem?.id ?? null;
		// Not carrying → drop sticky extract so a later pickup starts fresh.
		if (
			!targetItemId ||
			!unit.state.items.some((i) => i?.id === targetItemId)
		) {
			unit.memory.extracting = false;
		}

		const self = this.toCombatant(unit.state);
		const preMoveHp = self.currentHp;
		const others = this.buildOtherCombatants(unit.state.id);

		const chestInfos: RH.ChestInfo[] = this.mapController.chestSystem.all.map(
			(c) => ({
				coord: c.coord,
				isOpen: c.entity.isOpen,
			}),
		);

		const grid = this.cb.getGrid();
		const exitCoord = RH.findExitTile(grid);
		const monsterCoords = this.mapController.monsterSystem
			.livingMonsters()
			.map((m) => m.state.coord);
		const target = RH.decideMovementTarget(
			unit.archetype,
			self,
			others,
			chestInfos,
			targetItemId,
			exitCoord,
			monsterCoords,
			unit.memory ?? null,
		);

		const targetCombatant = others.find(
			(o) => o.coord.x === target.x && o.coord.y === target.y,
		);
		const wouldDeclineOnArrival =
			targetCombatant !== undefined &&
			!RH.decideEngagement(unit.archetype, self, targetCombatant);

		if (!wouldDeclineOnArrival) {
			this.cb.showFeedback(`🤔 ${this.cb.getUnitLabel(unit)} avoids a fight`);
			const visibleTraps = this.mapController.trapSystem.visibleTo(
				unit.state.id,
				unit.state.coord,
				unit.state.characterClass === "hunter",
			);
			const blocked = new Set([
				...others.map((o) => RH.coordKey(o.coord)),
				...this.mapController.monsterSystem
					.livingMonsterCoords()
					.map(RH.coordKey),
				...visibleTraps.map((t) => RH.coordKey(t.coord)),
			]);

			// Uncapped range purely to read the real, wall-aware path distance to
			// the target — not a straight-line guess, which could send AI toward
			// a card it doesn't actually need if the direct route is blocked.
			const uncappedRange = RH.computeMovementRange(
				grid,
				unit.state.coord,
				grid.width * grid.height,
				blocked,
			);
			const distanceNeeded =
				uncappedRange.get(RH.coordKey(target))?.distance ??
				Math.abs(target.x - unit.state.coord.x) +
					Math.abs(target.y - unit.state.coord.y);

			const moveCard = RH.decideMovementCard(
				unit.state.hand,
				unit.state.stats.movement,
				distanceNeeded,
			);
			const cardBonus =
				typeof moveCard?.value === "number" ? moveCard.value : 0;
			const moveBudget = unit.state.stats.movement + cardBonus;

			const threatOwners = this.mapController.buildThreatZoneOwners(
				unit.state.id,
			);
			const range = RH.computeMovementRangeWeighted(
				grid,
				unit.state.coord,
				moveBudget,
				blocked,
				threatOwners,
				unit.state.stats,
				unit.archetype,
			);
			const reachable =
				RH.findNearestReachableTile(grid, range, target, blocked) ??
				unit.state.coord;
			const path = RH.getPathTo(range, reachable) ?? [];

			const threatFraction = RH.computePathThreatFraction(
				grid,
				path,
				threatOwners,
				unit.state.stats,
				unit.state.currentHp,
			);
			const tooRisky =
				threatFraction > RH.ARCHETYPE_ZOC_REFUSAL_THRESHOLD[unit.archetype];
			if (tooRisky) {
				this.cb.showFeedback(
					`⚠️ ${this.cb.getUnitLabel(unit)} avoids a zone of control`,
				);
			}

			if (path.length > 0 && !tooRisky) {
				const cardType = moveCard?.color ?? "none";
				if (unit.turnManager.beginMovement(cardType, cardBonus)) {
					if (moveCard) {
						const idx = unit.state.hand.findIndex((c) => c.id === moveCard.id);
						if (idx !== -1) unit.state.hand.splice(idx, 1);
					}

					if (moveCard?.actionType === "defense") {
						const v = moveCard.value;
						if (typeof v === "number" || v === "A" || v === "C") {
							unit.state.temporaryStatBonus.defense = v;
						}
					} else {
						unit.state.temporaryStatBonus.movement = cardBonus;
					}

					const { truncatedPath, hazardHit, resists } =
						this.mapController.trapSystem.resolveAlongPath(
							path,
							unit.state.stats,
							unit.state.temporaryStatBonus.defense,
							this.game.session.rng,
						);
					for (const r of resists) {
						this.cb.showFeedback(
							`🪤 ${this.cb.getUnitLabel(unit)} resisted a hazard (${r.hazardRoll} vs ${r.victimRoll})`,
						);
					}

					unit.state.coord =
						truncatedPath.length > 0
							? truncatedPath[truncatedPath.length - 1]
							: unit.state.coord;
					unit.turnManager.commitMove(truncatedPath.length);
					this.cb.showFeedback(
						`🏃 ${this.cb.getUnitLabel(unit)} moves toward its target`,
					);
					await this.mapController.moveEntityWithZoneStrikes(
						{ state: unit.state, token: unit.mercenary },
						truncatedPath,
						this.cb.getUnitLabel(unit),
					);
					if (hazardHit) {
						this.mapController.applyHazardEffect(
							unit,
							hazardHit.kind,
							hazardHit.result,
						);
					}
					this.mapController.refreshTrapMarkers();

					// Stunned mid-move: still on tile, but no fight / fallback this turn.
					// Counter stays so the *next* turn is also skipped at loop start.
					if (unit.state.stunnedTurnsRemaining > 0) {
						this.mapController.tryOpenChestAt(unit.state, unit.state.coord);
						await this.mapController.checkWinCondition(unit);
						this.activeAi = null;
						this.camera.unlock();
						return;
					}
				}
			}
		}

		this.mapController.tryOpenChestAt(unit.state, unit.state.coord);
		await this.mapController.checkWinCondition(unit);

		const selfAfter = this.toCombatant(unit.state);
		const othersAfter = this.buildOtherCombatants(unit.state.id);
		const selfForEngagement = { ...selfAfter, currentHp: preMoveHp };
		const inRangeKeys = new Set(
			this.cb.adjacentTiles(unit.state.coord).map((c) => `${c.x},${c.y}`),
		);

		const victim = RH.pickEngagementTarget(
			unit.archetype,
			selfForEngagement,
			othersAfter,
			inRangeKeys,
		);

		if (victim) {
			const victimUnit = this.cb
				.getUnits()
				.find((u) => u.state.id === victim.id);
			const canFight =
				victimUnit &&
				victimUnit.state.currentHp > 0 &&
				unit.turnManager.spendAttack();

			if (canFight && victimUnit) {
				this.cb.showFeedback(
					`⚔ ${this.cb.getUnitLabel(unit)} attacks ${this.cb.getUnitLabel(victimUnit)}`,
				);

				if (victimUnit.pilot === "local") {
					this.cb.showTargetMarker(victimUnit.mercenary);
					await this.cb.delay(500);
					this.cb.hideTargetMarker();
					await this.mapController.aiInitiateCombat(unit, victimUnit);
				} else {
					this.cb.showTargetMarker(victimUnit.mercenary);
					await this.cb.delay(500);
					this.cb.hideTargetMarker();
					await this.mapController.resolveAiVsAi(unit, victimUnit);
				}
			} else {
				await this.runFallbackBehavior(unit, selfAfter, othersAfter);
			}
		} else {
			await this.runFallbackBehavior(unit, selfAfter, othersAfter);
		}

		this.activeAi = null;
		this.camera.unlock();
	}

	/**
	 * A downed unit's own turn is entirely consumed recovering — no move, no attack,
	 * nothing else. Heals to the reduced ceiling set at defeat time and stands back up.
	 */
	private async processRecoveryTurn(unit: PilotedMercenary): Promise<void> {
		this.activeAi = unit;
		await this.camera.panTo(
			{ x: unit.mercenary.view.x, y: unit.mercenary.view.y },
			500,
			this.screenSize.width,
			this.screenSize.height,
		);

		unit.state.currentHp = 1;
		this.cb.showFeedback(
			`✨ ${this.cb.getUnitLabel(unit)} recovers and gets back up`,
		);

		this.activeAi = null;
		this.camera.unlock();
	}

	private async runFallbackBehavior(
		unit: PilotedMercenary,
		selfAfter: RH.AiCombatant,
		othersAfter: RH.AiCombatant[],
	): Promise<void> {
		if (!unit.archetype || !unit.memory) return;

		const adjacentThreats = othersAfter.filter((o) =>
			RH.isAdjacent(unit.state.coord, o.coord),
		);
		const fallback = RH.decideFallbackAction(
			selfAfter,
			adjacentThreats,
			unit.archetype,
			unit.turnManager.canDisengage,
			unit.turnManager.canRest,
		);
		if (fallback === "rest") {
			const restDrawn = unit.turnManager.spendRest();
			if (restDrawn) {
				unit.state.hand.push(...restDrawn);
				RH.clearFleeMemory(unit.memory);
				this.cb.showFeedback(`💤 ${unit.archetype} hunter rests`);
			}
		} else if (fallback === "retreat" && unit.turnManager.beginDisengage()) {
			const retreatBlocked = new Set(
				othersAfter.map((o) => RH.coordKey(o.coord)),
			);
			const grid = this.cb.getGrid();
			const retreatRange = RH.computeMovementRange(
				grid,
				unit.state.coord,
				unit.state.stats.movement,
				retreatBlocked,
			);
			const retreatFrom = unit.state.coord;
			const retreatTile = RH.pickRetreatTile(
				retreatRange,
				adjacentThreats[0].coord,
				retreatFrom,
				unit.memory,
			);
			if (retreatTile) {
				const retreatPath = RH.getPathTo(retreatRange, retreatTile) ?? [];
				if (retreatPath.length > 0) {
					this.cb.showFeedback(
						`💨 ${this.cb.getUnitLabel(unit)} uses Disengage`,
					);
					unit.state.coord = retreatTile;
					RH.recordFlee(unit.memory, retreatFrom, retreatTile);
					// No applyZoneStrikes — Disengage is ZoC-immune, that's its whole point.
					await unit.mercenary.moveAlongPath(retreatPath);
				}
			}
		}
	}

	/**
	 * Fires exactly once, the first round the shared deck genuinely
	 * runs dry — warning, screen shake, then the boss spawns far from
	 * every living hunter.
	 */
	private async checkDeckExhaustion(): Promise<void> {
		if (this.cb.isTutorial()) return;
		if (this.game.session.bossSpawned) return;
		if ((this.game.session.sharedDeck?.length ?? 1) > 0) return;

		this.game.session.bossSpawned = true;

		this.cb.showFeedback(
			"⚠️ The deck is exhausted — something massive has arrived.",
		);
		this.cb.playBossAudio();

		const SHAKE_MS = 5000;
		await Promise.all([
			this.cb.showBossAlert(SHAKE_MS),
			Promise.race([
				this.camera.shake(SHAKE_MS, 24),
				this.cb.delay(SHAKE_MS + 500),
			]),
		]);

		const used = new Set<string>(
			this.cb.getUnits().map((u) => RH.coordKey(u.state.coord)),
		);
		for (const key of this.mapController.monsterSystem.occupiedCoordKeys())
			used.add(key);
		const coord = this.cb.pickEnemySpawnTile(used);
		if (!coord) return;

		const boss = this.mapController.monsterSystem.spawnBoss(coord);
		this.cb.showFeedback("👹 The boss has entered the map.");

		const PAN_MS = 900;
		await Promise.race([
			this.camera.panTo(
				{ x: boss.token.view.x, y: boss.token.view.y },
				PAN_MS,
				this.screenSize.width,
				this.screenSize.height,
			),
			this.cb.delay(PAN_MS + 500),
		]);

		await this.cb.delay(1000);
	}

	private async processMonsterTurns(): Promise<void> {
		const MONSTER_DELAY_MS = 1000;
		let isFirst = true;

		for (const monster of this.mapController.monsterSystem.livingMonsters()) {
			if (monster === this.mapController.monsterSystem.bossEntity) continue;
			if (!isFirst) await this.cb.delay(MONSTER_DELAY_MS);
			isFirst = false;
			await this.processOneMonsterTurn(monster);
		}
	}

	private async processOneMonsterTurn(monster: MonsterEntity): Promise<void> {
		if (monster.state.stunnedTurnsRemaining > 0) {
			monster.state.stunnedTurnsRemaining -= 1;
			this.cb.showFeedback(
				`🪤 A ${monster.state.tier} monster is stunned and skips its turn`,
			);
			return;
		}
		this.activeMonster = monster;
		this.camera.centerOn(
			{ x: monster.token.view.x, y: monster.token.view.y },
			this.screenSize.width,
			this.screenSize.height,
		);

		const targetItemId = this.game.session.chestPlan?.targetItem?.id ?? null;
		const hunters: RH.MonsterTargetCandidate[] = this.cb
			.getUnits()
			.filter((u) => u.state.currentHp > 0)
			.map((u) => ({
				id: u.state.id,
				coord: u.state.coord,
				stats: u.state.stats,
				currentHp: u.state.currentHp,
				isCarryingTarget: targetItemId
					? u.state.items.some((i) => i?.id === targetItemId)
					: false,
			}));
		const targetCandidate = RH.decideMonsterTarget(monster.state, hunters);
		if (!targetCandidate) {
			this.activeMonster = null;
			return;
		}

		const targetUnit = this.cb
			.getUnits()
			.find((u) => u.state.id === targetCandidate.id);
		if (!targetUnit) {
			this.activeMonster = null;
			return;
		}

		const grid = this.cb.getGrid();
		const isAdjacentNow = RH.isAdjacent(
			monster.state.coord,
			targetUnit.state.coord,
		);

		if (!isAdjacentNow) {
			const blocked = new Set([
				...this.cb
					.getUnits()
					.filter((u) => u.state.currentHp > 0)
					.map((u) => RH.coordKey(u.state.coord)),
				...this.mapController.monsterSystem
					.livingMonsterCoords()
					.filter(
						(c) =>
							!(c.x === monster.state.coord.x && c.y === monster.state.coord.y),
					)
					.map(RH.coordKey),
			]);
			const range = RH.computeMovementRange(
				grid,
				monster.state.coord,
				monster.state.stats.movement,
				blocked,
			);
			const reachable =
				RH.findNearestReachableTile(
					grid,
					range,
					targetUnit.state.coord,
					blocked,
				) ?? monster.state.coord;
			const path = RH.getPathTo(range, reachable) ?? [];

			if (path.length > 0) {
				monster.state.coord = reachable;
				await this.mapController.moveEntityWithZoneStrikes(
					monster,
					path,
					`A ${monster.state.tier} monster`,
				);
			}
		}

		if (RH.isAdjacent(monster.state.coord, targetUnit.state.coord)) {
			await this.mapController.monsterAttack(monster, targetUnit);
		}

		this.activeMonster = null;
	}
}
