export type MapCreatorPaletteUiKind =
	| "tile"
	| "material"
	| "edge"
	| "elevation";
export type MapCreatorEditorTab = "editor" | "parts" | "saved-maps";

export interface MapCreatorPaletteUiItem {
	index: number;
	label: string;
	kind: MapCreatorPaletteUiKind;
	color: number;
	group?: string;
	searchText?: string;
	thumbnailUrl?: string;
	variantCount?: number;
}

export interface MapCreatorFloorUiItem {
	index: number;
	label: string;
}

export interface MapCreatorFloorUiState {
	floors: readonly MapCreatorFloorUiItem[];
	currentFloorIndex: number;
	canAddAbove: boolean;
	canAddBelow: boolean;
}

export interface MapCreatorEditorUiCallbacks {
	onTogglePreview(): void | Promise<void>;
	onRecenterView(): void;
	onSelectPalette(index: number): void;
	onBack(): void | Promise<void>;
	onSave(): void | Promise<void>;
	onExport(): void;
	onClear(): void;
	onAddFloorAbove(): void;
	onAddBasement(): void;
	onSelectFloor(index: number): void;
	onLoadMap(name: string): void | Promise<void>;
	onDeleteMap(name: string): void | Promise<void>;
}

/**
 * DOM chrome for Map Creator.
 *
 * Pixi owns the full-screen map surface. This class owns editor controls that
 * benefit from normal browser UI: search, tabs, scrolling and accessible
 * buttons. Keeping those concerns out of Pixi also leaves the render viewport
 * free for both Blueprint and the production-renderer Preview.
 */
export class MapCreatorEditorUi {
	private readonly root = document.createElement("div");
	private readonly toolbar = document.createElement("div");
	private readonly modeButton = document.createElement("button");
	private readonly recenterButton = document.createElement("button");
	private readonly modeText = document.createElement("div");
	private readonly zoomText = document.createElement("div");
	private readonly floorText = document.createElement("div");
	private readonly statusText = document.createElement("div");

	private readonly drawer = document.createElement("aside");
	private readonly drawerToggle = document.createElement("button");
	private readonly tabs = document.createElement("div");
	private readonly tabButtons = new Map<
		MapCreatorEditorTab,
		HTMLButtonElement
	>();

	private readonly editorTab = document.createElement("section");
	private readonly partsTab = document.createElement("section");
	private readonly savedMapsTab = document.createElement("section");

	private readonly searchInput = document.createElement("input");
	private readonly paletteRoot = document.createElement("div");
	private readonly floorRoot = document.createElement("div");
	private readonly savedMapsRoot = document.createElement("div");
	private readonly previewNotice = document.createElement("div");

	private selectedPaletteIndex = -1;
	private drawerOpen = true;
	private activeTab: MapCreatorEditorTab | null = null;
	private searchQuery = "";

	constructor(
		private readonly palette: readonly MapCreatorPaletteUiItem[],
		private readonly callbacks: MapCreatorEditorUiCallbacks,
	) {
		ensureMapCreatorStyles();
		this.build();
	}

	mount(): void {
		if (!this.root.isConnected) {
			document.body.appendChild(this.root);
		}
	}

	destroy(): void {
		this.root.remove();
	}

	setMode(previewMode: boolean): void {
		this.modeButton.innerHTML = eyeIcon(previewMode);
		this.modeButton.classList.toggle("is-preview", previewMode);
		this.modeButton.title = previewMode
			? "Live preview on — return to Blueprint"
			: "Live preview off — open the real renderer preview";
		this.modeButton.setAttribute("aria-label", this.modeButton.title);
		this.modeText.textContent = previewMode ? "Live Preview" : "Blueprint";
		this.previewNotice.style.display = previewMode ? "block" : "none";
	}

	setActivity(text: string): void {
		this.statusText.textContent = text;
	}

	setZoomPercent(percent: number): void {
		this.zoomText.textContent = `${percent}%`;
	}

	setSelectedPaletteIndex(index: number): void {
		this.selectedPaletteIndex = index;
		this.paletteRoot
			.querySelectorAll<HTMLElement>("[data-palette-index]")
			.forEach((element) => {
				element.classList.toggle(
					"is-selected",
					Number(element.dataset.paletteIndex) === index,
				);
			});
	}

