import type { Container } from "pixi.js";
import * as RH from "@relic-hunter/shared";
import type { Game } from "@/core/game/Game";
import { BattleHost, type BattleHostResult } from "@/combat/BattleHost";
import {
	buildBattleRequest,
	describeLocalPlayer,
	describeHunter,
	describeMonster,
} from "@/combat/buildBattleRequest";
import { ChestSystem } from "@/systems/ChestSystem";
import { MonsterSystem } from "@/systems/MonsterSystem";
import { TrapSystem } from "@/systems/TrapSystem";
import { ExitRelicSystem } from "@/systems/ExitRelicSystem";
import { ZoneQuery } from "@/systems/ZoneQuery";
import { isCarryingTarget } from "@/systems/MatchController";
import type { TutorialEvent } from "@/tutorial/tutorialTypes";
import type {
	PilotedMercenary,
	MovableToken,
	MonsterEntity,
} from "@/types/entities";

/**
 * Callbacks MapController needs back into MapScene — presentation
 * (feedback, popups, labels), state that changes over a match's
 * lifetime (local unit, unit list, grid) and can't be captured once,
 * win/loss (MapScene still owns turnsTaken and the score-entry
 * builder), and the handful of scene-owned operations (teleport,
 * targeting exit, spawn-tile search) genuinely outside this
 * controller's job.
 */
export interface MapControllerCallbacks {
	showFeedback(message: string): void;
	showItemPopup(item: RH.ItemData, isTarget: boolean): void;
	getUnitLabel(unit: PilotedMercenary): string;
	teleportEntity(
		state: RH.MercenaryState,
		mercenary: MovableToken,
	): Promise<void>;
	syncUI(): void;
	onTutorialEvent(event: TutorialEvent): void;
	getLocalUnit(): PilotedMercenary;
	getUnits(): PilotedMercenary[];
	getGrid(): RH.Grid;
	rebuildMapRender(): void;
	exitTargetingMode(): void;
	pickEnemySpawnTile(used: Set<string>): RH.GridCoord | null;
	delay(ms: number): Promise<void>;
	triggerWin(): void;
	triggerLoss(winner: PilotedMercenary): void;
}

/**
 * Owns map-domain orchestration: the chest/monster/trap/exit systems,
 * combat triggering (both player-initiated and AI-initiated), the win
 * check, and zone-of-control crossing. Genuine Phase F seam (§9 of
 * docs/16) built as a wrapper around the systems Phase G already
 * extracted — AI turn orchestration (processEnemyTurns and friends)
 * deliberately stays on MapScene for now; see docs/16 §21a for why.
 *
 * chestSystem/monsterSystem/trapSystem/battleHost are public — MapScene
 * still reaches them directly for things this controller doesn't own
 * (per-frame token ticking, tutorial combat, the AI turn loop's own
 * trap/monster queries). What moved here is the *orchestration*
 * around those systems, not exclusive ownership of every query.
 * @author ShaAnder
 */
export class MapController {
	readonly chestSystem = new ChestSystem();
	readonly monsterSystem: MonsterSystem;
	readonly trapSystem = new TrapSystem();
	readonly battleHost: BattleHost;

	private activeCombatUnit: PilotedMercenary | null = null;

	constructor(
		private game: Game,
		mercenaryContainer: Container,
		private cb: MapControllerCallbacks,
	) {
		this.monsterSystem = new MonsterSystem(mercenaryContainer);
		this.battleHost = new BattleHost(this.game);
	}

	// ---------- Chests & exit ----------

	/** Rebuilds chests from the session's saved layout, or a fresh plan — MapScene decides which source, this just constructs. */
	spawnChests(reserved: Set<string>): void {
		const sessionPlacements = this.game.session.chestPlacements;
		if (sessionPlacements && sessionPlacements.length > 0) {
			this.chestSystem.spawnFromPlacements(sessionPlacements);
			return;
		}

		const plan = this.game.session.chestPlan;
		if (!plan) return;

		this.chestSystem.spawnFromPlan(
			plan,
			this.cb.getGrid(),
			reserved,
			this.game.session.rng,
		);
	}

