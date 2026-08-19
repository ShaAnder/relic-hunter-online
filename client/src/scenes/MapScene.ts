import { Container, Graphics, Text } from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import { Camera } from "@/core/cameras/Camera";
import {
	gridToScreen,
	screenToGrid,
	TILE_WIDTH,
	TILE_HEIGHT,
} from "@/math/isoGridMath";
import { Mercenary } from "@/entities/Mercenary";
import { Chest } from "@/entities/Chest";

import * as RH from "@relic-hunter/shared";

import { DeckTracker } from "@/ui/DeckTracker";
import { InventoryPanel } from "@/ui/InventoryPanel";
import { PauseOverlay } from "@/ui/overlay/PauseOverlay";
import { BattleOverlay, type BattleResult } from "@/ui/overlay/BattleOverlay";
import { MoveController } from "@/systems/MoveController";
import { TurnManager } from "@/systems/TurnManager";
import { Hand } from "@/ui/Hand";
import { CharacterPanel } from "@/ui/CharacterPanel";
import { HunterScoreEntry, MAP_SIZE_DIMENSIONS } from "@/core/game/GameSession";
import { MatchResultScene } from "./MatchResultScene";
import { getActiveHunterWorldPos } from "@/core/cameras/TurnCamera";
import { BagButton } from "@/ui/buttons/BagButton";
import { RadialActionWheel } from "@/ui/buttons/RadialActionWheel";
import { RefocusButton } from "@/ui/buttons/RefocusButton";
import { PlayZone } from "@/ui/PlayZone";
import type { PilotedMercenary, MovableToken } from "@/types/entities";
import { LogsButton } from "@/ui/buttons/LogButton";
import { LogPanel } from "@/ui/LogPanel";
import { logMatchEvent } from "@/core/game/GameSession";
import { InspectButton } from "@/ui/buttons/InspectButton";
import {
	HunterSummaryPanel,
	type HunterSummaryEntry,
} from "@/ui/HunterSummaryPanel";
import { MonsterToken } from "@/entities/Monster";
import type { MonsterEntity } from "@/types/entities";
import { pointInCircle, pointInContainer } from "@/rendering/HitTest";

/** A chest placed on the map, tying its visual entity to its plan and position. */
interface PlacedChest {
	coord: RH.GridCoord;
	plan: RH.ChestPlan;
	entity: Chest;
}

/**
 * Tactical map scene — grid, mercenary, AP turns, cards, chests, win condition.
 * Every unit on the map (local or AI-piloted) is a PilotedMercenary in one
 * shared array — `pilot` is the only thing distinguishing them. Map/chest
 * content comes from GameSession (set by LoadingScene), not decided here.
 * @author ShaAnder
 */
export class MapScene implements Scene {
	readonly view = new Container();

	// Board layers
	private grid: RH.Grid;
	private boardContainer = new Container();
	private tilesContainer = new Container();
	private chestContainer = new Container();
	private mercenaryContainer = new Container();

	// Systems
	private camera: Camera;
	private moveController: MoveController;

	// Entities — one array, pilot type is the only thing distinguishing them
	private units: PilotedMercenary[] = [];
	private placedChests: PlacedChest[] = [];

	// Monster Entities
	private monsters: MonsterEntity[] = [];
	private static readonly MONSTER_TIERS: RH.MonsterTier[] = [
		"light",
		"medium",
		"heavy",
	];
	private monsterSpawnIndex = 0;

	// True during the Exit card's two-flight teleport sequence — blocks
	// End Turn / regenerate from interrupting mid-sequence, same role
	// mercenary.isAnimating plays for normal moves.
	private exitCardInProgress = false;
	private turnsTaken = 0;

	// Targeting mode — active while choosing which enemy to attack
	private targetingActive = false;

	private targetReticle = new Graphics();
	private attackRangeContainer = new Container();

	// Which AI unit is mid-fight, so onBattleComplete knows who to update
	private activeCombatUnit: PilotedMercenary | null = null;
	// Guards End Turn from re-firing while enemies are mid-move/mid-fight
	private processingEnemyTurns = false;
	private activeAi: PilotedMercenary | null = null;
	private activeMonster: MonsterEntity | null = null;

	// Character panel (top-right)
	private characterPanel: CharacterPanel;
	private deckTracker: DeckTracker;
	private inventoryPanel: InventoryPanel;

	// UI
	private bagButton: BagButton;
	private buttonBar: RadialActionWheel;
	private refocusButton: RefocusButton;
	private logsButton: LogsButton;
	private logPanel: LogPanel;
	private inspectButton: InspectButton;
	private hunterSummaryPanel: HunterSummaryPanel;
	private statsText: Text;
	private feedbackText: Text;
	private feedbackTimer = 0;

	// Item pickup popup — floats above the mercenary's head, placeholder
	// icon until real item sprites exist
	private itemPopup = new Container();
	private itemPopupIcon = new Graphics();
	private itemPopupText: Text;
	private itemPopupTimer = 0;

	// Cards
	private hand: Hand;
	private playZone: PlayZone;

	// traps
	private traps: RH.Trap[] = [];

	private trapMarkerContainer = new Container();

	// Map config — dimensions and seed come from GameSession (set by
	// LoadingScene) rather than being hardcoded, so mission map size
	// selection actually does something.
	private readonly ROOM_DENSITY = 1 / 50;
	private mapWidth: number;
	private mapHeight: number;
	private roomCount: number;
	private mapSeed: number;

	private readonly TILE_COLORS: Record<RH.TileType, number> = {
		[RH.TileType.Floor]: 0x3a3a3a,
		[RH.TileType.Wall]: 0x1a1a1a,
		[RH.TileType.Exit]: 0xd4af37,
	};

	private fpsAccumulator = 0;

	/** The one human-piloted unit. Assumes exactly one exists — the flagged multiplayer-identity debt this whole migration is paying down. */
	private get localUnit(): PilotedMercenary {
		const unit = this.units.find((u) => u.pilot === "local");
		if (!unit) throw new Error("MapScene: no local unit found");
		return unit;
	}

	private getUnitLabel(unit: PilotedMercenary): string {
		return unit.pilot === "local"
			? "You"
			: RH.hunterLabel(
					unit.state.name,
					unit.archetype!,
					unit.state.characterClass,
				);
	}

	/** Every UI surface hover/click should never reach board interaction through. Add a new panel here once — nothing else needs updating. */
	private get uiSurfaces(): Container[] {
		return [
			this.inventoryPanel.view,
			this.logPanel.view,
			this.hunterSummaryPanel.view,
			this.characterPanel.view,
			this.bagButton.view,
			this.logsButton.view,
			this.inspectButton.view,
			this.deckTracker.view,
			this.hand.view,
			this.playZone.view,
		];
	}

	/** Every AI-piloted unit — replaces the old `enemies` array. */
	private get aiUnits(): PilotedMercenary[] {
		return this.units.filter((u) => u.pilot === "ai");
	}