	setFloorState(state: MapCreatorFloorUiState): void {
		this.floorRoot.replaceChildren();

		const currentFloor = state.floors.find(
			(floor) => floor.index === state.currentFloorIndex,
		);
		this.floorText.textContent = currentFloor?.label ?? "—";

		const label = document.createElement("div");
		label.className = "rho-map-editor-floor-rail-label";
		label.textContent = "Floors";
		this.floorRoot.appendChild(label);

		const addAbove = this.railButton("+↑", "Add floor above", () =>
			this.callbacks.onAddFloorAbove(),
		);
		addAbove.disabled = !state.canAddAbove;
		this.floorRoot.appendChild(addAbove);

		for (const floor of state.floors) {
			const button = this.railButton(
				floor.label,
				`Edit floor ${floor.label}`,
				() => this.callbacks.onSelectFloor(floor.index),
			);
			button.classList.toggle(
				"is-selected",
				floor.index === state.currentFloorIndex,
			);
			this.floorRoot.appendChild(button);
		}

		const addBelow = this.railButton("+↓", "Add basement", () =>
			this.callbacks.onAddBasement(),
		);
		addBelow.disabled = !state.canAddBelow;
		this.floorRoot.appendChild(addBelow);
	}

	setSavedMaps(names: readonly string[], currentMapName: string | null): void {
		this.savedMapsRoot.replaceChildren();

		const heading = document.createElement("div");
		heading.className = "rho-map-editor-section-title";
		heading.textContent = "Saved Maps";
		this.savedMapsRoot.appendChild(heading);

		const saveCurrent = this.actionButton(
			currentMapName ? `Save "${currentMapName}"` : "Save Current Map",
			() => this.callbacks.onSave(),
		);
		saveCurrent.classList.add("is-primary", "rho-map-editor-save-current");
		this.savedMapsRoot.appendChild(saveCurrent);

		if (names.length === 0) {
			const empty = document.createElement("div");
			empty.className = "rho-map-editor-muted";
			empty.textContent = "No saved maps yet.";
			this.savedMapsRoot.appendChild(empty);
			return;
		}

		for (const name of names) {
			const row = document.createElement("div");
			row.className = "rho-map-editor-map-row";

			const load = this.actionButton(name, () =>
				this.callbacks.onLoadMap(name),
			);
			load.classList.add("rho-map-editor-map-load");
			load.classList.toggle("is-selected", name === currentMapName);
			row.appendChild(load);

			const remove = this.actionButton("Delete", () =>
				this.callbacks.onDeleteMap(name),
			);
			remove.classList.add("is-danger");
			row.appendChild(remove);

			this.savedMapsRoot.appendChild(row);
		}
	}