	/** Open the chest at coord if unopened, for whichever unit reached it. Stays closed if inventory full. */
	tryOpenChestAt(state: RH.MercenaryState, coord: RH.GridCoord): void {
		const outcome = this.chestSystem.tryOpen(coord, state.items);
		const isLocal = state.id === this.cb.getLocalUnit().state.id;

		switch (outcome.kind) {
			case "noChest":
				return;

			case "inventoryFull":
				if (isLocal) {
					this.cb.showFeedback("🎒 Inventory full — chest left unopened");
				}
				return;

			case "opened":
				if (outcome.isTarget) {
					this.game.session.relicFound = true;
					this.triggerFrenzy();
					this.spawnExitFarFrom(coord);
					this.cb.rebuildMapRender();
					this.cb.showFeedback(
						isLocal
							? `🎯 Found the target: ${outcome.item.name}! The Exit has revealed itself.`
							: "⚠️ An enemy hunter found the target item! The Exit has revealed itself.",
					);
				} else if (isLocal) {
					this.cb.showFeedback(`📦 Found: ${outcome.item.name}`);
				}

				if (isLocal) this.cb.showItemPopup(outcome.item, outcome.isTarget);
		}
	}

	/**
	 * Every living regular monster gets a one-time, permanent stat bump
	 * the moment the relic is found. Boss is explicitly exempt —
	 * it's already the endgame threat, frenzy doesn't apply on top of it.
	 */
	private triggerFrenzy(): void {
		RH.applyFrenzy(this.monsterSystem.all.map((m) => m.state));
	}

	/**
	 * Spawns the match Exit far from the relic-find location, deferring
	 * to ExitRelicSystem for the actual tile-picking — this just builds
	 * the blocked set from the units/monsters this controller tracks.
	 */
	private spawnExitFarFrom(from: RH.GridCoord): void {
		const blocked = new Set<string>();
		for (const u of this.cb.getUnits()) {
			if (u.state.currentHp > 0) blocked.add(RH.coordKey(u.state.coord));
		}
		for (const m of this.monsterSystem.all) {
			if (m.state.currentHp > 0) blocked.add(RH.coordKey(m.state.coord));
		}

		ExitRelicSystem.spawnFarFrom(
			this.cb.getGrid(),
			from,
			blocked,
			this.game.session.rng,
		);
	}

	// ---------- Monster spawning ----------

	trySpawnMonster(): void {
		const rng = this.game.session.rng;
		if (!this.monsterSystem.shouldSpawn(rng)) return;

		const used = new Set<string>(
			this.cb.getUnits().map((u) => RH.coordKey(u.state.coord)),
		);
		for (const key of this.monsterSystem.occupiedCoordKeys()) used.add(key);

		const coord = this.cb.pickEnemySpawnTile(used);
		if (!coord) return;

		const tier = this.monsterSystem.trySpawn(coord, rng);
		if (tier) {
			this.cb.showFeedback(`👹 A ${tier} monster appears!`);
		}
	}

	// ---------- Combat triggering ----------

	async monsterAttack(
		monster: MonsterEntity,
		target: PilotedMercenary,
	): Promise<void> {
		const attackerDescriptor = describeMonster(monster);
		const defenderDescriptor = describeHunter(target);

		await this.battleHost.run(
			buildBattleRequest(attackerDescriptor, defenderDescriptor, {
				isRangedInitiated: false,
				onComplete: async (result) => {
					monster.state.currentHp = attackerDescriptor.state.currentHp;

					if (result.attackerMonsterDied) {
						this.monsterSystem.remove(monster);
					}

					if (result.defenderNeedsTeleport) {
						this.cb.teleportEntity(target.state, target.mercenary);
					}
				},
			}),
		);
	}

	async aiInitiateCombat(
		attacker: PilotedMercenary,
		defender: PilotedMercenary,
	): Promise<void> {
		this.activeCombatUnit = defender;

		const attackerDescriptor = describeHunter(attacker);
		const defenderDescriptor = describeHunter(defender);

		const result = await this.battleHost.run(
			buildBattleRequest(attackerDescriptor, defenderDescriptor, {
				isRangedInitiated: !RH.isAdjacent(
					attacker.state.coord,
					defender.state.coord,
				),
			}),
		);

		if (result.attackerNeedsTeleport) {
			this.cb.teleportEntity(attacker.state, attacker.mercenary);
		}

		if (result.defenderNeedsTeleport) {
			this.cb.teleportEntity(defender.state, defender.mercenary);
		}
	}

