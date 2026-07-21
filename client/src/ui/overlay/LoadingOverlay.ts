import { Container, Graphics, Text, Ticker } from "pixi.js";
import type { Overlay } from "@/core/Overlay";
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
import { MapScene } from "@/scenes/MapScene";

const CORNER_PAN_MS = 1100;
const SETTLE_ON_PLAYER_MS = 500;
const REVEAL_LINGER_MS = 1400;
const FADE_MS = 500;
const ROOM_DENSITY = 1 / 50;

/**
 * Pre-match cinematic, shown as an Overlay layered on top of whatever
 * scene triggered it (MissionSelectScene) rather than as its own Scene.
 *
 * This is the key architectural fix: SceneManager blocks a scene's own
 * update() calls for the entire duration of its onEnter() (see its own
 * docblock — "Blocks per-frame updates during transitions"). Any async
 * cinematic sequence living inside onEnter() either has to be fully
 * self-driven (no dependency on that scene's update() at all) or it risks
 * subtle timing bugs. OverlayManager has none of that blocking logic, so
 * running this sequence as an Overlay sidesteps the whole problem — and
 * it matches what this actually IS: a temporary layer on top of the
 * current scene, not a distinct navigational destination of its own.
 *
 * MissionSelectScene is never torn down by this overlay directly — it
 * stays the active SceneManager scene throughout the whole sequence,
 * fully covered by this overlay's opaque `cover`. Only at the very end
 * does this overlay call `sceneManager.changeScene(new MapScene(...))`,
 * which performs the real, correct teardown of MissionSelectScene — and
 * only after that scene change has fully resolved does this overlay
 * remove itself, so MapScene is revealed directly with no flash back to
 * the old screen in between.
 */
export class LoadingOverlay implements Overlay {
	readonly view = new Container();

	private boardContainer = new Container();
	private tilesContainer = new Container();
	private camera: Camera;
	private mapRenderer: MapRenderer;
	private grid!: Grid;

	private loadingText: Text;
	// Solid black — sits above everything, hides setup work and the
	// eventual scene swap underneath. See onShow() and the two fade helpers.
	private cover = new Graphics();

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

		this.loadingText = new Text({
			text: "Loading...",
			style: { fill: 0xffffff, fontSize: 24, fontWeight: "bold" },
		});
		this.loadingText.anchor.set(0.5);

		// Blocks clicks from reaching whatever's underneath (MissionSelectScene's
		// still-technically-present buttons) — same pattern as PauseOverlay's dimBg.
		this.cover.eventMode = "static";

		this.view.addChild(this.loadingText);
		this.view.addChild(this.cover);
	}

	async onShow(): Promise<void> {
		this.positionLoadingText();
		this.drawCover(this.game.app.screen.width, this.game.app.screen.height);
		this.cover.alpha = 1;
		this.loadingText.visible = true;

		await this.waitForPaint();

		// Fully hidden behind the opaque cover — the player never sees
		// tiles or chests assembling.
		this.setupMatch();
		this.mapRenderer.build(this.grid, 0);
		this.buildPanel();
		this.layout(this.game.app.screen.width, this.game.app.screen.height);

		this.loadingText.visible = false;
		await this.fadeCover(1, 0);

		await this.runIntroSequence();
	}

	onHide(): void {}

	update(deltaTime: number): void {
		this.camera.update(
			deltaTime,
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
	}

	onResize(width: number, height: number): void {
		this.positionLoadingText();
		this.drawCover(width, height);
		this.layout(width, height);
	}

	// ---------- Setup ----------

	private setupMatch(): void {
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

	/** Resolve once the browser has actually painted a frame. */
	private waitForPaint(): Promise<void> {
		return new Promise((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		});
	}

	/**
	 * Fade the cover between two alpha values over FADE_MS. Self-driven via
	 * Ticker.shared + a performance.now() timestamp — same reasoning as
	 * Camera.panTo: a wall-clock elapsed calculation is immune to any
	 * single tick reporting an inflated delta after blocking work.
	 */
	private fadeCover(from: number, to: number): Promise<void> {
		return new Promise((resolve) => {
			const startTime = performance.now();

			const tick = (): void => {
				const elapsed = performance.now() - startTime;
				const t = Math.min(elapsed / FADE_MS, 1);
				this.cover.alpha = from + (to - from) * t;

				if (t >= 1) {
					Ticker.shared.remove(tick);
					resolve();
				}
			};

			Ticker.shared.add(tick);
		});
	}

	private drawCover(width: number, height: number): void {
		this.cover.clear();
		this.cover.rect(0, 0, width, height);
		this.cover.fill(0x000000);
	}

	// ---------- Sequence ----------

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

		await this.camera.panTo(
			topRight,
			CORNER_PAN_MS,
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
		await this.camera.panTo(
			bottomRight,
			CORNER_PAN_MS,
			this.game.app.screen.width,
			this.game.app.screen.height,
		);
		await this.camera.panTo(
			bottomLeft,
			CORNER_PAN_MS,
			this.game.app.screen.width,
			this.game.app.screen.height,
		);

		this.rollTurnOrder();

		const spawnCoord = findFirstWalkableTile(this.grid) ?? { x: 0, y: 0 };
		await this.camera.panTo(
			gridToScreen(spawnCoord),
			SETTLE_ON_PLAYER_MS,
			this.game.app.screen.width,
			this.game.app.screen.height,
		);

		await this.delay(REVEAL_LINGER_MS);

		// Re-cover the screen BEFORE the scene swap happens underneath, so
		// MissionSelectScene's teardown and MapScene's construction are
		// both fully hidden. Only once MapScene has actually finished
		// entering do we remove this overlay — that's what makes the
		// handoff flash-free.
		await this.fadeCover(0, 1);
		await this.game.sceneManager.changeScene(new MapScene(this.game));
		this.game.overlays.hide();
	}

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

		// Cover must stay the topmost child throughout, or the reveal
		// fade would show the panel through it before it's supposed to.
		this.view.setChildIndex(this.cover, this.view.children.length - 1);
	}

	private positionLoadingText(): void {
		this.loadingText.x = this.game.app.screen.width / 2;
		this.loadingText.y = this.game.app.screen.height / 2;
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
