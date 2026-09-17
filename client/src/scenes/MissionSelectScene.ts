import { Container, Text } from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import { Button } from "@/ui/generics/Button";
import { computeFitScale } from "@/math/fitScale";
import { LobbyScene } from "./LobbyScene";
import { LoadingOverlay } from "@/ui/overlay/LoadingOverlay";
import { missionCustomMapRepo } from "@/core/maps/missionCustomMapRepo";
import { SelectedMapId } from "@/core/game/GameSession";

/**
 * Per-match config. Official maps and custom maps are separate tabs.
 * Start writes missionParams into the session and opens LoadingOverlay,
 * which compiles the chosen MapBundle and hands off to MapScene.
 */
export class MissionSelectScene implements Scene {
	readonly view = new Container();
	private content = new Container();

	private mapSource: "official" | "custom" = "official";
	private officialBtn!: Button;
	private customBtn!: Button;

	private selectedMap: SelectedMapId = { type: "builtin", id: "alleyways" };
	private mapButtons: Button[] = [];

	private title!: Text;
	private mapLabel!: Text;
	private fogToggleBtn!: Button;
	private startBtn!: Button;
	private backBtn!: Button;

	/** Defaults on — matches fog being the intended standard behavior, not an opt-in. */
	private fogOfWarEnabled = true;

	private readonly DESIGN_WIDTH = 700;
	private readonly DESIGN_HEIGHT = 560;

	constructor(private game: Game) {}

	onEnter(): void {
		this.buildUI();
		this.layout(this.game.app.screen.width, this.game.app.screen.height);
	}

	onExit(): void {}

	update(_deltaTime: number): void {}

	onResize(width: number, height: number): void {
		this.layout(width, height);
	}

	private officialMaps(): { id: SelectedMapId; label: string }[] {
		return [{ id: { type: "builtin", id: "alleyways" }, label: "Alleyways" }];
	}

	private customMaps(): { id: SelectedMapId; label: string }[] {
		return missionCustomMapRepo.list().map((name) => ({
			id: { type: "custom" as const, id: name },
			label: name,
		}));
	}

	private currentMaps() {
		return this.mapSource === "official"
			? this.officialMaps()
			: this.customMaps();
	}

	private clearMapButtons(): void {
		for (const btn of this.mapButtons) {
			this.content.removeChild(btn.view);
		}
		this.mapButtons = [];
	}

	private rebuildMapList(): void {
		this.clearMapButtons();
		const maps = this.currentMaps();

		if (maps.length === 0) {
			this.selectedMap = { type: "custom", id: "" };
			this.mapLabel.text = "No custom maps saved";
			this.startBtn.setEnabled(false);
			this.layout(this.game.app.screen.width, this.game.app.screen.height);
			return;
		}

		this.startBtn.setEnabled(true);
		this.selectedMap = maps[0].id;
		this.mapLabel.text = maps[0].label;

		maps.forEach((m, i) => {
			const btn = new Button({
				text: m.label,
				width: 260,
				height: 36,
				fontSize: 14,
				onClick: () => {
					this.selectedMap = m.id;
					this.mapLabel.text = m.label;
					this.highlightSelected(i);
				},
			});
			this.content.addChild(btn.view);
			this.mapButtons.push(btn);
		});
		this.highlightSelected(0);
		this.layout(this.game.app.screen.width, this.game.app.screen.height);
	}

	private highlightSelected(index: number): void {
		this.mapButtons.forEach((btn, i) => btn.setActive(i === index));
	}

	private setMapSource(source: "official" | "custom"): void {
		this.mapSource = source;
		this.officialBtn.setActive(source === "official");
		this.customBtn.setActive(source === "custom");
		this.rebuildMapList();
	}

	private buildUI(): void {
		this.view.addChild(this.content);

		this.title = new Text({
			text: "Select Mission",
			style: { fill: 0xffffff, fontSize: 32, fontWeight: "bold" },
		});
		this.content.addChild(this.title);

		this.mapLabel = new Text({
			text: "",
			style: { fill: 0x88ccff, fontSize: 20 },
		});
		this.content.addChild(this.mapLabel);

		this.officialBtn = new Button({
			text: "Official",
			width: 130,
			height: 36,
			fontSize: 14,
			onClick: () => this.setMapSource("official"),
		});
		this.customBtn = new Button({
			text: "Custom",
			width: 130,
			height: 36,
			fontSize: 14,
			onClick: () => this.setMapSource("custom"),
		});
		this.content.addChild(this.officialBtn.view);
		this.content.addChild(this.customBtn.view);
		this.officialBtn.setActive(true);

		this.fogToggleBtn = new Button({
			text: "Fog of War: ON",
			width: 220,
			height: 44,
			fontSize: 16,
			onClick: () => this.toggleFogOfWar(),
		});
		this.content.addChild(this.fogToggleBtn.view);

		this.startBtn = new Button({
			text: "Start Mission",
			width: 200,
			height: 52,
			fontSize: 18,
			bgColor: 0x1b5e20,
			activeColor: 0x2e7d32,
			onClick: () => this.onStart(),
		});
		this.content.addChild(this.startBtn.view);

		this.backBtn = new Button({
			text: "Back",
			width: 140,
			height: 44,
			fontSize: 16,
			onClick: () => {
				void this.game.sceneManager.changeScene(new LobbyScene(this.game));
			},
		});
		this.content.addChild(this.backBtn.view);

		this.rebuildMapList();
	}

	private toggleFogOfWar(): void {
		this.fogOfWarEnabled = !this.fogOfWarEnabled;
		this.fogToggleBtn.setText(
			`Fog of War: ${this.fogOfWarEnabled ? "ON" : "OFF"}`,
		);
	}

	private onStart(): void {
		if (this.selectedMap.type === "custom" && !this.selectedMap.id) return;
		this.game.session.missionParams = {
			fogOfWarEnabled: this.fogOfWarEnabled,
			selectedMap: this.selectedMap,
		};
		void this.game.overlays.show(new LoadingOverlay(this.game));
	}

	private layout(width: number, height: number): void {
		const cx = this.DESIGN_WIDTH / 2;

		this.title.x = cx - this.title.width / 2;
		this.title.y = 24;

		this.officialBtn.view.x = cx - 135;
		this.officialBtn.view.y = 72;
		this.customBtn.view.x = cx + 5;
		this.customBtn.view.y = 72;

		this.mapLabel.x = cx - this.mapLabel.width / 2;
		this.mapLabel.y = 118;

		this.mapButtons.forEach((btn, i) => {
			btn.view.x = cx - 130;
			btn.view.y = 150 + i * 42;
		});

		const listBottom = 150 + this.mapButtons.length * 42;
		const controlsY = Math.max(listBottom + 16, 260);

		this.fogToggleBtn.view.x = cx - 110;
		this.fogToggleBtn.view.y = controlsY;
		this.startBtn.view.x = cx - 100;
		this.startBtn.view.y = controlsY + 56;
		this.backBtn.view.x = cx - 70;
		this.backBtn.view.y = controlsY + 118;

		const scale = computeFitScale(
			width,
			height,
			this.DESIGN_WIDTH,
			this.DESIGN_HEIGHT,
		);
		this.content.scale.set(scale);
		this.content.x = (width - this.DESIGN_WIDTH * scale) / 2;
		this.content.y = (height - this.DESIGN_HEIGHT * scale) / 2;
	}
}
