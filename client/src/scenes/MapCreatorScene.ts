import {
	Container,
	FederatedPointerEvent,
	FederatedWheelEvent,
	Graphics,
	Rectangle,
	Text,
} from "pixi.js";
import type { Game } from "@/core/game/Game";
import {
	DevFileCustomMapRepo,
	DualWriteCustomMapRepo,
	LocalCustomMapRepo,
	type CustomMapRepo,
} from "@/core/maps/CustomMapRepo";
import type { Scene } from "@/core/scenes/Scene";
import {
	MapCreatorEditorUi,
	type MapCreatorPaletteUiItem,
} from "@/rendering/editor/MapCreatorEditorUi";
import { MapCreatorEnginePreview } from "@/rendering/editor/MapCreatorEnginePreview";
import { baseAssetsForGroundMaterial } from "@/rendering/engine/materials/GroundMaterialAssets";
import {
	allGroundMaterials,
	defaultGroundMaterialId,
	resolveGroundMaterial,
	type GroundMaterialDefinition,
} from "@/rendering/engine/materials/GroundMaterialCatalog";
import { MainMenuScene } from "./MainMenuScene";
import {
	EdgeBarrier,
	EdgeMapTileCode,
	clampElevationStep,
	defaultElevationStepForTileCode,
	type GroundMaterialId,
	type MapBundle,
	type MapFloorDefinition,
} from "@relic-hunter/shared";
const LOGICAL_SIZE = 40;
const GRID_SIZE = 2 * LOGICAL_SIZE - 1;
/**
 * One sub-cell in the double-resolution authoring grid.
 *
 * Logical tiles live on even/even coordinates. Structural edges occupy the
 * slots between them.
 */
const SUB_CELL_PX = 12;
/**
 * Tile fills deliberately overlap the edge gap so adjacent un-walled tiles
 * read as one continuous surface in Blueprint mode.
 */