	private build(): void {
		this.root.className = "rho-map-editor-ui";

		this.toolbar.className = "rho-map-editor-toolbar";

		this.modeButton.className = "rho-map-editor-mode-button";
		this.modeButton.type = "button";
		this.modeButton.onclick = () => {
			void this.callbacks.onTogglePreview();
		};

		this.recenterButton.className =
			"rho-map-editor-toolbar-button rho-map-editor-recenter-button";
		this.recenterButton.type = "button";
		this.recenterButton.innerHTML = recenterIcon();
		this.recenterButton.title = "Recenter the active map view";
		this.recenterButton.setAttribute("aria-label", this.recenterButton.title);
		this.recenterButton.onclick = () => this.callbacks.onRecenterView();

		const readout = document.createElement("div");
		readout.className = "rho-map-editor-readout";

		this.modeText.className = "rho-map-editor-readout-value";
		this.zoomText.className = "rho-map-editor-readout-value";
		this.floorText.className = "rho-map-editor-readout-value";
		this.statusText.className = "rho-map-editor-readout-value";

		readout.append(
			this.readoutItem("View", this.modeText),
			this.readoutItem("Zoom", this.zoomText),
			this.readoutItem("Floor", this.floorText),
			this.readoutItem("Tool", this.statusText),
		);

		this.toolbar.append(this.modeButton, this.recenterButton, readout);
		this.root.appendChild(this.toolbar);

		this.drawer.className = "rho-map-editor-drawer is-open";

		this.drawerToggle.className = "rho-map-editor-drawer-toggle";
		this.drawerToggle.type = "button";
		this.drawerToggle.title = "Collapse editor tools";
		this.drawerToggle.textContent = "›";
		this.drawerToggle.onclick = () => {
			this.drawerOpen = !this.drawerOpen;
			this.drawer.classList.toggle("is-open", this.drawerOpen);
			this.drawerToggle.textContent = this.drawerOpen ? "›" : "‹";
			this.drawerToggle.title = this.drawerOpen
				? "Collapse editor tools"
				: "Open editor tools";
		};
		this.drawer.appendChild(this.drawerToggle);

		const drawerHeader = document.createElement("div");
		drawerHeader.className = "rho-map-editor-drawer-header";

		const title = document.createElement("div");
		title.className = "rho-map-editor-title";
		title.textContent = "Map Creator";

		const actions = document.createElement("div");
		actions.className = "rho-map-editor-actions";
		actions.append(
			this.actionButton("Menu", () => this.callbacks.onBack()),
			this.actionButton("Export", () => this.callbacks.onExport()),
			this.actionButton("Clear", () => this.callbacks.onClear(), true),
		);

		this.tabs.className = "rho-map-editor-tabs";
		this.addTabButton("editor", "Editor");
		this.addTabButton("parts", "Parts");
		this.addTabButton("saved-maps", "Saved Maps");
		this.drawer.appendChild(this.tabs);

		this.previewNotice.className = "rho-map-editor-preview-notice";
		this.previewNotice.textContent =
			"Preview is read-only and renders the currently selected floor through the production renderer.";
		this.previewNotice.style.display = "none";

		drawerHeader.append(title, actions, this.previewNotice);

		const scroll = document.createElement("div");
		scroll.className = "rho-map-editor-scroll";

		this.buildEditorTab();
		this.buildPartsTab();

		this.savedMapsTab.className = "rho-map-editor-tab-panel";
		this.savedMapsRoot.className = "rho-map-editor-block";
		this.savedMapsTab.appendChild(this.savedMapsRoot);

		const drawerColumns = document.createElement("div");
		drawerColumns.className = "rho-map-editor-drawer-columns";
		this.floorRoot.className = "rho-map-editor-floor-rail";

		const tabContent = document.createElement("div");
		tabContent.className = "rho-map-editor-tab-content";
		tabContent.append(this.editorTab, this.partsTab, this.savedMapsTab);

		drawerColumns.append(this.floorRoot, tabContent);
		scroll.appendChild(drawerColumns);
		this.drawer.append(drawerHeader, scroll);
		this.root.appendChild(this.drawer);

		this.setActiveTab("editor");
		this.setMode(false);
		this.rebuildPalette();
	}

	private buildEditorTab(): void {
		this.editorTab.className = "rho-map-editor-tab-panel";

		this.searchInput.className = "rho-map-editor-search";
		this.searchInput.type = "search";
		this.searchInput.placeholder = "Search tiles, materials, edges…";
		this.searchInput.autocomplete = "off";
		this.searchInput.oninput = () => {
			this.searchQuery = this.searchInput.value.trim().toLowerCase();
			this.rebuildPalette();
		};

		const searchWrap = document.createElement("div");
		searchWrap.className = "rho-map-editor-search-wrap";
		searchWrap.appendChild(this.searchInput);

		this.paletteRoot.className = "rho-map-editor-palette";
		this.editorTab.append(searchWrap, this.paletteRoot);
	}

