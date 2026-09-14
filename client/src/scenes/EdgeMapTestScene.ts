import {
	Container,
	FederatedPointerEvent,
	Graphics,
} from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import { EdgeMapRenderer } from "@/rendering/EdgeMapRenderer";
import { Mercenary } from "@/entities/Mercenary";
import {
	gridToScreen,
	screenToGrid,
	TILE_WIDTH,
	TILE_HEIGHT,
} from "@/math/isoGridMath";
import * as RH from "@relic-hunter/shared";

const MOVE_BUDGET = 6;
const RANGE_HIGHLIGHT_COLOR = 0x4a9eff;
const RANGE_HIGHLIGHT_ALPHA = 0.35;

/**
 * Edge-map development scene running the REAL Alleyways ground floor.
 *
 * This replaces EDGE_TEST_BLUEPRINT as the source map. The existing
 * Alleyways blueprint is converted to Grid + EdgeGrid at runtime by
 * compileAlleywaysEdgeMap().
 */
export class EdgeMapTestScene implements Scene {
	readonly view = new Container();

	private mapContainer = new Container();
	private highlightContainer = new Container();
	private tokenContainer = new Container();

	private renderer: EdgeMapRenderer;

	private compiled: RH.AlleywaysEdgeMap = RH.ALLEYWAYS_EDGE_MAP;
	private rooms: RH.Room[] = [];
	private currentRoom: RH.Room | null = null;

	private character!: Mercenary;
	private characterCoord!: RH.GridCoord;
	private isMoving = false;

	constructor(private game: Game) {
		this.renderer = new EdgeMapRenderer(this.mapContainer);
	}

	onEnter(): void {
		this.view.addChild(this.mapContainer);
		this.view.addChild(this.highlightContainer);
		this.view.addChild(this.tokenContainer);

		this.rooms = RH.detectRooms(
			this.compiled.grid.width,
			this.compiled.grid.height,
			this.compiled.edges,
		);

		this.characterCoord =
			RH.findFirstWalkableTile(this.compiled.grid) ?? {
				x: 1,
				y: 1,
			};

		this.currentRoom = RH.findRoomAt(
			this.rooms,
			this.characterCoord,
		);

		this.renderer.build(
			this.compiled,
			this.currentRoom,
		);

		this.character = new Mercenary(
			this.characterCoord,
			"brawler",
		);

		this.tokenContainer.addChild(this.character.view);

		const startPosition = gridToScreen(this.characterCoord);
		this.character.view.x = startPosition.x;
		this.character.view.y = startPosition.y;

		this.view.eventMode = "static";
		this.view.on("pointertap", this.onPointerTap);

		this.drawRangeHighlight();
		this.center();
	}

	onExit(): void {
		this.view.off("pointertap", this.onPointerTap);
		this.view.removeChildren();
	}

	update(deltaTime: number): void {
		this.character.update(deltaTime);
	}

	onResize(width: number, height: number): void {
		this.center(width, height);
	}

	private onPointerTap = (
		event: FederatedPointerEvent,
	): void => {
		if (this.isMoving) return;

		const local = this.mapContainer.toLocal(event.global);

		const target = screenToGrid(
			local.x,
			local.y,
		);

		const range = RH.computeMovementRangeWithEdges(
			this.compiled.grid,
			this.compiled.edges,
			this.characterCoord,
			MOVE_BUDGET,
		);

		const key = RH.coordKey(target);

		if (
			!range.has(key) ||
			key === RH.coordKey(this.characterCoord)
		) {
			return;
		}

		const path = RH.getPathTo(range, target);
		if (!path || path.length === 0) return;

		this.isMoving = true;

		this.character
			.moveAlongPath(path)
			.then(() => {
				this.characterCoord = target;
				this.isMoving = false;

				const newRoom = RH.findRoomAt(
					this.rooms,
					this.characterCoord,
				);

				if (
					newRoom?.id !== this.currentRoom?.id
				) {
					this.currentRoom = newRoom;

					this.renderer.build(
						this.compiled,
						this.currentRoom,
					);
				}

				this.drawRangeHighlight();
			})
			.catch(() => {
				this.isMoving = false;
			});
	};

	private drawRangeHighlight(): void {
		this.highlightContainer.removeChildren();

		const range = RH.computeMovementRangeWithEdges(
			this.compiled.grid,
			this.compiled.edges,
			this.characterCoord,
			MOVE_BUDGET,
		);

		for (const entry of range.values()) {
			if (entry.distance === 0) continue;

			const position = gridToScreen(entry.coord);

			const graphic = new Graphics();

			graphic.poly([
				0,
				-TILE_HEIGHT / 2,
				TILE_WIDTH / 2,
				0,
				0,
				TILE_HEIGHT / 2,
				-TILE_WIDTH / 2,
				0,
			]);

			graphic.fill({
				color: RANGE_HIGHLIGHT_COLOR,
				alpha: RANGE_HIGHLIGHT_ALPHA,
			});

			graphic.x = position.x;
			graphic.y = position.y;

			this.highlightContainer.addChild(graphic);
		}
	}

	private center(
		width = this.game.app.screen.width,
		height = this.game.app.screen.height,
	): void {
		const bounds = this.mapContainer.getLocalBounds();

		const centerX =
			width / 2 - (bounds.x + bounds.width / 2);

		const centerY =
			height / 2 - (bounds.y + bounds.height / 2);

		for (const container of [
			this.mapContainer,
			this.highlightContainer,
			this.tokenContainer,
		]) {
			container.x = centerX;
			container.y = centerY;
		}
	}
}
