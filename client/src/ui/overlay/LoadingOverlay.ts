import { Container, Graphics, Text, Ticker } from "pixi.js";
import type { Overlay } from "@/core/overlays/Overlay";
import type { Game } from "@/core/game/Game";
import { Camera } from "@/core/cameras/Camera";
import { MapRenderer } from "@/rendering/MapRenderer";
import {
	MAP_SIZE_DIMENSIONS,
	type TurnOrderEntry,
	type PlacedChestRecord,
} from "@/core/game/GameSession";
import { gridToScreen } from "@/math/isoGridMath";
import {
	type Grid,
	type GridCoord,
	generateDungeon,
	findFirstWalkableTile,
	findExitTile,
	planChests,
	coordKey,
} from "@relic-hunter/shared";
import { Chest } from "@/entities/Chest";
import { MapScene } from "@/scenes/MapScene";
import { Mercenary } from "@/entities/Mercenary";
import { getActiveHunterWorldPos } from "@/core/cameras/TurnCamera";

const FADE_IN_MS = 900;
const LEG_MS = 1400;
const SNAP_MS = 500;
const LINGER_MS = 1600;
const FADE_OUT_MS = 500;
const ROOM_DENSITY = 1 / 50;
const CINEMATIC_ZOOM = 1.45;

/**
 * Pre-match cinematic as an Overlay on top of MissionSelect.
 * Places map + chests once, stores positions on GameSession, orbits the
 * outermost chests, then settles on the player before handing off to MapScene.
 */
export class LoadingOverlay implements Overlay {
	readonly view = new Container();

	private boardContainer = new Container();
	private tilesContainer = new Container();
	private chestContainer = new Container();
	private camera: Camera;
	private mapRenderer: MapRenderer;
	private grid!: Grid;

	private backdrop = new Graphics();
	private cover = new Graphics();

	private loadingRoot = new Container();
	private loadingLabel!: Text;
	private barTrack = new Graphics();
	private barFill = new Graphics();

	private panel = new Container();
	private sizeText!: Text;
	private seedText!: Text;
	private targetText!: Text;
	private turnOrderText!: Text;

	private placements: PlacedChestRecord[] = [];
	private spawnCoord: GridCoord = { x: 0, y: 0 };

	constructor(private game: Game) {
		this.boardContainer.addChild(this.tilesContainer);
		this.boardContainer.addChild(this.chestContainer);

		this.camera = new Camera(this.boardContainer, {
			initialZoom: CINEMATIC_ZOOM,
			minZoom: 0.75,
			maxZoom: 3,
		});
		this.mapRenderer = new MapRenderer(
			this.tilesContainer,
			this.boardContainer,
			this.camera,
			this.game,
		);

		this.cover.eventMode = "static";

		// Bottom → top: backdrop, board, panel, loading UI, cover
		this.view.addChild(this.backdrop);
		this.view.addChild(this.boardContainer);
		this.view.addChild(this.panel);
		this.view.addChild(this.loadingRoot);
		this.view.addChild(this.cover);

		this.buildLoadingUI();
	}

	async onShow(): Promise<void> {
		const w = this.game.app.screen.width;
		const h = this.game.app.screen.height;

		this.drawBackdrop(w, h);
		this.drawCover(w, h);
		this.cover.alpha = 1;
		this.loadingRoot.visible = true;
		this.setProgress(0);
		this.layoutLoadingUI(w, h);

		await this.waitForPaint();

		// --- Setup (bar advances as real work finishes) ---
		this.setProgress(0.15);
		this.setupGrid();

		this.setProgress(0.4);
		this.setupChestsAndSpawn();

		this.setProgress(0.7);
		this.mapRenderer.build(this.grid, 0);
		this.drawChestEntities();

		this.setProgress(0.9);
		this.buildPanel();
		this.layoutPanel(w, h);

		this.setProgress(1);
		await this.delay(200);
		this.loadingRoot.visible = false;

		// Cinematic: fade in while orbiting outermost chests, then settle on player
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
		this.drawBackdrop(width, height);
		this.drawCover(width, height);
		this.layoutLoadingUI(width, height);
		if (this.sizeText) this.layoutPanel(width, height);
	}

	// ---------- Setup ----------

