import { Container, Text } from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import { Button } from "@/ui/generics/Button";
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

	private readonly repo = new LocalCharacterRepo();
	private title!: Text;
	private emptyText!: Text;
	private charButtons: Button[] = [];
	private deleteButtons: Button[] = [];
	private backBtn!: Button;
	private createBtn!: Button;

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
		this.view.removeChildren();
		this.charButtons = [];
		this.deleteButtons = [];

		this.title = new Text({
			text: "Load Character",
			style: { fill: 0xffffff, fontSize: 32, fontWeight: "bold" },
		});
		this.view.addChild(this.title);

		const characters = this.repo.loadAll();

		this.emptyText = new Text({
			text: characters.length === 0 ? "No saved hunters yet." : "",
			style: { fill: 0xaaaaaa, fontSize: 18 },
		});
		this.view.addChild(this.emptyText);

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
			this.view.addChild(btn.view);

			const deleteBtn = new Button({
				text: "✕",
				width: 40,
				height: 48,
				fontSize: 16,
				onClick: () => this.deleteCharacter(char.id),
			});
			this.deleteButtons.push(deleteBtn);
			this.view.addChild(deleteBtn.view);
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
		this.view.addChild(this.createBtn.view);

		this.backBtn = new Button({
			text: "Back",
			width: 140,
			height: 44,
			fontSize: 16,
			onClick: () => {
				void this.game.sceneManager.changeScene(new MainMenuScene(this.game));
			},
		});
		this.view.addChild(this.backBtn.view);
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
		this.title.x = width / 2 - this.title.width / 2;
		this.title.y = 50;

		this.emptyText.x = width / 2 - this.emptyText.width / 2;
		this.emptyText.y = 140;

		let y = 140;
		for (let i = 0; i < this.charButtons.length; i++) {
			this.charButtons[i].view.x = width / 2 - 210;
			this.charButtons[i].view.y = y;
			this.deleteButtons[i].view.x = width / 2 + 220;
			this.deleteButtons[i].view.y = y;
			y += 60;
		}

		this.createBtn.view.x = width / 2 - 110;
		this.createBtn.view.y = height - 120;

		this.backBtn.view.x = width / 2 - 70;
		this.backBtn.view.y = height - 60;
	}

	private capitalize(s: string): string {
		return s.charAt(0).toUpperCase() + s.slice(1);
	}
}
