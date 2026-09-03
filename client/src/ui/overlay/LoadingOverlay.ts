import { Container, Graphics, Text, Ticker } from "pixi.js";
import type { Overlay } from "@/core/overlays/Overlay";
import type { Game } from "@/core/game/Game";
import {
	TEST_MAP_DIMENSIONS,
	type TurnOrderEntry,
	type PlacedChestRecord,
} from "@/core/game/GameSession";
import {
	type Grid,
	type GridCoord,
	generateDungeon,
	findFirstWalkableTile,
	planChests,
	coordKey,
	pickSpreadWalkableTile,
} from "@relic-hunter/shared";
import { MapScene } from "@/scenes/MapScene";

const ROOM_DENSITY = 1 / 50;

// Total loading-bar duration — split across the real setup steps below,
// so the bar fills smoothly over roughly this long rather than jumping
// straight to 100% the instant actual setup (which is near-instant)
// finishes. Easily tunable, single source of truth.
const LOADING_DURATION_MS = 4000;

// How long the summary screen (seed, target, turn order) stays up
// before automatically fading into the game.
const SUMMARY_LINGER_MS = 2500;
const FADE_MS = 500;

/**
 * Loading screen — a progress bar with step-labeled text (seed, target
 * item, turn order, as each is determined), then a centered summary
 * screen that lingers briefly before automatically fading into
 * MapScene. No camera pan/orbit cinematic, no button press required.
 * Places the map + chests once, stores positions on GameSession.
 */
export class LoadingOverlay implements Overlay {
	readonly view = new Container();

	private grid!: Grid;

	private backdrop = new Graphics();
	private cover = new Graphics();

	private loadingRoot = new Container();
	private loadingLabel!: Text;
	private barTrack = new Graphics();
	private barFill = new Graphics();

	private summaryRoot = new Container();
	private summaryText!: Text;

	private placements: PlacedChestRecord[] = [];
	private spawnCoord: GridCoord = { x: 0, y: 0 };
	private turnOrder: TurnOrderEntry[] = [];

	constructor(private game: Game) {
		this.view.addChild(this.backdrop);
		this.view.addChild(this.loadingRoot);
		this.view.addChild(this.summaryRoot);
		this.view.addChild(this.cover);

		this.cover.eventMode = "static";

		this.buildLoadingUI();
		this.buildSummaryUI();
	}

	async onShow(): Promise<void> {
		const w = this.game.app.screen.width;
		const h = this.game.app.screen.height;

		this.drawBackdrop(w, h);
		this.drawCover(w, h);
		this.cover.alpha = 0;
		this.loadingRoot.visible = true;
		this.summaryRoot.visible = false;
		this.setProgress(0);
		this.layoutLoadingUI(w, h);

		await this.waitForPaint();

		const stepDelay = LOADING_DURATION_MS / 5;

		this.setProgress(0.15);
		this.loadingLabel.text = "Preparing mission…";
		this.setupGrid();
		await this.delay(stepDelay);

		this.setProgress(0.4);
		this.loadingLabel.text = `Generating map (seed: ${this.game.session.mapSeed})…`;
		await this.delay(stepDelay);

		this.setProgress(0.6);
		this.setupChestsAndSpawn();
		const targetName =
			this.game.session.chestPlan?.targetItem?.name ?? "the relic";
		this.loadingLabel.text = `Searching for ${targetName}…`;
		await this.delay(stepDelay);

		this.setProgress(0.85);
		this.rollTurnOrder();
		this.loadingLabel.text = "Rolling turn order…";
		await this.delay(stepDelay);

		this.setProgress(1);
		this.loadingLabel.text = "Ready.";
		await this.delay(stepDelay);

		this.loadingRoot.visible = false;
		this.buildSummaryText();
		this.summaryRoot.visible = true;
		this.layoutSummaryUI(
			this.game.app.screen.width,
			this.game.app.screen.height,
		);

		await this.delay(SUMMARY_LINGER_MS);

		await this.fadeCover(0, 1, FADE_MS);
		await this.game.sceneManager.changeScene(new MapScene(this.game));
		this.game.overlays.hide();
	}

	onHide(): void {}

	update(_deltaTime: number): void {}

	onResize(width: number, height: number): void {
		this.drawBackdrop(width, height);
		this.drawCover(width, height);
		this.layoutLoadingUI(width, height);
		if (this.summaryRoot.visible) this.layoutSummaryUI(width, height);
	}

	// ---------- Setup ----------

	private setupGrid(): void {
		const { width, height } = TEST_MAP_DIMENSIONS;
		const seed = Math.floor(Math.random() * 1_000_000);
		this.game.session.mapSeed = seed;
		this.game.session.matchSeed = Math.floor(Math.random() * 1_000_000);

		this.grid = generateDungeon(width, height, {
			seed,
			roomCount: Math.floor(width * height * ROOM_DENSITY),
		});
	}