	private buildPartsTab(): void {
		this.partsTab.className = "rho-map-editor-tab-panel";

		const heading = document.createElement("div");
		heading.className = "rho-map-editor-section-title";
		heading.textContent = "Parts";

		const copy = document.createElement("div");
		copy.className = "rho-map-editor-muted rho-map-editor-parts-copy";
		copy.textContent =
			"Reserved for authored objects, reusable structures and prefabs. Stairs and ladders still use their current tile semantics until the object-authoring data model lands.";

		const planned = document.createElement("div");
		planned.className = "rho-map-editor-parts-grid";

		for (const [name, description] of [
			[
				"Objects",
				"Place authored world objects without turning every object into a tile type.",
			],
			[
				"Structures",
				"Author reusable multi-cell structures such as buildings and rooms.",
			],
			["Prefabs", "Save a local-origin chunk and snap copies into maps."],
		] as const) {
			const card = document.createElement("div");
			card.className = "rho-map-editor-part-card";

			const cardTitle = document.createElement("strong");
			cardTitle.textContent = name;

			const cardCopy = document.createElement("span");
			cardCopy.textContent = description;

			card.append(cardTitle, cardCopy);
			planned.appendChild(card);
		}

		this.partsTab.append(heading, copy, planned);
	}

	private addTabButton(tab: MapCreatorEditorTab, label: string): void {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "rho-map-editor-tab-button";
		button.dataset.tab = tab;
		button.innerHTML = tabIcon(tab);
		button.title = label;
		button.setAttribute("aria-label", label);
		button.onclick = () => this.setActiveTab(tab);
		this.tabButtons.set(tab, button);
		this.tabs.appendChild(button);
	}

	private setActiveTab(tab: MapCreatorEditorTab): void {
		if (this.activeTab === tab) return;
		this.activeTab = tab;

		for (const [buttonTab, button] of this.tabButtons) {
			button.classList.toggle("is-selected", buttonTab === tab);
		}

		this.editorTab.hidden = tab !== "editor";
		this.partsTab.hidden = tab !== "parts";
		this.savedMapsTab.hidden = tab !== "saved-maps";
	}

	private rebuildPalette(): void {
		this.paletteRoot.replaceChildren();

		const sections: readonly {
			kind: MapCreatorPaletteUiKind;
			title: string;
		}[] = [
			{ kind: "tile", title: "Tiles" },
			{ kind: "material", title: "Materials" },
			{ kind: "edge", title: "Edges" },
			{ kind: "elevation", title: "Elevation" },
		];

		for (const section of sections) {
			const matching = this.palette.filter((item) => {
				if (item.kind !== section.kind) return false;
				if (!this.searchQuery) return true;

				const haystack = [
					item.label,
					item.kind,
					item.group ?? "",
					item.searchText ?? "",
				]
					.join(" ")
					.toLowerCase();

				return haystack.includes(this.searchQuery);
			});

			if (matching.length === 0) continue;

			const details = document.createElement("details");
			details.className = "rho-map-editor-section";
			details.open = true;

			const summary = document.createElement("summary");
			summary.textContent = `${section.title} (${matching.length})`;
			details.appendChild(summary);

			if (section.kind === "material") {
				const grouped = new Map<string, MapCreatorPaletteUiItem[]>();

				for (const item of matching) {
					const group = item.group ?? "Other";
					const bucket = grouped.get(group) ?? [];
					bucket.push(item);
					grouped.set(group, bucket);
				}

				for (const [group, items] of grouped) {
					const groupDetails = document.createElement("details");
					groupDetails.className = "rho-map-editor-material-group";
					groupDetails.open = this.searchQuery.length > 0;

					const groupSummary = document.createElement("summary");
					groupSummary.textContent = `${group} (${items.length})`;

					groupDetails.append(groupSummary, this.paletteGrid(items));
					details.appendChild(groupDetails);
				}
			} else {
				details.appendChild(this.paletteGrid(matching));
			}

			this.paletteRoot.appendChild(details);
		}

		if (this.paletteRoot.childElementCount === 0) {
			const empty = document.createElement("div");
			empty.className = "rho-map-editor-muted";
			empty.textContent = "No editor tools match that search.";
			this.paletteRoot.appendChild(empty);
		}

		this.setSelectedPaletteIndex(this.selectedPaletteIndex);
	}

