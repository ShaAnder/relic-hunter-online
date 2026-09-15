import {
	Container,
	Graphics,
	Text,
	FederatedPointerEvent,
	FederatedWheelEvent,
} from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import { Button } from "@/ui/generics/Button";
import { MainMenuScene } from "./MainMenuScene";
import { EdgeBarrier } from "@relic-hunter/shared";
import {
	LocalCustomMapRepo,
	type CustomMapRepo,
} from "@/core/maps/CustomMapRepo";

const LOGICAL_SIZE = 40;
const GRID_SIZE = 2 * LOGICAL_SIZE - 1; // 79 — double-resolution: tiles on even, edges on odd

/** Size of one sub-cell in the underlying 79x79 grid at zoom=1 — this is the TRUE grid spacing used for click/paint interaction and for the always-visible boundary line. Visual tile fill is drawn larger than this (see TILE_RENDER_PX) so it overlaps into the gap on either side. */
const SUB_CELL_PX = 12;
/** How large a tile's own fill is actually drawn — bigger than SUB_CELL_PX so two neighboring tiles' fills meet exactly in the middle of the gap between them when that edge is unpainted, reading as one continuous floor with no seam. */
const TILE_RENDER_PX = SUB_CELL_PX * 2;
/** How thick a painted wall/fence/door edge renders, regardless of zoom scale applied on top. */
const WALL_THICKNESS_PX = 4;
const CORNER_DOT_PX = WALL_THICKNESS_PX;

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.15;

/** Tile-level codes — matches EdgeMapTileCode in edgeMapCompiler.ts exactly, so this tool's output is already in the format compileEdgeMap expects, no separate converter needed. */
enum TileCode {
	Void = 0,
	Floor = 1,
	Pavement = 2,
	Nature = 3,
	River = 4,
}

interface PaletteEntry {
	label: string;
	color: number;
	/** Which array this code belongs to — a tile position only ever accepts a TileCode, an edge position only ever accepts an EdgeBarrier. Keeps the picker from letting you paint a door onto a tile center or a floor color onto an edge slot. */
	kind: "tile" | "edge";
	code: number;
}

const TILE_PALETTE: PaletteEntry[] = [
	{ label: "Void", color: 0x101010, kind: "tile", code: TileCode.Void },
	{ label: "Floor", color: 0xc8c8c8, kind: "tile", code: TileCode.Floor },
	{ label: "Pavement", color: 0xaaaac8, kind: "tile", code: TileCode.Pavement },
	{ label: "Nature", color: 0x96c850, kind: "tile", code: TileCode.Nature },
	{ label: "River", color: 0x3c5ae6, kind: "tile", code: TileCode.River },
];

/** "Open" isn't really a color you paint — it's the absence of a wall, which just erases back to nothing (the tiles' own overlap covers it). Kept in the palette as an explicit, selectable option so there's a clear way to clear a single edge without switching to the eraser. */
const EDGE_PALETTE: PaletteEntry[] = [
	{
		label: "Open (erase)",
		color: 0x555555,
		kind: "edge",
		code: EdgeBarrier.None,
	},
	{
		label: "Low Wall",
		color: 0xdc1e1e,
		kind: "edge",
		code: EdgeBarrier.LowWall,
	},
	{
		label: "Full Wall",
		color: 0x463c6e,
		kind: "edge",
		code: EdgeBarrier.FullWall,
	},
	{ label: "Fence", color: 0xff3cdc, kind: "edge", code: EdgeBarrier.Fence },
	{ label: "Glass", color: 0xc8f0f5, kind: "edge", code: EdgeBarrier.Glass },
	{ label: "Door", color: 0xffe61e, kind: "edge", code: EdgeBarrier.Door },
];

const PALETTE: PaletteEntry[] = [...TILE_PALETTE, ...EDGE_PALETTE];

const BOUNDARY_LINE_COLOR = 0x707070;
const BG_COLOR = 0x1e1e28;