	constructor(private game: Game) {
		// Dimensions + seed come from the mission/LoadingScene setup. Falls
		// back to sane defaults for direct MapScene boots during dev.
		const mapSize = this.game.session.missionParams?.mapSize ?? "M";
		const dims = MAP_SIZE_DIMENSIONS[mapSize];
		this.mapWidth = dims.width;
		this.mapHeight = dims.height;
		this.roomCount = Math.floor(
			this.mapWidth * this.mapHeight * this.ROOM_DENSITY,
		);
		this.mapSeed =
			this.game.session.mapSeed ?? Math.floor(Math.random() * 1_000_000);

		// WE ADD THIS - So when a new match happens it's a fresh deck, without it
		// would try to carry old deck over
		this.game.session.sharedDeck = null;

		this.grid = this.buildMap();

		this.boardContainer.addChild(this.tilesContainer);
		this.boardContainer.addChild(this.chestContainer);
		this.boardContainer.addChild(this.mercenaryContainer);
		this.view.addChild(this.boardContainer);

		this.camera = new Camera(this.boardContainer, {
			initialZoom: 1.75,
			minZoom: 1.4,
			maxZoom: 4,
			panSpeed: 700,
		});

		this.applyCameraBounds();

		this.spawnLocalUnit();
		this.spawnEnemyHunters();

		// Item popup rides along as a child of the mercenary's own view,
		// so it moves with the token automatically — no manual per-frame
		// position syncing needed.
		this.itemPopupText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 12, fontWeight: "bold" },
		});
		this.itemPopupText.anchor.set(0.5, 1);
		this.itemPopup.addChild(this.itemPopupIcon, this.itemPopupText);

		this.targetReticle.visible = false;
		this.mercenaryContainer.addChild(this.targetReticle);

		this.spawnChests();

		this.characterPanel = new CharacterPanel();
		this.view.addChild(this.characterPanel.view);

		this.inventoryPanel = new InventoryPanel();
		this.inventoryPanel.setOnDrop((index) => {
			this.localUnit.state.items[index] = null;
			this.syncUI();
		});
		this.view.addChild(this.inventoryPanel.view);

		this.deckTracker = new DeckTracker();
		this.view.addChild(this.deckTracker.view);

		this.bagButton = new BagButton();
		this.view.addChild(this.bagButton.view);

		this.logsButton = new LogsButton();
		this.view.addChild(this.logsButton.view);

		this.logPanel = new LogPanel();
		this.view.addChild(this.logPanel.view);

		this.inspectButton = new InspectButton();
		this.view.addChild(this.inspectButton.view);

		this.hunterSummaryPanel = new HunterSummaryPanel();
		this.view.addChild(this.hunterSummaryPanel.view);

		this.playZone = new PlayZone();
		this.view.addChild(this.playZone.view);

		this.hand = new Hand(
			this.game.app.stage,
			this.playZone,
			(card: RH.CardData) => this.handleCardConfirmed(card),
		);
		this.view.addChild(this.hand.view);

		// Required so drag keeps tracking after the pointer leaves the card sprite
		this.game.app.stage.eventMode = "static";
		this.game.app.stage.hitArea = this.game.app.screen;

		// Top up to the full 5-card starting hand — the local unit's own
		// TurnManager already drew 1 via its own reset()→endTurn() cascade;
		// this draws the remaining 4.
		this.localUnit.turnManager.dealStartingHand();

		this.moveController = this.createMoveController();
		this.boardContainer.addChild(this.moveController.view);
		this.boardContainer.addChild(this.attackRangeContainer);

		// traps
		this.boardContainer.addChild(this.trapMarkerContainer);

		this.buttonBar = new RadialActionWheel();
		this.view.addChild(this.buttonBar.view);

		this.refocusButton = new RefocusButton();
		this.view.addChild(this.refocusButton.view);

		this.statsText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 14, fontFamily: "monospace" },
		});
		this.statsText.x = 12;
		this.statsText.y = 12;
		this.view.addChild(this.statsText);

		this.feedbackText = new Text({
			text: "",
			style: { fill: 0xffd700, fontSize: 16, fontWeight: "bold" },
		});
		this.feedbackText.visible = false;
		this.view.addChild(this.feedbackText);
	}

	/** Render the map, center the camera, and wire up input. */
	onEnter(): void {
		this.renderMap();
		this.centerCameraOnActiveHunter();
		this.camera.attach(this.game.app.canvas);
		this.hand.syncFromHand(this.localUnit.state.hand);
		this.layoutHud();
		this.syncUI();

		window.addEventListener("keydown", this.handleKeyDown);
		this.game.app.canvas.addEventListener("click", this.handleClick);
		this.game.app.canvas.addEventListener("mousemove", this.handleMouseMove);
	}

	/** Tear down visuals and input listeners. */
	onExit(): void {
		this.moveController.exit();
		this.buttonBar.closeMenu();
		this.boardContainer.removeChildren();
		this.camera.detach(this.game.app.canvas);
		window.removeEventListener("keydown", this.handleKeyDown);
		this.game.app.canvas.removeEventListener("click", this.handleClick);
		this.game.app.canvas.removeEventListener("mousemove", this.handleMouseMove);
	}

	/** Per-frame tick: camera, animation, camera follow, stats. */
	update(deltaTime: number): void {
		if (this.game.overlays.isOpen) return;

		this.camera.update(
			deltaTime,
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
		for (const unit of this.units) {
			unit.mercenary.update(deltaTime);
			unit.mercenary.view.alpha = unit.state.currentHp <= 0 ? 0.4 : 1;
		}
		for (const monster of this.monsters) {
			monster.token.update(deltaTime);
		}

		this.hand.update(deltaTime);
		this.buttonBar.update(deltaTime);
		this.inventoryPanel.update(deltaTime);

		// PASS 4 TODO: still assumes exactly one local unit ever needs the
		// camera to follow it — real judgment call, deferred deliberately.
		if (this.processingEnemyTurns && this.activeAi) {
			this.camera.lockTo({
				x: this.activeAi.mercenary.view.x,
				y: this.activeAi.mercenary.view.y,
			});
		} else if (this.processingEnemyTurns && this.activeMonster) {
			this.camera.lockTo({
				x: this.activeMonster.token.view.x,
				y: this.activeMonster.token.view.y,
			});
		} else if (this.processingEnemyTurns) {
			// Between individual units' turns — nothing specific is
			// "active" right now, but the whole cycle is still running.
			// Deliberately a no-op: holds whatever was last locked instead
			// of falling through to unlock() below, which was the actual
			// gap letting camera input sneak through mid-cycle.
		} else if (
			this.moveController.active ||
			this.localUnit.mercenary.isAnimating ||
			this.hand.isSelecting ||
			this.exitCardInProgress ||
			this.targetingActive
		) {
			this.camera.lockTo({
				x: this.localUnit.mercenary.view.x,
				y: this.localUnit.mercenary.view.y,
			});
		} else if (this.camera.isLocked) {
			this.camera.unlock();
		}

		if (this.feedbackTimer > 0) {
			this.feedbackTimer -= deltaTime;
			if (this.feedbackTimer <= 0) {
				this.feedbackText.visible = false;
			}
		}

		if (this.itemPopupTimer > 0) {
			this.itemPopupTimer -= deltaTime;
			if (this.itemPopupTimer <= 0) {
				this.itemPopup.visible = false;
			}
		}

		this.fpsAccumulator += deltaTime;
		if (this.fpsAccumulator >= 30) {
			this.fpsAccumulator = 0;
		}
	}

	/** Reposition UI on window resize. */
	onResize(_width: number): void {
		this.layoutHud();
		this.game.app.stage.hitArea = this.game.app.screen;
	}

	// ---------- Camera ----------

	private centerCameraOnActiveHunter(): void {
		const world = getActiveHunterWorldPos(this.game.session);
		this.camera.centerOn(
			world,
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
	}

	/** Builds the actual clamp function and hands it to the camera —
	 * converts the camera's world position to tile coordinates,
	 * clamps those (a true rectangle in tile space), then converts back.
	 */
	private applyCameraBounds(): void {
		const PADDING_TILES = 3;

		this.camera.setWorldClamp((worldPos) => {
			// Same inverse transform screenToGrid uses, but deliberately
			// without its rounding — rounding here is what caused the
			// camera to freeze, since it snapped every frame's small pan
			// motion back to the same tile center before it could ever
			// accumulate. We only need the exact fractional tile position
			// to check against bounds, never an actual discrete tile index.
			const a = worldPos.x / (TILE_WIDTH / 2);
			const b = worldPos.y / (TILE_HEIGHT / 2);
			const tileX = (a + b) / 2;
			const tileY = (b - a) / 2;

			const clampedTileX = Math.min(
				Math.max(tileX, -PADDING_TILES),
				this.grid.width + PADDING_TILES,
			);
			const clampedTileY = Math.min(
				Math.max(tileY, -PADDING_TILES),
				this.grid.height + PADDING_TILES,
			);

			// In bounds — return the exact original, untouched. Avoids
			// even a lossless round-trip through the transform when
			// nothing actually needed clamping.
			if (clampedTileX === tileX && clampedTileY === tileY) {
				return worldPos;
			}

			return gridToScreen({ x: clampedTileX, y: clampedTileY });
		});
	}

	private async beginPlayerTurn(): Promise<void> {
		this.camera.unlock();

		if (this.localUnit.state.currentHp <= 0) {
			await this.camera.panTo(
				{
					x: this.localUnit.mercenary.view.x,
					y: this.localUnit.mercenary.view.y,
				},
				500,
				this.game.app.screen.width,
				this.game.app.screen.height,
			);
			this.localUnit.state.currentHp = 1;
			this.localUnit.turnManager.endTurn();
			this.showFeedback("✨ You recover and get back up");
			this.turnsTaken++;
			this.trySpawnMonster();
			this.syncUI();
			void this.processEnemyTurns();
			return;
		}

		if (this.localUnit.state.stunnedTurnsRemaining > 0) {
			this.localUnit.state.stunnedTurnsRemaining -= 1;
			this.localUnit.turnManager.endTurn();
			this.showFeedback("🪤 You're stunned and can't act this turn");
			this.turnsTaken++;
			this.trySpawnMonster();
			this.syncUI();
			void this.processEnemyTurns();
			return;
		}

		this.setPlayerControlsVisible(true);
		this.camera.centerOn(
			{
				x: this.localUnit.mercenary.view.x,
				y: this.localUnit.mercenary.view.y,
			},
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
	}

	// ---------- Hud ----------

	private layoutHud(): void {
		const w = this.game.app.screen.width;
		const h = this.game.app.screen.height;

		this.characterPanel.layout(w, h);

		this.buttonBar.layout(w, h);
		this.refocusButton.layout(w - 40, h - 40, 280);
		this.bagButton.layout(
			this.characterPanel.view.x,
			this.characterPanel.view.y,
			this.characterPanel.panelHeight,
		);

		this.inspectButton.layout(this.bagButton.view.x, this.bagButton.view.y);
		this.hunterSummaryPanel.layout(
			this.bagButton.view.x,
			this.bagButton.view.y + 56,
		);

		this.logsButton.layout(
			this.inspectButton.view.x,
			this.inspectButton.view.y,
		);
		this.logPanel.layout(this.bagButton.view.x, this.bagButton.view.y + 56);

		this.inventoryPanel.layoutRightOfCharacter(
			this.characterPanel.view.x,
			this.characterPanel.view.y,
			this.characterPanel.panelWidth,
		);
		this.deckTracker.layout(w);
		this.hand.resize(w, h);
		this.game.app.stage.hitArea = this.game.app.screen;
		this.playZone.layout(w / 2, h / 2);
	}

	// ---------- Move ----------

	/**
	 * Toggle Move: cancel if aiming/selecting, else open card selection.
	 * Filter excludes Attack and blue if already played this turn.
	 */
	private handleMovePressed(): void {
		if (this.moveController.active) {
			this.moveController.exit();
			this.buttonBar.setMoveActive(false);
			return;
		}
		if (this.hand.isSelecting) {
			this.hand.exitSelectionMode();
			this.buttonBar.setMoveActive(false);
			return;
		}

		this.resetActionState();

		const tm = this.localUnit.turnManager;
		if (!tm.canMove) return;

		this.hand.enterSelectionMode((data) => data.actionType !== "attack");
		this.buttonBar.setMoveActive(true);
		this.buttonBar.closeMenu();
	}

	/** Commit a move: update position, deduct tiles, animate, check chest/win. */
	private async onMoveCommitted(
		target: RH.GridCoord,
		path: RH.GridCoord[],
		ignoresZoc: boolean,
	): Promise<void> {
		const local = this.localUnit;

		const { truncatedPath, hazardHit } = this.resolveTrapsAlongPath(
			local,
			path,
		);

		local.state.coord =
			truncatedPath.length > 0
				? truncatedPath[truncatedPath.length - 1]
				: local.state.coord;
		local.turnManager.commitMove(truncatedPath.length);
		this.buttonBar.setMoveActive(false);
		this.moveController.exit();

		if (ignoresZoc) {
			await local.mercenary.moveAlongPath(truncatedPath);
		} else {
			await this.moveEntityWithZoneStrikes(
				{ state: local.state, token: local.mercenary },
				truncatedPath,
				this.getUnitLabel(local),
			);
		}

		if (hazardHit) {
			this.applyHazardEffect(local, hazardHit.kind, hazardHit.result);
		}
		this.renderTrapMarkers();

		this.tryOpenChestAt(local.state, target);
		await this.checkWinCondition(local);

		this.syncUI();
	}

	/** Hide player controls while AI resolves overworld turns. */
	private setPlayerControlsVisible(visible: boolean): void {
		this.hand.view.visible = visible;
		this.buttonBar.view.visible = visible;
		if (!visible) {
			this.hand.exitSelectionMode();
			this.buttonBar.closeMenu();
			this.buttonBar.setMoveActive(false);
			this.moveController.exit();
		}
	}

	// ---------- Zone of Control ----------

	private buildZoneOwners(excludeId: string): RH.ZoneOwner[] {
		return this.units
			.filter(
				(u) =>
					u.state.id !== excludeId &&
					u.state.currentHp > 0 &&
					RH.isMeleeClass(u.state.characterClass),
			)
			.map((u) => ({ id: u.state.id, coord: u.state.coord, zocRadius: 2 }));
	}

	private buildThreatZoneOwners(excludeId: string): RH.ThreatOwner[] {
		return this.units
			.filter(
				(u) =>
					u.state.id !== excludeId &&
					u.state.currentHp > 0 &&
					RH.isMeleeClass(u.state.characterClass),
			)
			.map((u) => ({
				id: u.state.id,
				coord: u.state.coord,
				zocRadius: 2,
				stats: u.state.stats,
			}));
	}

	/**
	 * Animates a path in segments, pausing exactly at each zone crossing to
	 * apply the reaction strike and log it. Works for ANY entity with a
	 * mutable RH.EntityCore-shaped state and a MovableToken — hunters and
	 * monsters both satisfy this structurally, so this single function
	 * replaces what used to be two near-identical copies (moveWithZoneStrikes
	 * for hunters, moveMonsterWithZoneStrikes for monsters).
	 */
	private async moveEntityWithZoneStrikes(
		entity: { state: RH.EntityCore; token: MovableToken },
		path: RH.GridCoord[],
		label: string,
	): Promise<void> {
		const owners = this.buildZoneOwners(entity.state.id);
		const crossings = RH.findZonesCrossed(this.grid, path, owners);

		let segmentStart = 0;
		for (const crossing of crossings) {
			const segment = path.slice(segmentStart, crossing.pathIndex + 1);
			if (segment.length > 0) {
				await entity.token.moveAlongPath(segment);
			}
			segmentStart = crossing.pathIndex + 1;

			const ownerUnit = this.units.find(
				(u) => u.state.id === crossing.owner.id,
			);
			if (ownerUnit) {
				const strike = RH.resolveReactionStrike(
					ownerUnit.state.stats,
					entity.state.stats,
				);
				entity.state.currentHp -= strike.damage;
				this.showFeedback(
					`⚔ ${label} entered ${this.getUnitLabel(ownerUnit)}'s zone of control — took ${strike.damage} damage`,
				);
				await this.delay(400);
			}
		}

		const remaining = path.slice(segmentStart);
		if (remaining.length > 0) {
			await entity.token.moveAlongPath(remaining);
		}
	}

	// ---------- Chests & Items ----------

	/** Place chests from the session plan onto walkable tiles. No-ops if plan is missing. */
	private spawnChests(): void {
		this.chestContainer.removeChildren();
		this.placedChests = [];

		const sessionPlacements = this.game.session.chestPlacements;
		if (sessionPlacements && sessionPlacements.length > 0) {
			for (const record of sessionPlacements) {
				const entity = new Chest(record.coord);
				this.chestContainer.addChild(entity.view);
				this.placedChests.push({
					coord: record.coord,
					plan: record.plan,
					entity,
				});
			}
			return;
		}

		const plan = this.game.session.chestPlan;
		if (!plan) return;

		// No exit at match start — only reserve the local spawn tile.
		const used = new Set<string>();
		used.add(RH.coordKey(this.localUnit.state.coord));

		for (const chestPlan of plan.chests) {
			const coord = RH.pickSpreadWalkableTile(this.grid, used);
			if (!coord) break;
			used.add(RH.coordKey(coord));
			const entity = new Chest(coord);
			this.chestContainer.addChild(entity.view);
			this.placedChests.push({ coord, plan: chestPlan, entity });
		}
	}

	private isPointOverUiSurface(screenX: number, screenY: number): boolean {
		return this.uiSurfaces.some((c) => pointInContainer(screenX, screenY, c));
	}

	/** Open the chest at coord if unopened, for whichever unit reached it. Stays closed if inventory full. */
	private tryOpenChestAt(state: RH.MercenaryState, coord: RH.GridCoord): void {
		const placed = this.placedChests.find(
			(c) => !c.entity.isOpen && c.coord.x === coord.x && c.coord.y === coord.y,
		);
		if (!placed) return;

		if (!state.items.some((i) => i === null)) {
			if (state.id === this.localUnit.state.id) {
				this.showFeedback("🎒 Inventory full — chest left unopened");
			}
			return;
		}

		placed.entity.open();
		const emptyIndex = state.items.findIndex((i) => i === null);
		state.items[emptyIndex] = placed.plan.item;

		const isLocal = state.id === this.localUnit.state.id;
		if (placed.plan.isTarget) {
			this.game.session.relicFound = true;
			this.spawnExitFarFrom(coord);
			this.renderMap();
			this.showFeedback(
				isLocal
					? `🎯 Found the target: ${placed.plan.item.name}! The Exit has revealed itself.`
					: "⚠️ An enemy hunter found the target item! The Exit has revealed itself.",
			);
		} else if (isLocal) {
			this.showFeedback(`📦 Found: ${placed.plan.item.name}`);
		}

		if (isLocal) this.showItemPopup(placed.plan.item, placed.plan.isTarget);
	}

	/**
	 * Spawns the match Exit far from the relic-find location. No exit
	 * exists on the grid until this runs. Occupied hunter/monster tiles
	 * and the find tile itself are blocked.
	 */
	private spawnExitFarFrom(from: RH.GridCoord): void {
		if (RH.findExitTile(this.grid)) return;

		const blocked = new Set<string>();
		blocked.add(RH.coordKey(from));
		for (const u of this.units) {
			if (u.state.currentHp > 0) blocked.add(RH.coordKey(u.state.coord));
		}
		for (const m of this.monsters) {
			if (m.state.currentHp > 0) blocked.add(RH.coordKey(m.state.coord));
		}

		const exitCoord = RH.pickExitFarFrom(this.grid, from, blocked, 0.35);
		if (!exitCoord) {
			const fallback = RH.pickSpreadWalkableTile(this.grid, blocked, 1, 1);
			if (!fallback) return;
			this.grid.setTileType(fallback, RH.TileType.Exit);
			return;
		}
		this.grid.setTileType(exitCoord, RH.TileType.Exit);
	}

	/** Float an icon + item name above the mercenary's head briefly. */
	private showItemPopup(item: RH.ItemData, isTarget: boolean): void {
		this.itemPopupIcon.clear();
		this.itemPopupIcon.circle(0, -46, 10);
		this.itemPopupIcon.fill(isTarget ? 0xffd700 : 0xffffff);
		this.itemPopupIcon.stroke({ width: 2, color: 0x000000, alpha: 0.6 });

		this.itemPopupText.text = item.name;
		this.itemPopupText.y = -58;

		this.itemPopup.visible = true;
		this.itemPopupTimer = 90;
	}

	// ---------- Enemy AI ----------

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
		return this.units
			.filter((u) => u.state.id !== excludeId && u.state.currentHp > 0)
			.map((u) => this.toCombatant(u.state));
	}

	private async processEnemyTurns(): Promise<void> {
		this.processingEnemyTurns = true;
		this.camera.setInputLocked(true);
		this.setPlayerControlsVisible(false);

		const BETWEEN_AI_MS = 600;

		let isFirst = true;
		for (const unit of this.aiUnits) {
			if (unit.state.currentHp <= 0) {
				if (!isFirst) await this.delay(BETWEEN_AI_MS);
				isFirst = false;
				await this.processRecoveryTurn(unit);
				continue;
			}

			if (!isFirst) {
				await this.delay(BETWEEN_AI_MS);
			}
			isFirst = false;
			unit.turnManager.endTurn();
			await this.processOneEnemyTurn(unit);
			this.trySpawnMonster();
		}

		await this.processMonsterTurns();

		this.processingEnemyTurns = false;
		this.camera.setInputLocked(false);
		this.beginPlayerTurn();

		this.syncUI();
	}

	private async processOneEnemyTurn(unit: PilotedMercenary): Promise<void> {
		// AI units always have both — guard for the type
		if (!unit.archetype || !unit.memory) return;
		this.activeAi = unit;
		this.camera.centerOn(
			{ x: unit.mercenary.view.x, y: unit.mercenary.view.y },
			this.game.app.screen.width,
			this.game.app.screen.height,
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

		const chestInfos: RH.ChestInfo[] = this.placedChests.map((c) => ({
			coord: c.coord,
			isOpen: c.entity.isOpen,
		}));

		const exitCoord = RH.findExitTile(this.grid);
		const monsterCoords = this.livingMonsters().map((m) => m.state.coord);
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
			this.showFeedback(`🤔 ${this.getUnitLabel(unit)} avoids a fight`);
			const visibleTraps = this.trapsVisibleTo(unit);
			const blocked = new Set([
				...others.map((o) => RH.coordKey(o.coord)),
				...this.livingMonsterCoords().map(RH.coordKey),
				...visibleTraps.map((t) => RH.coordKey(t.coord)),
			]);

			// Uncapped range purely to read the real, wall-aware path distance to
			// the target — not a straight-line guess, which could send AI toward
			// a card it doesn't actually need if the direct route is blocked.
			const uncappedRange = RH.computeMovementRange(
				this.grid,
				unit.state.coord,
				this.grid.width * this.grid.height,
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

			const threatOwners = this.buildThreatZoneOwners(unit.state.id);
			const range = RH.computeMovementRangeWeighted(
				this.grid,
				unit.state.coord,
				moveBudget,
				blocked,
				threatOwners,
				unit.state.stats,
				unit.archetype,
			);
			const reachable =
				RH.findNearestReachableTile(this.grid, range, target, blocked) ??
				unit.state.coord;
			const path = RH.getPathTo(range, reachable) ?? [];

			const threatFraction = RH.computePathThreatFraction(
				this.grid,
				path,
				threatOwners,
				unit.state.stats,
				unit.state.currentHp,
			);
			const tooRisky =
				threatFraction > RH.ARCHETYPE_ZOC_REFUSAL_THRESHOLD[unit.archetype];
			if (tooRisky) {
				this.showFeedback(
					`⚠️ ${this.getUnitLabel(unit)} avoids a zone of control`,
				);
			}

			if (path.length > 0 && !tooRisky) {
				const cardType = moveCard?.color ?? "none";
				if (unit.turnManager.beginMovement(cardType, cardBonus)) {
					if (moveCard) {
						const idx = unit.state.hand.findIndex((c) => c.id === moveCard.id);
						if (idx !== -1) unit.state.hand.splice(idx, 1);
					}

					const { truncatedPath, hazardHit } = this.resolveTrapsAlongPath(
						unit,
						path,
					);

					unit.state.coord =
						truncatedPath.length > 0
							? truncatedPath[truncatedPath.length - 1]
							: unit.state.coord;
					unit.turnManager.commitMove(truncatedPath.length);
					this.showFeedback(
						`🏃 ${this.getUnitLabel(unit)} moves toward its target`,
					);
					await this.moveEntityWithZoneStrikes(
						{ state: unit.state, token: unit.mercenary },
						truncatedPath,
						this.getUnitLabel(unit),
					);
					if (hazardHit) {
						this.applyHazardEffect(unit, hazardHit.kind, hazardHit.result);
					}
					this.renderTrapMarkers();
				}
			}
		}

		this.tryOpenChestAt(unit.state, unit.state.coord);
		await this.checkWinCondition(unit);

		const selfAfter = this.toCombatant(unit.state);
		const othersAfter = this.buildOtherCombatants(unit.state.id);
		// Engagement decision uses pre-approach HP specifically — a ZoC
		// tick taken reaching the target shouldn't retroactively cancel
		// the fight it was risked for. Real post-move HP (selfAfter) is
		// still what runFallbackBehavior uses below if no fight happens.
		const selfForEngagement = { ...selfAfter, currentHp: preMoveHp };
		const engagementRange = RH.getRangeForClass(unit.state.characterClass);
		const engagementTiles = RH.computeAttackRange(
			this.grid,
			unit.state.coord,
			unit.state.characterClass,
			engagementRange,
		);
		const inRangeKeys = new Set(
			engagementTiles.map((t) => `${t.coord.x},${t.coord.y}`),
		);

		const victim = RH.pickEngagementTarget(
			unit.archetype,
			selfForEngagement,
			othersAfter,
			inRangeKeys,
		);

		if (victim) {
			const victimUnit = this.units.find((u) => u.state.id === victim.id);
			const canFight =
				victimUnit &&
				victimUnit.state.currentHp > 0 &&
				unit.turnManager.spendAttack();

			if (canFight && victimUnit) {
				this.showFeedback(
					`⚔ ${this.getUnitLabel(unit)} attacks ${this.getUnitLabel(victimUnit)}`,
				);

				if (victimUnit.pilot === "local") {
					this.showTargetMarker(victimUnit.mercenary);
					await this.delay(500);
					this.hideTargetMarker();
					await this.aiInitiateCombat(unit, victimUnit);
				} else {
					this.showTargetMarker(victimUnit.mercenary);
					await this.delay(500);
					this.hideTargetMarker();
					await this.resolveAiVsAi(unit, victimUnit);
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
			this.game.app.screen.width,
			this.game.app.screen.height,
		);

		unit.state.currentHp = 1;
		unit.turnManager.endTurn();
		this.showFeedback(
			`✨ ${this.getUnitLabel(unit)} recovers and gets back up`,
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
		if (fallback === "rest" && unit.turnManager.spendRest()) {
			RH.clearFleeMemory(unit.memory);
			this.showFeedback(`💤 ${unit.archetype} hunter rests`);
		} else if (fallback === "retreat" && unit.turnManager.beginDisengage()) {
			const retreatBlocked = new Set(
				othersAfter.map((o) => RH.coordKey(o.coord)),
			);
			const retreatRange = RH.computeMovementRange(
				this.grid,
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
					this.showFeedback(`💨 ${this.getUnitLabel(unit)} uses Disengage`);
					unit.state.coord = retreatTile;
					RH.recordFlee(unit.memory, retreatFrom, retreatTile);
					// No applyZoneStrikes — Disengage is ZoC-immune, that's its whole point.
					await unit.mercenary.moveAlongPath(retreatPath);
				}
			}
		}
	}

	private async processMonsterTurns(): Promise<void> {
		const MONSTER_DELAY_MS = 400;
		let isFirst = true;

		for (const monster of this.livingMonsters()) {
			if (!isFirst) await this.delay(MONSTER_DELAY_MS);
			isFirst = false;
			await this.processOneMonsterTurn(monster);
		}
	}

	private async processOneMonsterTurn(monster: MonsterEntity): Promise<void> {
		this.activeMonster = monster;
		this.camera.centerOn(
			{ x: monster.token.view.x, y: monster.token.view.y },
			this.game.app.screen.width,
			this.game.app.screen.height,
		);

		const targetItemId = this.game.session.chestPlan?.targetItem?.id ?? null;
		const hunters: RH.MonsterTargetCandidate[] = this.units
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

		const targetUnit = this.units.find(
			(u) => u.state.id === targetCandidate.id,
		);
		if (!targetUnit) {
			this.activeMonster = null;
			return;
		}

		const isAdjacentNow = RH.isAdjacent(
			monster.state.coord,
			targetUnit.state.coord,
		);

		if (!isAdjacentNow) {
			const blocked = new Set([
				...this.units
					.filter((u) => u.state.currentHp > 0)
					.map((u) => RH.coordKey(u.state.coord)),
				...this.livingMonsterCoords()
					.filter(
						(c) =>
							!(c.x === monster.state.coord.x && c.y === monster.state.coord.y),
					)
					.map(RH.coordKey),
			]);
			const range = RH.computeMovementRange(
				this.grid,
				monster.state.coord,
				monster.state.stats.movement,
				blocked,
			);
			const reachable =
				RH.findNearestReachableTile(
					this.grid,
					range,
					targetUnit.state.coord,
					blocked,
				) ?? monster.state.coord;
			const path = RH.getPathTo(range, reachable) ?? [];

			if (path.length > 0) {
				monster.state.coord = reachable;
				await this.moveEntityWithZoneStrikes(
					monster,
					path,
					`A ${monster.state.tier} monster`,
				);
			}
		}

		if (RH.isAdjacent(monster.state.coord, targetUnit.state.coord)) {
			await this.monsterAttack(monster, targetUnit);
		}

		this.activeMonster = null;
	}

	private async monsterAttack(
		monster: MonsterEntity,
		target: PilotedMercenary,
	): Promise<void> {
		const monsterAsState = RH.monsterAsMercenaryState(monster.state);
		const tierLabel = `${monster.state.tier[0].toUpperCase()}${monster.state.tier.slice(1)} Monster`;

		await new Promise<void>((resolve) => {
			void this.game.overlays.show(
				new BattleOverlay(
					this.game,
					monsterAsState,
					target.state,
					async (result) => {
						monster.state.currentHp = monsterAsState.currentHp;
						if (result.attackerMonsterDied) {
							this.removeMonster(monster);
						}
						if (result.defenderNeedsTeleport) {
							this.teleportEntity(target.state, target.mercenary);
						}
						resolve();
					},
					0x8b0000,
					tierLabel,
					target.pilot === "local"
						? 0x4a9eff
						: RH.ARCHETYPE_COLORS[target.archetype!],
					target.pilot === "local" ? "You" : target.state.name,
					"balanced",
					target.archetype ?? "balanced",
					target.pilot === "local" ? "defender" : "none",
					monster.state.coord,
					target.state.coord,
					false,
					undefined,
					true,
				),
			);
		});
	}

	/** Player is defender — existing interactive BattleOverlay. */
	private async aiInitiateCombat(
		attacker: PilotedMercenary,
		defender: PilotedMercenary,
	): Promise<void> {
		this.activeCombatUnit = defender;

		await new Promise<void>((resolve) => {
			void this.game.overlays.show(
				new BattleOverlay(
					this.game,
					attacker.state,
					defender.state,
					async (result) => {
						if (result.attackerNeedsTeleport) {
							this.teleportEntity(attacker.state, attacker.mercenary);
						}
						if (result.defenderNeedsTeleport) {
							this.teleportEntity(defender.state, defender.mercenary);
						}
						resolve();
					},
					RH.ARCHETYPE_COLORS[attacker.archetype!],
					attacker.state.name,
					0x4a9eff,
					"You",
					attacker.archetype!,
					"balanced",
					"defender",
					attacker.state.coord,
					defender.state.coord,
					!RH.isAdjacent(attacker.state.coord, defender.state.coord),
				),
			);
		});
	}

	/**
	 * AI vs AI: both sides auto-pick via chooseCombatAction, resolve through
	 * shared combat, apply HP/loot. Same BattleOverlay pipeline, spectator mode.
	 */
	private async resolveAiVsAi(
		attacker: PilotedMercenary,
		defender: PilotedMercenary,
	): Promise<void> {
		await new Promise<void>((resolve) => {
			void this.game.overlays.show(
				new BattleOverlay(
					this.game,
					attacker.state,
					defender.state,
					async (result) => {
						if (result.attackerNeedsTeleport) {
							this.teleportEntity(attacker.state, attacker.mercenary);
						}
						if (result.defenderNeedsTeleport) {
							this.teleportEntity(defender.state, defender.mercenary);
						}
						resolve();
					},
					RH.ARCHETYPE_COLORS[attacker.archetype!],
					attacker.state.name,
					RH.ARCHETYPE_COLORS[defender.archetype!],
					defender.state.name,
					attacker.archetype!,
					defender.archetype!,
					"none",
					attacker.state.coord,
					defender.state.coord,
					!RH.isAdjacent(attacker.state.coord, defender.state.coord),
				),
			);
		});
	}

	// ---------- Spawn ----------

	private static readonly ENEMY_COLORS = [
		0xe67e22, 0x9b59b6, 0x1abc9c,
	] as const;

	private static readonly ENEMY_ARCHETYPES: RH.AiArchetype[] = [
		"aggressive",
		"treasure",
		"balanced",
	];

	private spawnLocalUnit(): void {
		const state = this.spawnMercenary();
		const mercenary = new Mercenary(state.coord);
		this.mercenaryContainer.addChild(mercenary.view);

		const turnManager = new TurnManager(
			() => state,
			() => (this.game.session.sharedDeck ??= RH.buildSharedDeck()),
			() => this.syncUI(),
		);

		this.units.push({ pilot: "local", state, mercenary, turnManager });
	}

	private spawnEnemyHunters(): void {
		this.units = this.units.filter((u) => u.pilot === "local");

		const used = new Set<string>();
		used.add(RH.coordKey(this.localUnit.state.coord));
		const exitTile = RH.findExitTile(this.grid);
		if (exitTile) used.add(RH.coordKey(exitTile));

		for (let i = 0; i < MapScene.ENEMY_ARCHETYPES.length; i++) {
			const archetype = MapScene.ENEMY_ARCHETYPES[i];
			const coord = this.pickEnemySpawnTile(used) ?? {
				x: this.localUnit.state.coord.x + 2 + i,
				y: this.localUnit.state.coord.y,
			};
			used.add(RH.coordKey(coord));

			const aiClass =
				RH.ALL_CLASSES[Math.floor(Math.random() * RH.ALL_CLASSES.length)];
			const aiName = RH.generateHunterName();

			const state = RH.createMercenary(
				`enemy_${archetype}_${i}`,
				coord,
				{
					movement: 3 + (archetype === "aggressive" ? 1 : 0),
					attack: archetype === "aggressive" ? 4 : 3,
					defense: archetype === "treasure" ? 3 : 2,
					maxHp: 15,
					ap: 3,
				},
				aiClass,
				aiName,
			);
			const mercenary = new Mercenary(
				coord,
				MapScene.ENEMY_COLORS[i] ?? 0xe67e22,
			);
			this.mercenaryContainer.addChild(mercenary.view);

			const turnManager = new TurnManager(
				() => state,
				() => (this.game.session.sharedDeck ??= RH.buildSharedDeck()),
				() => {},
			);

			this.units.push({
				pilot: "ai",
				state,
				mercenary,
				turnManager,
				archetype,
				memory: RH.createAiMemory(),
			});
		}
	}

	private buildHunterVisualInfo(u: PilotedMercenary): { accentColor: number } {
		return {
			accentColor:
				u.pilot === "local" ? 0x4a9eff : RH.ARCHETYPE_COLORS[u.archetype!],
		};
	}

	private buildHunterSummaryEntries(): HunterSummaryEntry[] {
		return this.units.map((u) => ({
			id: u.state.id,
			label: this.getUnitLabel(u),
			...this.buildHunterVisualInfo(u),
			currentHp: u.state.currentHp,
			maxHp: u.state.stats.maxHp,
			items: u.state.items,
		}));
	}

	private buildHunterScoreEntries(): HunterScoreEntry[] {
		return this.units.map((u) => ({
			label: u.pilot === "local" ? "You" : u.state.name,
			...this.buildHunterVisualInfo(u),
			matchScore: u.state.matchScore,
		}));
	}

	private trySpawnMonster(): void {
		if (!RH.shouldSpawnMonster(this.monsters.length)) return;

		const used = new Set<string>(
			this.units.map((u) => RH.coordKey(u.state.coord)),
		);
		for (const m of this.monsters) used.add(RH.coordKey(m.state.coord));

		const coord = this.pickEnemySpawnTile(used);
		if (!coord) return;

		const tier =
			MapScene.MONSTER_TIERS[
				this.monsterSpawnIndex % MapScene.MONSTER_TIERS.length
			];
		this.monsterSpawnIndex++;

		const state = RH.createMonster(
			`monster_${Date.now()}_${this.monsterSpawnIndex}`,
			tier,
			coord,
		);
		const token = new MonsterToken(coord, tier);
		this.mercenaryContainer.addChild(token.view);

		this.monsters.push({ state, token });
		this.showFeedback(`👹 A ${tier} monster appears!`);
	}

	private livingMonsterCoords(): RH.GridCoord[] {
		return this.livingMonsters().map((m) => m.state.coord);
	}

	private livingMonsters(): MonsterEntity[] {
		return this.monsters.filter((m) => m.state.currentHp > 0);
	}

	/** Removes a dead monster from the board entirely — array entry and visual token both, not just letting HP sit at 0 forever. */
	private removeMonster(monster: MonsterEntity): void {
		const index = this.monsters.indexOf(monster);
		if (index !== -1) this.monsters.splice(index, 1);
		this.mercenaryContainer.removeChild(monster.token.view);
		monster.token.view.destroy({ children: true });
	}

	private pickEnemySpawnTile(used: Set<string>): RH.GridCoord | null {
		const preferred: RH.GridCoord[] = [];
		const fallback: RH.GridCoord[] = [];
		const px = this.localUnit.state.coord.x;
		const py = this.localUnit.state.coord.y;

		for (let x = 0; x < this.grid.width; x++) {
			for (let y = 0; y < this.grid.height; y++) {
				const coord = { x, y };
				if (!this.grid.isWalkable(coord)) continue;
				if (used.has(RH.coordKey(coord))) continue;
				fallback.push(coord);
				const dist = Math.abs(x - px) + Math.abs(y - py);
				if (dist >= 4) preferred.push(coord);
			}
		}

		const pool = preferred.length > 0 ? preferred : fallback;
		if (pool.length === 0) return null;
		return pool[Math.floor(Math.random() * pool.length)];
	}

	/** Win check: standing on Exit with target held, via normal move only. PASS 4 TODO: local-only, revisit for multiplayer. */
	private async checkWinCondition(unit: PilotedMercenary): Promise<void> {
		const exitTile = RH.findExitTile(this.grid);
		if (!exitTile) return;
		if (unit.state.coord.x !== exitTile.x || unit.state.coord.y !== exitTile.y)
			return;

		if (this.isCarryingTarget(unit)) {
			if (unit.pilot === "local") {
				this.triggerWin();
			} else {
				this.triggerLoss(unit);
			}
			return;
		}

		this.showFeedback(
			`🌀 ${this.getUnitLabel(unit)} reached the exit without the relic and was cast away`,
		);
		await this.teleportEntity(unit.state, unit.mercenary);
	}

	/** Whether the given unit currently holds this match's target item. */
	private isCarryingTarget(unit: PilotedMercenary): boolean {
		const target = this.game.session.chestPlan?.targetItem;
		if (!target) return false;
		return unit.state.items.some((item) => item?.id === target.id);
	}

	/** Record the match result and transition to MatchResultScene. */
	private triggerWin(): void {
		this.game.session.matchResult = {
			won: true,
			turnsTaken: this.turnsTaken,
			itemsExtracted: this.localUnit.state.items.filter((i) => i !== null)
				.length,
			hunterScores: this.buildHunterScoreEntries(),
		};
		void this.game.sceneManager.changeScene(new MatchResultScene(this.game));
	}

	/** An AI hunter reached the exit with the target first — a real loss, not a variant of winning. */
	private triggerLoss(winner: PilotedMercenary): void {
		this.showFeedback(`${this.getUnitLabel(winner)} escaped with the relic!`);
		this.game.session.matchResult = {
			won: false,
			turnsTaken: this.turnsTaken,
			itemsExtracted: 0,
			hunterScores: this.buildHunterScoreEntries(),
		};
		void this.game.sceneManager.changeScene(new MatchResultScene(this.game));
	}

	// ---------- Actions ----------

	/** Toggle targeting mode. Requires AP for Attack up front — no point entering otherwise. */
	private handleAttack(): void {
		if (this.targetingActive) {
			this.exitTargetingMode();
			return;
		}
		if (!this.localUnit.turnManager.canAttack) {
			this.showFeedback("⚔ Not enough AP to attack");
			return;
		}
		if (this.livingEnemies().length === 0) {
			this.showFeedback("⚔ No enemies on the map");
			return;
		}

		this.resetActionState();
		this.enterTargetingMode();
	}

	/** All AI units still standing — the only valid targeting candidates. */
	private livingEnemies(): PilotedMercenary[] {
		return this.aiUnits.filter((u) => u.state.currentHp > 0);
	}

	private enterTargetingMode(): void {
		const candidates = this.livingEnemies();
		if (candidates.length === 0) return;

		this.targetingActive = true;
		this.game.app.canvas.style.cursor = "crosshair";
		this.renderAttackRange();
	}

	private exitTargetingMode(): void {
		this.targetingActive = false;
		this.attackRangeContainer.removeChildren();
		this.game.app.canvas.style.cursor = "default";
	}

	private renderAttackRange(): void {
		this.attackRangeContainer.removeChildren();
		const local = this.localUnit.state;
		const range = RH.getRangeForClass(local.characterClass);
		const tiles = RH.computeAttackRange(
			this.grid,
			local.coord,
			local.characterClass,
			range,
		);

		for (const tile of tiles) {
			const pos = gridToScreen(tile.coord);
			const g = new Graphics();
			g.poly([
				0,
				-TILE_HEIGHT / 2,
				TILE_WIDTH / 2,
				0,
				0,
				TILE_HEIGHT / 2,
				-TILE_WIDTH / 2,
				0,
			]);
			g.fill({
				color: tile.quality === "clear" ? 0xffd700 : 0xe74c3c,
				alpha: 0.35,
			});
			g.x = pos.x;
			g.y = pos.y;
			this.attackRangeContainer.addChild(g);
		}
	}

	/** Points the shared marker at any entity's token — used by the player's manual targeting, and by any AI/monster/boss engagement preview. */
	private showTargetMarker(target: { view: { x: number; y: number } }): void {
		this.targetReticle.visible = true;
		this.targetReticle.clear();
		this.targetReticle.poly([0, 0, 8, -12, -8, -12]);
		this.targetReticle.fill(0xffd700);
		this.targetReticle.x = target.view.x;
		this.targetReticle.y = target.view.y - 50;
	}

	private hideTargetMarker(): void {
		this.targetReticle.visible = false;
	}

	/** Range-checks the target, spends AP, opens BattleOverlay if valid. */
	private tryStartCombat(unit: PilotedMercenary): void {
		if (!unit || unit.state.currentHp <= 0) return;

		const local = this.localUnit.state;
		const range = RH.getRangeForClass(local.characterClass);
		const inRangeTiles = RH.computeAttackRange(
			this.grid,
			local.coord,
			local.characterClass,
			range,
		);
		const inRange = inRangeTiles.some(
			(t) =>
				t.coord.x === unit.state.coord.x && t.coord.y === unit.state.coord.y,
		);

		if (!inRange) {
			this.showFeedback("⚔ Target out of range");
			return;
		}
		if (!this.localUnit.turnManager.spendAttack()) return;

		this.exitTargetingMode();
		this.activeCombatUnit = unit;

		void this.game.overlays.show(
			new BattleOverlay(
				this.game,
				local,
				unit.state,
				(result) => this.onBattleComplete(result),
				0x4a9eff,
				"You",
				RH.ARCHETYPE_COLORS[unit.archetype!],
				unit.state.name,
				"balanced",
				unit.archetype!,
				"attacker",
				local.coord,
				unit.state.coord,
				!RH.isAdjacent(local.coord, unit.state.coord),
			),
		);
	}

	private tryStartCombatVsMonster(monster: MonsterEntity): void {
		const local = this.localUnit.state;
		const range = RH.getRangeForClass(local.characterClass);
		const inRangeTiles = RH.computeAttackRange(
			this.grid,
			local.coord,
			local.characterClass,
			range,
		);
		const inRange = inRangeTiles.some(
			(t) =>
				t.coord.x === monster.state.coord.x &&
				t.coord.y === monster.state.coord.y,
		);
		if (!inRange) {
			this.showFeedback("⚔ Target out of range");
			return;
		}
		if (!this.localUnit.turnManager.spendAttack()) return;

		this.exitTargetingMode();

		const monsterAsState = RH.monsterAsMercenaryState(monster.state);
		const tierLabel = `${monster.state.tier[0].toUpperCase()}${monster.state.tier.slice(1)} Monster`;

		void this.game.overlays.show(
			new BattleOverlay(
				this.game,
				local,
				monsterAsState,
				(result) => {
					monster.state.currentHp = monsterAsState.currentHp;
					if (result.defenderMonsterDied) this.removeMonster(monster);
					if (result.attackerNeedsTeleport) {
						this.teleportEntity(this.localUnit.state, this.localUnit.mercenary);
					}
					this.syncUI();
				},
				0x4a9eff,
				"You",
				0x8b0000,
				tierLabel,
				"balanced",
				"balanced",
				"attacker",
				local.coord,
				monster.state.coord,
				!RH.isAdjacent(local.coord, monster.state.coord),
				undefined,
				false,
				true,
			),
		);
	}

	/**
	 * Click-to-target: hit-tests the click against every living AI token
	 * in board-local space. Only active while targeting; a miss is a
	 * no-op, doesn't cancel targeting.
	 */
	private handleTargetClick(screenX: number, screenY: number): boolean {
		if (!this.targetingActive) return false;

		const localX =
			(screenX - this.boardContainer.x) / this.boardContainer.scale.x;
		const localY =
			(screenY - this.boardContainer.y) / this.boardContainer.scale.y;

		const local = this.localUnit.state;
		const range = RH.getRangeForClass(local.characterClass);
		const inRangeTiles = RH.computeAttackRange(
			this.grid,
			local.coord,
			local.characterClass,
			range,
		);

		const hit = this.aiUnits.find((u) => {
			if (u.state.currentHp <= 0) return false;
			if (
				!pointInCircle(
					u.mercenary.view.x,
					u.mercenary.view.y,
					localX,
					localY,
					20,
				)
			)
				return false;
			return inRangeTiles.some(
				(t) => t.coord.x === u.state.coord.x && t.coord.y === u.state.coord.y,
			);
		});

		if (hit) {
			this.tryStartCombat(hit);
			return true;
		}

		const monsterHit = this.livingMonsters().find((m) => {
			if (!pointInCircle(m.token.view.x, m.token.view.y, localX, localY, 20))
				return false;
			return inRangeTiles.some(
				(t) => t.coord.x === m.state.coord.x && t.coord.y === m.state.coord.y,
			);
		});

		if (monsterHit) this.tryStartCombatVsMonster(monsterHit);
		return true;
	}

	/** Enemy defeat/teleport are BattleOverlay's job via shared state; this handles the rest. */
	private async onBattleComplete(result: BattleResult): Promise<void> {
		const unit = this.activeCombatUnit;
		this.activeCombatUnit = null;

		if (result.defenderNeedsTeleport && unit) {
			await this.teleportEntity(unit.state, unit.mercenary);
			this.showFeedback("💨 Enemy hunter fled the fight!");
		}

		if (result.attackerNeedsTeleport) {
			await this.teleportEntity(this.localUnit.state, this.localUnit.mercenary);
		}

		this.syncUI();
	}

	/** Spend 1 AP on Rest, lock Move, draw up to 2 cards. */
	private handleRest(): void {
		this.resetActionState();
		if (!this.localUnit.turnManager.spendRest()) return;
		this.showFeedback("💤 Rested — drew cards");
	}

	/** Spend 2 AP on Disengage — alternative movement, immune to ZoC. */
	private handleDisengagePressed(): void {
		if (this.moveController.active) {
			this.moveController.exit();
			this.buttonBar.setMoveActive(false);
			return;
		}

		this.resetActionState();

		if (!this.localUnit.turnManager.beginDisengage()) return;

		this.moveController.enter(this.localUnit.state.stats.movement, true);
		this.buttonBar.setMoveActive(true);
		this.buttonBar.closeMenu();
	}

	// ---------- End Turn ----------

	/** End turn — shared by [E] key and End Turn button. No-ops mid-animation. */
	private handleEndTurn(): void {
		if (
			this.localUnit.mercenary.isAnimating ||
			this.exitCardInProgress ||
			this.processingEnemyTurns
		) {
			return;
		}
		this.moveController.exit();
		this.hand.exitSelectionMode();
		this.exitTargetingMode();
		this.buttonBar.setMoveActive(false);
		this.buttonBar.closeMenu();
		this.localUnit.turnManager.endTurn();
		this.turnsTaken++;
		this.trySpawnMonster();
		void this.processEnemyTurns();
	}

	// ---------- Input ----------

	/** [Esc] cancel/pause toggle · [E] end turn · [R] regen · arrows+Enter for hand nav. */
	private handleKeyDown = (event: KeyboardEvent): void => {
		if (this.game.overlays.isOpen) {
			if (event.key === "Escape") this.game.overlays.hide();
			return;
		}

		switch (event.key) {
			case "Escape":
				if (this.targetingActive) {
					this.exitTargetingMode();
				} else if (this.moveController.active || this.hand.isSelecting) {
					this.moveController.exit();
					this.hand.exitSelectionMode();
					this.buttonBar.setMoveActive(false);
					this.buttonBar.closeMenu();
				} else {
					this.openPauseMenu();
				}
				break;
			case "e":
			case "E":
				this.handleEndTurn();
				break;
			case "r":
			case "R":
				this.regenerateMap();
				break;
			case "ArrowLeft":
				if (this.hand.isSelecting) this.hand.moveCaret(-1);
				break;
			case "ArrowRight":
				if (this.hand.isSelecting) this.hand.moveCaret(1);
				break;
			case "Enter":
			case " ":
				if (this.hand.isSelecting) this.hand.confirmHighlighted();
				break;
		}
	};

	/** Show the pause overlay. MapScene keeps existing untouched underneath — see OverlayManager. */
	private openPauseMenu(): void {
		void this.game.overlays.show(new PauseOverlay(this.game));
	}

	/** Delegate all click routing to ButtonBar, then switch on the returned action. */
	private handleClick = (event: MouseEvent): void => {
		if (this.game.overlays.isOpen) return;
		if (this.processingEnemyTurns) return;

		const { screenX, screenY } = this.getScreenPoint(event);
		const action = this.buttonBar.handleClick(screenX, screenY);

		if (this.bagButton.hitTest(screenX, screenY)) {
			this.inventoryPanel.toggle();
			return;
		}
		if (this.logsButton.hitTest(screenX, screenY)) {
			this.logPanel.toggle();
			return;
		}

		if (this.inspectButton.hitTest(screenX, screenY)) {
			this.hunterSummaryPanel.toggle();
			return;
		}

		if (this.refocusButton.hitTest(screenX, screenY)) {
			this.camera.centerOn(
				{
					x: this.localUnit.mercenary.view.x,
					y: this.localUnit.mercenary.view.y,
				},
				this.game.app.screen.width,
				this.game.app.screen.height,
			);
			return;
		}

		switch (action) {
			case "move":
				this.handleMovePressed();
				break;
			case "attack":
				this.handleAttack();
				break;
			case "rest":
				this.handleRest();
				break;
			case "disengage":
				this.handleDisengagePressed();
				break;
			case "endTurn":
				this.handleEndTurn();
				break;
			case null:
				if (this.handleTargetClick(screenX, screenY)) break;
				if (this.moveController.active) {
					this.moveController.tryCommit(
						this.screenPointToGrid(screenX, screenY),
					);
				}
				break;
		}
	};

	/** Feed hovered tiles to the path preview while aiming; hand-reveal check always runs. */
	private handleMouseMove = (event: MouseEvent): void => {
		if (this.game.overlays.isOpen) return;

		const { screenX, screenY } = this.getScreenPoint(event);

		const nearHand =
			screenX < 420 && screenY > this.game.app.screen.height - 160;
		this.hand.setHovered(nearHand);

		if (!this.moveController.active) return;
		if (this.isPointOverUiSurface(screenX, screenY)) return;
		this.moveController.onHover(this.screenPointToGrid(screenX, screenY));
	};

	// ---------- UI ----------

	/** Show a temporary top-of-screen message, auto-hides after ~2.5s. */
	private showFeedback(message: string): void {
		this.feedbackText.text = message;
		this.feedbackText.visible = true;
		this.feedbackText.x =
			(this.game.app.screen.width - this.feedbackText.width) / 2;
		this.feedbackText.y = 60;
		this.feedbackTimer = 150;

		logMatchEvent(this.game.session, message);
		this.logPanel.sync(this.game.session.matchLog ?? []);
	}
	/** Sync all UI to the local unit's TurnManager state. Guarded — fires before buttonBar exists during construction. */
	private syncUI(): void {
		if (!this.buttonBar || this.units.length === 0) return;
		const local = this.localUnit;
		this.buttonBar.sync(local.turnManager);
		this.hand.syncFromHand(local.state.hand);
		this.deckTracker.sync(local.turnManager);
		this.inventoryPanel.sync(local.state.items);
		this.inventoryPanel.setTargetItemId(
			this.game.session.chestPlan?.targetItem?.id ?? null,
		);
		this.characterPanel.setFromState(
			this.game.session.character,
			local.state,
			local.turnManager.apRemaining,
			local.turnManager.baseAP,
		);
		this.hunterSummaryPanel.sync(this.buildHunterSummaryEntries());
	}

	// ---------- Cards ----------

	/** Removes card from real hand, spends AP. Blue E routes to handleExitCard; Attack doesn't reach here. */
	private handleCardConfirmed(card: RH.CardData): void {
		const local = this.localUnit;
		const handIndex = local.state.hand.findIndex((c) => c.id === card.id);
		if (handIndex !== -1) local.state.hand.splice(handIndex, 1);

		if (card.color === "blue" && card.value === "E") {
			void this.handleExitCard(card);
			return;
		}

		const cardType = card.id === "__skip__" ? "none" : card.color;
		const numericValue = typeof card.value === "number" ? card.value : 0;

		if (!local.turnManager.beginMovement(cardType, numericValue)) {
			return;
		}

		this.moveController.requestEnter();
		this.buttonBar.setMoveActive(this.moveController.active);

		if (card.actionType === "defense") {
			this.showFeedback(
				`🛡️ Defense ${card.value} active this turn (effect coming soon)`,
			);
		} else if (card.actionType === "stun") {
			// TEMPORARY: routed through the Move flow because there's no
			// dedicated RH.Trap action yet — every class, Trapper included
			// once it exists, shares this path for now.
			this.placeTrap(card);
			if (!local.turnManager.beginMovement("none", 0)) return;
			this.moveController.requestEnter();
			this.buttonBar.setMoveActive(this.moveController.active);
			return;
		}
	}

	private placeTrapAtCurrentPosition(_card: RH.CardData): void {
		const coord = this.localUnit.state.coord;
		this.traps.push({
			id: `trap_${Date.now()}_${this.traps.length}`,
			coord,
			ownerId: this.localUnit.state.id,
			kind: "stun",
		});
		this.showFeedback("🪤 RH.Trap left behind");
		this.renderTrapMarkers();
	}

	private visibleTrapsForLocalPlayer(): RH.Trap[] {
		const local = this.localUnit.state;
		const isHunterClass = local.characterClass === "hunter";
		return this.traps.filter((t) =>
			RH.canSeeTrap(t, local.id, local.coord, isHunterClass),
		);
	}

	private trapsVisibleTo(unit: PilotedMercenary): RH.Trap[] {
		const isHunterClass = unit.state.characterClass === "hunter";
		return this.traps.filter((t) =>
			RH.canSeeTrap(t, unit.state.id, unit.state.coord, isHunterClass),
		);
	}

	private renderTrapMarkers(): void {
		this.trapMarkerContainer.removeChildren();
		for (const trap of this.visibleTrapsForLocalPlayer()) {
			const pos = gridToScreen(trap.coord);
			const g = new Graphics();
			g.poly([
				0,
				-TILE_HEIGHT / 2,
				TILE_WIDTH / 2,
				0,
				0,
				TILE_HEIGHT / 2,
				-TILE_WIDTH / 2,
				0,
			]);
			g.fill({ color: 0x2ecc71, alpha: 0.4 });
			g.stroke({ width: 2, color: 0x2ecc71, alpha: 0.8 });
			g.x = pos.x;
			g.y = pos.y;
			this.trapMarkerContainer.addChild(g);
		}
	}

	private resolveTrapsAlongPath(
		unit: PilotedMercenary,
		path: RH.GridCoord[],
	): {
		truncatedPath: RH.GridCoord[];
		hazardHit: { kind: RH.TrapKind; result: RH.HazardRollResult } | null;
	} {
		for (let i = 0; i < path.length; i++) {
			const step = path[i];
			const index = this.traps.findIndex(
				(t) => t.coord.x === step.x && t.coord.y === step.y,
			);
			if (index === -1) continue;
			const trap = this.traps[index];

			this.traps.splice(index, 1);

			const result = RH.resolveHazardRoll(unit.state.stats);
			if (!result.landed) {
				this.showFeedback(
					`🪤 ${this.getUnitLabel(unit)} resisted a hazard (${result.hazardRoll} vs ${result.victimRoll})`,
				);
				continue;
			}

			return {
				truncatedPath: path.slice(0, i + 1),
				hazardHit: { kind: trap.kind, result },
			};
		}
		return { truncatedPath: path, hazardHit: null };
	}

	private placeTrap(card: RH.CardData): void {
		switch (this.localUnit.state.characterClass) {
			// case trapper goes here later

			default:
				this.placeTrapAtCurrentPosition(card);
		}
	}

	private applyHazardEffect(
		unit: PilotedMercenary,
		kind: RH.TrapKind,
		result: RH.HazardRollResult,
	): void {
		switch (kind) {
			case "stun":
				unit.state.stunnedTurnsRemaining += 1;
				this.showFeedback(
					`🪤 ${this.getUnitLabel(unit)} was stunned! (${result.hazardRoll} vs ${result.victimRoll})`,
				);
		}
	}

	/**
	 * Blue E: if the Exit has not revealed yet, put the card back and
	 * spend nothing. If it has, fly there — win if carrying the relic.
	 */
	private async handleExitCard(card: RH.CardData): Promise<void> {
		const local = this.localUnit;
		const exitTile = RH.findExitTile(this.grid);

		if (!exitTile) {
			local.state.hand.push(card);
			this.showFeedback("🌀 The Exit has not revealed itself yet");
			this.syncUI();
			return;
		}

		if (!local.turnManager.beginMovement("blue", 0)) {
			local.state.hand.push(card);
			this.syncUI();
			return;
		}

		this.exitCardInProgress = true;
		this.showFeedback("🌀 Exit card played — heading to the exit...");
		await this.flyMercenaryTo(exitTile);
		await this.checkWinCondition(local);
		this.exitCardInProgress = false;
	}

	/**
	 * Instantly relocates and pans the camera — same mechanism
	 * teleportEntity uses, so this reads identically to every
	 * other teleport rather than its own separate, slower animation.
	 */
	private async flyMercenaryTo(coord: RH.GridCoord): Promise<void> {
		const local = this.localUnit;
		local.state.coord = coord;
		const screenPos = gridToScreen(coord);
		local.mercenary.setPositionInstant(screenPos);
		await this.camera.panTo(
			screenPos,
			500,
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
	}

	/** Promise-based delay — used for the Exit card's linger between flights. */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/** Pick a random walkable (Floor) tile on the grid, excluding one coord. */
	private randomWalkableTile(
		exclude: RH.GridCoord,
		alsoExclude: RH.GridCoord[] = [],
	): RH.GridCoord | null {
		const candidates: RH.GridCoord[] = [];

		for (let x = 0; x < this.grid.width; x++) {
			for (let y = 0; y < this.grid.height; y++) {
				const tile = this.grid.getTile({ x, y });
				if (!tile || tile.type !== RH.TileType.Floor) continue;
				if (tile.coord.x === exclude.x && tile.coord.y === exclude.y) continue;
				if (
					alsoExclude.some((c) => c.x === tile.coord.x && c.y === tile.coord.y)
				)
					continue;
				candidates.push(tile.coord);
			}
		}

		if (candidates.length === 0) return null;
		return candidates[Math.floor(Math.random() * candidates.length)];
	}

	/**
	 * Instant repositioning plus a real, awaited camera pan to the destination.
	 * Callers await this directly — that's what guarantees a teleport finishes,
	 * camera and all, before whatever happens next (the next unit's turn,
	 * control returning to the player) ever begins.
	 */
	private async teleportEntity(
		state: RH.MercenaryState,
		mercenary: Mercenary,
	): Promise<void> {
		const occupied: RH.GridCoord[] = this.units
			.filter((u) => u.state.id !== state.id && u.state.currentHp > 0)
			.map((u) => u.state.coord);

		const destination = this.randomWalkableTile(state.coord, occupied);
		if (!destination) return;
		state.coord = destination;
		const screenPos = gridToScreen(destination);
		mercenary.setPositionInstant(screenPos);

		await this.camera.panTo(
			{ x: screenPos.x, y: screenPos.y },
			500,
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
	}

	// ---------- Helpers ----------

	/** Single construction point for MoveController wiring. */
	private createMoveController(): MoveController {
		return new MoveController({
			grid: this.grid,
			camera: this.camera,
			mercenary: this.localUnit.mercenary,
			getMercenaryCoord: () => this.localUnit.state.coord,
			getMovementRemaining: () => this.localUnit.turnManager.movementRemaining,
			getBlockedCoords: () => [
				...this.aiUnits
					.filter((u) => u.state.currentHp > 0)
					.map((u) => u.state.coord),
				...this.livingMonsterCoords(),
			],
			onMoveCommitted: (
				target: RH.GridCoord,
				path: RH.GridCoord[],
				ignoresZoc: boolean,
			) => this.onMoveCommitted(target, path, ignoresZoc),
		});
	}

	/** [R] dev shortcut: fresh seed/map/chests locally, no LoadingScene round-trip. */
	private regenerateMap(): void {
		if (this.localUnit.mercenary.isAnimating || this.exitCardInProgress) return;

		this.game.session.sharedDeck = null;

		this.moveController.exit();
		this.hand.exitSelectionMode();
		this.buttonBar.setMoveActive(false);
		this.buttonBar.closeMenu();
		this.exitTargetingMode();

		this.mapSeed = Math.floor(Math.random() * 1_000_000);
		this.grid = this.buildMap();

		this.applyCameraBounds();

		this.mercenaryContainer.removeChildren();
		this.units = [];
		this.spawnLocalUnit();
		this.localUnit.mercenary.view.addChild(this.itemPopup);
		this.itemPopup.visible = false;

		this.spawnEnemyHunters();

		this.targetReticle.visible = false;
		this.mercenaryContainer.addChild(this.targetReticle);

		this.game.session.chestPlan = null;
		this.game.session.chestPlacements = null;
		this.game.session.playerSpawn = null;
		this.spawnChests();

		this.hand.syncFromHand(this.localUnit.state.hand);
		this.localUnit.turnManager.reset();
		this.localUnit.turnManager.dealStartingHand();
		this.turnsTaken = 0;

		this.boardContainer.removeChild(this.moveController.view);
		this.moveController = this.createMoveController();
		this.boardContainer.addChild(this.moveController.view);

		this.renderMap();
		this.centerCameraOnMap();
		this.syncUI();
	}

	/** Cancels whatever action-mode is currently active */
	private resetActionState(): void {
		this.moveController.exit();
		this.exitTargetingMode();
		this.hand.exitSelectionMode();
		this.buttonBar.setMoveActive(false);
		this.buttonBar.closeMenu();
	}

	/** Convert a mouse event to canvas-local screen coordinates. */
	private getScreenPoint(event: MouseEvent) {
		const rect = this.game.app.canvas.getBoundingClientRect();
		return {
			screenX: event.clientX - rect.left,
			screenY: event.clientY - rect.top,
		};
	}

	/** Convert canvas-local screen coordinates to a grid tile. */
	private screenPointToGrid(screenX: number, screenY: number): RH.GridCoord {
		const localX =
			(screenX - this.boardContainer.x) / this.boardContainer.scale.x;
		const localY =
			(screenY - this.boardContainer.y) / this.boardContainer.scale.y;
		return screenToGrid(localX, localY);
	}

	/**
	 * Generates the dungeon with no exit tile. Exit spawns only after
	 * the target relic is found (see tryOpenChestAt + spawnExitFarFrom).
	 */
	private buildMap(): RH.Grid {
		return RH.generateDungeon(this.mapWidth, this.mapHeight, {
			seed: this.mapSeed,
			roomCount: this.roomCount,
		});
	}

	/** Build the local player's RH.MercenaryState. */
	private spawnMercenary(): RH.MercenaryState {
		const spawnCoord = this.game.session.playerSpawn ??
			RH.findFirstWalkableTile(this.grid) ?? { x: 0, y: 0 };

		const character = this.game.session.character;
		if (character) {
			return RH.spawnFromCharacter(character, spawnCoord);
		}

		return RH.createMercenary("player", spawnCoord, {
			movement: 4,
			attack: 3,
			defense: 2,
			maxHp: 20,
			ap: 3,
		});
	}

	/** Draw every tile diamond. */
	private renderMap(): void {
		this.tilesContainer.removeChildren();

		for (let x = 0; x < this.grid.width; x++) {
			for (let y = 0; y < this.grid.height; y++) {
				const tile = this.grid.getTile({ x, y });
				if (!tile) continue;
				const screenPos = gridToScreen(tile.coord);
				const diamond = this.drawTileDiamond(this.TILE_COLORS[tile.type]);
				diamond.x = screenPos.x;
				diamond.y = screenPos.y;
				this.tilesContainer.addChild(diamond);
			}
		}
	}

	/** Build one iso diamond tile graphic in the given color. */
	private drawTileDiamond(color: number): Graphics {
		const g = new Graphics();
		g.poly([
			0,
			-TILE_HEIGHT / 2,
			TILE_WIDTH / 2,
			0,
			0,
			TILE_HEIGHT / 2,
			-TILE_WIDTH / 2,
			0,
		]);
		g.fill(color);
		g.stroke({ width: 1, color: 0x000000, alpha: 0.3 });
		return g;
	}

	/** Snap the camera to the centre of the map. */
	private centerCameraOnMap(): void {
		const bounds = this.boardContainer.getLocalBounds();
		this.camera.centerOn(
			{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
	}
}