	private paletteGrid(items: readonly MapCreatorPaletteUiItem[]): HTMLElement {
		const grid = document.createElement("div");
		grid.className = "rho-map-editor-item-grid";

		for (const item of items) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "rho-map-editor-item";
			button.dataset.paletteIndex = String(item.index);
			button.title = item.searchText
				? `${item.label}\n${item.searchText}`
				: item.label;
			button.onclick = () => {
				this.selectedPaletteIndex = item.index;
				this.setSelectedPaletteIndex(item.index);
				this.callbacks.onSelectPalette(item.index);
			};

			const preview = document.createElement("span");
			preview.className = "rho-map-editor-item-preview";
			preview.style.backgroundColor = cssColor(item.color);

			if (item.thumbnailUrl) {
				preview.style.backgroundImage = `url("${item.thumbnailUrl}")`;
			}

			const label = document.createElement("span");
			label.className = "rho-map-editor-item-label";
			label.textContent = item.label;

			button.append(preview, label);

			if ((item.variantCount ?? 0) > 1) {
				const badge = document.createElement("span");
				badge.className = "rho-map-editor-variant-badge";
				badge.textContent = `${item.variantCount} variants`;
				button.appendChild(badge);
			}

			grid.appendChild(button);
		}

		return grid;
	}

	private readoutItem(label: string, value: HTMLElement): HTMLElement {
		const item = document.createElement("div");
		item.className = "rho-map-editor-readout-item";

		const itemLabel = document.createElement("span");
		itemLabel.className = "rho-map-editor-readout-label";
		itemLabel.textContent = `${label}:`;

		item.append(itemLabel, value);
		return item;
	}

	private actionButton(
		label: string,
		onClick: () => void | Promise<void>,
		danger = false,
	): HTMLButtonElement {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "rho-map-editor-action";
		button.classList.toggle("is-danger", danger);
		button.textContent = label;
		button.onclick = () => {
			void onClick();
		};
		return button;
	}

	private railButton(
		label: string,
		title: string,
		onClick: () => void,
	): HTMLButtonElement {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "rho-map-editor-floor-button";
		button.textContent = label;
		button.title = title;
		button.onclick = onClick;
		return button;
	}
}

function cssColor(value: number): string {
	return `#${(value & 0xffffff).toString(16).padStart(6, "0")}`;
}

function tabIcon(tab: MapCreatorEditorTab): string {
	switch (tab) {
		case "editor":
			return `
<svg viewBox="0 0 24 24" aria-hidden="true">
	<path d="M4 20l4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" />
	<path d="m13.8 7.2 3 3" />
</svg>`;

		case "parts":
			return `
<svg viewBox="0 0 24 24" aria-hidden="true">
	<path d="M3 11.2 12 4l9 7.2" />
	<path d="M5.5 10.2V20h13V10.2" />
	<path d="M9.5 20v-5.5h5V20" />
</svg>`;

		case "saved-maps":
			return `
<svg viewBox="0 0 24 24" aria-hidden="true">
	<path d="m3 5 5-2 8 3 5-2v15l-5 2-8-3-5 2V5Z" />
	<path d="M8 3v15M16 6v15" />
</svg>`;
	}
}

function recenterIcon(): string {
	return `
<svg viewBox="-14 -14 28 28" aria-hidden="true">
	<circle cx="0" cy="0" r="6" />
	<path d="M0 -12v5M0 7v5M-12 0h5M7 0h5" />
</svg>`;
}

function eyeIcon(open: boolean): string {
	if (open) {
		return `
<svg viewBox="0 0 24 24" aria-hidden="true">
	<path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
	<circle cx="12" cy="12" r="2.7" />
</svg>`;
	}

	return `
<svg viewBox="0 0 24 24" aria-hidden="true">
	<path d="M3 13.5c2.5 2.6 5.4 3.9 9 3.9s6.5-1.3 9-3.9" />
	<path d="M6 16.1 4.7 18M10 17.4 9.6 20M14 17.4 14.4 20M18 16.1 19.3 18" />
</svg>`;
}