/**
 * In-game map creator. A 79x79 double-resolution grid (a 40x40
 * logical map's tiles on even positions, edges on odd positions),
 * painted by click-and-drag. Left half of the screen is the grid
 * (zoomable with the mouse wheel), right half is the palette and
 * controls.
 *
 * Rendering deliberately mirrors how the real in-game renderer
 * (EdgeMapRenderer) actually draws an edge-based map, rather than
 * showing every edge slot as a uniform colored block regardless of
 * whether anything is painted there:
 *  - Every tile is drawn larger than its own true grid cell, enough
 *    to overlap into the gap on each side. Where the edge between two
 *    tiles is unpainted, their overlapping fills meet with no visible
 *    seam — it just reads as continuous floor.
 *  - A thin boundary line is always drawn at every tile's TRUE
 *    (non-overlapped) edge, so the underlying grid structure stays
 *    visible even where nothing is painted.
 *  - Only when an edge is actually painted (anything other than
 *    "Open") does a thin, wall-colored rectangle appear there, on top
 *    of the tile overlap.
 *  - Small corner dots appear wherever two or more painted edges meet,
 *    so a wall's corners read as connected rather than leaving a gap.
 *
 * Only ever painting a wall color onto an edge position (never a tile
 * position, and never a tile color onto an edge) is enforced the same
 * way as before — see paintAtEvent.
 */
export class MapCreatorScene implements Scene {
	readonly view = new Container();
	private gridPanel = new Container();
	private gridViewport = new Container(); // masked, fixed-size window into the grid
	private gridContainer = new Container(); // the pannable/zoomable content inside the viewport
	private gridGraphics = new Graphics();
	private paletteContainer = new Container();
	private statusText!: Text;
	private zoomText!: Text;
	private mapListContainer = new Container();
	private repo: CustomMapRepo = new LocalCustomMapRepo();
	private currentMapName: string | null = null;
	private viewportMask = new Graphics();

	// DOM-based dialogs, not window.prompt/confirm/alert — those are
	// commonly blocked or silently no-op in sandboxed/embedded preview
	// contexts (no "allow=modals" permission on the iframe), which
	// would make Save (and Delete) appear to do nothing at all. A
	// plain DOM overlay doesn't need any special permission and works
	// the same everywhere.
	private dialogOverlay!: HTMLDivElement;
	private dialogMessage!: HTMLDivElement;
	private dialogInput!: HTMLInputElement;
	private dialogOkBtn!: HTMLButtonElement;
	private dialogCancelBtn!: HTMLButtonElement;

	/** grid[y][x] — same row-major shape as every blueprint array elsewhere in the project. */
	private grid: number[][] = [];
	private selectedIndex = 1; // starts on "Floor"
	private isPainting = false;
	private zoom = 1;

	private isPanning = false;
	private panStart = { x: 0, y: 0 };
	private panStartContainer = { x: 0, y: 0 };

	constructor(private game: Game) {
		for (let y = 0; y < GRID_SIZE; y++) {
			this.grid.push(new Array(GRID_SIZE).fill(0));
		}
	}

	onEnter(): void {
		this.view.addChild(this.gridPanel);
		this.view.addChild(this.paletteContainer);

		this.gridPanel.addChild(this.gridViewport);
		this.gridViewport.addChild(this.gridContainer);
		this.gridContainer.addChild(this.gridGraphics);

		this.buildPalette();
		this.buildGridInteraction();
		this.buildDialogOverlay();
		this.redrawGrid();
		this.layout(this.game.app.screen.width, this.game.app.screen.height);

		this.game.app.canvas.addEventListener("contextmenu", this.onContextMenu);
	}

