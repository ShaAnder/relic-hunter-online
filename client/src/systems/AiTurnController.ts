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
	getFloorMap(floorIndex: number): RH.CompiledEdgeMap | null;
	canSpectateCrossFloor(): boolean;
	viewFloorForSpectating(floorIndex: number, observerCoord: RH.GridCoord): void;
	canLocalPlayerSee(floorIndex: number, coord: RH.GridCoord): boolean;
	getTurnsTaken(): number;
	getFogOfWarEnabled(): boolean;
	adjacentTiles(coord: RH.GridCoord): RH.GridCoord[];
	pickEnemySpawnTile(used: Set<string>): RH.GridCoord | null;
	setPlayerControlsVisible(visible: boolean): void;
	beginPlayerTurn(): void;
	syncUI(): void;
	syncDeckTracker(): void;
	showBossAlert(ms: number): Promise<void>;
	playBossAudio(): void;
	isTutorial(): boolean;
	applyFloor(floorIndex: number): void;
	trySwitchFloor(
		unit: PilotedMercenary,
		moveCamera: boolean,
		towardFloor?: number,
	): Promise<void>;

	tryMonsterSwitchFloor(monster: MonsterEntity, towardFloor?: number): void;
	rebuildMapRender(): void;
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
	crossFloorSpectating = false;

	constructor(
		private game: Game,
		private camera: CameraController,
		private mapController: MapController,
		private cb: AiTurnCallbacks,
	) {}

	/**
	 * Shared weighted traversal for AI-controlled actors.
	 *
	 * `terrain` supplies authoritative base gameplay traversal.
	 * `extraStepPenalty` is additive AI policy, such as ZoC threat.
	 */
	private computeAiRange(
		grid: RH.Grid,
		edges: RH.EdgeGrid | null,
		start: RH.GridCoord,
		budget: number,
		blocked: Set<string>,
		terrain?: RH.TerrainTraversalContext,
		extraStepPenalty?: (from: RH.GridCoord, to: RH.GridCoord) => number,
	): Map<string, RH.MovementRangeEntry> {
		const baseStepCost: RH.StepCostProvider = edges
			? (from, to) =>
					RH.getTraversalStepCost(
						from,
						to,
						RH.getEdgeBetween(edges, from, to),
						terrain,
					)
			: () => RH.BASE_TRAVERSAL_STEP_COST;
		return RH.computeWeightedMovementRange(
			grid,
			start,
			budget,
			blocked,
			(from, to) => {
				const base = baseStepCost(from, to);
				if (base === null) {
					return null;
				}
				const rawPenalty = extraStepPenalty?.(from, to) ?? 0;
				const penalty = Number.isFinite(rawPenalty)
					? Math.max(0, rawPenalty)
					: 0;
				return base + penalty;
			},
		);
	}

	private canEngageAdjacent(
		floorIndex: number,
		from: RH.GridCoord,
		to: RH.GridCoord,
	): boolean {
		if (!RH.isAdjacent(from, to)) {
			return false;
		}

		const floor = this.cb.getFloorMap(floorIndex);

		if (!floor) return false;

		return RH.edgeIsPassable(RH.getEdgeBetween(floor.edges, from, to));
	}

	private toCombatant(state: RH.MercenaryState): RH.AiCombatant {
		return {
			id: state.id,
			coord: state.coord,
			floorIndex: state.floorIndex,
			stats: state.stats,
			currentHp: state.currentHp,
			items: state.items.filter((i): i is RH.ItemData => i !== null),
		};
	}

	/** Every living combatant except excludeId, regardless of floor. */
	private buildAllOtherCombatants(excludeId: string): RH.AiCombatant[] {
		return this.cb
			.getUnits()
			.filter((u) => u.state.id !== excludeId && u.state.currentHp > 0)
			.map((u) => this.toCombatant(u.state));
	}

	/**
	 * Same-floor combatants only.
	 *
	 * Immediate movement blockers, engagement and retreat stay floor-local.
	 * Strategic cross-floor decisions use buildAllOtherCombatants instead.
	 */
	private buildOtherCombatants(
		excludeId: string,
		floorIndex: number,
	): RH.AiCombatant[] {
		return this.buildAllOtherCombatants(excludeId).filter(
			(other) => other.floorIndex === floorIndex,
		);
	}

	private nearestDifferentFloor(
		currentFloor: number,
		candidates: number[],
	): number | null {
		const unique = [...new Set(candidates)].filter(
			(floorIndex) => floorIndex !== currentFloor,
		);

		if (unique.length === 0) return null;

		const nearestDistance = Math.min(
			...unique.map((floorIndex) => Math.abs(floorIndex - currentFloor)),
		);

		const nearest = unique.filter(
			(floorIndex) => Math.abs(floorIndex - currentFloor) === nearestDistance,
		);

		return nearest[Math.floor(this.game.session.rng() * nearest.length)];
	}

	/**
	 * When the AI's ordinary same-floor decision has nothing useful to do,
	 * choose another floor worth travelling toward.
	 *
	 * A discovered relic carrier is higher priority for the pursuit-oriented
	 * archetypes even if something else exists locally.
	 */
	private pickCrossFloorObjectiveFloor(
		unit: PilotedMercenary,
		targetItemId: string | null,
		allowGeneralFallback: boolean,
	): number | null {
		const floors = this.game.session.mapFloors;
		if (!floors || floors.length <= 1) return null;

		const currentFloor = unit.state.floorIndex;

		const livingOthers = this.cb
			.getUnits()
			.filter(
				(other) =>
					other.state.id !== unit.state.id && other.state.currentHp > 0,
			);

		const unopenedChests = this.mapController.chestSystem.all.filter(
			(chest) => !chest.entity.isOpen,
		);

		const unopenedChestFloors = unopenedChests
			.filter((chest) => chest.floorIndex !== currentFloor)
			.map((chest) => chest.floorIndex);

		const rivalFloors = livingOthers
			.filter((other) => other.state.floorIndex !== currentFloor)
			.map((other) => other.state.floorIndex);

		const exitFloors = floors
			.map((floor, floorIndex) =>
				RH.findExitTile(floor.grid) ? floorIndex : null,
			)
			.filter(
				(floorIndex): floorIndex is number =>
					floorIndex !== null && floorIndex !== currentFloor,
			);

		const anyOtherFloors = floors
			.map((_, floorIndex) => floorIndex)
			.filter((floorIndex) => floorIndex !== currentFloor);

		const carryingTarget =
			targetItemId !== null &&
			unit.state.items.some((item) => item?.id === targetItemId);

		if (carryingTarget) {
			return this.nearestDifferentFloor(currentFloor, exitFloors);
		}

		const carrier =
			targetItemId === null
				? null
				: (livingOthers.find((other) =>
						other.state.items.some((item) => item?.id === targetItemId),
					) ?? null);

		if (carrier && carrier.state.floorIndex !== currentFloor) {
			switch (unit.archetype) {
				case "aggressive":
				case "balanced":
				case "clever":
					return carrier.state.floorIndex;

				case "treasure": {
					const localChestExists = unopenedChests.some(
						(chest) => chest.floorIndex === currentFloor,
					);

					if (!localChestExists) {
						return carrier.state.floorIndex;
					}
					break;
				}

				case "passive":
					break;
			}
		}

		if (!allowGeneralFallback) {
			return null;
		}

		// Fogged AI should not magically know where unseen loot/rivals are.
		// Once its current floor gives it nothing to do, simply explore
		// another floor.
		if (this.cb.getFogOfWarEnabled()) {
			return this.nearestDifferentFloor(currentFloor, anyOtherFloors);
		}

		let preferredFloors: number[] = [];

		switch (unit.archetype) {
			case "aggressive":
				preferredFloors = [...rivalFloors, ...unopenedChestFloors];
				break;

			case "treasure":
			case "clever":
				preferredFloors = [...unopenedChestFloors, ...rivalFloors];
				break;

			case "passive":
				preferredFloors = [...unopenedChestFloors, ...exitFloors];
				break;

			case "balanced":
			default:
				preferredFloors = [...unopenedChestFloors, ...rivalFloors];
				break;
		}

		return (
			this.nearestDifferentFloor(currentFloor, preferredFloors) ??
			this.nearestDifferentFloor(currentFloor, anyOtherFloors)
		);
	}

	/**
	 * Pick the closest connector that is genuinely reachable through the
	 * current floor's walls/doors, rather than whichever connector happens
	 * to be closest by straight-line distance.
	 */
	private findBestReachableConnector(
		fromFloor: number,
		towardFloor: number,
		range: Map<string, RH.MovementRangeEntry>,
	): RH.GridCoord | null {
		const bundle = this.game.session.mapBundle;
		if (!bundle) return null;

		const connectors = RH.findConnectorsTowardFloor(
			bundle,
			fromFloor,
			towardFloor,
		);

		let best: RH.GridCoord | null = null;
		let bestDistance = Infinity;

		for (const connector of connectors) {
			const entry = range.get(RH.coordKey(connector));

			if (!entry) continue;

			if (entry.distance < bestDistance) {
				bestDistance = entry.distance;
				best = connector;
			}
		}

		return best;
	}

	private get screenSize(): { width: number; height: number } {
		return {
			width: this.game.app.screen.width,
			height: this.game.app.screen.height,
		};
	}

	async processEnemyTurns(): Promise<void> {
		this.processingEnemyTurns = true;

		this.crossFloorSpectating = this.cb.canSpectateCrossFloor();

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
					this.cb.rebuildMapRender();
					continue;
				}

				// Stun: full turn skip — no startTurn(), no draw, no move/attack.
				if (unit.state.stunnedTurnsRemaining > 0) {
					unit.state.stunnedTurnsRemaining -= 1;
					this.cb.showFeedback(
						`🪤 ${this.cb.getUnitLabel(unit)} is stunned and skips their turn`,
					);
					this.mapController.trySpawnMonster();
					this.cb.rebuildMapRender();
					continue;
				}

				const drawn = unit.turnManager.startTurn();
				unit.state.hand.push(...drawn);
				await this.processOneEnemyTurn(unit);
				this.mapController.trySpawnMonster();
				this.cb.rebuildMapRender();
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
			this.crossFloorSpectating = false;
			this.camera.setInputLocked(false);
			this.cb.beginPlayerTurn();
			this.cb.syncUI();
		}
	}

	private async processOneEnemyTurn(unit: PilotedMercenary): Promise<void> {
		// AI units always have both — guard for the type
		if (!unit.archetype || !unit.memory) return;
		this.activeAi = unit;
		const localUnit = this.cb.getLocalUnit();

		const crossFloorPeek =
			this.crossFloorSpectating &&
			unit.state.floorIndex !== localUnit.state.floorIndex;

		if (this.crossFloorSpectating) {
			this.cb.viewFloorForSpectating(unit.state.floorIndex, unit.state.coord);
		}
		const floorMap = this.cb.getFloorMap(unit.state.floorIndex);

		if (!floorMap) {
			this.activeAi = null;
			return;
		}

		let grid = floorMap.grid;
		let edges = floorMap.edges;

		const terrain: RH.TerrainTraversalContext = {
			elevationSteps: floorMap.elevationSteps,

			tileCodes: floorMap.tileCodes,
		};

		// Re-stamp this unit's own fog for the current turn immediately —
		// its sighting-recording logic below needs an accurate "visible"
		// read for its own surroundings, which would otherwise lag if
		// this unit didn't move last turn (fog visibility now strictly
		// tracks the turn a tile was recorded, not raw distance).
		if (this.cb.getFogOfWarEnabled()) {
			RH.updateFogOfWar(
				unit.state,
				unit.state.coord,
				this.cb.getTurnsTaken(),
				grid,
				undefined,
				edges,
			);
		}

		const fogEnabled = this.cb.getFogOfWarEnabled();

		const canSeeUnit =
			crossFloorPeek ||
			this.cb.canLocalPlayerSee(unit.state.floorIndex, unit.state.coord);
		if (canSeeUnit) {
			// activeAi is already set, so rebuilding now makes room-focus
			// follow the same hunter the camera is about to follow.
			this.cb.rebuildMapRender();

			this.camera.centerOn(
				{ x: unit.mercenary.view.x, y: unit.mercenary.view.y },
				this.screenSize.width,
				this.screenSize.height,
			);
		}

		// Never conserve cards, same philosophy as movement cards — a
		// green (stun/trap) card sitting unused in hand is the actual
		// bug. Trap is dropped at the current tile before anything else
		// happens this turn, then the unit proceeds normally.
		const trapCard = unit.state.hand.find((c) => c.actionType === "stun");
		if (trapCard) {
			RH.spendCard(unit.state, trapCard.id);
			this.mapController.placeTrap(unit);
		}

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
		const allOthers = this.buildOtherCombatants(
			unit.state.id,
			unit.state.floorIndex,
		);

		const allChestInfos: RH.ChestInfo[] = this.mapController.chestSystem.all
			.filter((c) => c.floorIndex === unit.state.floorIndex)
			.map((c) => ({
				coord: c.coord,
				isOpen: c.entity.isOpen,
			}));

		const exitCoord = RH.findExitTile(grid);

		const allMonsterCoords = this.mapController.monsterSystem
			.livingMonsters()
			.filter((m) => m.state.floorIndex === unit.state.floorIndex)
			.map((m) => m.state.coord);

		// Fog-of-war: an AI can only target what it has actually seen —
		// same rule a human plays under, per design. exitCoord is
		// deliberately NOT filtered here — it still reveals globally
		// once the relic is found, unchanged for now. Respects the same
		// dev toggle the player's own view does — fog off means AI
		// targets globally too, not silently staying restricted while
		// the player can see everything.
		const currentTurn = this.cb.getTurnsTaken();

		const rooms = RH.detectRooms(grid, edges);

		const hasDirectVisibility = (coord: RH.GridCoord): boolean => {
			if (!RH.canSeeRoomContent(rooms, unit.state.coord, coord)) {
				return false;
			}

			return RH.hasClearLineOfSight(grid, unit.state.coord, coord, edges);
		};

		const isKnown = (coord: RH.GridCoord): boolean => {
			if (!hasDirectVisibility(coord)) {
				return false;
			}

			if (!fogEnabled) {
				return true;
			}

			return (
				RH.getTileVisibility(
					unit.state,
					coord,
					unit.state.coord,
					currentTurn,
				) !== "unseen"
			);
		};

		let others = allOthers.filter((other) => isKnown(other.coord));
		const chestInfos = allChestInfos.filter((chest) => isKnown(chest.coord));
		const monsterCoords = allMonsterCoords.filter((coord) => isKnown(coord));

		// Record a fresh sighting for every rival actually, currently
		// visible (not merely "explored") — this is the memory that
		// lets a lost trail still be worth chasing later.
		if (fogEnabled && unit.memory) {
			for (const o of allOthers) {
				if (
					hasDirectVisibility(o.coord) &&
					RH.getTileVisibility(
						unit.state,
						o.coord,
						unit.state.coord,
						currentTurn,
					) === "visible"
				) {
					RH.recordRivalSighting(unit.memory, o.id, o.coord, currentTurn);
				}
			}
			RH.pruneColdRivalMemory(unit.memory, currentTurn);
		}

		// No rival known at all right now (fog swallowed them) — the
		// hunt/clever archetypes keep chasing the last place they were
		// actually seen, for as long as that lead stays fresh, rather
		// than immediately reverting to chest-seeking as if the rival
		// had never existed.
		if (
			fogEnabled &&
			others.length === 0 &&
			unit.memory &&
			(unit.archetype === "aggressive" || unit.archetype === "clever")
		) {
			const lead = RH.getFreshestLastKnownRival(unit.memory, currentTurn);
			if (lead) {
				others = [
					{
						id: "__lastKnownRival__",
						coord: lead.coord,
						floorIndex: self.floorIndex,
						stats: self.stats,
						currentHp: 1,
						items: [],
					},
				];
			}
		}

		const explorationTarget = fogEnabled
			? RH.findNearestUnexploredTile(
					unit.state,
					unit.state.coord,
					grid,
					currentTurn,
				)
			: null;
		let target = RH.decideMovementTarget(
			unit.archetype,
			self,
			others,
			chestInfos,
			targetItemId,
			exitCoord,
			monsterCoords,
			unit.memory ?? null,
			explorationTarget,
		);

		const targetCombatant = allOthers.find(
			(o) => o.coord.x === target.x && o.coord.y === target.y,
		);

		// Choosing an opponent and deciding not to fight them must NOT
		// cancel the AI's entire movement phase. Remove opponents this
		// archetype currently refuses to engage and ask the normal target
		// logic for its next-best objective instead.
		//
		// That can become:
		// - another acceptable hunter,
		// - a chest,
		// - the exit,
		// - an exploration tile,
		// - or its own tile, which lets the cross-floor fallback below
		//   choose another floor.
		if (
			targetCombatant &&
			!RH.decideEngagement(unit.archetype, self, targetCombatant)
		) {
			this.cb.showFeedback(
				`🤔 ${this.cb.getUnitLabel(unit)} avoids that fight and reassesses`,
			);

			const acceptableOthers = others.filter((other) =>
				RH.decideEngagement(unit.archetype!, self, other),
			);

			target = RH.decideMovementTarget(
				unit.archetype,
				self,
				acceptableOthers,
				chestInfos,
				targetItemId,
				exitCoord,
				monsterCoords,
				unit.memory ?? null,
				explorationTarget,
			);
		}

		let transitionTowardFloor: number | null = null;

		// Always run the movement phase. Refusing one opponent means
		// "choose something else", not "forfeit the turn".
		{
			const visibleTraps = this.mapController.trapSystem.visibleTo(
				unit.state.id,
				unit.state.coord,
				unit.state.characterClass === "hunter",
			);
			const blocked = new Set([
				...allOthers.map((o) => RH.coordKey(o.coord)),
				...this.mapController.monsterSystem
					.livingMonsters()
					.filter(
						(monster) => monster.state.floorIndex === unit.state.floorIndex,
					)
					.map((monster) => RH.coordKey(monster.state.coord)),
				...visibleTraps.map((t) => RH.coordKey(t.coord)),
			]);

			const uncappedRange = this.computeAiRange(
				grid,
				edges,
				unit.state.coord,
				Number.POSITIVE_INFINITY,
				blocked,
				terrain,
			);

			const targetIsCurrentTile =
				target.x === unit.state.coord.x && target.y === unit.state.coord.y;

			const targetReachableOnThisFloor = uncappedRange.has(RH.coordKey(target));

			const crossFloorObjective = this.pickCrossFloorObjectiveFloor(
				unit,
				targetItemId,
				targetIsCurrentTile || !targetReachableOnThisFloor,
			);

			if (crossFloorObjective !== null) {
				const connector = this.findBestReachableConnector(
					unit.state.floorIndex,
					crossFloorObjective,
					uncappedRange,
				);

				if (connector) {
					target = connector;
					transitionTowardFloor = crossFloorObjective;
				}
			}

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

			const range = this.computeAiRange(
				grid,
				edges,
				unit.state.coord,
				moveBudget,
				blocked,
				terrain,
				(_from, to) =>
					RH.getZocStepPenalty(
						grid,
						threatOwners,
						to,
						unit.state.stats,
						unit.archetype!,
					),
			);

			const reachable =
				RH.findNearestReachableTile(
					grid,
					range,
					target,
					blocked,
					edges,
					terrain,
				) ?? unit.state.coord;

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
						RH.spendCard(unit.state, moveCard.id);
					}

					if (moveCard?.actionType === "defense") {
						const v = moveCard.value;
						if (typeof v === "number" || v === "A" || v === "C") {
							unit.state.temporaryStatBonus.defense = v;
						}
					} else {
						unit.state.temporaryStatBonus.movement = cardBonus;
					}

					const moveStart = {
						...unit.state.coord,
					};

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

					const actualMovementCost = RH.computePathMovementCost(
						moveStart,
						truncatedPath,
						edges,
						terrain,
					);

					if (actualMovementCost === null) {
						throw new Error(
							"AiTurnController: generated hunter path became illegal before commit",
						);
					}

					unit.state.coord =
						truncatedPath.length > 0
							? truncatedPath[truncatedPath.length - 1]
							: unit.state.coord;
					RH.updateFogOfWar(
						unit.state,
						unit.state.coord,
						this.cb.getTurnsTaken(),
						grid,
						undefined,
						edges,
					);
					unit.turnManager.commitMove(actualMovementCost);
					this.cb.showFeedback(
						`🏃 ${this.cb.getUnitLabel(unit)} moves toward its target`,
					);
					await this.mapController.moveEntityWithZoneStrikes(
						{ state: unit.state, token: unit.mercenary },
						truncatedPath,
						this.cb.getUnitLabel(unit),
					);

					const floorBeforeTransition = unit.state.floorIndex;

					await this.cb.trySwitchFloor(
						unit,
						false,
						transitionTowardFloor ?? undefined,
					);

					if (unit.state.floorIndex !== floorBeforeTransition) {
						const newFloorMap = this.cb.getFloorMap(unit.state.floorIndex);

						if (newFloorMap) {
							grid = newFloorMap.grid;
							edges = newFloorMap.edges;

							RH.updateFogOfWar(
								unit.state,
								unit.state.coord,
								this.cb.getTurnsTaken(),
								grid,
								undefined,
								edges,
							);
						}

						if (this.crossFloorSpectating) {
							this.cb.viewFloorForSpectating(
								unit.state.floorIndex,
								unit.state.coord,
							);
						}
					}

					const canSeeUnitAfterMove =
						(this.crossFloorSpectating &&
							unit.state.floorIndex !== localUnit.state.floorIndex) ||
						this.cb.canLocalPlayerSee(unit.state.floorIndex, unit.state.coord);
					if (canSeeUnitAfterMove) {
						this.cb.rebuildMapRender();
					}

					if (hazardHit) {
						unit.state.matchScore.tacticalScore = Math.max(
							0,
							unit.state.matchScore.tacticalScore - 500,
						);
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

						if (this.crossFloorSpectating) {
							this.cb.viewFloorForSpectating(
								unit.state.floorIndex,
								unit.state.coord,
							);
						}

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

		const othersAfter = this.buildOtherCombatants(
			unit.state.id,
			unit.state.floorIndex,
		);

		const selfForEngagement = {
			...selfAfter,
			currentHp: preMoveHp,
		};

		const roomsAfter = RH.detectRooms(grid, edges);

		const engagementOthers = othersAfter.filter((other) => {
			if (!RH.canSeeRoomContent(roomsAfter, unit.state.coord, other.coord)) {
				return false;
			}

			return RH.hasClearLineOfSight(grid, unit.state.coord, other.coord, edges);
		});

		const inRangeKeys = new Set(
			this.cb
				.adjacentTiles(unit.state.coord)
				.filter((coord) =>
					this.canEngageAdjacent(
						unit.state.floorIndex,
						unit.state.coord,
						coord,
					),
				)
				.map((coord) => `${coord.x},${coord.y}`),
		);

		const victim = RH.pickEngagementTarget(
			unit.archetype,
			selfForEngagement,
			engagementOthers,
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
				await this.runFallbackBehavior(
					unit,
					selfAfter,
					engagementOthers,
					grid,
					edges,
				);
			}
		} else {
			await this.runFallbackBehavior(
				unit,
				selfAfter,
				engagementOthers,
				grid,
				edges,
			);
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

		if (this.crossFloorSpectating) {
			this.cb.viewFloorForSpectating(unit.state.floorIndex, unit.state.coord);
		}

		const canSeeUnit = this.cb.canLocalPlayerSee(
			unit.state.floorIndex,
			unit.state.coord,
		);
		if (canSeeUnit) {
			await this.camera.panTo(
				{ x: unit.mercenary.view.x, y: unit.mercenary.view.y },
				500,
				this.screenSize.width,
				this.screenSize.height,
			);
		}

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
		grid: RH.Grid,
		edges: RH.EdgeGrid | null,
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

			const retreatFloor = this.cb.getFloorMap(unit.state.floorIndex);

			const retreatTerrain: RH.TerrainTraversalContext | undefined =
				retreatFloor
					? {
							elevationSteps: retreatFloor.elevationSteps,
							tileCodes: retreatFloor.tileCodes,
						}
					: undefined;

			const retreatRange = this.computeAiRange(
				grid,
				edges,
				unit.state.coord,
				unit.state.stats.movement,
				retreatBlocked,
				retreatTerrain,
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
					await this.cb.trySwitchFloor(unit, false);
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
			this.cb.rebuildMapRender();
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
		if (this.crossFloorSpectating) {
			this.cb.viewFloorForSpectating(
				monster.state.floorIndex,
				monster.state.coord,
			);
		}
		const floorMap = this.cb.getFloorMap(monster.state.floorIndex);

		if (!floorMap) {
			this.activeMonster = null;
			return;
		}

		const grid = floorMap.grid;
		const edges = floorMap.edges;
		const terrain: RH.TerrainTraversalContext = {
			elevationSteps: floorMap.elevationSteps,
			tileCodes: floorMap.tileCodes,
		};
		const localUnit = this.cb.getLocalUnit();
		const crossFloorPeek =
			this.crossFloorSpectating &&
			monster.state.floorIndex !== localUnit.state.floorIndex;
		const canSeeMonster =
			crossFloorPeek ||
			this.cb.canLocalPlayerSee(monster.state.floorIndex, monster.state.coord);
		if (canSeeMonster) {
			// activeMonster is already set. Rebuilding here means room
			// focus follows this monster exactly as it does an active AI
			// hunter.
			this.cb.rebuildMapRender();

			this.camera.centerOn(
				{ x: monster.token.view.x, y: monster.token.view.y },
				this.screenSize.width,
				this.screenSize.height,
			);
		}

		const targetItemId = this.game.session.chestPlan?.targetItem?.id ?? null;
		const hunters: RH.MonsterTargetCandidate[] = this.cb
			.getUnits()
			.filter((u) => u.state.currentHp > 0)
			.map((u) => ({
				id: u.state.id,
				coord: u.state.coord,
				floorIndex: u.state.floorIndex,
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

		const isAdjacentNow =
			monster.state.floorIndex === targetUnit.state.floorIndex &&
			this.canEngageAdjacent(
				monster.state.floorIndex,
				monster.state.coord,
				targetUnit.state.coord,
			);

		if (!isAdjacentNow) {
			const blocked = new Set([
				...this.cb
					.getUnits()
					.filter(
						(u) =>
							u.state.currentHp > 0 &&
							u.state.floorIndex === monster.state.floorIndex,
					)
					.map((u) => RH.coordKey(u.state.coord)),

				...this.mapController.monsterSystem
					.livingMonsters()
					.filter(
						(otherMonster) =>
							otherMonster !== monster &&
							otherMonster.state.currentHp > 0 &&
							otherMonster.state.floorIndex === monster.state.floorIndex,
					)
					.map((otherMonster) => RH.coordKey(otherMonster.state.coord)),
			]);

			const fullRange = this.computeAiRange(
				grid,
				edges,
				monster.state.coord,
				Number.POSITIVE_INFINITY,
				blocked,
				terrain,
			);

			let effectiveTargetCoord = targetUnit.state.coord;

			let transitionTowardFloor: number | null = null;

			if (targetCandidate.floorIndex !== monster.state.floorIndex) {
				const connector = this.findBestReachableConnector(
					monster.state.floorIndex,
					targetCandidate.floorIndex,
					fullRange,
				);

				if (!connector) {
					this.activeMonster = null;
					return;
				}

				effectiveTargetCoord = connector;
				transitionTowardFloor = targetCandidate.floorIndex;
			}

			const range = this.computeAiRange(
				grid,
				edges,
				monster.state.coord,
				monster.state.stats.movement,
				blocked,
				terrain,
			);

			const reachable =
				RH.findNearestReachableTile(
					grid,
					range,
					effectiveTargetCoord,
					blocked,
					edges,
					terrain,
				) ?? monster.state.coord;

			const path = RH.getPathTo(range, reachable) ?? [];

			if (path.length > 0) {
				monster.state.coord = reachable;

				await this.mapController.moveEntityWithZoneStrikes(
					monster,
					path,
					`A ${monster.state.tier} monster`,
				);

				this.cb.tryMonsterSwitchFloor(
					monster,
					transitionTowardFloor ?? undefined,
				);
				if (this.crossFloorSpectating) {
					this.cb.viewFloorForSpectating(
						monster.state.floorIndex,
						monster.state.coord,
					);
				}

				const canSeeMonsterAfterMove =
					(this.crossFloorSpectating &&
						monster.state.floorIndex !== localUnit.state.floorIndex) ||
					this.cb.canLocalPlayerSee(
						monster.state.floorIndex,
						monster.state.coord,
					);
				if (canSeeMonsterAfterMove) {
					this.cb.rebuildMapRender();
				}
			}
		}

		if (
			monster.state.floorIndex === targetUnit.state.floorIndex &&
			this.canEngageAdjacent(
				monster.state.floorIndex,
				monster.state.coord,
				targetUnit.state.coord,
			)
		) {
			await this.mapController.monsterAttack(monster, targetUnit);
		}

		if (this.crossFloorSpectating) {
			this.cb.viewFloorForSpectating(
				monster.state.floorIndex,
				monster.state.coord,
			);
		}

		this.activeMonster = null;
	}
}