const TILE_RENDER_PX = SUB_CELL_PX * 2;
const WALL_THICKNESS_PX = 4;
const CORNER_DOT_PX = WALL_THICKNESS_PX;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;
const PREVIEW_MIN_ZOOM = 0.1;
const PREVIEW_MAX_ZOOM = 2;
const ZOOM_STEP = 1.15;
const VIEW_FIT_PADDING = 48;
const MAX_FLOORS_ABOVE_GROUND = 5;
const MAX_BASEMENTS = 2;
const BOUNDARY_LINE_COLOR = 0x707070;
const BG_COLOR = 0x1e1e28;
type PaletteKind = "tile" | "edge" | "elevation" | "material";
interface PaletteEntry {
	label: string;
	color: number;
	kind: PaletteKind;
	code?: number;
	elevationDelta?: -1 | 1;
	setElevationStep?: number;
	clearElevationOverride?: boolean;
	materialId?: GroundMaterialId;
	clearGroundMaterialOverride?: boolean;
	uiGroup?: string;
	thumbnailUrl?: string;
	variantCount?: number;
	searchText?: string;
}
const TILE_PALETTE: PaletteEntry[] = [
	{
		label: "Void",
		color: 0x101010,
		kind: "tile",
		code: EdgeMapTileCode.Void,
	},
	{
		label: "Floor",
		color: 0xc8c8c8,
		kind: "tile",
		code: EdgeMapTileCode.Floor,
	},
	{
		label: "Pavement",
		color: 0xaaaac8,
		kind: "tile",
		code: EdgeMapTileCode.Pavement,
	},
	{
		label: "Road",
		color: 0x66666f,
		kind: "tile",
		code: EdgeMapTileCode.Road,
	},
	{
		label: "Nature",
		color: 0x96c850,
		kind: "tile",
		code: EdgeMapTileCode.Nature,
	},
	{
		label: "River",
		color: 0x3c5ae6,
		kind: "tile",
		code: EdgeMapTileCode.River,
	},
	{
		label: "Stair Bottom",
		color: 0xa0703c,
		kind: "tile",
		code: EdgeMapTileCode.StairBottom,
	},
	{
		label: "Stair Top",
		color: 0xc89050,
		kind: "tile",
		code: EdgeMapTileCode.StairTop,
	},
	{
		label: "Stair Step",
		color: 0x8c5a28,
		kind: "tile",
		code: EdgeMapTileCode.StairStep,
	},
	{
		label: "Stair Connector",
		color: 0xff8c1e,
		kind: "tile",
		code: EdgeMapTileCode.StairConnector,
	},
	{
		label: "Ladder Bottom",
		color: 0x647888,
		kind: "tile",
		code: EdgeMapTileCode.LadderBottom,
	},
	{
		label: "Ladder Top",
		color: 0x8ca0b4,
		kind: "tile",
		code: EdgeMapTileCode.LadderTop,
	},
];
/**
 * "Open" is the absence of a structural barrier. Keeping it selectable makes
 * edge erasure part of the normal paint workflow rather than a hidden gesture.
 */
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
	{
		label: "Fence",
		color: 0xff3cdc,
		kind: "edge",
		code: EdgeBarrier.Fence,
	},
	{
		label: "Glass",
		color: 0xc8f0f5,
		kind: "edge",
		code: EdgeBarrier.Glass,
	},
	{
		label: "Door",
		color: 0xffe61e,
		kind: "edge",
		code: EdgeBarrier.Door,
	},
];
const ELEVATION_PALETTE: PaletteEntry[] = [
	{
		label: "Raise +1",
		color: 0x4a9eff,
		kind: "elevation",
		elevationDelta: 1,
	},
	{
		label: "Lower -1",
		color: 0xe67e22,
		kind: "elevation",
		elevationDelta: -1,
	},
	{
		label: "Set 0",
		color: 0x777777,
		kind: "elevation",
		setElevationStep: 0,
	},
	{
		label: "Elevation Default",
		color: 0x4a4a4a,
		kind: "elevation",
		clearElevationOverride: true,
	},
];
const MATERIAL_PALETTE: PaletteEntry[] = [
	{
		label: "Material Default",
		color: 0x4a4a4a,
		kind: "material",
		clearGroundMaterialOverride: true,
		uiGroup: "Defaults",
		searchText: "default inherited semantic material",
	},
	...allGroundMaterials().map((definition): PaletteEntry => {
		const baseAssets = baseAssetsForGroundMaterial(definition);

		return {
			label: definition.label,
			color: definition.fallbackColor,
			kind: "material",
			materialId: definition.id,
			uiGroup: materialGroupLabel(definition),
			thumbnailUrl: baseAssets[0]?.url,
			variantCount: baseAssets.length,
			searchText: `${definition.id} ${definition.textureFolder ?? "fallback colour"}`,
		};
	}),
];
const PALETTE: PaletteEntry[] = [
	...TILE_PALETTE,
	...MATERIAL_PALETTE,
	...EDGE_PALETTE,
	...ELEVATION_PALETTE,
];
const PALETTE_UI_ITEMS: readonly MapCreatorPaletteUiItem[] = PALETTE.map(
	(entry, index) => ({
		index,
		label: entry.label,
		kind: entry.kind,
		color: entry.color,
		group: entry.uiGroup,
		searchText:
			entry.searchText ??
			(entry.materialId ? String(entry.materialId) : undefined),
		thumbnailUrl: entry.thumbnailUrl,
		variantCount: entry.variantCount,
	}),
);
/**
 * Full-screen Map Creator.
 *
 * The Pixi viewport is now dedicated entirely to authored map content. Editor
 * chrome is an overlay:
 *
 * - top-left mode/fit controls
 * - collapsible searchable tool drawer on the right
 *
 * Blueprint and Preview therefore use the same full viewport instead of being
 * squeezed beside permanent palette/floor columns.
 */
