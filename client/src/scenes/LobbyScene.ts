import { Container, Graphics, Text } from "pixi.js";
import type { Scene } from "@/core/Scene";
import type { Game } from "@/core/Game";
import { Button } from "@/ui/generics/Button";
import { MissionSelectScene } from "./MissionSelectScene";
import { MainMenuScene } from "./MainMenuScene";

/**
 * Persistent hub between matches.
 * Shows the active hunter and the main menu options defined in
 * 10-scene-flow-design.md (Missions / Story / Shop / Collectibles / Quit).
 */
export class LobbyScene implements Scene {
	readonly view = new Container();

	private title!: Text;
	private characterPanel = new Container();
	private characterName!: Text;
	private characterMeta!: Text;
	private characterStats!: Text;
	private menuButtons: Button[] = [];
	private statusText!: Text;

	constructor(private game: Game) {}

	onEnter(): void {
		this.buildUI();
		this.refreshCharacterPanel();
		this.layout(this.game.app.screen.width, this.game.app.screen.height);
	}

	onExit(): void {
		// Buttons live on the view; SceneManager removes the whole view.
	}

	update(_deltaTime: number): void {}

	onResize(width: number, height: number): void {
		this.layout(width, height);
	}

	// ---------- Construction ----------

	private buildUI(): void {
		// Title
		this.title = new Text({
			text: "Relic Hunter Online",
			style: {
				fill: 0xffffff,
				fontSize: 36,
				fontWeight: "bold",
			},
		});
		this.view.addChild(this.title);

		// Character panel background + text
		const panelBg = new Graphics();
		panelBg.roundRect(0, 0, 320, 160, 10);
		panelBg.fill(0x2a2a2a);
		panelBg.stroke({ width: 2, color: 0x555555 });
		this.characterPanel.addChild(panelBg);

		this.characterName = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 22, fontWeight: "bold" },
		});
		this.characterName.x = 16;
		this.characterName.y = 16;
		this.characterPanel.addChild(this.characterName);

		this.characterMeta = new Text({
			text: "",
			style: { fill: 0xaaaaaa, fontSize: 16 },
		});
		this.characterMeta.x = 16;
		this.characterMeta.y = 48;
		this.characterPanel.addChild(this.characterMeta);

		this.characterStats = new Text({
			text: "",
			style: { fill: 0x88ccff, fontSize: 15 },
		});
		this.characterStats.x = 16;
		this.characterStats.y = 80;
		this.characterPanel.addChild(this.characterStats);

		this.view.addChild(this.characterPanel);

		// Menu buttons
		const menuItems: {
			label: string;
			action: () => void;
			primary?: boolean;
		}[] = [
			{
				label: "Missions",
				primary: true,
				action: () => this.onMissions(),
			},
			{
				label: "Story Mode",
				action: () => this.showComingSoon("Story Mode"),
			},
			{
				label: "Shop",
				action: () => this.showComingSoon("Shop"),
			},
			{
				label: "Collectibles",
				action: () => this.showComingSoon("Collectibles"),
			},
			{
				label: "Quit",
				action: () => this.onQuit(),
			},
		];

		for (const item of menuItems) {
			const btn = new Button({
				text: item.label,
				width: 220,
				height: 48,
				fontSize: 18,
				bgColor: item.primary ? 0x1b5e20 : 0x2a2a2a,
				activeColor: item.primary ? 0x2e7d32 : 0x4a9eff,
				onClick: item.action,
			});
			this.menuButtons.push(btn);
			this.view.addChild(btn.view);
		}

		// Status / feedback line
		this.statusText = new Text({
			text: "",
			style: { fill: 0xffcc66, fontSize: 16 },
		});
		this.view.addChild(this.statusText);
	}

	private layout(width: number, height: number): void {
		this.title.x = width / 2 - this.title.width / 2;
		this.title.y = 40;

		// Character panel — left side
		this.characterPanel.x = width * 0.12;
		this.characterPanel.y = height * 0.28;

		// Menu — right of character panel
		const menuX = width * 0.55;
		let menuY = height * 0.26;
		for (const btn of this.menuButtons) {
			btn.view.x = menuX;
			btn.view.y = menuY;
			menuY += 60;
		}

		this.statusText.x = width / 2 - this.statusText.width / 2;
		this.statusText.y = height - 60;
	}

	// ---------- Character panel ----------

	private refreshCharacterPanel(): void {
		const char = this.game.session.character;

		if (!char) {
			this.characterName.text = "No hunter selected";
			this.characterMeta.text = "Create or load a character first";
			this.characterStats.text = "";
			return;
		}

		this.characterName.text = char.name;
		this.characterMeta.text = `${this.capitalize(char.characterClass)}  •  Model ${char.modelIndex + 1}`;
		this.characterStats.text =
			`Move ${char.stats.movement}   Atk ${char.stats.attack}   ` +
			`Def ${char.stats.defense}   HP ${char.stats.maxHp}   AP ${char.stats.ap}`;
	}

	private capitalize(s: string): string {
		return s.charAt(0).toUpperCase() + s.slice(1);
	}

	// ---------- Actions ----------

	private onMissions(): void {
		void this.game.sceneManager.changeScene(new MissionSelectScene(this.game));
	}

	private showComingSoon(feature: string): void {
		this.statusText.text = `${feature} — Coming Soon`;
		this.statusText.x =
			this.game.app.screen.width / 2 - this.statusText.width / 2;
	}

	private onQuit(): void {
		void this.game.sceneManager.changeScene(new MainMenuScene(this.game));
	}
}