	/**
	 * Plan items, place every chest on a distinct walkable tile, pick spawn.
	 * Writes the authoritative layout onto GameSession for MapScene.
	 */
	private setupChestsAndSpawn(): void {
		const plan = planChests(this.game.session.rng);
		this.game.session.chestPlan = plan;

		// Exit is not placed at generation — only reserve the player spawn.
		const used = new Set<string>();

		const spawn =
			findFirstWalkableTile(this.grid) ?? ({ x: 0, y: 0 } as GridCoord);
		this.spawnCoord = spawn;
		used.add(coordKey(spawn));
		this.game.session.playerSpawn = spawn;

		this.placements = [];
		for (const chestPlan of plan.chests) {
			const coord = pickSpreadWalkableTile(
				this.grid,
				used,
				this.game.session.rng,
			);
			if (!coord) break;
			used.add(coordKey(coord));
			this.placements.push({ plan: chestPlan, coord });
		}

		this.game.session.participants = [
			{
				id: "player",
				label: this.game.session.character?.name ?? "Player",
				coord: spawn,
				isLocal: true,
			},
		];

		this.game.session.chestPlacements = this.placements;
	}

	private rollTurnOrder(): void {
		const roster = this.game.session.participants ?? [
			{
				id: "player",
				label: this.game.session.character?.name ?? "Player",
				coord: this.spawnCoord,
				isLocal: true,
			},
		];

		const entries: TurnOrderEntry[] = roster.map((p) => ({
			id: p.id,
			label: p.label,
			roll: 1 + Math.floor(Math.random() * 20),
		}));

		entries.sort((a, b) => b.roll - a.roll);
		this.game.session.turnOrder = entries;
		this.turnOrder = entries;
	}

	// ---------- Loading UI ----------

	private buildLoadingUI(): void {
		this.loadingLabel = new Text({
			text: "Preparing mission…",
			style: { fill: 0xffffff, fontSize: 20, fontWeight: "bold" },
		});
		this.loadingLabel.anchor.set(0.5);

		this.loadingRoot.addChild(this.barTrack);
		this.loadingRoot.addChild(this.barFill);
		this.loadingRoot.addChild(this.loadingLabel);
	}

	private layoutLoadingUI(width: number, height: number): void {
		const barW = Math.min(320, width * 0.5);
		const barH = 12;
		const cx = width / 2;
		const cy = height / 2;

		this.loadingLabel.x = cx;
		this.loadingLabel.y = cy - 28;

		this.barTrack.clear();
		this.barTrack.roundRect(cx - barW / 2, cy, barW, barH, 4);
		this.barTrack.fill(0x333333);

		this.setProgress(this._progress);
	}

	private _progress = 0;

	private setProgress(t: number): void {
		this._progress = Math.max(0, Math.min(1, t));
		const width = this.game.app.screen.width;
		const height = this.game.app.screen.height;
		const barW = Math.min(320, width * 0.5);
		const barH = 12;
		const cx = width / 2;
		const cy = height / 2;
		const fillW = barW * this._progress;

		this.barFill.clear();
		if (fillW > 0) {
			this.barFill.roundRect(cx - barW / 2, cy, fillW, barH, 4);
			this.barFill.fill(0x4a9eff);
		}
	}

	// ---------- Summary screen ----------

	private buildSummaryUI(): void {
		this.summaryText = new Text({
			text: "",
			style: {
				fill: 0xffffff,
				fontSize: 18,
				fontFamily: "monospace",
				align: "center",
			},
		});
		this.summaryText.anchor.set(0.5, 0.5);
		this.summaryRoot.addChild(this.summaryText);

		this.summaryRoot.visible = false;
	}

	private buildSummaryText(): void {
		const target = this.game.session.chestPlan?.targetItem;
		const lines = [
			`Map Seed: ${this.game.session.mapSeed}`,
			target ? `Your Relic: ${target.name}` : "",
			target?.description ? `"${target.description}"` : "",
			"",
			...this.turnOrder.map(
				(e, i) => `${i + 1}. ${e.label} — rolled ${e.roll}`,
			),
		].filter((line) => line !== "");
		this.summaryText.text = lines.join("\n");
	}

	private layoutSummaryUI(width: number, height: number): void {
		this.summaryText.x = width / 2;
		this.summaryText.y = height / 2;
	}

	// ---------- Cover / backdrop ----------

	private drawBackdrop(width: number, height: number): void {
		this.backdrop.clear();
		this.backdrop.rect(0, 0, width, height);
		this.backdrop.fill(0x0a0a0a);
	}

	private drawCover(width: number, height: number): void {
		this.cover.clear();
		this.cover.rect(0, 0, width, height);
		this.cover.fill(0x000000);
	}

	private fadeCover(
		from: number,
		to: number,
		durationMs: number,
	): Promise<void> {
		return new Promise((resolve) => {
			const startTime = performance.now();
			const tick = (): void => {
				const elapsed = performance.now() - startTime;
				const t = Math.min(elapsed / durationMs, 1);
				this.cover.alpha = from + (to - from) * t;
				if (t >= 1) {
					Ticker.shared.remove(tick);
					resolve();
				}
			};
			Ticker.shared.add(tick);
		});
	}

	private waitForPaint(): Promise<void> {
		return new Promise((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		});
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