export class MapCreatorScene implements Scene {
	readonly view = new Container();
	private readonly gridPanel = new Container();
	private readonly gridViewport = new Container();
	private readonly gridContainer = new Container();
	private readonly gridGraphics = new Graphics();
	private readonly viewportMask = new Graphics();
	private readonly elevationLabelContainer = new Container();
	private readonly enginePreview = new MapCreatorEnginePreview();
	private readonly repo: CustomMapRepo = new DualWriteCustomMapRepo(
		new DevFileCustomMapRepo(),
		new LocalCustomMapRepo(),
	);
	private readonly editorUi: MapCreatorEditorUi;
	private currentMapName: string | null = null;
	private dialogOverlay!: HTMLDivElement;
	private dialogMessage!: HTMLDivElement;
	private dialogInput!: HTMLInputElement;
	private dialogOkBtn!: HTMLButtonElement;
	private dialogCancelBtn!: HTMLButtonElement;
	/**
	 * Floors stay in canonical MapBundle order:
	 *
	 * deepest basement -> ground -> highest floor
	 */
	private floors: MapFloorDefinition[] = [];
	private groundFloorIndex = 0;
	private currentFloorIndex = 0;
	private selectedIndex = 1;
	private isPainting = false;
	private elevationPaintedThisStroke = new Set<string>();
	private isPanning = false;
	private panStart = {
		x: 0,
		y: 0,
	};
	private panStartContainer = {
		x: 0,
		y: 0,
	};
	private zoom = 1;
	private previewZoom = 1;
	private previewMode = false;
	private requestedPreviewMode = false;
	private previewTransitionId = 0;
	private blueprintViewInitialized = false;
	private previewViewInitialized = false;
	constructor(private game: Game) {
		this.resetToSingleFloor(this.makeBlankGrid());
		this.editorUi = new MapCreatorEditorUi(PALETTE_UI_ITEMS, {
			onTogglePreview: () => this.setPreviewMode(!this.requestedPreviewMode),
			onRecenterView: () => this.recenterActiveView(),
			onSelectPalette: (index) => {
				this.selectedIndex = index;
				this.updateStatus();
			},
			onBack: () =>
				this.game.sceneManager.changeScene(new MainMenuScene(this.game)),
			onSave: () => this.promptAndSave(),
			onExport: () => this.exportBlueprint(),
			onClear: () => this.clearMap(),
			onAddFloorAbove: () => this.addFloorAbove(),
			onAddBasement: () => this.addBasement(),
			onSelectFloor: (index) => this.selectFloor(index),
			onLoadMap: (name) => this.loadMap(name),
			onDeleteMap: (name) => this.deleteMap(name),
		});
	}
	/**
	 * Current authored double-resolution floor blueprint.
	 */
	private get grid(): number[][] {
		return this.floors[this.currentFloorIndex].blueprint;
	}
	private set grid(value: number[][]) {
		this.floors[this.currentFloorIndex].blueprint = value;
	}
	private get elevationSteps(): Record<string, number> {
		return this.floors[this.currentFloorIndex].elevationSteps;
	}
	private get groundMaterialOverrides(): MapFloorDefinition["groundMaterialOverrides"] {
		return this.floors[this.currentFloorIndex].groundMaterialOverrides;
	}
	private makeBlankFloor(): MapFloorDefinition {
		return {
			blueprint: this.makeBlankGrid(),
			elevationSteps: {},
			groundMaterialOverrides: {},
		};
	}
	private makeBlankGrid(): number[][] {
		const blank: number[][] = [];
		for (let y = 0; y < GRID_SIZE; y++) {
			blank.push(new Array(GRID_SIZE).fill(0));
		}
		return blank;
	}
	private resetToSingleFloor(blueprint: number[][]): void {
		this.floors = [
			{
				blueprint,
				elevationSteps: {},
				groundMaterialOverrides: {},
			},
		];
		this.groundFloorIndex = 0;
		this.currentFloorIndex = 0;
	}
	private loadBundleIntoState(bundle: MapBundle): void {
		this.floors = bundle.floors.map((floor) => ({
			blueprint: floor.blueprint.map((row) => [...row]),
			elevationSteps: {
				...floor.elevationSteps,
			},
			groundMaterialOverrides: {
				...floor.groundMaterialOverrides,
			},
		}));
		this.groundFloorIndex = bundle.groundFloorIndex;
		this.currentFloorIndex = bundle.groundFloorIndex;
	}
	onEnter(): void {
		this.view.addChild(this.gridPanel);
		this.gridPanel.addChild(this.gridViewport);
		this.gridViewport.addChild(this.gridContainer, this.enginePreview.view);
		this.gridContainer.addChild(
			this.gridGraphics,
			this.elevationLabelContainer,
		);
		this.gridContainer.visible = true;
		this.enginePreview.view.visible = false;
		this.editorUi.mount();
		this.buildGridInteraction();
		this.buildDialogOverlay();
		this.redrawGrid();
		this.layout(this.game.app.screen.width, this.game.app.screen.height);
		this.syncEditorUi();
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
		this.editorUi.destroy();
		this.enginePreview.destroy();
		this.view.removeChildren();
	}
	update(_deltaTime: number): void {}
	onResize(width: number, height: number): void {
		this.layout(width, height);
	}
	/**
	 * Preview consumes a point-in-time data snapshot rather than reaching into
	 * MapCreatorScene internals.
	 */
	private currentBundleSnapshot(): MapBundle {
		return {
			name: this.currentMapName ?? "Unsaved",
			floors: this.floors.map((floor) => ({
				blueprint: floor.blueprint.map((row) => [...row]),
				elevationSteps: {
					...floor.elevationSteps,
				},
				groundMaterialOverrides: {
					...floor.groundMaterialOverrides,
				},
			})),
			groundFloorIndex: this.groundFloorIndex,
		};
	}
	// ---------- Editor chrome ----------
	private syncEditorUi(): void {
		this.editorUi.setMode(this.previewMode);
		this.editorUi.setSelectedPaletteIndex(this.selectedIndex);
		this.refreshFloorUi();
		this.refreshSavedMapsUi();
		this.updateStatus();
		this.updateZoomText();
	}
	private refreshFloorUi(): void {
		const floors = [];
		for (let index = this.floors.length - 1; index >= 0; index--) {
			floors.push({
				index,
				label: this.floorLabel(index),
			});
		}
		this.editorUi.setFloorState({
			floors,
			currentFloorIndex: this.currentFloorIndex,
			canAddAbove:
				this.floors.length - 1 - this.groundFloorIndex <
				MAX_FLOORS_ABOVE_GROUND,
			canAddBelow: this.groundFloorIndex < MAX_BASEMENTS,
		});
	}
	private refreshSavedMapsUi(): void {
		this.editorUi.setSavedMaps(this.repo.list(), this.currentMapName);
	}
	private updateStatus(): void {
		if (this.previewMode) {
			this.editorUi.setActivity("Live Render");
			return;
		}

		const entry = PALETTE[this.selectedIndex];
		this.editorUi.setActivity(`Painting ${entry.label}`);
	}