	onExit(): void {
		this.gridViewport.off("pointerdown", this.onPointerDown);
		this.gridViewport.off("pointermove", this.onPointerMove);
		this.gridViewport.off("pointerup", this.onPointerUp);
		this.gridViewport.off("pointerupoutside", this.onPointerUp);
		this.gridViewport.off("wheel", this.onWheel);
		this.game.app.canvas.removeEventListener("contextmenu", this.onContextMenu);
		this.dialogOverlay.remove();
		this.view.removeChildren();
	}

	update(_deltaTime: number): void {}

	onResize(width: number, height: number): void {
		this.layout(width, height);
	}

	// ---------- Palette / controls (right half) ----------

	private buildPalette(): void {
		const y = 0;

		const backBtn = new Button({
			text: "< Menu",
			width: 105,
			height: 36,
			fontSize: 13,
			onClick: () => {
				void this.game.sceneManager.changeScene(new MainMenuScene(this.game));
			},
		});
		backBtn.view.x = 0;
		backBtn.view.y = y;
		this.paletteContainer.addChild(backBtn.view);

		const saveBtn = new Button({
			text: "Save",
			width: 105,
			height: 36,
			fontSize: 13,
			bgColor: 0x2a4e8e,
			onClick: () => void this.promptAndSave(),
		});
		saveBtn.view.x = 115;
		saveBtn.view.y = y;
		this.paletteContainer.addChild(saveBtn.view);

		const exportBtn = new Button({
			text: "Export .ts",
			width: 105,
			height: 36,
			fontSize: 13,
			bgColor: 0x2a6e3c,
			onClick: () => this.exportBlueprint(),
		});
		exportBtn.view.x = 230;
		exportBtn.view.y = y;
		this.paletteContainer.addChild(exportBtn.view);

		const clearBtn = new Button({
			text: "Clear",
			width: 105,
			height: 36,
			fontSize: 13,
			bgColor: 0x6e2a2a,
			onClick: () => {
				for (let row = 0; row < GRID_SIZE; row++) this.grid[row].fill(0);
				this.currentMapName = null;
				this.redrawGrid();
				this.updateStatus();
			},
		});
		clearBtn.view.x = 345;
		clearBtn.view.y = y;
		this.paletteContainer.addChild(clearBtn.view);

		let cursorY = y + 50;
		this.statusText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 14 },
		});
		this.statusText.x = 0;
		this.statusText.y = cursorY;
		this.paletteContainer.addChild(this.statusText);

		cursorY += 24;
		this.zoomText = new Text({
			text: "",
			style: {
				fill: 0xaaaaaa,
				fontSize: 12,
				wordWrap: true,
				wordWrapWidth: 420,
			},
		});
		this.zoomText.x = 0;
		this.zoomText.y = cursorY;
		this.paletteContainer.addChild(this.zoomText);
		this.updateZoomText();

		cursorY += 50;
		cursorY = this.buildPaletteSection("Tiles", TILE_PALETTE, cursorY);
		cursorY += 20;
		cursorY = this.buildPaletteSection("Edges (walls)", EDGE_PALETTE, cursorY);

		cursorY += 20;
		this.mapListContainer.x = 0;
		this.mapListContainer.y = cursorY;
		this.paletteContainer.addChild(this.mapListContainer);
		this.rebuildMapList();

		this.updateStatus();
	}

	private buildPaletteSection(
		title: string,
		entries: PaletteEntry[],
		startY: number,
	): number {
		const heading = new Text({
			text: title,
			style: { fill: 0xffffff, fontSize: 15, fontWeight: "bold" },
		});
		heading.x = 0;
		heading.y = startY;
		this.paletteContainer.addChild(heading);

		const swatchSize = 40;
		const swatchGap = 8;
		const rowY = startY + 26;

		entries.forEach((entry, col) => {
			const globalIndex = PALETTE.indexOf(entry);
			const swatch = new Container();
			swatch.x = col * (swatchSize + swatchGap);
			swatch.y = rowY;
			swatch.eventMode = "static";
			swatch.cursor = "pointer";

			const bg = new Graphics();
			bg.rect(0, 0, swatchSize, swatchSize).fill(entry.color);
			swatch.addChild(bg);

			const border = new Graphics();
			swatch.addChild(border);

			const label = new Text({
				text: entry.label,
				style: {
					fill: 0xffffff,
					fontSize: 9,
					wordWrap: true,
					wordWrapWidth: swatchSize + swatchGap,
				},
			});
			label.x = 0;
			label.y = swatchSize + 2;
			label.resolution = 2;
			swatch.addChild(label);

			const redrawBorder = () => {
				border.clear();
				const selected = globalIndex === this.selectedIndex;
				border
					.rect(0, 0, swatchSize, swatchSize)
					.stroke({
						width: selected ? 3 : 1,
						color: selected ? 0x4a9eff : 0x000000,
					});
			};
			redrawBorder();

			swatch.on("pointertap", () => {
				this.selectedIndex = globalIndex;
				this.refreshPaletteSelection();
				this.updateStatus();
			});

			(swatch as Container & { __redrawBorder?: () => void }).__redrawBorder =
				redrawBorder;
			this.paletteContainer.addChild(swatch);
		});

		return rowY + swatchSize + 20;
	}

	private refreshPaletteSelection(): void {
		for (const child of this.paletteContainer.children) {
			const withRedraw = child as Container & { __redrawBorder?: () => void };
			withRedraw.__redrawBorder?.();
		}
	}

	private updateStatus(): void {
		const entry = PALETTE[this.selectedIndex];
		const mapLabel = this.currentMapName
			? ` — editing "${this.currentMapName}"`
			: " — unsaved";
		this.statusText.text = `Painting: ${entry.label} (${entry.kind === "tile" ? "tile" : "edge/wall"})${mapLabel}`;
	}

	private updateZoomText(): void {
		this.zoomText.text = `Zoom: ${Math.round(this.zoom * 100)}% — wheel to zoom, right-click-drag to pan`;
	}

	// ---------- Grid interaction (left half) ----------

	private buildGridInteraction(): void {
		this.gridViewport.eventMode = "static";
		this.gridViewport.on("pointerdown", this.onPointerDown);
		this.gridViewport.on("pointermove", this.onPointerMove);
		this.gridViewport.on("pointerup", this.onPointerUp);
		this.gridViewport.on("pointerupoutside", this.onPointerUp);
		this.gridViewport.on("wheel", this.onWheel);
	}

	private onWheel = (event: FederatedWheelEvent): void => {
		const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
		const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
		if (newZoom === this.zoom) return;

		// Zoom toward the pointer position, not the grid's top-left corner.
		const localBefore = this.gridContainer.toLocal(event.global);
		this.zoom = newZoom;
		this.gridContainer.scale.set(this.zoom);
		const localAfter = this.gridContainer.toLocal(event.global);
		this.gridContainer.x += (localAfter.x - localBefore.x) * this.zoom;
		this.gridContainer.y += (localAfter.y - localBefore.y) * this.zoom;

		this.updateZoomText();
	};

	/** Right-click is now a pan gesture, not a request for the browser's own context menu. */
	private onContextMenu = (event: MouseEvent): void => {
		event.preventDefault();
	};

	private onPointerDown = (event: FederatedPointerEvent): void => {
		// Right-click drags to pan. Left-click paints. Erasing is done
		// by selecting the "Open" swatch and painting with it, same as
		// any other edge value — not a separate click-modifier.
		if (event.button === 2) {
			this.isPanning = true;
			this.panStart = { x: event.global.x, y: event.global.y };
			this.panStartContainer = {
				x: this.gridContainer.x,
				y: this.gridContainer.y,
			};
			return;
		}

		this.isPainting = true;
		this.paintAtEvent(event);
	};

	private onPointerMove = (event: FederatedPointerEvent): void => {
		if (this.isPanning) {
			this.gridContainer.x =
				this.panStartContainer.x + (event.global.x - this.panStart.x);
			this.gridContainer.y =
				this.panStartContainer.y + (event.global.y - this.panStart.y);
			return;
		}
		if (!this.isPainting) return;
		this.paintAtEvent(event);
	};

	private onPointerUp = (): void => {
		this.isPainting = false;
		this.isPanning = false;
	};

	private paintAtEvent(event: FederatedPointerEvent): void {
		const local = this.gridContainer.toLocal(event.global);
		const bx = Math.floor(local.x / SUB_CELL_PX);
		const by = Math.floor(local.y / SUB_CELL_PX);
		if (bx < 0 || by < 0 || bx >= GRID_SIZE || by >= GRID_SIZE) return;

		const isEvenX = bx % 2 === 0;
		const isEvenY = by % 2 === 0;

		let value: number | null = null;
		if (isEvenX && isEvenY) {
			const entry = PALETTE[this.selectedIndex];
			if (entry.kind === "tile") value = entry.code;
		} else if (isEvenX !== isEvenY) {
			const entry = PALETTE[this.selectedIndex];
			if (entry.kind === "edge") value = entry.code;
		}
		// odd,odd corner positions never accept paint directly — they're
		// derived automatically from whichever edges around them are painted.

		if (value === null) return;
		if (this.grid[by][bx] === value) return;

		this.grid[by][bx] = value;
		this.redrawGrid();
	}

	// ---------- Rendering ----------

	private redrawGrid(): void {
		this.gridGraphics.clear();
		this.gridGraphics
			.rect(0, 0, GRID_SIZE * SUB_CELL_PX, GRID_SIZE * SUB_CELL_PX)
			.fill(BG_COLOR);

		// Pass 1: tile fills, oversized to cover the gap on each side.
		for (let y = 0; y < GRID_SIZE; y += 2) {
			for (let x = 0; x < GRID_SIZE; x += 2) {
				this.drawTile(x, y);
			}
		}
		// Pass 2: the always-visible true-size boundary line per tile.
		for (let y = 0; y < GRID_SIZE; y += 2) {
			for (let x = 0; x < GRID_SIZE; x += 2) {
				this.drawBoundaryLine(x, y);
			}
		}
		// Pass 3: painted edges (thin wall rectangles) on top.
		for (let y = 0; y < GRID_SIZE; y++) {
			for (let x = 0; x < GRID_SIZE; x++) {
				const isEvenX = x % 2 === 0;
				const isEvenY = y % 2 === 0;
				if (isEvenX === isEvenY) continue; // only true edge cells
				this.drawEdgeIfPainted(x, y);
			}
		}
		// Pass 4: corner dots wherever 2+ painted edges meet.
		for (let y = 1; y < GRID_SIZE; y += 2) {
			for (let x = 1; x < GRID_SIZE; x += 2) {
				this.drawCornerIfNeeded(x, y);
			}
		}
	}

	private tileColor(value: number): number {
		return (
			TILE_PALETTE.find((p) => p.code === value)?.color ?? TILE_PALETTE[0].color
		);
	}

	private edgeColor(value: number): number {
		return (
			EDGE_PALETTE.find((p) => p.code === value)?.color ?? EDGE_PALETTE[1].color
		);
	}

	private drawTile(x: number, y: number): void {
		const value = this.grid[y][x];
		const color = this.tileColor(value);
		const centerX = x * SUB_CELL_PX + SUB_CELL_PX / 2;
		const centerY = y * SUB_CELL_PX + SUB_CELL_PX / 2;
		const half = TILE_RENDER_PX / 2;
		this.gridGraphics
			.rect(centerX - half, centerY - half, TILE_RENDER_PX, TILE_RENDER_PX)
			.fill(color);
	}

	private drawBoundaryLine(x: number, y: number): void {
		const px = x * SUB_CELL_PX;
		const py = y * SUB_CELL_PX;
		this.gridGraphics
			.rect(px, py, SUB_CELL_PX, SUB_CELL_PX)
			.stroke({ width: 1, color: BOUNDARY_LINE_COLOR, alpha: 0.6 });
	}

	private drawEdgeIfPainted(x: number, y: number): void {
		const value = this.grid[y][x];
		if (value === EdgeBarrier.None) return;

		const color = this.edgeColor(value);
		const centerX = x * SUB_CELL_PX + SUB_CELL_PX / 2;
		const centerY = y * SUB_CELL_PX + SUB_CELL_PX / 2;
		const isVertical = x % 2 === 1; // odd x, even y -> the wall here runs N-S, separating two horizontally-adjacent tiles

		if (isVertical) {
			this.gridGraphics
				.rect(
					centerX - WALL_THICKNESS_PX / 2,
					centerY - TILE_RENDER_PX / 2,
					WALL_THICKNESS_PX,
					TILE_RENDER_PX,
				)
				.fill(color);
		} else {
			this.gridGraphics
				.rect(
					centerX - TILE_RENDER_PX / 2,
					centerY - WALL_THICKNESS_PX / 2,
					TILE_RENDER_PX,
					WALL_THICKNESS_PX,
				)
				.fill(color);
		}
	}

	private drawCornerIfNeeded(x: number, y: number): void {
		// x,y both odd here — the four edges touching this corner are at
		// (x-1,y), (x+1,y) [vertical-running edges, N/S of this corner]
		// and (x,y-1), (x,y+1) [horizontal-running edges, E/W of it].
		const neighbors: [number, number][] = [
			[x - 1, y],
			[x + 1, y],
			[x, y - 1],
			[x, y + 1],
		].filter(
			([nx, ny]) => nx >= 0 && ny >= 0 && nx < GRID_SIZE && ny < GRID_SIZE,
		) as [number, number][];

		const paintedNeighbors = neighbors.filter(
			([nx, ny]) => this.grid[ny][nx] !== EdgeBarrier.None,
		);
		if (paintedNeighbors.length < 2) return;

		const counts = new Map<number, number>();
		for (const [nx, ny] of paintedNeighbors) {
			const v = this.grid[ny][nx];
			counts.set(v, (counts.get(v) ?? 0) + 1);
		}
		let bestValue = paintedNeighbors[0];
		let bestCount = 0;
		for (const n of paintedNeighbors) {
			const v = this.grid[n[1]][n[0]];
			const c = counts.get(v) ?? 0;
			if (c > bestCount) {
				bestCount = c;
				bestValue = n;
			}
		}
		const color = this.edgeColor(this.grid[bestValue[1]][bestValue[0]]);

		const centerX = x * SUB_CELL_PX + SUB_CELL_PX / 2;
		const centerY = y * SUB_CELL_PX + SUB_CELL_PX / 2;
		this.gridGraphics
			.rect(
				centerX - CORNER_DOT_PX / 2,
				centerY - CORNER_DOT_PX / 2,
				CORNER_DOT_PX,
				CORNER_DOT_PX,
			)
			.fill(color);
	}

	// ---------- Dialogs (DOM-based, not window.prompt/confirm) ----------

	private buildDialogOverlay(): void {
		const overlay = document.createElement("div");
		overlay.style.cssText =
			"position:fixed;inset:0;background:rgba(0,0,0,0.6);display:none;align-items:center;justify-content:center;z-index:9999;font-family:sans-serif;";

		const box = document.createElement("div");
		box.style.cssText =
			"background:#1e1e28;padding:20px;border-radius:8px;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.5);";

		const message = document.createElement("div");
		message.style.cssText = "color:#fff;margin-bottom:12px;font-size:14px;";

		const input = document.createElement("input");
		input.type = "text";
		input.style.cssText =
			"width:100%;box-sizing:border-box;padding:8px;margin-bottom:12px;border-radius:4px;border:1px solid #555;background:#2a2a2a;color:#fff;font-size:14px;";

		const buttonRow = document.createElement("div");
		buttonRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

		const cancelBtn = document.createElement("button");
		cancelBtn.textContent = "Cancel";
		cancelBtn.style.cssText =
			"padding:8px 16px;border-radius:4px;border:none;background:#6e2a2a;color:#fff;cursor:pointer;";

		const okBtn = document.createElement("button");
		okBtn.textContent = "OK";
		okBtn.style.cssText =
			"padding:8px 16px;border-radius:4px;border:none;background:#2a4e8e;color:#fff;cursor:pointer;";

		buttonRow.appendChild(cancelBtn);
		buttonRow.appendChild(okBtn);
		box.appendChild(message);
		box.appendChild(input);
		box.appendChild(buttonRow);
		overlay.appendChild(box);
		document.body.appendChild(overlay);

		this.dialogOverlay = overlay;
		this.dialogMessage = message;
		this.dialogInput = input;
		this.dialogOkBtn = okBtn;
		this.dialogCancelBtn = cancelBtn;
	}

	/** Replaces window.prompt() — shows the text input, resolves with the entered name on OK/Enter, or null on Cancel/Escape. */
	private promptForText(
		message: string,
		defaultValue: string,
	): Promise<string | null> {
		return new Promise((resolve) => {
			this.dialogMessage.textContent = message;
			this.dialogInput.style.display = "block";
			this.dialogInput.value = defaultValue;
			this.dialogOverlay.style.display = "flex";
			this.dialogInput.focus();
			this.dialogInput.select();

			const cleanup = (result: string | null) => {
				this.dialogOverlay.style.display = "none";
				this.dialogOkBtn.onclick = null;
				this.dialogCancelBtn.onclick = null;
				this.dialogInput.onkeydown = null;
				resolve(result);
			};

			this.dialogOkBtn.onclick = () =>
				cleanup(this.dialogInput.value.trim() || null);
			this.dialogCancelBtn.onclick = () => cleanup(null);
			this.dialogInput.onkeydown = (e) => {
				if (e.key === "Enter") cleanup(this.dialogInput.value.trim() || null);
				if (e.key === "Escape") cleanup(null);
			};
		});
	}

	/** Replaces window.confirm() — shows the message with no input field, resolves true on OK, false on Cancel/Escape. */
	private confirmDialog(message: string): Promise<boolean> {
		return new Promise((resolve) => {
			this.dialogMessage.textContent = message;
			this.dialogInput.style.display = "none";
			this.dialogOverlay.style.display = "flex";

			const cleanup = (result: boolean) => {
				this.dialogOverlay.style.display = "none";
				this.dialogInput.style.display = "block";
				this.dialogOkBtn.onclick = null;
				this.dialogCancelBtn.onclick = null;
				resolve(result);
			};

			this.dialogOkBtn.onclick = () => cleanup(true);
			this.dialogCancelBtn.onclick = () => cleanup(false);
		});
	}

	// ---------- Save / Load (local, per named map) ----------

	private async promptAndSave(): Promise<void> {
		const name = await this.promptForText(
			"Save map as:",
			this.currentMapName ?? "",
		);
		if (!name) return; // cancelled or empty

		this.repo.save(name, this.grid);
		this.currentMapName = name;
		this.rebuildMapList();
		this.updateStatus();
	}

	private async loadMap(name: string): Promise<void> {
		const blueprint = this.repo.load(name);
		if (!blueprint) return;

		// Defensive: a saved map should always be GRID_SIZE x GRID_SIZE,
		// but if something malformed ever gets into storage, don't let
		// it wreck the current session — just ignore it.
		if (
			blueprint.length !== GRID_SIZE ||
			blueprint.some((row) => row.length !== GRID_SIZE)
		) {
			await this.confirmDialog(
				`"${name}" isn't a valid ${GRID_SIZE}x${GRID_SIZE} map — not loading it.`,
			);
			return;
		}

		this.grid = blueprint.map((row) => [...row]);
		this.currentMapName = name;
		this.redrawGrid();
		this.updateStatus();
	}

	private rebuildMapList(): void {
		this.mapListContainer.removeChildren();

		const heading = new Text({
			text: "Saved maps",
			style: { fill: 0xffffff, fontSize: 15, fontWeight: "bold" },
		});
		this.mapListContainer.addChild(heading);

		const names = this.repo.list();
		if (names.length === 0) {
			const empty = new Text({
				text: "(none yet — use Save above)",
				style: { fill: 0x888888, fontSize: 12 },
			});
			empty.y = 24;
			this.mapListContainer.addChild(empty);
			return;
		}

		names.forEach((name, i) => {
			const row = new Container();
			row.y = 26 + i * 30;

			const loadBtn = new Button({
				text: name,
				width: 260,
				height: 26,
				fontSize: 12,
				bgColor: name === this.currentMapName ? 0x2a4e8e : 0x2a2a2a,
				onClick: () => void this.loadMap(name),
			});
			row.addChild(loadBtn.view);

			const deleteBtn = new Button({
				text: "Delete",
				width: 70,
				height: 26,
				fontSize: 11,
				bgColor: 0x6e2a2a,
				onClick: () => {
					void this.confirmDialog(`Delete saved map "${name}"?`).then((ok) => {
						if (!ok) return;
						this.repo.delete(name);
						if (this.currentMapName === name) this.currentMapName = null;
						this.rebuildMapList();
						this.updateStatus();
					});
				},
			});
			deleteBtn.view.x = 270;
			row.addChild(deleteBtn.view);

			this.mapListContainer.addChild(row);
		});
	}

	// ---------- Export ----------

	private exportBlueprint(): void {
		const rows = this.grid.map((row) => `\t[${row.join(", ")}],`).join("\n");
		const content = `/**\n * Map drawn with the in-game Map Creator.\n * Double-resolution format: tiles on even,even positions (see\n * TileCode in MapCreatorScene.ts / EdgeMapTileCode in\n * edgeMapCompiler.ts), edges on odd,even and even,odd positions (see\n * EdgeBarrier in edgeGrid.ts). Odd,odd positions are always 0 — no\n * diagonal walls.\n *\n * Compiles directly with compileEdgeMap() from this package, no\n * separate conversion step needed.\n */\nexport const CUSTOM_MAP_BLUEPRINT: number[][] = [\n${rows}\n];\n`;

		const blob = new Blob([content], { type: "text/typescript" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "customMapBlueprint.ts";
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	// ---------- Layout ----------

	private layout(width: number, height: number): void {
		const leftWidth = width / 2;

		this.gridPanel.x = 0;
		this.gridPanel.y = 0;

		// Reuse the same mask Graphics every layout() call (including
		// every resize) instead of creating a new one each time — the
		// previous version created a fresh Graphics on every call and
		// only ever compared it against itself for "already added,"
		// which is always false for a brand-new object, so a stray
		// orphaned mask rectangle was left behind on every resize.
		this.viewportMask.clear();
		this.viewportMask.rect(0, 0, leftWidth, height).fill(0xffffff);
		this.gridViewport.mask = this.viewportMask;
		if (!this.gridPanel.children.includes(this.viewportMask)) {
			this.gridPanel.addChild(this.viewportMask);
		}

		// Center the (unzoomed) grid in the left panel on first layout.
		const gridPx = GRID_SIZE * SUB_CELL_PX;
		this.gridContainer.scale.set(this.zoom);
		this.gridContainer.x = leftWidth / 2 - (gridPx * this.zoom) / 2;
		this.gridContainer.y = height / 2 - (gridPx * this.zoom) / 2;

		this.paletteContainer.x = leftWidth + 20;
		this.paletteContainer.y = 20;
	}
}