	async resolveAiVsAi(
		attacker: PilotedMercenary,
		defender: PilotedMercenary,
	): Promise<void> {
		const attackerDescriptor = describeHunter(attacker);
		const defenderDescriptor = describeHunter(defender);

		const result = await this.battleHost.run(
			buildBattleRequest(attackerDescriptor, defenderDescriptor, {
				isRangedInitiated: !RH.isAdjacent(
					attacker.state.coord,
					defender.state.coord,
				),
			}),
		);

		if (result.attackerNeedsTeleport) {
			this.cb.teleportEntity(attacker.state, attacker.mercenary);
		}

		if (result.defenderNeedsTeleport) {
			this.cb.teleportEntity(defender.state, defender.mercenary);
		}
	}

	tryStartCombat(unit: PilotedMercenary): void {
		if (!unit || unit.state.currentHp <= 0) return;

		const local = this.cb.getLocalUnit();
		const inRange = RH.isAdjacent(local.state.coord, unit.state.coord);

		if (!inRange) {
			this.cb.showFeedback("⚔ Target out of range");
			return;
		}

		if (!local.turnManager.spendAttack()) return;

		this.cb.exitTargetingMode();
		this.activeCombatUnit = unit;

		void this.battleHost.run(
			buildBattleRequest(describeLocalPlayer(local), describeHunter(unit), {
				isRangedInitiated: !RH.isAdjacent(local.state.coord, unit.state.coord),
				onComplete: (result) => {
					void this.onBattleComplete(result);
				},
			}),
		);
	}

	tryStartCombatVsMonster(monster: MonsterEntity): void {
		const local = this.cb.getLocalUnit();
		const inRange = RH.isAdjacent(local.state.coord, monster.state.coord);

		if (!inRange) {
			this.cb.showFeedback("⚔ Target out of range");
			return;
		}

		if (!local.turnManager.spendAttack()) return;

		this.cb.exitTargetingMode();

		const defenderDescriptor = describeMonster(monster);

		this.cb.onTutorialEvent({
			type: "combatStarted",
			opponentType: "monster",
		});

		void this.battleHost.run(
			buildBattleRequest(describeLocalPlayer(local), defenderDescriptor, {
				isRangedInitiated: !RH.isAdjacent(
					local.state.coord,
					monster.state.coord,
				),
				onComplete: (result) => {
					monster.state.currentHp = defenderDescriptor.state.currentHp;

					if (result.defenderMonsterDied) {
						this.monsterSystem.remove(monster);
					}

					if (result.attackerNeedsTeleport) {
						this.cb.teleportEntity(local.state, local.mercenary);
					}

					this.cb.onTutorialEvent({
						type: "combatEnded",
						won: !!result.defenderMonsterDied,
					});

					this.cb.syncUI();
				},
			}),
		);
	}

	/** Enemy defeat/teleport are BattleOverlay's job via shared state; this handles the rest. */
	private async onBattleComplete(result: BattleHostResult): Promise<void> {
		const unit = this.activeCombatUnit;
		this.activeCombatUnit = null;
		const local = this.cb.getLocalUnit();

		if (result.defenderNeedsTeleport && unit) {
			await this.cb.teleportEntity(unit.state, unit.mercenary);
			this.cb.showFeedback("💨 Enemy hunter fled the fight!");
		}

		if (result.attackerNeedsTeleport) {
			await this.cb.teleportEntity(local.state, local.mercenary);
		}

		this.cb.syncUI();
	}

	// ---------- Win check ----------

	/** Win check: standing on Exit with target held, via normal move only. */
	async checkWinCondition(unit: PilotedMercenary): Promise<void> {
		const grid = this.cb.getGrid();
		const exitTile = RH.findExitTile(grid);
		if (!exitTile) return;
		if (unit.state.coord.x !== exitTile.x || unit.state.coord.y !== exitTile.y)
			return;

		if (
			isCarryingTarget(
				unit.state.items,
				this.game.session.chestPlan?.targetItem?.id,
			)
		) {
			if (unit.pilot === "local") {
				this.cb.triggerWin();
			} else {
				this.cb.triggerLoss(unit);
			}
			return;
		}

		this.cb.showFeedback(
			`🌀 ${this.cb.getUnitLabel(unit)} reached the exit without the relic and was cast away`,
		);
		await this.cb.teleportEntity(unit.state, unit.mercenary);
	}