	private updateZoomText(): void {
		const zoom = this.previewMode ? this.previewZoom : this.zoom;
		this.editorUi.setZoomPercent(Math.round(zoom * 100));
	}
	private clearMap(): void {
		this.resetToSingleFloor(this.makeBlankGrid());
		this.currentMapName = null;
		this.redrawGrid();
		this.blueprintViewInitialized = false;
		this.refreshFloorUi();
		this.refreshSavedMapsUi();
		this.updateStatus();
		this.recenterActiveView();
		this.refreshEnginePreview();
	}
	// ---------- Preview ----------
	private async setPreviewMode(previewMode: boolean): Promise<void> {
		if (
			previewMode === this.previewMode &&
			previewMode === this.requestedPreviewMode
		) {
			return;
		}
		this.requestedPreviewMode = previewMode;
		const transitionId = ++this.previewTransitionId;
		this.isPainting = false;
		this.isPanning = false;
		this.elevationPaintedThisStroke.clear();
		if (previewMode) {
			try {
				await this.enginePreview.initialize();
				if (transitionId !== this.previewTransitionId) {
					return;
				}
				this.enginePreview.render(
					this.currentBundleSnapshot(),
					this.currentFloorIndex,
				);
			} catch (error) {
				if (transitionId !== this.previewTransitionId) {
					return;
				}
				this.requestedPreviewMode = this.previewMode;
				console.error("Map Creator preview failed:", error);
				this.editorUi.setActivity(
					`Preview failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				return;
			}
		}
		if (transitionId !== this.previewTransitionId) {
			return;
		}
		this.previewMode = previewMode;
		this.gridContainer.visible = !previewMode;
		this.enginePreview.view.visible = previewMode;
		this.editorUi.setMode(previewMode);
		if (previewMode) {
			this.fitPreviewToViewport(
				this.game.app.screen.width,
				this.game.app.screen.height,
			);
		} else if (!this.blueprintViewInitialized) {
			this.fitBlueprintToViewport(
				this.game.app.screen.width,
				this.game.app.screen.height,
			);
		}
		this.updateStatus();
		this.updateZoomText();
	}
	private refreshEnginePreview(): void {
		if (!this.previewMode) {
			return;
		}
		try {
			this.enginePreview.render(
				this.currentBundleSnapshot(),
				this.currentFloorIndex,
			);
			this.fitPreviewToViewport(
				this.game.app.screen.width,
				this.game.app.screen.height,
			);
		} catch (error) {
			console.error("Map Creator preview refresh failed:", error);
			this.editorUi.setActivity(
				`Preview failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	private activeViewportContent(): Container {
		return this.previewMode ? this.enginePreview.view : this.gridContainer;
	}
	private recenterActiveView(): void {
		const width = this.game.app.screen.width;
		const height = this.game.app.screen.height;

		if (this.previewMode) {
			this.recenterPreview(width, height);
			return;
		}

		this.recenterBlueprint(width, height);
	}

	private recenterBlueprint(width: number, height: number): void {
		const gridPx = GRID_SIZE * SUB_CELL_PX;
		this.gridContainer.scale.set(this.zoom);
		this.gridContainer.x = width / 2 - (gridPx * this.zoom) / 2;
		this.gridContainer.y = height / 2 - (gridPx * this.zoom) / 2;
	}

	private recenterPreview(width: number, height: number): void {
		const bounds = this.enginePreview.view.getLocalBounds();
		this.enginePreview.view.scale.set(this.previewZoom);
		this.enginePreview.view.x =
			width / 2 - (bounds.x + bounds.width / 2) * this.previewZoom;
		this.enginePreview.view.y =
			height / 2 - (bounds.y + bounds.height / 2) * this.previewZoom;
	}
	private fitBlueprintToViewport(width: number, height: number): void {
		const gridPx = GRID_SIZE * SUB_CELL_PX;
		const usableWidth = Math.max(1, width - VIEW_FIT_PADDING * 2);
		const usableHeight = Math.max(1, height - VIEW_FIT_PADDING * 2);
		const fitZoom = Math.min(usableWidth / gridPx, usableHeight / gridPx);

		this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitZoom));
		this.recenterBlueprint(width, height);
		this.blueprintViewInitialized = true;
		this.updateZoomText();
	}

	private fitPreviewToViewport(width: number, height: number): void {
		const bounds = this.enginePreview.view.getLocalBounds();

		if (bounds.width <= 0 || bounds.height <= 0) {
			this.previewZoom = 1;
			this.recenterPreview(width, height);
			this.previewViewInitialized = true;
			this.updateZoomText();
			return;
		}

		const usableWidth = Math.max(1, width - VIEW_FIT_PADDING * 2);
		const usableHeight = Math.max(1, height - VIEW_FIT_PADDING * 2);
		const fitZoom = Math.min(
			usableWidth / bounds.width,
			usableHeight / bounds.height,
		);

		this.previewZoom = Math.min(
			PREVIEW_MAX_ZOOM,
			Math.max(PREVIEW_MIN_ZOOM, fitZoom),
		);

		this.recenterPreview(width, height);
		this.previewViewInitialized = true;
		this.updateZoomText();
	}

	// ---------- Floors ----------
	private floorLabel(index: number): string {
		const offset = index - this.groundFloorIndex;
		if (offset === 0) {
			return "0";
		}
		return offset > 0 ? String(offset) : `B${-offset}`;
	}
	private selectFloor(index: number): void {
		if (index === this.currentFloorIndex) {
			return;
		}
		this.currentFloorIndex = index;
		this.redrawGrid();
		this.refreshFloorUi();
		this.updateStatus();
		this.refreshEnginePreview();
	}
	private addFloorAbove(): void {
		const floorsAboveGround = this.floors.length - 1 - this.groundFloorIndex;
		if (floorsAboveGround >= MAX_FLOORS_ABOVE_GROUND) {
			return;
		}
		this.floors.push(this.makeBlankFloor());
		this.currentFloorIndex = this.floors.length - 1;
		this.redrawGrid();
		this.refreshFloorUi();
		this.updateStatus();
		this.refreshEnginePreview();
	}
	private addBasement(): void {
		if (this.groundFloorIndex >= MAX_BASEMENTS) {
			return;
		}
		/**
		 * Floors are stored bottom-to-top. A new basement is therefore inserted
		 * at index 0; push() would place it above the existing top floor.
		 */
		this.floors.unshift(this.makeBlankFloor());
		this.groundFloorIndex += 1;
		this.currentFloorIndex = 0;
		this.redrawGrid();
		this.refreshFloorUi();
		this.updateStatus();
		this.refreshEnginePreview();
	}
	// ---------- Full-screen viewport interaction ----------
	private buildGridInteraction(): void {
		this.gridViewport.eventMode = "static";
		this.gridViewport.on("pointerdown", this.onPointerDown);
		this.gridViewport.on("pointermove", this.onPointerMove);
		this.gridViewport.on("pointerup", this.onPointerUp);
		this.gridViewport.on("pointerupoutside", this.onPointerUp);
		this.gridViewport.on("wheel", this.onWheel);
	}
	private onWheel = (event: FederatedWheelEvent): void => {
		event.preventDefault();
		const target = this.activeViewportContent();
		const currentZoom = this.previewMode ? this.previewZoom : this.zoom;
		const minZoom = this.previewMode ? PREVIEW_MIN_ZOOM : MIN_ZOOM;
		const maxZoom = this.previewMode ? PREVIEW_MAX_ZOOM : MAX_ZOOM;
		const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
		const newZoom = Math.min(maxZoom, Math.max(minZoom, currentZoom * factor));
		if (newZoom === currentZoom) {
			return;
		}
		/**
		 * Keep the content point under the pointer stationary while changing
		 * scale. Computing the global position again after scaling is clearer and
		 * remains correct if the container transform becomes more complex later.
		 */
		const localBefore = target.toLocal(event.global);
		if (this.previewMode) {
			this.previewZoom = newZoom;
		} else {
			this.zoom = newZoom;
		}
		target.scale.set(newZoom);
		const globalAfter = target.toGlobal(localBefore);
		target.x += event.global.x - globalAfter.x;
		target.y += event.global.y - globalAfter.y;
		this.updateZoomText();
	};
	private onContextMenu = (event: MouseEvent): void => {
		event.preventDefault();
	};
	private onPointerDown = (event: FederatedPointerEvent): void => {
		/**
		 * Blueprint reserves primary drag for painting. Preview is read-only, so
		 * primary drag can naturally pan there. Middle/right drag pans in either
		 * mode.
		 */
		const isPanGesture =
			event.button === 1 ||
			event.button === 2 ||
			(this.previewMode && event.button === 0);
		if (isPanGesture) {
			const target = this.activeViewportContent();
			this.isPanning = true;
			this.panStart = {
				x: event.global.x,
				y: event.global.y,
			};
			this.panStartContainer = {
				x: target.x,
				y: target.y,
			};
			return;
		}
		if (this.previewMode) {
			return;
		}
		this.elevationPaintedThisStroke.clear();
		this.isPainting = true;
		this.paintAtEvent(event);
	};
	private onPointerMove = (event: FederatedPointerEvent): void => {
		if (this.isPanning) {
			const target = this.activeViewportContent();
			target.x = this.panStartContainer.x + (event.global.x - this.panStart.x);
			target.y = this.panStartContainer.y + (event.global.y - this.panStart.y);
			return;
		}
		if (!this.isPainting) {
			return;
		}
		this.paintAtEvent(event);
	};
	private onPointerUp = (): void => {
		this.isPainting = false;
		this.isPanning = false;
		this.elevationPaintedThisStroke.clear();
	};
	private paintAtEvent(event: FederatedPointerEvent): void {
		if (this.previewMode) {
			return;
		}
		const local = this.gridContainer.toLocal(event.global);
		const bx = Math.floor(local.x / SUB_CELL_PX);
		const by = Math.floor(local.y / SUB_CELL_PX);
		if (bx < 0 || by < 0 || bx >= GRID_SIZE || by >= GRID_SIZE) {
			return;
		}
		const isEvenX = bx % 2 === 0;
		const isEvenY = by % 2 === 0;
		const entry = PALETTE[this.selectedIndex];
		if (isEvenX && isEvenY && entry.kind === "elevation") {
			const logicalX = bx / 2;
			const logicalY = by / 2;
			const key = `${logicalX},${logicalY}`;
			if (this.elevationPaintedThisStroke.has(key)) {
				return;
			}
			this.elevationPaintedThisStroke.add(key);
			const tileCode = this.grid[by][bx] as EdgeMapTileCode;
			if (
				tileCode === EdgeMapTileCode.Void ||
				tileCode === EdgeMapTileCode.River
			) {
				return;
			}
			if (entry.clearElevationOverride) {
				delete this.elevationSteps[key];
				this.redrawGrid();
				return;
			}
			const current =
				this.elevationSteps[key] ?? defaultElevationStepForTileCode(tileCode);
			const next =
				entry.setElevationStep !== undefined
					? clampElevationStep(entry.setElevationStep)
					: clampElevationStep(current + (entry.elevationDelta ?? 0));
			this.elevationSteps[key] = next;
			this.redrawGrid();
			return;
		}
		if (isEvenX && isEvenY && entry.kind === "material") {
			const logicalX = bx / 2;
			const logicalY = by / 2;
			const key = `${logicalX},${logicalY}`;
			const tileCode = this.grid[by][bx] as EdgeMapTileCode;
			if (tileCode === EdgeMapTileCode.Void) {
				return;
			}
			if (entry.clearGroundMaterialOverride) {
				delete this.groundMaterialOverrides[key];
				this.redrawGrid();
				return;
			}
			if (!entry.materialId) {
				return;
			}
			/**
			 * The compiler validates imported data too. Editor validation keeps
			 * normal authoring from creating an invalid semantic/material pair.
			 */
			try {
				resolveGroundMaterial(tileCode, entry.materialId);
			} catch {
				return;
			}
			const defaultId = defaultGroundMaterialId(tileCode);
			if (entry.materialId === defaultId) {
				delete this.groundMaterialOverrides[key];
			} else {
				this.groundMaterialOverrides[key] = entry.materialId;
			}
			this.redrawGrid();
			return;
		}
		let value: number | null = null;
		if (
			isEvenX &&
			isEvenY &&
			entry.kind === "tile" &&
			entry.code !== undefined
		) {
			value = entry.code;
		} else if (
			isEvenX !== isEvenY &&
			entry.kind === "edge" &&
			entry.code !== undefined
		) {
			value = entry.code;
		}
		if (value === null || this.grid[by][bx] === value) {
			return;
		}
		this.grid[by][bx] = value;
		if (isEvenX && isEvenY && entry.kind === "tile") {
			const logicalX = bx / 2;
			const logicalY = by / 2;
			const key = `${logicalX},${logicalY}`;
			const existingMaterial = this.groundMaterialOverrides[key];
			if (existingMaterial) {
				const nextTileCode = value as EdgeMapTileCode;
				if (nextTileCode === EdgeMapTileCode.Void) {
					delete this.groundMaterialOverrides[key];
				} else {
					try {
						resolveGroundMaterial(nextTileCode, existingMaterial);
					} catch {
						/**
						 * Visual material is subordinate to semantic tile identity.
						 * A semantic repaint must not leave a stale invalid override.
						 */
						delete this.groundMaterialOverrides[key];
					}
				}
			}
		}
		this.redrawGrid();
	}
	// ---------- Blueprint rendering ----------
	private redrawGrid(): void {
		this.elevationLabelContainer.removeChildren();
		this.gridGraphics.clear();
		this.gridGraphics
			.rect(0, 0, GRID_SIZE * SUB_CELL_PX, GRID_SIZE * SUB_CELL_PX)
			.fill(BG_COLOR);
		for (let y = 0; y < GRID_SIZE; y += 2) {
			for (let x = 0; x < GRID_SIZE; x += 2) {
				this.drawTile(x, y);
			}
		}
		for (let y = 0; y < GRID_SIZE; y += 2) {
			for (let x = 0; x < GRID_SIZE; x += 2) {
				this.drawBoundaryLine(x, y);
			}
		}
		for (let y = 0; y < GRID_SIZE; y++) {
			for (let x = 0; x < GRID_SIZE; x++) {
				const isEvenX = x % 2 === 0;
				const isEvenY = y % 2 === 0;
				if (isEvenX === isEvenY) {
					continue;
				}
				this.drawEdgeIfPainted(x, y);
			}
		}
		for (let y = 1; y < GRID_SIZE; y += 2) {
			for (let x = 1; x < GRID_SIZE; x += 2) {
				this.drawCornerIfNeeded(x, y);
			}
		}
		for (let y = 0; y < GRID_SIZE; y += 2) {
			for (let x = 0; x < GRID_SIZE; x += 2) {
				this.drawElevationLabel(x, y);
			}
		}
	}
	private tileColor(value: number): number {
		return (
			TILE_PALETTE.find((entry) => entry.code === value)?.color ??
			TILE_PALETTE[0].color
		);
	}
	private edgeColor(value: number): number {
		return (
			EDGE_PALETTE.find((entry) => entry.code === value)?.color ??
			EDGE_PALETTE[1].color
		);
	}
	private drawTile(x: number, y: number): void {
		const tileCode = this.grid[y][x] as EdgeMapTileCode;
		const logicalX = x / 2;
		const logicalY = y / 2;
		const key = `${logicalX},${logicalY}`;
		/**
		 * Void has no rendered ground material because there is no ground surface.
		 */
		const color =
			tileCode === EdgeMapTileCode.Void
				? this.tileColor(tileCode)
				: resolveGroundMaterial(tileCode, this.groundMaterialOverrides[key])
						.fallbackColor;
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
		this.gridGraphics.rect(px, py, SUB_CELL_PX, SUB_CELL_PX).stroke({
			width: 1,
			color: BOUNDARY_LINE_COLOR,
			alpha: 0.6,
		});
	}
	private drawEdgeIfPainted(x: number, y: number): void {
		const value = this.grid[y][x];
		if (value === EdgeBarrier.None) {
			return;
		}
		const color = this.edgeColor(value);
		const centerX = x * SUB_CELL_PX + SUB_CELL_PX / 2;
		const centerY = y * SUB_CELL_PX + SUB_CELL_PX / 2;
		const isVertical = x % 2 === 1;
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
	private drawElevationLabel(x: number, y: number): void {
		const code = this.grid[y][x] as EdgeMapTileCode;
		if (code === EdgeMapTileCode.Void || code === EdgeMapTileCode.River) {
			return;
		}
		const logicalX = x / 2;
		const logicalY = y / 2;
		const key = `${logicalX},${logicalY}`;
		const step =
			this.elevationSteps[key] ?? defaultElevationStepForTileCode(code);
		if (step === 0) {
			return;
		}
		const label = new Text({
			text: step > 0 ? `+${step}` : `${step}`,
			style: {
				fill: 0xffffff,
				fontSize: 8,
				fontWeight: "bold",
			},
		});
		label.anchor.set(0.5);
		label.x = x * SUB_CELL_PX + SUB_CELL_PX / 2;
		label.y = y * SUB_CELL_PX + SUB_CELL_PX / 2;
		this.elevationLabelContainer.addChild(label);
	}
	private drawCornerIfNeeded(x: number, y: number): void {
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
		if (paintedNeighbors.length < 2) {
			return;
		}
		const counts = new Map<number, number>();
		for (const [nx, ny] of paintedNeighbors) {
			const value = this.grid[ny][nx];
			counts.set(value, (counts.get(value) ?? 0) + 1);
		}
		let bestValue = paintedNeighbors[0];
		let bestCount = 0;
		for (const neighbor of paintedNeighbors) {
			const value = this.grid[neighbor[1]][neighbor[0]];
			const count = counts.get(value) ?? 0;
			if (count > bestCount) {
				bestCount = count;
				bestValue = neighbor;
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
	// ---------- Dialogs ----------
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
			this.dialogInput.onkeydown = (event) => {
				if (event.key === "Enter") {
					cleanup(this.dialogInput.value.trim() || null);
				}
				if (event.key === "Escape") {
					cleanup(null);
				}
			};
		});
	}
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
	// ---------- Save / load ----------
	private async promptAndSave(): Promise<void> {
		const name = await this.promptForText(
			"Save map as:",
			this.currentMapName ?? "",
		);
		if (!name) {
			return;
		}
		const bundle: MapBundle = {
			name,
			floors: this.floors.map((floor) => ({
				blueprint: floor.blueprint.map((row) => [...row]),
				elevationSteps: {
					...floor.elevationSteps,
				},
				groundMaterialOverrides: {
					...floor.groundMaterialOverrides,
				},
			})),
			groundFloorIndex: this.groundFloorIndex,
		};
		try {
			await this.repo.save(name, bundle);
		} catch (error) {
			await this.confirmDialog(
				`Couldn't save "${name}": ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return;
		}
		this.currentMapName = name;
		this.refreshSavedMapsUi();
		this.updateStatus();
	}
	private async loadMap(name: string): Promise<void> {
		const bundle = this.repo.load(name);
		if (!bundle) {
			return;
		}
		const hasMalformedFloor = bundle.floors.some(
			(floor) =>
				floor.blueprint.length !== GRID_SIZE ||
				floor.blueprint.some((row) => row.length !== GRID_SIZE),
		);
		if (
			bundle.floors.length === 0 ||
			hasMalformedFloor ||
			bundle.groundFloorIndex < 0 ||
			bundle.groundFloorIndex >= bundle.floors.length
		) {
			await this.confirmDialog(
				`"${name}" isn't a valid saved map — not loading it.`,
			);
			return;
		}
		this.loadBundleIntoState(bundle);
		this.currentMapName = name;
		this.redrawGrid();
		this.blueprintViewInitialized = false;
		this.refreshFloorUi();
		this.refreshSavedMapsUi();
		this.updateStatus();
		if (!this.previewMode) {
			this.fitBlueprintToViewport(
				this.game.app.screen.width,
				this.game.app.screen.height,
			);
		}
		this.refreshEnginePreview();
	}
	private async deleteMap(name: string): Promise<void> {
		const confirmed = await this.confirmDialog(`Delete saved map "${name}"?`);
		if (!confirmed) {
			return;
		}
		try {
			await this.repo.delete(name);
		} catch (error) {
			await this.confirmDialog(
				`Couldn't delete "${name}": ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return;
		}
		if (this.currentMapName === name) {
			this.currentMapName = null;
		}
		this.refreshSavedMapsUi();
		this.updateStatus();
	}
	// ---------- Export ----------
	private exportBlueprint(): void {
		const rows = this.grid.map((row) => `\t\t[${row.join(", ")}],`).join("\n");
		const elevationSource = JSON.stringify(this.elevationSteps, null, "\t");
		const materialSource = JSON.stringify(
			this.groundMaterialOverrides,
			null,
			"\t",
		);
		const content = `/**
 * Map floor drawn with the in-game Map Creator.
 */
export const CUSTOM_MAP_FLOOR = {
	blueprint: [
${rows}
	],
	elevationSteps: ${elevationSource},
	groundMaterialOverrides: ${materialSource},
};
`;
		const blob = new Blob([content], {
			type: "text/typescript",
		});
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = "customMapFloor.ts";
		document.body.appendChild(anchor);
		anchor.click();
		document.body.removeChild(anchor);
		URL.revokeObjectURL(url);
	}
	// ---------- Full-screen layout ----------
	private layout(width: number, height: number): void {
		this.gridPanel.x = 0;
		this.gridPanel.y = 0;
		this.viewportMask.clear();
		this.viewportMask.rect(0, 0, width, height).fill(0xffffff);
		this.gridViewport.mask = this.viewportMask;
		this.gridViewport.hitArea = new Rectangle(0, 0, width, height);
		if (!this.gridPanel.children.includes(this.viewportMask)) {
			this.gridPanel.addChild(this.viewportMask);
		}
		/**
		 * Resize only changes the viewport bounds. Once the user has panned or
		 * zoomed, preserve that transform; the floating Recenter button is the
		 * explicit way to restore the active view to the viewport centre.
		 */
		if (!this.blueprintViewInitialized) {
			this.fitBlueprintToViewport(width, height);
		}
		if (this.previewMode && !this.previewViewInitialized) {
			this.fitPreviewToViewport(width, height);
		}
	}
}
function materialGroupLabel(definition: GroundMaterialDefinition): string {
	const family = String(definition.id).split(".")[0];
	switch (family) {
		case "floor":
			return "Floor";
		case "pavement":
			return "Pavement";
		case "road":
			return "Road";
		case "nature":
			return "Nature";
		case "river":
			return "River";
		case "stair":
			return "Stairs";
		case "ladder":
			return "Ladders";
		default:
			return "Other";
	}
}