function ensureMapCreatorStyles(): void {
	const styleId = "rho-map-editor-ui-styles";
	if (document.getElementById(styleId)) return;

	const style = document.createElement("style");
	style.id = styleId;
	style.textContent = `
.rho-map-editor-ui {
	position: fixed;
	inset: 0;
	z-index: 8000;
	pointer-events: none;
	font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	color: #f4f4f6;
}

.rho-map-editor-toolbar {
	position: absolute;
	top: 14px;
	left: 14px;
	display: flex;
	align-items: stretch;
	gap: 8px;
	pointer-events: auto;
}

.rho-map-editor-mode-button,
.rho-map-editor-toolbar-button,
.rho-map-editor-action,
.rho-map-editor-floor-button,
.rho-map-editor-tab-button {
	border: 1px solid rgba(255,255,255,0.18);
	background: rgba(30,30,40,0.94);
	color: #fff;
	border-radius: 8px;
	cursor: pointer;
	font-weight: 700;
}

.rho-map-editor-mode-button {
	width: 48px;
	height: 48px;
	display: grid;
	place-items: center;
	padding: 0;
	background: rgba(30,30,40,0.94);
}

.rho-map-editor-mode-button svg {
	width: 23px;
	height: 23px;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.8;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.rho-map-editor-mode-button.is-preview {
	background: rgba(42,78,142,0.96);
}

.rho-map-editor-toolbar-button {
	padding: 0;
}

.rho-map-editor-recenter-button {
	width: 48px;
	height: 48px;
	display: grid;
	place-items: center;
}

.rho-map-editor-recenter-button svg {
	width: 24px;
	height: 24px;
	fill: none;
	stroke: currentColor;
	stroke-width: 2;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.rho-map-editor-mode-button:hover,
.rho-map-editor-toolbar-button:hover,
.rho-map-editor-action:hover:not(:disabled),
.rho-map-editor-floor-button:hover:not(:disabled),
.rho-map-editor-tab-button:hover {
	filter: brightness(1.12);
}

.rho-map-editor-readout {
	height: 48px;
	display: flex;
	align-items: center;
	gap: 22px;
	padding: 0 4px;
}

.rho-map-editor-readout-item {
	display: flex;
	align-items: baseline;
	gap: 6px;
	white-space: nowrap;
}

.rho-map-editor-readout-label,
.rho-map-editor-readout-value {
	font-size: 13px;
	font-weight: 600;
	line-height: 1;
}

.rho-map-editor-readout-label {
	color: #a5a6b0;
}

.rho-map-editor-readout-value {
	color: #f4f4f6;
}

.rho-map-editor-drawer {
	position: absolute;
	top: 0;
	right: 0;
	bottom: 0;
	width: min(430px, calc(100vw - 52px));
	display: flex;
	flex-direction: column;
	background: rgba(24,24,32,0.97);
	border-left: 1px solid rgba(255,255,255,0.14);
	box-shadow: -12px 0 32px rgba(0,0,0,0.34);
	transform: translateX(100%);
	transition: transform 160ms ease;
	pointer-events: auto;
	backdrop-filter: blur(12px);
}

.rho-map-editor-drawer.is-open {
	transform: translateX(0);
}

.rho-map-editor-drawer-toggle {
	position: absolute;
	z-index: 3;
	left: -42px;
	top: 72px;
	width: 42px;
	height: 56px;
	border: 1px solid rgba(255,255,255,0.18);
	border-right: 0;
	border-radius: 10px 0 0 10px;
	background: rgba(24,24,32,0.97);
	color: #fff;
	font-size: 24px;
	cursor: pointer;
}

.rho-map-editor-drawer-header {
	position: relative;
	z-index: 2;
	flex: 0 0 auto;
	background: rgba(24,24,32,0.97);
	padding: 18px 16px 12px;
	border-bottom: 1px solid rgba(255,255,255,0.10);
}

.rho-map-editor-title {
	font-size: 20px;
	font-weight: 800;
	margin-bottom: 12px;
}

.rho-map-editor-actions {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 6px;
	margin-bottom: 10px;
}

.rho-map-editor-action {
	min-height: 34px;
	padding: 6px 8px;
	background: #2a2a34;
	font-size: 12px;
}

.rho-map-editor-action.is-primary {
	background: #2a4e8e;
}

.rho-map-editor-action.is-danger {
	background: #642b31;
}

.rho-map-editor-action:disabled,
.rho-map-editor-floor-button:disabled {
	opacity: 0.4;
	cursor: default;
}

.rho-map-editor-tabs {
	position: absolute;
	left: -38px;
	top: 140px;
	z-index: 1;
	width: 42px;
	display: flex;
	flex-direction: column;
	gap: 10px;
	opacity: 0;
	pointer-events: none;
	transform: translateX(42px);
	transition:
		opacity 130ms ease,
		transform 160ms ease;
}

.rho-map-editor-drawer.is-open .rho-map-editor-tabs {
	opacity: 1;
	pointer-events: auto;
	transform: translateX(0);
}

.rho-map-editor-tab-button {
	width: 42px;
	height: 56px;
	display: grid;
	place-items: center;
	padding: 0;
	border-right: 0;
	border-radius: 10px 0 0 10px;
	box-shadow: -4px 4px 12px rgba(0,0,0,0.22);
	transform: translateX(4px);
	transition:
		transform 120ms ease,
		filter 120ms ease,
		box-shadow 120ms ease;
}

.rho-map-editor-tab-button svg {
	width: 21px;
	height: 21px;
	fill: none;
	stroke: currentColor;
	stroke-width: 1.8;
	stroke-linecap: round;
	stroke-linejoin: round;
}

.rho-map-editor-tab-button[data-tab="editor"] {
	background: #385d86;
}

.rho-map-editor-tab-button[data-tab="parts"] {
	background: #805e34;
}

.rho-map-editor-tab-button[data-tab="saved-maps"] {
	background: #3f6a59;
}

.rho-map-editor-tab-button.is-selected {
	transform: translateX(-4px);
	border-color: rgba(255,255,255,0.56);
	box-shadow:
		-5px 5px 14px rgba(0,0,0,0.28),
		inset 0 0 0 1px rgba(255,255,255,0.10);
}

.rho-map-editor-preview-notice {
	margin-top: 10px;
	padding: 9px 10px;
	border-radius: 7px;
	background: rgba(74,158,255,0.10);
	border: 1px solid rgba(74,158,255,0.25);
	color: #cfe5ff;
	font-size: 11px;
	line-height: 1.35;
}

.rho-map-editor-scroll {
	position: relative;
	z-index: 2;
	min-height: 0;
	background: rgba(24,24,32,0.97);
	flex: 1 1 auto;
	display: flex;
	overflow-y: auto;
	overscroll-behavior: contain;
	padding: 14px 14px 36px;
}

.rho-map-editor-tab-panel[hidden] {
	display: none;
}

.rho-map-editor-drawer-columns {
	position: relative;
	flex: 1 1 auto;
	min-height: 100%;
	width: 100%;
	display: grid;
	grid-template-columns: 52px minmax(0, 1fr);
	gap: 12px;
	align-items: start;
}

.rho-map-editor-drawer-columns::before {
	content: "";
	position: absolute;
	top: 0;
	bottom: 0;
	left: 52px;
	width: 1px;
	background: rgba(255,255,255,0.09);
}

.rho-map-editor-tab-content {
	min-width: 0;
}

.rho-map-editor-floor-rail {
	position: sticky;
	top: 0;
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding-right: 10px;
}

.rho-map-editor-floor-rail-label {
	margin-bottom: 2px;
	color: #8d8d99;
	font-size: 9px;
	font-weight: 800;
	text-align: center;
	text-transform: uppercase;
	letter-spacing: 0.08em;
}

.rho-map-editor-floor-button {
	width: 42px;
	height: 36px;
	padding: 0;
	background: #2a2a34;
	font-size: 11px;
}

.rho-map-editor-floor-button.is-selected {
	background: #2a4e8e;
	border-color: rgba(255,255,255,0.48);
}

.rho-map-editor-catalog {
	min-width: 0;
}

.rho-map-editor-search-wrap {
	position: sticky;
	top: 0;
	z-index: 2;
	padding-bottom: 10px;
	background: linear-gradient(rgba(24,24,32,1) 78%, rgba(24,24,32,0));
}

.rho-map-editor-search {
	box-sizing: border-box;
	width: 100%;
	height: 38px;
	padding: 0 11px;
	border-radius: 8px;
	border: 1px solid rgba(255,255,255,0.16);
	outline: none;
	background: #16161e;
	color: #fff;
	font-size: 13px;
}

.rho-map-editor-search:focus {
	border-color: #4a9eff;
	box-shadow: 0 0 0 2px rgba(74,158,255,0.16);
}

.rho-map-editor-palette {
	min-width: 0;
}

.rho-map-editor-section,
.rho-map-editor-material-group {
	margin-bottom: 12px;
	border-bottom: 1px solid rgba(255,255,255,0.08);
	padding-bottom: 10px;
}

.rho-map-editor-section > summary,
.rho-map-editor-material-group > summary {
	cursor: pointer;
	user-select: none;
	font-weight: 800;
}

.rho-map-editor-section > summary {
	padding: 7px 0 9px;
	font-size: 14px;
}

.rho-map-editor-material-group {
	margin: 4px 0 8px 8px;
	padding: 0 0 8px 8px;
	border-left: 2px solid rgba(255,255,255,0.08);
	border-bottom: 0;
}

.rho-map-editor-material-group > summary {
	padding: 6px 0 8px;
	color: #b4b4c2;
	font-size: 11px;
	text-transform: uppercase;
	letter-spacing: 0.06em;
}

.rho-map-editor-item-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 8px;
}

.rho-map-editor-item {
	position: relative;
	min-width: 0;
	padding: 6px;
	border: 1px solid rgba(255,255,255,0.12);
	border-radius: 8px;
	background: #24242e;
	color: #fff;
	cursor: pointer;
	text-align: left;
}

.rho-map-editor-item:hover {
	background: #2e2e3a;
}

.rho-map-editor-item.is-selected {
	border-color: #4a9eff;
	box-shadow: 0 0 0 2px rgba(74,158,255,0.24);
	background: #26334a;
}

.rho-map-editor-item-preview {
	display: block;
	width: 100%;
	aspect-ratio: 1.35 / 1;
	border-radius: 5px;
	background-size: cover;
	background-position: center;
	image-rendering: auto;
	box-shadow: inset 0 0 0 1px rgba(255,255,255,0.10);
}

.rho-map-editor-item-label {
	display: block;
	margin-top: 6px;
	font-size: 11px;
	font-weight: 700;
	line-height: 1.2;
	overflow-wrap: anywhere;
}

.rho-map-editor-variant-badge {
	display: block;
	margin-top: 3px;
	color: #9494a2;
	font-size: 9px;
}

.rho-map-editor-section-title {
	margin-bottom: 9px;
	font-size: 14px;
	font-weight: 800;
	letter-spacing: 0.02em;
}

.rho-map-editor-block {
	padding-bottom: 16px;
}

.rho-map-editor-save-current {
	width: 100%;
	margin-bottom: 12px;
}

.rho-map-editor-map-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 7px;
	margin-bottom: 7px;
}

.rho-map-editor-map-load {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.rho-map-editor-map-load.is-selected {
	background: #2a4e8e;
	border-color: rgba(255,255,255,0.48);
}

.rho-map-editor-muted {
	color: #8d8d99;
	font-size: 12px;
	line-height: 1.5;
}

.rho-map-editor-parts-copy {
	margin-bottom: 14px;
}

.rho-map-editor-parts-grid {
	display: grid;
	gap: 8px;
}

.rho-map-editor-part-card {
	display: grid;
	gap: 4px;
	padding: 12px;
	border: 1px solid rgba(255,255,255,0.10);
	border-radius: 8px;
	background: #22222c;
}

.rho-map-editor-part-card strong {
	font-size: 13px;
}

.rho-map-editor-part-card span {
	color: #9898a6;
	font-size: 11px;
	line-height: 1.4;
}

@media (max-width: 760px) {
	.rho-map-editor-readout {
		max-width: 58vw;
		gap: 12px;
		overflow-x: auto;
	}

	.rho-map-editor-drawer {
		width: min(390px, calc(100vw - 48px));
	}
}
`;

	document.head.appendChild(style);
}