	// ---------- Zone of control ----------

	buildZoneOwners(excludeId: string): RH.ZoneOwner[] {
		return ZoneQuery.buildZoneOwners(
			this.cb.getUnits().map((u) => ({
				id: u.state.id,
				coord: u.state.coord,
				stats: u.state.stats,
				currentHp: u.state.currentHp,
				special: u.state.special,
			})),
			excludeId,
		);
	}

	buildThreatZoneOwners(excludeId: string): RH.ThreatOwner[] {
		return ZoneQuery.buildThreatZoneOwners(
			this.cb.getUnits().map((u) => ({
				id: u.state.id,
				coord: u.state.coord,
				stats: u.state.stats,
				currentHp: u.state.currentHp,
				special: u.state.special,
			})),
			excludeId,
		);
	}

	/**
	 * Animates a path in segments, pausing exactly at each zone crossing
	 * to apply the reaction strike and log it. Works for any entity with
	 * a mutable RH.EntityCore-shaped state and a MovableToken — hunters
	 * and monsters both satisfy this structurally.
	 */
	async moveEntityWithZoneStrikes(
		entity: { state: RH.EntityCore; token: MovableToken },
		path: RH.GridCoord[],
		label: string,
	): Promise<void> {
		const owners = this.buildZoneOwners(entity.state.id);
		const crossings = RH.findZonesCrossed(this.cb.getGrid(), path, owners);

		let segmentStart = 0;
		for (const crossing of crossings) {
			const segment = path.slice(segmentStart, crossing.pathIndex + 1);
			if (segment.length > 0) {
				await entity.token.moveAlongPath(segment);
			}
			segmentStart = crossing.pathIndex + 1;

			const ownerUnit = this.cb
				.getUnits()
				.find((u) => u.state.id === crossing.owner.id);
			if (ownerUnit) {
				const bonus =
					"temporaryStatBonus" in entity.state
						? (entity.state as RH.MercenaryState).temporaryStatBonus.defense
						: 0;
				const syntheticCard: RH.CardData | undefined =
					bonus !== 0
						? {
								id: "__temp_defense__",
								color: "yellow",
								name: "Defense",
								value: bonus,
								description: "",
								actionType: "defense",
							}
						: undefined;
				const strike = RH.resolveReactionStrike(
					ownerUnit.state.stats,
					entity.state.stats,
					syntheticCard,
				);
				entity.state.currentHp -= strike.damage;
				this.cb.showFeedback(
					`⚔ ${label} entered ${this.cb.getUnitLabel(ownerUnit)}'s zone of control — took ${strike.damage} damage`,
				);
				await this.cb.delay(400);
			}
		}

		const remaining = path.slice(segmentStart);
		if (remaining.length > 0) {
			await entity.token.moveAlongPath(remaining);
		}
	}

	// ---------- Traps ----------

	placeTrapAtCurrentPosition(): void {
		const local = this.cb.getLocalUnit().state;
		this.trapSystem.place({
			coord: local.coord,
			ownerId: local.id,
			kind: "stun",
		});
		this.cb.showFeedback("🪤 Trap left behind");
		this.refreshTrapMarkers();
	}

	refreshTrapMarkers(): void {
		const local = this.cb.getLocalUnit().state;
		this.trapSystem.renderMarkersFor(
			local.id,
			local.coord,
			local.characterClass === "hunter",
		);
	}

	placeTrap(): void {
		switch (this.cb.getLocalUnit().state.characterClass) {
			// case trapper goes here later

			default:
				this.placeTrapAtCurrentPosition();
		}
	}

	applyHazardEffect(
		unit: PilotedMercenary,
		kind: RH.TrapKind,
		result: RH.HazardRollResult,
	): void {
		switch (kind) {
			case "stun":
				RH.applyStun(unit.state);
				this.cb.showFeedback(
					`🪤 ${this.cb.getUnitLabel(unit)} was stunned! (${result.hazardRoll} vs ${result.victimRoll})`,
				);
		}
	}
}
