import { Container, Text } from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import { Button } from "@/ui/generics/Button";
import { computeFitScale } from "@/math/fitScale";
import { LocalCharacterRepo } from "@/core/entities/CharacterRepo";
import type { CharacterData } from "@relic-hunter/shared";
import { LobbyScene } from "./LobbyScene";
import { MainMenuScene } from "./MainMenuScene";
import { CharacterCreationScene } from "./CharacterCreationScene";

/**
 * Lists every saved hunter from CharacterRepository.
 * Selecting one writes it into GameSession and goes to Lobby. Each row
 * also has a delete button, backed by CharacterRepo's existing delete().
 */
export class LoadGameScene implements Scene {
	readonly view = new Container();
	private content = new Container();

	private readonly repo = new LocalCharacterRepo();
	private title!: Text;
	private emptyText!: Text;
	private charButtons: Button[] = [];
	private deleteButtons: Button[] = [];
	private backBtn!: Button;
	private createBtn!: Button;

	private readonly DESIGN_WIDTH = 700;
	private readonly DESIGN_HEIGHT = 720;

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

	private buildUI(): void {
		// buildUI can now be called more than once (delete triggers a
		// rebuild) — clear everything first so children don't double up.
		this.content.removeChildren();
		this.charButtons = [];
		this.deleteButtons = [];
		this.view.addChild(this.content);

		this.title = new Text({
			text: "Load Character",
			style: { fill: 0xffffff, fontSize: 32, fontWeight: "bold" },
		});
		this.content.addChild(this.title);

		const characters = this.repo.loadAll();

		this.emptyText = new Text({
			text: characters.length === 0 ? "No saved hunters yet." : "",
			style: { fill: 0xaaaaaa, fontSize: 18 },
		});
		this.content.addChild(this.emptyText);

		for (const char of characters) {
			const label = `${char.name}  ·  ${this.capitalize(char.characterClass)}  ·  HP ${char.stats.maxHp}`;
			const btn = new Button({
				text: label,
				width: 420,
				height: 48,
				fontSize: 16,
				onClick: () => this.selectCharacter(char),
			});
			this.charButtons.push(btn);
			this.content.addChild(btn.view);

			const deleteBtn = new Button({
				text: "✕",
				width: 40,
				height: 48,
				fontSize: 16,
				onClick: () => this.deleteCharacter(char.id),
			});
			this.deleteButtons.push(deleteBtn);
			this.content.addChild(deleteBtn.view);
		}

		this.createBtn = new Button({
			text: "Create New Instead",
			width: 220,
			height: 44,
			fontSize: 16,
			onClick: () => {
				void this.game.sceneManager.changeScene(
					new CharacterCreationScene(this.game),
				);
			},
		});
		this.content.addChild(this.createBtn.view);

		this.backBtn = new Button({
			text: "Back",
			width: 140,
			height: 44,
			fontSize: 16,
			onClick: () => {
				void this.game.sceneManager.changeScene(new MainMenuScene(this.game));
			},
		});
		this.content.addChild(this.backBtn.view);
	}

	private selectCharacter(char: CharacterData): void {
		this.game.session.character = char;
		void this.game.sceneManager.changeScene(new LobbyScene(this.game));
	}

	private deleteCharacter(id: string): void {
		this.repo.delete(id);
		this.buildUI();
		this.layout(this.game.app.screen.width, this.game.app.screen.height);
	}

	private layout(width: number, height: number): void {
		this.title.x = this.DESIGN_WIDTH / 2 - this.title.width / 2;
		this.title.y = 50;

		this.emptyText.x = this.DESIGN_WIDTH / 2 - this.emptyText.width / 2;
		this.emptyText.y = 140;

		let y = 140;
		for (let i = 0; i < this.charButtons.length; i++) {
			this.charButtons[i].view.x = this.DESIGN_WIDTH / 2 - 210;
			this.charButtons[i].view.y = y;
			this.deleteButtons[i].view.x = this.DESIGN_WIDTH / 2 + 220;
			this.deleteButtons[i].view.y = y;
			y += 60;
		}

		this.createBtn.view.x = this.DESIGN_WIDTH / 2 - 110;
		this.createBtn.view.y = this.DESIGN_HEIGHT - 120;

		this.backBtn.view.x = this.DESIGN_WIDTH / 2 - 70;
		this.backBtn.view.y = this.DESIGN_HEIGHT - 60;

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

	private capitalize(s: string): string {
		return s.charAt(0).toUpperCase() + s.slice(1);
	}
}
