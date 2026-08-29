import { Container, Graphics, Text } from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import { CameraController } from "@/core/cameras/CameraController";
import { MapRenderer } from "@/rendering/MapRenderer";
import {
	gridToScreen,
	screenToGrid,
	TILE_WIDTH,
	TILE_HEIGHT,
} from "@/math/isoGridMath";
import { computeUiScale, uiPx } from "@/math/uiScale";
import { Mercenary } from "@/entities/Mercenary";

import * as RH from "@relic-hunter/shared";

import { PauseOverlay } from "@/ui/overlay/PauseOverlay";
import { BattleHost, type BattleHostResult } from "@/combat/BattleHost";
import {
	buildBattleRequest,
	describeLocalPlayer,
	describeHunter,
	describeMonster,
} from "@/combat/buildBattleRequest";
import { MoveController } from "@/systems/MoveController";
import { TurnManager } from "@/systems/TurnManager";
import { Hand } from "@/ui/Hand";
import { HunterScoreEntry, TEST_MAP_DIMENSIONS } from "@/core/game/GameSession";
import type {
	TutorialConfig,
	TutorialUiPointerTarget,
} from "@/tutorial/tutorialTypes";
import { MatchResultScene } from "./MatchResultScene";
import { getActiveHunterWorldPos } from "@/core/cameras/TurnCamera";
import { PlayZone } from "@/ui/PlayZone";
import type { PilotedMercenary, MovableToken } from "@/types/entities";
import { logMatchEvent } from "@/core/game/GameSession";
import type { HunterSummaryEntry } from "@/ui/HunterSummaryPanel";
import { MonsterSystem } from "@/systems/MonsterSystem";
import { ChestSystem } from "@/systems/ChestSystem";
import { ExitRelicSystem } from "@/systems/ExitRelicSystem";
import { ZoneQuery } from "@/systems/ZoneQuery";
import { TutorialMarkers } from "@/systems/TutorialMarkers";
import { TrapSystem } from "@/systems/TrapSystem";
import type { MonsterEntity } from "@/types/entities";
import { pointInCircle, pointInContainer } from "@/rendering/HitTest";
import { AudioController } from "@/core/audio/audioController";
import { CardDrawQueue } from "@/ui/CardDrawQueue";
import { MapHud } from "@/hud/MapHud";
import { GestureRouter, type ScrollSurface } from "@/input/GestureRouter";
import { DialogueOverlay } from "@/ui/overlay/DialogueOverlay";
import type {
	TutorialPort,
	TutorialCombatGuide,
} from "@/tutorial/tutorialPort";
import type { DialogueLine } from "@/tutorial/dialogue";

/**
 * Tactical map scene — grid, mercenary, AP turns, cards, chests, win condition.
 * Every unit on the map (local or AI-piloted) is a PilotedMercenary in one
 * shared array — `pilot` is the only thing distinguishing them. Map/chest
 * content comes from GameSession (set by LoadingScene), not decided here.
 * @author ShaAnder
 */
export class MapScene implements Scene, TutorialPort {
	readonly view = new Container();

	// Board layers
	private grid: RH.Grid;
	private boardContainer = new Container();
	private tilesContainer = new Container();
	private mercenaryContainer = new Container();

	// Systems
	private camera: CameraController;
	private mapRenderer!: MapRenderer;
	private moveController: MoveController;

	// Entities — one array, pilot type is the only thing distinguishing them
	private units: PilotedMercenary[] = [];

	private monsterSystem!: MonsterSystem;
	private chestSystem = new ChestSystem();

	// True during the Exit card's two-flight teleport sequence — blocks
	// End Turn / regenerate from interrupting mid-sequence, same role
	// mercenary.isAnimating plays for normal moves.
	private exitCardInProgress = false;
	private turnsTaken = 0;

	// Targeting mode — active while choosing which enemy to attack
	private targetingActive = false;

	private targetReticle = new Graphics();
	private attackRangeContainer = new Container();

	private movePointerDragging = false;
	private suppressNextClick = false;

	/** Owns wheel/drag arbitration between HUD panels and the camera — see docs/16, section 15. */
	private gestureRouter = new GestureRouter();
	private activeDragSurface: ScrollSurface | null = null;
	private cameraDragActive = false;
	private lastDragScreenPos: { x: number; y: number } | null = null;

	// Which AI unit is mid-fight, so onBattleComplete knows who to update
	private activeCombatUnit: PilotedMercenary | null = null;
	// Guards End Turn from re-firing while enemies are mid-move/mid-fight
	private processingEnemyTurns = false;
	private activeAi: PilotedMercenary | null = null;
	private activeMonster: MonsterEntity | null = null;

	// UI
	private hud!: MapHud;

	// Item pickup popup — floats above the mercenary's head, placeholder
	// icon until real item sprites exist
	private itemPopup = new Container();
	private itemPopupIcon = new Graphics();
	private itemPopupText: Text;
	private itemPopupTimer = 0;

	// Cards
	private hand: Hand;
	private playZone: PlayZone;

	private cardDrawQueue!: CardDrawQueue;
	private drawLayer = new Container();

	private trapSystem = new TrapSystem();

	// Map config — dimensions and seed come from GameSession (set by
	// LoadingScene) rather than being hardcoded, so mission map size
	// selection actually does something.
	private readonly ROOM_DENSITY = 1 / 50;
	private mapWidth: number;
	private mapHeight: number;
	private roomCount: number;
	private mapSeed: number;

	private tutorialConfig: TutorialConfig | null;
	/** Lazily constructed — only tutorials ever need dialogue. */
	private dialogueOverlay: DialogueOverlay | null = null;
	/** Set by handleCardConfirmed right before a move starts */
	private pendingMoveUsedCard = false;
	/** The one controlled, killable monster a combat tutorial spawns */
	private tutorialMonster: MonsterEntity | null = null;

	private tutorialMarkers = new TutorialMarkers();

	private battleHost: BattleHost;

	private audio = new AudioController();

	private fpsAccumulator = 0;

