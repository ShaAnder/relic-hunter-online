import { Container, Text } from "pixi.js";
import type { Scene } from "@/core/Scene";
import type { Game } from "@/core/Game";
import { Camera } from "@/core/Camera";
import { MapRenderer } from "@/rendering/MapRenderer";
import { MAP_SIZE_DIMENSIONS, type TurnOrderEntry } from "@/core/GameSession";
import { gridToScreen } from "@/math/isoGridMath";
import {
	type Grid,
	generateDungeon,
	findFirstWalkableTile,
	planChests,
} from "@relic-hunter/shared";
import { MapScene } from "./MapScene";

const CORNER_PAN_MS = 1100;
const SETTLE_ON_PLAYER_MS = 500;
const REVEAL_LINGER_MS = 1400;
const ROOM_DENSITY = 1 / 50;

/**
 * Pre-match cinematic: generates the map + chest plan once (stored on
 * GameSession so MapScene reuses the exact same seed and contents rather
 * than rolling its own), pans the camera around the full perimeter while
 * a reveal panel shows map size / seed / target item, rolls turn order,
 * then snaps onto the player's spawn point before handing off to MapScene.
 *
 * This is where LoadingScene's "insertion point" (noted in
 * MissionSelectScene's docblock) actually lands — it does real work, not
 * just a spinner.
 */
export class LoadingScene implements Scene {
	readonly view = new Container();

	private boardContainer = new Container();
	private tilesContainer = new Container();
	private camera: Camera;
	private mapRenderer: MapRenderer;
	private grid: Grid;

	private panel = new Container();
	private sizeText!: Text;
	private seedText!: Text;
	private targetText!: Text;
	private turnOrderText!: Text;

	constructor(private game: Game) {
		this.boardContainer.addChild(this.tilesContainer);
		this.view.addChild(this.boardContainer);

		this.camera = new Camera(this.boardContainer, {
			initialZoom: 1.1,
			minZoom: 0.75,
			maxZoom: 3,
		});
		this.mapRenderer = new MapRenderer(
			this.tilesContainer,
			this.boardContainer,
			this.camera,
			this.game,
		);

		// Generate once, here — MapScene reuses game.session.mapSeed instead
		// of rolling its own, so this preview and the real map always match.
		const mapSize = this.game.session.missionParams?.mapSize ?? "M";
		const { width, height } = MAP_SIZE_DIMENSIONS[mapSize];
		const seed = Math.floor(Math.random() * 1_000_000);
		this.game.session.mapSeed = seed;

		this.grid = generateDungeon(width, height, {
			seed,
			roomCount: Math.floor(width * height * ROOM_DENSITY),
		});

		this.game.session.chestPlan = planChests();
	}

	async onEnter(): Promise<void> {
		this.mapRenderer.build(this.grid, 0);
		this.buildPanel();
		this.layout(this.game.app.screen.width, this.game.app.screen.height);

		await this.runIntroSequence();
	}

	onExit(): void {}

	update(deltaTime: number): void {
		// Camera.panTo only advances while update runs. Without this the
		// intro sequence hangs forever on the first await panTo(...).
		this.camera.update(
			deltaTime,
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
	}

	onResize(width: number, height: number): void {
		this.layout(width, height);
	}

	// ---------- Sequence ----------

	/**
	 * Start at one corner, pan the full perimeter, roll turn order, then
	 * snap onto the player's spawn tile before transitioning to MapScene.
	 */
	private async runIntroSequence(): Promise<void> {
		const { width, height } = this.grid;
		const topLeft = gridToScreen({ x: 0, y: 0 });
		const topRight = gridToScreen({ x: width - 1, y: 0 });
		const bottomRight = gridToScreen({ x: width - 1, y: height - 1 });
		const bottomLeft = gridToScreen({ x: 0, y: height - 1 });

		this.camera.centerOn(
			topLeft,
			this.game.app.screen.width,
			this.game.app.screen.height,
		);

		await this.camera.panTo(topRight, CORNER_PAN_MS);
		await this.camera.panTo(bottomRight, CORNER_PAN_MS);
		await this.camera.panTo(bottomLeft, CORNER_PAN_MS);

		this.rollTurnOrder();

		const spawnCoord = findFirstWalkableTile(this.grid) ?? { x: 0, y: 0 };
		await this.camera.panTo(gridToScreen(spawnCoord), SETTLE_ON_PLAYER_MS);

		await this.delay(REVEAL_LINGER_MS);

		void this.game.sceneManager.changeScene(new MapScene(this.game));
	}

	/**
	 * Roll turn order. Single participant today (the player), but the
	 * shape is generic — each entry rolls a d20, sorted highest-first —
	 * so this works unmodified once enemy hunters exist to roll against.
	 */
	private rollTurnOrder(): void {
		const playerName = this.game.session.character?.name ?? "Player";

		const entries: TurnOrderEntry[] = [
			{
				id: "player",
				label: playerName,
				roll: 1 + Math.floor(Math.random() * 20),
			},
		];
		entries.sort((a, b) => b.roll - a.roll);

		this.game.session.turnOrder = entries;
		this.turnOrderText.text = entries
			.map((e, i) => `${i + 1}. ${e.label} — rolled ${e.roll}`)
			.join("\n");
	}

	/** Promise-based delay for the post-reveal pause before transitioning. */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	// ---------- UI ----------

	private buildPanel(): void {
		const mapSize = this.game.session.missionParams?.mapSize ?? "M";
		const target = this.game.session.chestPlan?.targetItem;

		const style = { fill: 0xffffff, fontSize: 16, fontFamily: "monospace" };

		this.sizeText = new Text({ text: `Map Size: ${mapSize}`, style });
		this.seedText = new Text({
			text: `Seed: ${this.game.session.mapSeed}`,
			style,
		});
		this.targetText = new Text({
			text: target ? `🎯 Target: ${target.name}\n"${target.description}"` : "",
			style: { ...style, fill: 0xffd700, fontWeight: "bold" },
		});
		this.turnOrderText = new Text({ text: "", style });

		this.panel.addChild(
			this.sizeText,
			this.seedText,
			this.targetText,
			this.turnOrderText,
		);
		this.view.addChild(this.panel);
	}

	private layout(width: number, height: number): void {
		this.sizeText.x = 20;
		this.sizeText.y = 20;

		this.seedText.x = 20;
		this.seedText.y = 46;

		this.targetText.x = 20;
		this.targetText.y = 80;

		this.turnOrderText.x = 20;
		this.turnOrderText.y = height - 90;
	}
}
