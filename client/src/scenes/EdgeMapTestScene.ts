import { Container, FederatedPointerEvent, Graphics } from "pixi.js";
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
 * Dev-only scene: the edge-based test room (EDGE_TEST_BLUEPRINT),
 * rendered with EdgeMapRenderer, plus a single movable character —
 * built specifically to test whether smooth click-to-move animation
 * still works correctly against edge-aware pathfinding
 * (computeMovementRangeWithEdges), not just whether the map renders.
 * Everything else (fog, combat, turns, elevation on this map, doors
 * as anything other than a passable edge) is deliberately out of
 * scope here.
 *
 * Not part of the real game flow. To view it temporarily, swap the
 * line in main.ts:
 *   await game.start(new LandingScene(game));
 * for:
 *   await game.start(new EdgeMapTestScene(game));
 * and revert afterward — this scene is not meant to ship.
 */
export class EdgeMapTestScene implements Scene {
	readonly view = new Container();
	private mapContainer = new Container();
	private highlightContainer = new Container();
	private tokenContainer = new Container();
	private renderer: EdgeMapRenderer;

	private compiled!: RH.CompiledEdgeMap;
	private rooms!: RH.Room[];
	private currentRoom: RH.Room | null = null;
	private character!: Mercenary;
	private characterCoord: RH.GridCoord = { x: 2, y: 2 };
	private isMoving = false;

	constructor(private game: Game) {
		this.renderer = new EdgeMapRenderer(this.mapContainer);
	}

	onEnter(): void {
		this.view.addChild(this.mapContainer);
		this.view.addChild(this.highlightContainer);
		this.view.addChild(this.tokenContainer);

		this.compiled = RH.compileEdgeMap(RH.EDGE_TEST_BLUEPRINT);
		this.rooms = RH.detectRooms(
			this.compiled.grid.width,
			this.compiled.grid.height,
			this.compiled.edges,
		);
		this.currentRoom = RH.findRoomAt(this.rooms, this.characterCoord);
		this.renderer.build(this.compiled, this.currentRoom);

		this.character = new Mercenary(this.characterCoord, "brawler");
		this.tokenContainer.addChild(this.character.view);

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

	private onPointerTap = (event: FederatedPointerEvent): void => {
		if (this.isMoving) return;

		const local = this.mapContainer.toLocal(event.global);
		const target = screenToGrid(local.x, local.y);

		const range = RH.computeMovementRangeWithEdges(
			this.compiled.grid,
			this.compiled.edges,
			this.characterCoord,
			MOVE_BUDGET,
		);
		const key = RH.coordKey(target);
		if (!range.has(key) || key === RH.coordKey(this.characterCoord)) return;

		const path = RH.getPathTo(range, target);
		if (!path || path.length === 0) return;

		this.isMoving = true;
		this.character
			.moveAlongPath(path)
			.then(() => {
				this.characterCoord = target;
				this.isMoving = false;

				const newRoom = RH.findRoomAt(this.rooms, this.characterCoord);
				if (newRoom?.id !== this.currentRoom?.id) {
					this.currentRoom = newRoom;
					this.renderer.build(this.compiled, this.currentRoom);
				}

				this.drawRangeHighlight();
			})
			.catch(() => {
				this.isMoving = false;
			});
	};

	/** A simple blue-tinted diamond over every tile currently reachable — just enough feedback to see the edge-aware range actually respects the walls and door, not a full production move-preview. */
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
			const pos = gridToScreen(entry.coord);
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
			g.fill({ color: RANGE_HIGHLIGHT_COLOR, alpha: RANGE_HIGHLIGHT_ALPHA });
			g.x = pos.x;
			g.y = pos.y;
			this.highlightContainer.addChild(g);
		}
	}

	private center(
		width = this.game.app.screen.width,
		height = this.game.app.screen.height,
	): void {
		const bounds = this.mapContainer.getLocalBounds();
		const cx = width / 2 - (bounds.x + bounds.width / 2);
		const cy = height / 2 - (bounds.y + bounds.height / 2);
		for (const c of [
			this.mapContainer,
			this.highlightContainer,
			this.tokenContainer,
		]) {
			c.x = cx;
			c.y = cy;
		}
	}
}