	/** The one human-piloted unit. Assumes exactly one exists */
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
			...this.hud.interactiveSurfaces,
			this.hand.view,
			this.playZone.view,
		];
	}

	/** Every AI-piloted unit — replaces the old `enemies` array. */
	private get aiUnits(): PilotedMercenary[] {
		return this.units.filter((u) => u.pilot === "ai");
	}

	constructor(
		private game: Game,
		tutorialConfig: TutorialConfig | null = null,
	) {
		this.tutorialConfig = tutorialConfig;

		// Dimensions + seed come from the mission/LoadingScene setup, unless
		// a tutorial config supplies its own small, fixed debug map.
		const dims = tutorialConfig?.script.debugMap ?? TEST_MAP_DIMENSIONS;
		this.mapWidth = dims.width;
		this.mapHeight = dims.height;
		this.roomCount =
			tutorialConfig?.script.debugMap.roomCount ??
			Math.floor(this.mapWidth * this.mapHeight * this.ROOM_DENSITY);
		this.mapSeed =
			tutorialConfig?.script.debugMap.seed ??
			this.game.session.mapSeed ??
			Math.floor(Math.random() * 1_000_000);

		// WE ADD THIS - So when a new match happens it's a fresh deck, without it
		// would try to carry old deck over. Tutorials get a genuinely empty
		// array, not null — null lazily rebuilds a full deck on first
		// access via `??=`, an empty array never does.
		this.game.session.sharedDeck = this.tutorialConfig ? [] : null;

		this.grid = this.buildMap();

		this.boardContainer.addChild(this.tilesContainer);
		this.boardContainer.addChild(this.chestSystem.container);
		this.boardContainer.addChild(this.mercenaryContainer);
		this.view.addChild(this.boardContainer);

		this.monsterSystem = new MonsterSystem(this.mercenaryContainer);

		{
			const sw = this.game.app.screen.width;
			const sh = this.game.app.screen.height;
			const ui = computeUiScale(sw, sh);
			// Mobile / narrow: start more zoomed out so the board is readable
			const mobile = ui < 0.85 || Math.min(sw, sh) < 500;
			this.camera = new CameraController(this.boardContainer, {
				initialZoom: mobile ? 1.05 : 1.75,
				minZoom: mobile ? 1.05 : 1.4,
				maxZoom: 4,
				panSpeed: 700,
			});
		}

		this.mapRenderer = new MapRenderer(
			this.tilesContainer,
			this.boardContainer,
			this.camera,
			this.game,
		);

		this.applyCameraBounds();

		this.spawnLocalUnit();
		if (!this.tutorialConfig || this.tutorialConfig.spawnAiHunters) {
			this.spawnEnemyHunters();
		}

		if (this.tutorialConfig?.script.staticActors) {
			this.tutorialMarkers.spawnStaticActors(
				this.tutorialConfig.script.staticActors,
				this.mercenaryContainer,
			);
		}
		this.battleHost = new BattleHost(this.game);
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

		if (!this.tutorialConfig || this.tutorialConfig.spawnChests) {
			this.spawnChests();
		}

		this.mercenaryContainer.addChild(this.tutorialMarkers.targetMarkerView);

		this.playZone = new PlayZone();
		this.view.addChild(this.playZone.view);

		this.hand = new Hand(
			this.game.app.stage,
			this.playZone,
			(card: RH.CardData) => this.handleCardConfirmed(card),
		);
		this.view.addChild(this.hand.view);

		// after hand is added to view:
		this.view.addChild(this.drawLayer);
		this.cardDrawQueue = new CardDrawQueue({
			layer: this.drawLayer,
			getHandTarget: () => {
				// toLocal correctly accounts for drawLayer's own scale — a
				// plain position subtraction here only worked while drawLayer
				// sat at scale 1; now that it's genuinely scaled to match the
				// rest of the UI, the conversion needs to divide by that scale
				// too, which toLocal does for us.
				return this.drawLayer.toLocal(this.hand.view.getGlobalPosition());
			},
			onCollected: (card) => {
				// The hand is a hard-cap invariant. The draw source should already
				// have limited the requested draw, but keep this as the final
				// presentation-side guard against queued/tutorial cards overflowing it.
				if (
					this.localUnit.turnManager.handSize >=
					this.localUnit.turnManager.maxHandSize
				) {
					return;
				}
				this.localUnit.state.hand.push(card);
				this.tutorialConfig?.onTutorialEvent({ type: "cardCollected" });
				this.syncUI();
			},
		});

		// Required so drag keeps tracking after the pointer leaves the card sprite
		this.game.app.stage.eventMode = "static";
		this.game.app.stage.hitArea = this.game.app.screen;

		// Establish the initial five-card hand. Initial setup is not a normal
		// turn-start draw; subsequent turns draw exactly one at startTurn().
		if (!this.tutorialConfig) {
			const starter = this.localUnit.turnManager.dealStartingHand();
			// Defer present until onEnter so layer is laid out — or enqueue now:
			this.cardDrawQueue.enqueue(starter);
		}

		this.moveController = this.createMoveController();
		this.boardContainer.addChild(this.moveController.view);
		this.boardContainer.addChild(this.attackRangeContainer);

		this.boardContainer.addChild(this.trapSystem.markerContainer);

		this.hud = new MapHud(this.game);
		this.hud.setActionMenuSubmenuToggled((open) => {
			if (open) {
				this.tutorialConfig?.onTutorialEvent({
					type: "actionsSubmenuOpened",
				});
			}
		});
		this.hud.setInventoryOnDrop((index) => {
			this.localUnit.state.items[index] = null;
			this.syncUI();
		});
		this.view.addChild(this.hud.view);

		this.hud.registerScrollSurfaces(this.gestureRouter);

		this.view.addChild(this.tutorialMarkers.uiPointerView);
	}

	/** Render the map, center the camera, and wire up input. */
	onEnter(): void {
		this.mapRenderer.build(this.grid, 0);
		this.centerCameraOnActiveHunter();
		this.camera.attach(this.game.app.canvas);
		this.hand.syncFromHand(this.localUnit.state.hand);
		this.layoutHud();
		this.syncUI();

		window.addEventListener("keydown", this.handleKeyDown);
		this.game.app.canvas.addEventListener("click", this.handleClick);
		this.game.app.canvas.addEventListener("mousemove", this.handleMouseMove);
		this.game.app.canvas.addEventListener(
			"pointerdown",
			this.handlePointerDown,
		);
		this.game.app.canvas.addEventListener(
			"pointermove",
			this.handlePointerMove,
		);
		this.game.app.canvas.addEventListener("pointerup", this.handlePointerUp);
		this.game.app.canvas.addEventListener(
			"pointercancel",
			this.handlePointerUp,
		);
		this.game.app.canvas.addEventListener(
			"contextmenu",
			this.handleContextMenu,
		);
		this.game.app.canvas.addEventListener("wheel", this.handleWheel, {
			passive: false,
		});
	}

	/** Tear down visuals and input listeners. */
	onExit(): void {
		this.moveController.exit();
		this.hud.closeActionMenu();
		this.boardContainer.removeChildren();
		this.camera.detach(this.game.app.canvas);
		window.removeEventListener("keydown", this.handleKeyDown);
		this.game.app.canvas.removeEventListener("click", this.handleClick);
		this.game.app.canvas.removeEventListener("mousemove", this.handleMouseMove);
		this.game.app.canvas.removeEventListener(
			"pointerdown",
			this.handlePointerDown,
		);
		this.game.app.canvas.removeEventListener(
			"pointermove",
			this.handlePointerMove,
		);
		this.game.app.canvas.removeEventListener("pointerup", this.handlePointerUp);
		this.game.app.canvas.removeEventListener(
			"pointercancel",
			this.handlePointerUp,
		);
		this.game.app.canvas.removeEventListener(
			"contextmenu",
			this.handleContextMenu,
		);
		this.game.app.canvas.removeEventListener("wheel", this.handleWheel);
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
		for (const monster of this.monsterSystem.all) {
			monster.token.update(deltaTime);
		}

		this.hand.update(deltaTime);

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
			this.targetingActive ||
			this.cardDrawQueue.isActive
		) {
			this.camera.lockTo({
				x: this.localUnit.mercenary.view.x,
				y: this.localUnit.mercenary.view.y,
			});
		} else if (this.camera.isLocked) {
			this.camera.unlock();
		}

		this.hud.update(deltaTime);

		if (this.itemPopupTimer > 0) {
			this.itemPopupTimer -= deltaTime;
			if (this.itemPopupTimer <= 0) {
				this.itemPopup.visible = false;
			}
		}

		this.tutorialMarkers.update(deltaTime, (target) =>
			this.resolveUiPointerPosition(target),
		);

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

		if (this.localUnit.state.stunnedTurnsRemaining > 0) {
			this.localUnit.state.stunnedTurnsRemaining -= 1;
			this.showFeedback("🪤 You're stunned and can't act this turn");
			this.turnsTaken++;
			this.trySpawnMonster();
			this.syncUI();
			void this.processEnemyTurns();
			return;
		}

		// A normal player turn starts here. TurnManager owns the rule and
		// returns the card for MapScene to present through CardDrawQueue.
		const drawn = this.localUnit.turnManager.startTurn();
		if (drawn.length > 0) {
			this.cardDrawQueue.enqueue(drawn);
		}

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
			this.showFeedback("✨ You recover and get back up");
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
		const s = computeUiScale(w, h);

		const m = uiPx(16, s);

		this.hud.layout(w, h, s, m);

		this.playZone.view.scale.set(s);

		// Hand owns its scale + left anchor inside resize
		this.hand.resize(w, h, s);
		this.playZone.layout(w / 2, h / 2, s);
		this.game.app.stage.hitArea = this.game.app.screen;

		this.drawLayer.x = w / 2;
		this.drawLayer.y = h * 0.42;
		this.drawLayer.scale.set(s);
	}

	// ---------- Move ----------

	/**
	 * Toggle Move: cancel if aiming/selecting, else open card selection.
	 * Filter excludes Attack and blue if already played this turn.
	 */
	private handleMovePressed(): void {
		if (this.moveController.active) {
			this.moveController.exit();
			this.hud.setMoveActive(false);
			return;
		}

		// if movement was already started this action just reshow range
		if (this.localUnit.turnManager.movementRemaining > 0) {
			this.moveController.enter(this.localUnit.turnManager.movementRemaining);
		}

		if (this.hand.isSelecting) {
			this.hand.exitSelectionMode();
			this.hud.setMoveActive(false);
			return;
		}

		this.resetActionState();

		const tm = this.localUnit.turnManager;
		if (!tm.canMove) return;

		this.hand.enterSelectionMode((data) => data.actionType !== "attack");
		this.tutorialConfig?.onTutorialEvent({ type: "actionMenuOpened" });
		this.hud.setMoveActive(true);
		this.hud.closeActionMenu();
	}

	private handlePointerDown = (event: PointerEvent): void => {
		if (this.game.overlays.isOpen) return;
		if (this.processingEnemyTurns) return;
		if (event.button !== 0) return;

		const { screenX, screenY } = this.getScreenPoint(event);

		// A HUD scroll surface always owns the gesture over itself,
		// move-mode included — see docs/16, section 15.2.
		const owner = this.gestureRouter.findOwnerAt(screenX, screenY);
		if (owner) {
			this.activeDragSurface = owner;
			this.lastDragScreenPos = { x: screenX, y: screenY };
			return;
		}

		if (this.isPointOverUiSurface(screenX, screenY)) return;

		if (this.targetingActive) {
			// A click-to-target gesture, not a drag — don't start a camera
			// pan or claim it, just let it reach the click handler.
			return;
		}

		if (!this.moveController.active) {
			// Nothing claimed it — drag pans the camera (mobile/touch pan).
			this.cameraDragActive = true;
			this.lastDragScreenPos = { x: screenX, y: screenY };
			return;
		}

		const tile = this.screenPointToGrid(screenX, screenY);

		// Locked + press dest commits inside onPointerDown
		if (this.moveController.isPreviewLocked) {
			const before = this.moveController.active;
			this.moveController.onPointerDown(tile);
			if (before && !this.moveController.active) {
				this.hud.setMoveActive(false);
			}
			// If still active, they re-pathed / started a new drag
			if (this.moveController.isDragging) {
				this.movePointerDragging = true;
			}
			return;
		}

		this.movePointerDragging = true;
		this.moveController.onPointerDown(tile);
	};

	private handlePointerMove = (event: PointerEvent): void => {
		if (this.game.overlays.isOpen) return;

		const { screenX, screenY } = this.getScreenPoint(event);

		const hs = computeUiScale(
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
		const nearHand =
			screenX < uiPx(380, hs) &&
			screenY > this.game.app.screen.height - uiPx(180, hs);
		this.hand.setHovered(nearHand);

		if (this.activeDragSurface && this.lastDragScreenPos) {
			const dx = screenX - this.lastDragScreenPos.x;
			const dy = screenY - this.lastDragScreenPos.y;
			this.activeDragSurface.handleDrag(dx, dy);
			this.lastDragScreenPos = { x: screenX, y: screenY };
			return;
		}

		if (this.cameraDragActive && this.lastDragScreenPos) {
			const dx = screenX - this.lastDragScreenPos.x;
			const dy = screenY - this.lastDragScreenPos.y;
			this.camera.panByScreenDelta(dx, dy);
			this.lastDragScreenPos = { x: screenX, y: screenY };
			return;
		}

		if (!this.moveController.active) return;
		if (this.isPointOverUiSurface(screenX, screenY)) return;

		const tile = this.screenPointToGrid(screenX, screenY);
		if (this.moveController.isDragging) {
			this.moveController.onPointerMove(tile);
		}
	};

	private handlePointerUp = (_event: PointerEvent): void => {
		if (this.activeDragSurface) {
			this.activeDragSurface = null;
			this.lastDragScreenPos = null;
			this.suppressNextClick = true;
			return;
		}

		if (this.cameraDragActive) {
			this.cameraDragActive = false;
			this.lastDragScreenPos = null;
			this.suppressNextClick = true;
			return;
		}

		if (!this.movePointerDragging) return;
		this.movePointerDragging = false;
		if (!this.moveController.active) return;
		this.moveController.onPointerUp();
		this.suppressNextClick = true;
	};

	/** Routes to whichever HUD surface owns the gesture; only zooms the camera when none does. */
	private handleWheel = (event: WheelEvent): void => {
		if (this.game.overlays.isOpen) return;
		event.preventDefault();

		const { screenX, screenY } = this.getScreenPoint(event);
		const consumed = this.gestureRouter.routeWheel(
			screenX,
			screenY,
			event.deltaY,
		);
		if (!consumed) {
			this.camera.zoomAt(event.deltaY);
		}
	};

	private handleContextMenu = (event: MouseEvent): void => {
		if (!this.moveController.active) return;
		event.preventDefault();
		this.moveController.onCancel();
	};

	/** Commit a move: update position, deduct tiles, animate, check chest/win. */
	private async onMoveCommitted(
		target: RH.GridCoord,
		path: RH.GridCoord[],
		ignoresZoc: boolean,
	): Promise<void> {
		const local = this.localUnit;

		const { truncatedPath, hazardHit, resists } =
			this.trapSystem.resolveAlongPath(
				path,
				local.state.stats,
				local.state.temporaryStatBonus.defense,
			);
		for (const r of resists) {
			this.showFeedback(
				`🪤 ${this.getUnitLabel(local)} resisted a hazard (${r.hazardRoll} vs ${r.victimRoll})`,
			);
		}

		local.state.coord =
			truncatedPath.length > 0
				? truncatedPath[truncatedPath.length - 1]
				: local.state.coord;
		local.turnManager.commitMove(truncatedPath.length);
		this.hud.setMoveActive(false);
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
		this.refreshTrapMarkers();

		this.tryOpenChestAt(local.state, target);
		await this.checkWinCondition(local);

		// Trap stun: no more actions this turn (attack / move / rest / etc.)
		if (local.state.stunnedTurnsRemaining > 0) {
			this.resetActionState();
			this.setPlayerControlsVisible(false);
			this.showFeedback("🪤 Stunned — your turn ends");
			// Leave stunnedTurnsRemaining as-is so beginPlayerTurn skips next turn too.
			this.localUnit.turnManager.endTurn();
			this.turnsTaken++;
			this.tutorialConfig?.onTutorialEvent({
				type: "moved",
				tilesMoved: truncatedPath.length,
				usedCard: this.pendingMoveUsedCard,
				finalCoord: local.state.coord,
			});
			this.syncUI();
			this.trySpawnMonster();
			void this.processEnemyTurns();
			return;
		}

		this.tutorialConfig?.onTutorialEvent({
			type: "moved",
			tilesMoved: truncatedPath.length,
			usedCard: this.pendingMoveUsedCard,
			finalCoord: local.state.coord,
		});
		this.syncUI();
	}

	/** Hide player controls while AI resolves overworld turns. */
	private setPlayerControlsVisible(visible: boolean): void {
		this.hand.view.visible = visible;
		this.hud.setActionMenuVisible(visible);
		if (!visible) {
			this.hand.exitSelectionMode();
			this.hud.closeActionMenu();
			this.hud.setMoveActive(false);
			this.moveController.exit();
		}
	}

	// ---------- Zone of Control ----------

	private buildZoneOwners(excludeId: string): RH.ZoneOwner[] {
		return ZoneQuery.buildZoneOwners(
			this.units.map((u) => ({
				id: u.state.id,
				coord: u.state.coord,
				stats: u.state.stats,
				currentHp: u.state.currentHp,
				special: u.state.special,
			})),
			excludeId,
		);
	}

	private buildThreatZoneOwners(excludeId: string): RH.ThreatOwner[] {
		return ZoneQuery.buildThreatZoneOwners(
			this.units.map((u) => ({
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
		const sessionPlacements = this.game.session.chestPlacements;
		if (sessionPlacements && sessionPlacements.length > 0) {
			this.chestSystem.spawnFromPlacements(sessionPlacements);
			return;
		}

		const plan = this.game.session.chestPlan;
		if (!plan) return;

		// No exit at match start — only reserve the local spawn tile.
		const reserved = new Set<string>();
		reserved.add(RH.coordKey(this.localUnit.state.coord));
		this.chestSystem.spawnFromPlan(plan, this.grid, reserved);
	}

	private isPointOverUiSurface(screenX: number, screenY: number): boolean {
		return this.uiSurfaces.some((c) => pointInContainer(screenX, screenY, c));
	}

	/** Open the chest at coord if unopened, for whichever unit reached it. Stays closed if inventory full. */
	private tryOpenChestAt(state: RH.MercenaryState, coord: RH.GridCoord): void {
		const outcome = this.chestSystem.tryOpen(coord, state.items);
		const isLocal = state.id === this.localUnit.state.id;

		switch (outcome.kind) {
			case "noChest":
				return;

			case "inventoryFull":
				if (isLocal) {
					this.showFeedback("🎒 Inventory full — chest left unopened");
				}
				return;

			case "opened":
				if (outcome.isTarget) {
					this.game.session.relicFound = true;
					this.triggerFrenzy();
					this.spawnExitFarFrom(coord);
					this.mapRenderer.build(this.grid, 0);
					this.showFeedback(
						isLocal
							? `🎯 Found the target: ${outcome.item.name}! The Exit has revealed itself.`
							: "⚠️ An enemy hunter found the target item! The Exit has revealed itself.",
					);
				} else if (isLocal) {
					this.showFeedback(`📦 Found: ${outcome.item.name}`);
				}

				if (isLocal) this.showItemPopup(outcome.item, outcome.isTarget);
		}
	}

	/**
	 * Every living regular monster gets a one-time, permanent stat bump
	 * the moment the relic is found. Boss is explicitly exempt
	 * it's already the endgame threat, frenzy doesn't apply on top of it.
	 */
	private triggerFrenzy(): void {
		RH.applyFrenzy(this.monsterSystem.all.map((m) => m.state));
	}

	/**
	 * Spawns the match Exit far from the relic-find location, deferring
	 * to ExitRelicSystem for the actual tile-picking — this just builds
	 * the blocked set from the units/monsters MapScene already tracks.
	 */
	private spawnExitFarFrom(from: RH.GridCoord): void {
		const blocked = new Set<string>();
		for (const u of this.units) {
			if (u.state.currentHp > 0) blocked.add(RH.coordKey(u.state.coord));
		}
		for (const m of this.monsterSystem.all) {
			if (m.state.currentHp > 0) blocked.add(RH.coordKey(m.state.coord));
		}

		ExitRelicSystem.spawnFarFrom(this.grid, from, blocked);
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

		try {
			const BETWEEN_AI_MS = 1200;

			let isFirst = true;
			for (const unit of this.aiUnits) {
				if (!isFirst) {
					await this.delay(BETWEEN_AI_MS);
				}
				isFirst = false;

				if (unit.state.currentHp <= 0) {
					await this.processRecoveryTurn(unit);
					continue;
				}

				// Stun: full turn skip — no startTurn(), no draw, no move/attack.
				if (unit.state.stunnedTurnsRemaining > 0) {
					unit.state.stunnedTurnsRemaining -= 1;
					this.showFeedback(
						`🪤 ${this.getUnitLabel(unit)} is stunned and skips their turn`,
					);
					this.trySpawnMonster();
					continue;
				}

				const drawn = unit.turnManager.startTurn();
				unit.state.hand.push(...drawn);
				await this.processOneEnemyTurn(unit);
				this.trySpawnMonster();
			}

			this.hud.syncDeckTracker(this.localUnit.turnManager);
			await this.checkDeckExhaustion();
			await this.processMonsterTurns();

			if (
				this.monsterSystem.bossEntity &&
				this.monsterSystem.bossEntity.state.currentHp > 0
			) {
				await this.delay(400);
				await this.processOneMonsterTurn(this.monsterSystem.bossEntity);
			}
		} finally {
			this.processingEnemyTurns = false;
			this.camera.setInputLocked(false);
			this.beginPlayerTurn();
			this.syncUI();
		}
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

		const chestInfos: RH.ChestInfo[] = this.chestSystem.all.map((c) => ({
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
			const visibleTraps = this.trapSystem.visibleTo(
				unit.state.id,
				unit.state.coord,
				unit.state.characterClass === "hunter",
			);
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

					if (moveCard?.actionType === "defense") {
						const v = moveCard.value;
						if (typeof v === "number" || v === "A" || v === "C") {
							unit.state.temporaryStatBonus.defense = v;
						}
					} else {
						unit.state.temporaryStatBonus.movement = cardBonus;
					}

					const { truncatedPath, hazardHit, resists } =
						this.trapSystem.resolveAlongPath(
							path,
							unit.state.stats,
							unit.state.temporaryStatBonus.defense,
						);
					for (const r of resists) {
						this.showFeedback(
							`🪤 ${this.getUnitLabel(unit)} resisted a hazard (${r.hazardRoll} vs ${r.victimRoll})`,
						);
					}

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
					this.refreshTrapMarkers();

					// Stunned mid-move: still on tile, but no fight / fallback this turn.
					// Counter stays so the *next* turn is also skipped at loop start.
					if (unit.state.stunnedTurnsRemaining > 0) {
						this.tryOpenChestAt(unit.state, unit.state.coord);
						await this.checkWinCondition(unit);
						this.activeAi = null;
						this.camera.unlock();
						return;
					}
				}
			}
		}

		this.tryOpenChestAt(unit.state, unit.state.coord);
		await this.checkWinCondition(unit);

		const selfAfter = this.toCombatant(unit.state);
		const othersAfter = this.buildOtherCombatants(unit.state.id);
		const selfForEngagement = { ...selfAfter, currentHp: preMoveHp };
		const inRangeKeys = new Set(
			this.adjacentTiles(unit.state.coord).map((c) => `${c.x},${c.y}`),
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
		if (fallback === "rest") {
			const restDrawn = unit.turnManager.spendRest();
			if (restDrawn) {
				unit.state.hand.push(...restDrawn);
				RH.clearFleeMemory(unit.memory);
				this.showFeedback(`💤 ${unit.archetype} hunter rests`);
			}
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

	/**
	 * Fires exactly once, the first round the shared deck genuinely
	 * runs dry — warning, screen shake, then the boss spawns far from
	 * every living hunter.
	 */
	private async checkDeckExhaustion(): Promise<void> {
		if (this.tutorialConfig) return;
		if (this.game.session.bossSpawned) return;
		if ((this.game.session.sharedDeck?.length ?? 1) > 0) return;

		this.game.session.bossSpawned = true;

		this.showFeedback(
			"⚠️ The deck is exhausted — something massive has arrived.",
		);
		this.audio.play("boss-theme", "/audio/boss-theme.mp3", {
			loop: true,
			volume: 0.6,
		});

		const SHAKE_MS = 5000;
		await Promise.all([
			this.hud.showBossAlert(SHAKE_MS),
			Promise.race([
				this.camera.shake(SHAKE_MS, 24),
				this.delay(SHAKE_MS + 500),
			]),
		]);

		const used = new Set<string>(
			this.units.map((u) => RH.coordKey(u.state.coord)),
		);
		for (const key of this.monsterSystem.occupiedCoordKeys()) used.add(key);
		const coord = this.pickEnemySpawnTile(used);
		if (!coord) return;

		const boss = this.monsterSystem.spawnBoss(coord);
		this.showFeedback("👹 The boss has entered the map.");

		const PAN_MS = 900;
		await Promise.race([
			this.camera.panTo(
				{ x: boss.token.view.x, y: boss.token.view.y },
				PAN_MS,
				this.game.app.screen.width,
				this.game.app.screen.height,
			),
			this.delay(PAN_MS + 500),
		]);

		await this.delay(1000);
	}

	private async processMonsterTurns(): Promise<void> {
		const MONSTER_DELAY_MS = 1000;
		let isFirst = true;

		for (const monster of this.livingMonsters()) {
			if (monster === this.monsterSystem.bossEntity) continue;
			if (!isFirst) await this.delay(MONSTER_DELAY_MS);
			isFirst = false;
			await this.processOneMonsterTurn(monster);
		}
	}

	private async processOneMonsterTurn(monster: MonsterEntity): Promise<void> {
		if (monster.state.stunnedTurnsRemaining > 0) {
			monster.state.stunnedTurnsRemaining -= 1;
			this.showFeedback(
				`🪤 A ${monster.state.tier} monster is stunned and skips its turn`,
			);
			return;
		}
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
		const attackerDescriptor = describeMonster(monster);
		const defenderDescriptor = describeHunter(target);

		await this.battleHost.run(
			buildBattleRequest(attackerDescriptor, defenderDescriptor, {
				isRangedInitiated: false,
				onComplete: async (result) => {
					monster.state.currentHp = attackerDescriptor.state.currentHp;

					if (result.attackerMonsterDied) {
						this.removeMonster(monster);
					}

					if (result.defenderNeedsTeleport) {
						this.teleportEntity(target.state, target.mercenary);
					}
				},
			}),
		);
	}

	private async aiInitiateCombat(
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
			this.teleportEntity(attacker.state, attacker.mercenary);
		}

		if (result.defenderNeedsTeleport) {
			this.teleportEntity(defender.state, defender.mercenary);
		}
	}

	private async resolveAiVsAi(
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
			this.teleportEntity(attacker.state, attacker.mercenary);
		}

		if (result.defenderNeedsTeleport) {
			this.teleportEntity(defender.state, defender.mercenary);
		}
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
		if (this.tutorialConfig?.playerMovement !== undefined) {
			state.stats.movement = this.tutorialConfig.playerMovement;
		}
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
			hpCeiling: u.state.hpCeiling,
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
		if (this.tutorialConfig && !this.tutorialConfig.spawnMonsters) return;
		if (!this.monsterSystem.shouldSpawn()) return;

		const used = new Set<string>(
			this.units.map((u) => RH.coordKey(u.state.coord)),
		);
		for (const key of this.monsterSystem.occupiedCoordKeys()) used.add(key);

		const coord = this.pickEnemySpawnTile(used);
		if (!coord) return;

		const tier = this.monsterSystem.trySpawn(coord);
		if (tier) {
			this.showFeedback(`👹 A ${tier} monster appears!`);
		}
	}

	private livingMonsterCoords(): RH.GridCoord[] {
		return this.monsterSystem.livingMonsterCoords();
	}

	private livingMonsters(): MonsterEntity[] {
		return this.monsterSystem.livingMonsters();
	}

	/** Removes a dead monster from the board entirely — array entry and visual token both, not just letting HP sit at 0 forever. */
	private removeMonster(monster: MonsterEntity): void {
		this.monsterSystem.remove(monster);
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

	/** The four cardinal neighbor tiles of a coord — no walkability or line-of-sight filtering, just raw adjacency. */
	private adjacentTiles(coord: RH.GridCoord): RH.GridCoord[] {
		return [
			{ x: coord.x + 1, y: coord.y },
			{ x: coord.x - 1, y: coord.y },
			{ x: coord.x, y: coord.y + 1 },
			{ x: coord.x, y: coord.y - 1 },
		];
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
		if (
			this.livingEnemies().length === 0 &&
			this.livingMonsters().length === 0
		) {
			this.showFeedback("⚔ No enemies on the map");
			return;
		}

		this.resetActionState();
		this.enterTargetingMode();
		this.tutorialConfig?.onTutorialEvent({ type: "attackTargetingEntered" });
	}

	/** All AI units still standing — the only valid targeting candidates. */
	private livingEnemies(): PilotedMercenary[] {
		return this.aiUnits.filter((u) => u.state.currentHp > 0);
	}

	private enterTargetingMode(): void {
		if (
			this.livingEnemies().length === 0 &&
			this.livingMonsters().length === 0
		) {
			return;
		}

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

		for (const coord of this.adjacentTiles(local.coord)) {
			const pos = gridToScreen(coord);
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
			g.fill({ color: 0xffd700, alpha: 0.35 });
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

	private tryStartCombat(unit: PilotedMercenary): void {
		if (!unit || unit.state.currentHp <= 0) return;

		const local = this.localUnit.state;
		const inRange = RH.isAdjacent(local.coord, unit.state.coord);

		if (!inRange) {
			this.showFeedback("⚔ Target out of range");
			return;
		}

		if (!this.localUnit.turnManager.spendAttack()) return;

		this.exitTargetingMode();
		this.activeCombatUnit = unit;

		void this.battleHost.run(
			buildBattleRequest(
				describeLocalPlayer(this.localUnit),
				describeHunter(unit),
				{
					isRangedInitiated: !RH.isAdjacent(local.coord, unit.state.coord),
					onComplete: (result) => {
						this.onBattleComplete(result);
					},
				},
			),
		);
	}

	private tryStartCombatVsMonster(monster: MonsterEntity): void {
		const local = this.localUnit.state;
		const inRange = RH.isAdjacent(local.coord, monster.state.coord);

		if (!inRange) {
			this.showFeedback("⚔ Target out of range");
			return;
		}

		if (!this.localUnit.turnManager.spendAttack()) return;

		this.exitTargetingMode();

		const defenderDescriptor = describeMonster(monster);

		this.tutorialConfig?.onTutorialEvent({
			type: "combatStarted",
			opponentType: "monster",
		});

		void this.battleHost.run(
			buildBattleRequest(
				describeLocalPlayer(this.localUnit),
				defenderDescriptor,
				{
					isRangedInitiated: !RH.isAdjacent(local.coord, monster.state.coord),
					onComplete: (result) => {
						monster.state.currentHp = defenderDescriptor.state.currentHp;

						if (result.defenderMonsterDied) {
							this.removeMonster(monster);
						}

						if (result.attackerNeedsTeleport) {
							this.teleportEntity(
								this.localUnit.state,
								this.localUnit.mercenary,
							);
						}

						this.tutorialConfig?.onTutorialEvent({
							type: "combatEnded",
							won: !!result.defenderMonsterDied,
						});

						this.syncUI();
					},
				},
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
			return RH.isAdjacent(local.coord, u.state.coord);
		});

		if (hit) {
			this.tryStartCombat(hit);
			return true;
		}

		const monsterHit = this.livingMonsters().find((m) => {
			if (!pointInCircle(m.token.view.x, m.token.view.y, localX, localY, 20))
				return false;
			return RH.isAdjacent(local.coord, m.state.coord);
		});

		if (monsterHit) this.tryStartCombatVsMonster(monsterHit);
		return true;
	}

	/** Enemy defeat/teleport are BattleOverlay's job via shared state; this handles the rest. */
	private async onBattleComplete(result: BattleHostResult): Promise<void> {
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
		const drawn = this.localUnit.turnManager.spendRest();
		if (!drawn) return;
		this.cardDrawQueue.enqueue(drawn);
		this.showFeedback("💤 Rested — draw your cards");
		this.syncUI();
	}

	/** Spend 2 AP on Disengage — alternative movement, immune to ZoC. */
	private handleDisengagePressed(): void {
		if (this.moveController.active) {
			this.moveController.exit();
			this.hud.setMoveActive(false);
			return;
		}

		this.resetActionState();

		if (!this.localUnit.turnManager.beginDisengage()) return;

		this.moveController.enter(this.localUnit.state.stats.movement, true);
		this.hud.setMoveActive(true);
		this.hud.closeActionMenu();
	}

	private handleSpecialPressed(): void {
		this.resetActionState();
		const def = RH.getClassSpecial(this.localUnit.state.characterClass);
		if (!def) return;
		if (!this.localUnit.turnManager.useSpecial(def.apCost, def.id)) return;
		if (def.isStance) {
			this.showFeedback(`✨ ${def.name} active`);
		}
		this.syncUI();
	}

	// ---------- End Turn ----------

	/** End turn — shared by [E] key and End Turn button. No-ops mid-animation. */
	private handleEndTurn(): void {
		if (
			this.localUnit.mercenary.isAnimating ||
			this.exitCardInProgress ||
			this.processingEnemyTurns ||
			this.cardDrawQueue.isActive
		) {
			return;
		}
		this.moveController.exit();
		this.hand.exitSelectionMode();
		this.exitTargetingMode();
		this.hud.setMoveActive(false);
		this.hud.closeActionMenu();
		this.localUnit.turnManager.endTurn();
		this.turnsTaken++;
		this.tutorialConfig?.onTutorialEvent({ type: "turnEnded" });
		this.trySpawnMonster();
		void this.processEnemyTurns();
	}

	// ---------- Input ----------

	/** [Esc] cancel/pause toggle · [E] end turn · [R] regen · arrows+Enter for hand nav. */
	private handleKeyDown = (event: KeyboardEvent): void => {
		if (this.game.overlays.isOpen) {
			if (event.key === "Escape" && !this.game.overlays.active?.blocksEscape) {
				this.game.overlays.hide();
			}
			return;
		}

		switch (event.key) {
			case "Escape":
				if (this.targetingActive) {
					this.exitTargetingMode();
				} else if (this.moveController.active) {
					this.hud.setMoveActive(false);
				} else if (this.hand.isSelecting) {
					this.hand.exitSelectionMode();
					this.hud.setMoveActive(false);
					this.hud.closeActionMenu();
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
				if (this.moveController.isPreviewLocked) {
					if (this.moveController.confirm()) {
						this.hud.setMoveActive(false);
					}
					break;
				}
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
		if (this.suppressNextClick) {
			this.suppressNextClick = false;
			return;
		}
		if (this.game.overlays.isOpen) return;
		if (this.processingEnemyTurns) return;
		if (this.cardDrawQueue.isActive) {
			this.cardDrawQueue.tryCollect();
			return;
		}

		const { screenX, screenY } = this.getScreenPoint(event);
		const action = this.hud.handleActionClick(screenX, screenY);

		if (this.hud.hitTestBag(screenX, screenY)) {
			this.hud.toggleInventoryPanel();
			return;
		}
		if (this.hud.hitTestLogsButton(screenX, screenY)) {
			this.hud.toggleLogPanel();
			return;
		}

		if (this.hud.hitTestInspect(screenX, screenY)) {
			this.hud.toggleHunterSummaryPanel();
			return;
		}

		if (this.hud.hitTestRefocus(screenX, screenY)) {
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
			case "special":
				this.handleSpecialPressed();
				break;
			case "endTurn":
				this.handleEndTurn();
				break;
			case null:
				if (this.handleTargetClick(screenX, screenY)) break;
				if (this.moveController.isPreviewLocked) {
					const tile = this.screenPointToGrid(screenX, screenY);
					if (this.moveController.onPrimary(tile)) {
						this.hud.setMoveActive(false);
					}
				}
				break;
		}
	};

	/** Feed hovered tiles to the path preview while aiming; hand-reveal check always runs. */
	private handleMouseMove = (event: MouseEvent): void => {
		if (this.game.overlays.isOpen) return;
		const { screenX, screenY } = this.getScreenPoint(event);
		const hs = computeUiScale(
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
		const nearHand =
			screenX < uiPx(380, hs) &&
			screenY > this.game.app.screen.height - uiPx(180, hs);
		this.hand.setHovered(nearHand);
	};

	// ---------- UI ----------

	/** Shows a transient message via the HUD, plus logs it to match history. */
	private showFeedback(message: string): void {
		this.hud.showFeedbackMessage(message);

		logMatchEvent(this.game.session, message);
		this.hud.syncLogPanel(this.game.session.matchLog ?? []);
	}
	/** Sync all UI to the local unit's TurnManager state. */
	/**
	 * Pushes a specific card directly into the local player's hand,
	 * bypassing the deck entirely. Deliberately generic, not shaped
	 * around tutorials specifically — a future shop granting a purchased
	 * item-card can reuse this exactly as-is.
	 */
	giveCard(card: RH.CardData): void {
		if (this.localUnit.turnManager.handCapacity <= 0) return;
		this.cardDrawQueue.enqueue(card);
	}

	/**
	 * Hands over several cards as ONE real batch — not a loop of
	 * giveCard() calls. CardDrawQueue.enqueue's own presentBatch runs
	 * its synchronous setup (including splicing everything currently
	 * pending) immediately, before control ever returns to a caller —
	 * looping individual enqueue(single card) calls meant the first
	 * call already started presenting with just that one card before
	 * the loop's later calls had even pushed theirs in, splitting a
	 * "4 cards at once" into a visible "1, then 3" a moment later.
	 * Passing the whole array to a single enqueue() call is what
	 * CardDrawQueue's own API is already built to accept correctly.
	 */
	giveCards(cards: RH.CardData[]): void {
		const allowed = cards.slice(0, this.localUnit.turnManager.handCapacity);
		if (allowed.length === 0) return;
		this.cardDrawQueue.enqueue(allowed);
	}

	/**
	 * Empties the local player's hand entirely — used right before a
	 * guided combat round to guarantee the only card available is
	 * whatever giveCard hands them next, not whatever was already
	 * sitting in hand from earlier in the script.
	 */
	clearLocalHand(): void {
		this.localUnit.state.hand = [];
		this.syncUI();
	}

	/** Layers over an open overlay (a live battle) or shows exclusively, fading the HUD only in the exclusive case. */
	async playDialogue(lines: DialogueLine[]): Promise<void> {
		if (lines.length === 0) return;
		this.dialogueOverlay ??= new DialogueOverlay(this.game);

		const layered = this.game.overlays.isOpen;
		if (!layered) this.setHudVisible(false);

		if (layered) {
			await this.game.overlays.showOnTop(this.dialogueOverlay);
		} else {
			await this.game.overlays.show(this.dialogueOverlay);
		}

		await this.dialogueOverlay.playLines(lines);

		if (layered) {
			this.game.overlays.hideTop();
		} else {
			this.game.overlays.hide();
			this.setHudVisible(true);
		}
	}

	/**
	 * visible=false, not alpha — alpha only hides rendering; an interactive
	 * child under a zero-alpha element can still be hit-tested. visible=false
	 * skips both rendering and hits.
	 *
	 * Toggle panels (inventory / log / hunter summary) and PlayZone own their
	 * own .view.visible via open state / show-hide. Never force those to true
	 * here — that is what made them pop open after every dialogue beat.
	 * On hide, close them so nothing peeks under the overlay.
	 */
	setHudVisible(isVisible: boolean): void {
		this.hud.setCharacterPanelVisible(isVisible);
		this.hud.setDeckTrackerVisible(isVisible);
		this.hud.setBagVisible(isVisible);
		this.hud.setActionMenuVisible(isVisible);
		this.hud.view.visible = isVisible;
		this.hud.setRefocusVisible(isVisible);
		this.hud.setLogsChromeVisible(isVisible);
		this.hud.setInspectVisible(isVisible);
		this.hand.view.visible = isVisible;

		if (!isVisible) {
			this.hud.closeInventoryIfOpen();
			this.hud.closeLogPanelIfOpen();
			this.hud.closeHunterSummaryIfOpen();
			this.playZone.hide();
		} else if (this.hand.isSelecting) {
			// Dialogue hid the zone; selection is still active — put it back
			this.playZone.show();
		}

		this.tutorialMarkers.setVisible(isVisible);
	}
	getLocalUnitCoord(): RH.GridCoord {
		return this.localUnit.state.coord;
	}

	/**
	 * Instantly teleports the local player back to coord and undoes
	 * the movement they just spent attempting this segment, so they
	 * can immediately try again. Uses Mercenary's existing
	 * setPositionInstant (no animation — a genuine teleport, not a
	 * walk back) and TurnManager's undoMovementForRetry (refunds the
	 * AP and clears "already moved" without a full end-turn cycle,
	 * which would draw a new hand and could disrupt whatever a
	 * tutorial script specifically gave the player).
	 */
	resetLocalUnitToCoord(coord: RH.GridCoord): void {
		const local = this.localUnit;
		local.state.coord = coord;
		local.mercenary.setPositionInstant(gridToScreen(coord));
		local.turnManager.undoMovementForRetry();
		this.syncUI();
	}

	/**
	 * Animates a static actor's token from its current screen position
	 * to destination. Purely visual — no game state, no coord
	 * tracking, since static actors were never part of turn logic to
	 * begin with.
	 */
	moveStaticActor(
		label: string,
		destination: RH.GridCoord,
		durationMs = 900,
	): Promise<void> {
		return this.tutorialMarkers.moveStaticActor(
			label,
			destination,
			this.grid,
			durationMs,
		);
	}

	/**
	 * Spawns one specific, controlled, genuinely killable monster —
	 * deliberately separate from trySpawnMonster's random-position
	 * logic. A real MonsterEntity in MonsterSystem's own array (not a
	 * decorative token), so it's genuinely fightable through the
	 * normal Attack flow.
	 */
	spawnTutorialMonster(coord: RH.GridCoord, tier: RH.MonsterTier): void {
		const entity = this.monsterSystem.spawnSpecific(
			`tutorial_monster_${tier}`,
			tier,
			coord,
		);
		this.tutorialMonster = entity;
	}

	/** The tutorial monster's current coord, or null if none has been spawned yet — used to point at it once it exists, since its actual position isn't known until it's spawned and dashed at runtime. */
	getTutorialMonsterCoord(): RH.GridCoord | null {
		return this.tutorialMonster?.state.coord ?? null;
	}

	/**
	 * Animates the tutorial monster along a real, tile-based path to a
	 * tile adjacent to the player — never onto the player's own tile,
	 * since that coord is explicitly in the blocked set here (the
	 * earlier version left it out, which meant the pathfinder had no
	 * reason not to path the monster directly onto the player). Uses
	 * the same computeMovementRange/getPathTo real AI monster movement
	 * already uses, then MonsterToken's own moveAlongPath — same
	 * genuine tile-based animation the token already has.
	 */
	async dashMonsterToPlayer(): Promise<void> {
		const monster = this.tutorialMonster;
		if (!monster) return;

		const target = this.localUnit.state.coord;
		const blocked = new Set<string>([RH.coordKey(target)]);
		const range = RH.computeMovementRange(
			this.grid,
			monster.state.coord,
			this.grid.width + this.grid.height,
			blocked,
		);
		const landing =
			RH.findNearestReachableTile(this.grid, range, target, blocked) ??
			monster.state.coord;
		const path = RH.getPathTo(range, landing) ?? [];
		if (path.length === 0) return;

		monster.state.coord = landing;
		await monster.token.moveAlongPath(path);
	}

	triggerTutorialMonsterAttack(
		maxRounds?: number,
		availableActions?: RH.CombatAction[],
		guide?: TutorialCombatGuide,
	): Promise<void> {
		const monster = this.tutorialMonster;
		if (!monster) return Promise.resolve();

		const target = this.localUnit;
		const attackerDescriptor = describeMonster(monster);
		const defenderDescriptor = describeLocalPlayer(target);

		this.tutorialConfig?.onTutorialEvent({
			type: "combatStarted",
			opponentType: "monster",
		});

		return this.battleHost
			.run(
				buildBattleRequest(attackerDescriptor, defenderDescriptor, {
					isRangedInitiated: false,
					maxRounds,
					tutorial: {
						availableActions,
						requiredAction: guide?.requiredAction,
						grayOthers: guide?.grayOthers,
						onWrongAction: guide?.onWrongAction,
						onReady: guide?.onReady,
					},
				}),
			)
			.then(async (result) => {
				monster.state.currentHp = attackerDescriptor.state.currentHp;

				if (result.attackerMonsterDied) {
					this.removeMonster(monster);
				}

				if (result.defenderNeedsTeleport) {
					await this.teleportEntity(target.state, target.mercenary);
				}

				this.tutorialConfig?.onTutorialEvent({
					type: "combatEnded",
					won: !result.defenderNeedsTeleport,
				});

				this.syncUI();
			});
	}

	/**
	 * Glowing tile + bobbing downward arrow over a specific coord — a
	 * generic "move here" pointer any tutorial segment can request via
	 * targetTile, not something built one-off for this scene. Guidance
	 * only, never enforced — the player can still move anywhere.
	 */
	showTutorialTarget(coord: RH.GridCoord): void {
		this.tutorialMarkers.showTarget(coord);
	}

	hideTutorialTarget(): void {
		this.tutorialMarkers.hideTarget();
	}

	/**
	 * Points a bobbing arrow at a screen-space UI element — a specific
	 * ActionMenu button, a hand card, the card-draw stack, the
	 * PlayZone, or its skip button. `side` picks which direction the
	 * arrow sits and points from, chosen per-call to avoid overlapping
	 * whatever neighboring UI actually surrounds that target (e.g.
	 * "down" for the skip button so the arrow doesn't collide with
	 * PlayZone sitting above it). Unlike showTutorialTarget (a fixed
	 * map coordinate), this target's position is re-queried every
	 * frame in update(), since the actual screen position of a hand
	 * card or menu row can genuinely move.
	 */
	showUiPointer(target: TutorialUiPointerTarget): void {
		this.tutorialMarkers.showUiPointer(target);
	}

	hideUiPointer(): void {
		this.tutorialMarkers.hideUiPointer();
	}

	/** Dispatches to whichever component actually owns the requested target's live screen position. Returns null if that element doesn't currently exist rather than throwing. */
	private resolveUiPointerPosition(
		target: TutorialUiPointerTarget,
	): { x: number; y: number } | null {
		switch (target.kind) {
			case "actionButton":
				return this.hud.getActionButtonScreenPosition(target.key);
			case "handCard":
				return this.hand.getCardScreenPosition(target.cardId);
			case "cardDrawStack":
				return this.cardDrawQueue.getFrontCardScreenPosition();
			case "playZone":
				return this.playZone.getZoneScreenPosition();
			case "skipButton":
				return this.playZone.getSkipButtonScreenPosition();
		}
	}

	private syncUI(): void {
		if (!this.hud || this.units.length === 0) return;
		const local = this.localUnit;
		this.hud.syncActions(
			local.turnManager,
			RH.getClassSpecial(local.state.characterClass),
		);
		this.hand.syncFromHand(local.state.hand);
		this.hud.syncDeckTracker(local.turnManager);
		this.hud.syncInventoryPanel(local.state.items);
		this.hud.setInventoryTargetItemId(
			this.game.session.chestPlan?.targetItem?.id ?? null,
		);
		this.hud.syncCharacterPanel(
			this.game.session.character,
			local.state,
			local.turnManager.apRemaining,
			local.turnManager.baseAP,
		);
		this.hud.syncHunterSummary(this.buildHunterSummaryEntries());
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
		this.pendingMoveUsedCard = cardType !== "none";
		this.tutorialConfig?.onTutorialEvent({
			type: cardType === "none" ? "skipChosen" : "cardChosen",
		});

		if (!local.turnManager.beginMovement(cardType, numericValue)) {
			return;
		}

		if (card.actionType === "defense") {
			const v = card.value;
			if (typeof v === "number" || v === "A" || v === "C") {
				local.state.temporaryStatBonus.defense = v;
			}
		} else {
			local.state.temporaryStatBonus.movement = numericValue;
		}
		this.syncUI();

		this.moveController.requestEnter();
		this.hud.setMoveActive(this.moveController.active);

		if (card.actionType === "stun") {
			// TEMPORARY: routed through the Move flow because there's no
			// dedicated RH.Trap action yet — every class, Trapper included
			// once it exists, shares this path for now.
			this.placeTrap(card);
			if (!local.turnManager.beginMovement("none", 0)) return;
			this.moveController.requestEnter();
			this.hud.setMoveActive(this.moveController.active);
			return;
		}
	}

	private placeTrapAtCurrentPosition(_card: RH.CardData): void {
		const local = this.localUnit.state;
		this.trapSystem.place({
			coord: local.coord,
			ownerId: local.id,
			kind: "stun",
		});
		this.showFeedback("🪤 RH.Trap left behind");
		this.refreshTrapMarkers();
	}

	private refreshTrapMarkers(): void {
		const local = this.localUnit.state;
		this.trapSystem.renderMarkersFor(
			local.id,
			local.coord,
			local.characterClass === "hunter",
		);
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
				RH.applyStun(unit.state);
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
				...this.tutorialMarkers.actorCoordsList,
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
		this.hud.setMoveActive(false);
		this.hud.closeActionMenu();
		this.exitTargetingMode();

		this.mapSeed = Math.floor(Math.random() * 1_000_000);
		this.grid = this.buildMap();

		this.applyCameraBounds();

		this.mercenaryContainer.removeChildren();
		this.units = [];
		this.monsterSystem = new MonsterSystem(this.mercenaryContainer);
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
		const starter = this.localUnit.turnManager.dealStartingHand();
		this.cardDrawQueue.enqueue(starter);
		this.turnsTaken = 0;

		this.boardContainer.removeChild(this.moveController.view);
		this.moveController = this.createMoveController();
		this.boardContainer.addChild(this.moveController.view);

		this.mapRenderer.build(this.grid, 0);
		this.mapRenderer.centerCamera();
		this.syncUI();
	}

	/** Cancels whatever action-mode is currently active */
	private resetActionState(): void {
		this.moveController.exit();
		this.exitTargetingMode();
		this.hand.exitSelectionMode();
		this.hud.setMoveActive(false);
		this.hud.closeActionMenu();
	}

	/** Convert a mouse event to canvas-local screen coordinates. */
	private getScreenPoint(event: MouseEvent) {
		const canvas = this.game.app.canvas;
		const rect = canvas.getBoundingClientRect();
		const scaleX = canvas.width / Math.max(1, rect.width);
		const scaleY = canvas.height / Math.max(1, rect.height);
		return {
			screenX: (event.clientX - rect.left) * scaleX,
			screenY: (event.clientY - rect.top) * scaleY,
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
		const overrides = this.tutorialConfig?.script.debugMap.tileOverrides;
		if (overrides) {
			const grid = new RH.Grid(this.mapWidth, this.mapHeight);
			for (const { coord, type } of overrides) {
				grid.setTileType(coord, type);
			}
			return grid;
		}

		return RH.generateDungeon(this.mapWidth, this.mapHeight, {
			seed: this.mapSeed,
			roomCount: this.roomCount,
		});
	}

	/** Build the local player's RH.MercenaryState. */
	private spawnMercenary(): RH.MercenaryState {
		const spawnCoord = this.tutorialConfig?.script.playerSpawn ??
			this.game.session.playerSpawn ??
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
}