	private setupGrid(): void {
		const mapSize = this.game.session.missionParams?.mapSize ?? "M";
		const { width, height } = MAP_SIZE_DIMENSIONS[mapSize];
		const seed = Math.floor(Math.random() * 1_000_000);
		this.game.session.mapSeed = seed;

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
		const plan = planChests();
		this.game.session.chestPlan = plan;

		const exitTile = findExitTile(this.grid);
		const used = new Set<string>();
		if (exitTile) used.add(coordKey(exitTile));

		// Spawn first so chests avoid it
		const spawn =
			findFirstWalkableTile(this.grid) ?? ({ x: 0, y: 0 } as GridCoord);
		this.spawnCoord = spawn;
		used.add(coordKey(spawn));
		this.game.session.playerSpawn = spawn;

		this.placements = [];
		for (const chestPlan of plan.chests) {
			const coord = this.pickUnusedWalkableTile(used);
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

	private pickUnusedWalkableTile(used: Set<string>): GridCoord | null {
		const candidates: GridCoord[] = [];
		for (let x = 0; x < this.grid.width; x++) {
			for (let y = 0; y < this.grid.height; y++) {
				const coord = { x, y };
				if (!this.grid.isWalkable(coord)) continue;
				if (used.has(coordKey(coord))) continue;
				candidates.push(coord);
			}
		}
		if (candidates.length === 0) return null;
		return candidates[Math.floor(Math.random() * candidates.length)];
	}

	private drawChestEntities(): void {
		this.chestContainer.removeChildren();
		for (const placed of this.placements) {
			const entity = new Chest(placed.coord);
			this.chestContainer.addChild(entity.view);
		}
	}

	// ---------- Cinematic ----------

	private async runIntroSequence(): Promise<void> {
		const sw = this.game.app.screen.width;
		const sh = this.game.app.screen.height;

		const hull = this.buildOuterLoopWaypoints();
		if (hull.length === 0) {
			// No chests — just settle on spawn
			this.camera.centerOn(gridToScreen(this.spawnCoord), sw, sh);
			await this.fadeCover(1, 0, FADE_IN_MS);
		} else {
			// Start on first hull point, covered
			this.camera.centerOn(hull[0], sw, sh);

			// Fade in in parallel with first leg of the orbit
			const firstTarget = hull.length > 1 ? hull[1] : hull[0];
			await Promise.all([
				this.fadeCover(1, 0, FADE_IN_MS),
				this.camera.panTo(firstTarget, LEG_MS, sw, sh),
			]);

			// Remaining legs (close the loop back to hull[0] if we have room)
			for (let i = 2; i < hull.length; i++) {
				await this.camera.panTo(hull[i], LEG_MS, sw, sh);
			}
			if (hull.length >= 3) {
				await this.camera.panTo(hull[0], LEG_MS, sw, sh);
			}
		}

		this.rollTurnOrder();
		const focus = getActiveHunterWorldPos(this.game.session);

		await this.camera.panTo(focus, SNAP_MS, sw, sh);
		await this.delay(LINGER_MS);

		await this.fadeCover(0, 1, FADE_OUT_MS);
		await this.game.sceneManager.changeScene(new MapScene(this.game));
		this.game.overlays.hide();
	}

	/**
	 * Up to 4 waypoints: chests closest to each corner of the chest-cloud
	 * bounding box, ordered clockwise so panTo forms a short ring.
	 */
	private buildOuterLoopWaypoints(): { x: number; y: number }[] {
		if (this.placements.length === 0) return [];

		const pts = this.placements.map((p) => gridToScreen(p.coord));

		// 1–4 chests: use all of them, angle-sorted
		if (pts.length <= 4) {
			const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
			const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
			return pts
				.slice()
				.sort(
					(a, b) =>
						Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
				);
		}

		// Bounding box of all chests
		let minX = Infinity,
			maxX = -Infinity,
			minY = Infinity,
			maxY = -Infinity;
		for (const p of pts) {
			minX = Math.min(minX, p.x);
			maxX = Math.max(maxX, p.x);
			minY = Math.min(minY, p.y);
			maxY = Math.max(maxY, p.y);
		}

		const corners = [
			{ x: minX, y: minY },
			{ x: maxX, y: minY },
			{ x: maxX, y: maxY },
			{ x: minX, y: maxY },
		];

		// One unique chest nearest each corner → always ≤ 4
		const used = new Set<number>();
		const picked: { x: number; y: number }[] = [];

		for (const corner of corners) {
			let bestIdx = -1;
			let bestDist = Infinity;
			for (let i = 0; i < pts.length; i++) {
				if (used.has(i)) continue;
				const dx = pts[i].x - corner.x;
				const dy = pts[i].y - corner.y;
				const d = dx * dx + dy * dy;
				if (d < bestDist) {
					bestDist = d;
					bestIdx = i;
				}
			}
			if (bestIdx >= 0) {
				used.add(bestIdx);
				picked.push(pts[bestIdx]);
			}
		}

		const cx = picked.reduce((s, p) => s + p.x, 0) / picked.length;
		const cy = picked.reduce((s, p) => s + p.y, 0) / picked.length;
		picked.sort(
			(a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
		);

		return picked; // length 1–4
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

		if (this.turnOrderText) {
			this.turnOrderText.text = entries
				.map((e, i) => `${i + 1}. ${e.label} — rolled ${e.roll}`)
				.join("\n");
		}
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

		// barFill width is set in setProgress — just store geometry via redraw
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
		durationMs = FADE_OUT_MS,
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

	// ---------- Info panel ----------

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

		this.panel.removeChildren();
		this.panel.addChild(
			this.sizeText,
			this.seedText,
			this.targetText,
			this.turnOrderText,
		);

		// Cover stays topmost for fades
		this.view.setChildIndex(this.cover, this.view.children.length - 1);
	}

	private layoutPanel(width: number, height: number): void {
		if (!this.sizeText) return;
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
