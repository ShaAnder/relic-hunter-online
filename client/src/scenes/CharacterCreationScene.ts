import { Container, Graphics, Text } from "pixi.js";
import type { Scene } from "../core/Scene";
import type { Game } from "../core/Game";
import { Button } from "../ui/generics/Button";
import {
	type CharacterClass,
	type StatAllocation,
	CHAR_POINT_BUDGET,
	STAT_POINT_COST,
	totalPointsSpent,
	computeCharacterStats,
	createCharacter,
} from "@relic-hunter/shared";
import { LocalCharacterRepo } from "../core/CharacterRepo";
import { LobbyScene } from "./LobbyScene";

const CLASSES: CharacterClass[] = [
	"tank",
	"brawler",
	"hunter",
	"scout",
	"mage",
	"summoner",
];

const STAT_KEYS: (keyof StatAllocation)[] = [
	"movement",
	"attack",
	"defense",
	"hp",
];

const MODEL_COUNT = 6;

/**
 * Character creation screen.
 * Left: silhouette + class select (class will later drive model choice).
 * Right: 12-point allocation with live final stats.
 * Confirm writes through CharacterRepository and GameSession → Lobby.
 */
export class CharacterCreationScene implements Scene {
	readonly view = new Container();

	private readonly repo = new LocalCharacterRepo();

	// ---------- State ----------
	private selectedClass: CharacterClass = "brawler";
	private modelIndex = 0;
	private allocation: StatAllocation = {
		movement: 0,
		attack: 0,
		defense: 0,
		hp: 0,
	};
	private name = "Hunter";

	// ---------- Visual roots ----------
	private modelContainer = new Container();
	private modelGraphics = new Graphics();
	private leftArrow!: Button;
	private rightArrow!: Button;
	private classButtons: Button[] = [];
	private statRows: {
		key: keyof StatAllocation;
		label: Text;
		valueText: Text;
		finalText: Text;
		minus: Button;
		plus: Button;
	}[] = [];
	private pointsRemainingText!: Text;
	private confirmBtn!: Button;
	private nameInput: HTMLInputElement | null = null;

	constructor(private game: Game) {
		this.view.addChild(this.modelContainer);
		this.modelContainer.addChild(this.modelGraphics);
	}

	onEnter(): void {
		this.buildUI();
		this.refreshAll();
		this.createNameInput();
	}

	onExit(): void {
		this.destroyNameInput();
	}

	update(_deltaTime: number): void {}

	onResize(width: number, height: number): void {
		this.layout(width, height);
		this.positionNameInput();
	}

	// ---------- Construction ----------

	private buildUI(): void {
		const w = this.game.app.screen.width;
		const h = this.game.app.screen.height;

		// Model arrows
		this.leftArrow = new Button({
			text: "◀",
			width: 48,
			height: 48,
			fontSize: 22,
			onClick: () => this.cycleModel(-1),
		});
		this.rightArrow = new Button({
			text: "▶",
			width: 48,
			height: 48,
			fontSize: 22,
			onClick: () => this.cycleModel(1),
		});
		this.view.addChild(this.leftArrow.view);
		this.view.addChild(this.rightArrow.view);

		// Class buttons (same side as silhouette)
		for (const cls of CLASSES) {
			const btn = new Button({
				text: cls.charAt(0).toUpperCase() + cls.slice(1),
				width: 100,
				height: 36,
				fontSize: 14,
				onClick: () => {
					this.selectedClass = cls;
					this.refreshAll();
				},
			});
			this.classButtons.push(btn);
			this.view.addChild(btn.view);
		}

		// Points remaining
		this.pointsRemainingText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 18, fontWeight: "bold" },
		});
		this.view.addChild(this.pointsRemainingText);

		// Stat rows
		for (const key of STAT_KEYS) {
			const label = new Text({
				text: this.statLabel(key),
				style: { fill: 0xcccccc, fontSize: 16 },
			});
			const valueText = new Text({
				text: "0",
				style: { fill: 0xffffff, fontSize: 16, fontWeight: "bold" },
			});
			const finalText = new Text({
				text: "",
				style: { fill: 0x88ccff, fontSize: 14 },
			});
			const minus = new Button({
				text: "−",
				width: 36,
				height: 32,
				fontSize: 20,
				onClick: () => this.adjustStat(key, -1),
			});
			const plus = new Button({
				text: "+",
				width: 36,
				height: 32,
				fontSize: 20,
				onClick: () => this.adjustStat(key, 1),
			});

			this.view.addChild(label);
			this.view.addChild(valueText);
			this.view.addChild(finalText);
			this.view.addChild(minus.view);
			this.view.addChild(plus.view);

			this.statRows.push({ key, label, valueText, finalText, minus, plus });
		}

		// Confirm
		this.confirmBtn = new Button({
			text: "Confirm",
			width: 160,
			height: 48,
			fontSize: 18,
			bgColor: 0x2e7d32,
			activeColor: 0x43a047,
			onClick: () => this.onConfirm(),
		});
		this.view.addChild(this.confirmBtn.view);

		this.layout(w, h);
	}

	private layout(width: number, height: number): void {
		// ===== LEFT SIDE: silhouette + class select =====
		const leftCenterX = width * 0.26;
		const modelY = height * 0.32;

		this.modelContainer.x = leftCenterX;
		this.modelContainer.y = modelY;

		this.leftArrow.view.x = leftCenterX - 120;
		this.leftArrow.view.y = modelY - 24;
		this.rightArrow.view.x = leftCenterX + 72;
		this.rightArrow.view.y = modelY - 24;

		// Class buttons under the silhouette (2×3 grid)
		const classStartY = modelY + 90;
		this.classButtons.forEach((btn, i) => {
			btn.view.x = leftCenterX - 160 + (i % 3) * 110;
			btn.view.y = classStartY + Math.floor(i / 3) * 44;
		});

		// ===== RIGHT SIDE: name, points, stats, confirm =====
		const panelX = width * 0.55;
		let y = height * 0.18;

		// Name input is positioned separately via HTML overlay
		y += 50;

		this.pointsRemainingText.x = panelX;
		this.pointsRemainingText.y = y;
		y += 40;

		for (const row of this.statRows) {
			row.label.x = panelX;
			row.label.y = y + 6;

			row.minus.view.x = panelX + 110;
			row.minus.view.y = y;

			row.valueText.x = panelX + 160;
			row.valueText.y = y + 6;

			row.plus.view.x = panelX + 200;
			row.plus.view.y = y;

			row.finalText.x = panelX + 260;
			row.finalText.y = y + 6;

			y += 48;
		}

		this.confirmBtn.view.x = panelX;
		this.confirmBtn.view.y = y + 24;
	}

	// ---------- Model silhouettes ----------

	private cycleModel(dir: number): void {
		this.modelIndex = (this.modelIndex + dir + MODEL_COUNT) % MODEL_COUNT;
		this.drawModel();
	}

	private drawModel(): void {
		const g = this.modelGraphics;
		g.clear();

		const color = 0xe74c3c;
		const s = 48;

		switch (this.modelIndex) {
			case 0: // Circle
				g.circle(0, 0, s);
				g.fill(color);
				g.circle(-s * 0.3, -s * 0.35, s * 0.35);
				g.fill({ color: 0xffffff, alpha: 0.35 });
				break;
			case 1: // Square
				g.roundRect(-s, -s, s * 2, s * 2, 8);
				g.fill(color);
				break;
			case 2: // Triangle
				g.moveTo(0, -s);
				g.lineTo(s, s);
				g.lineTo(-s, s);
				g.closePath();
				g.fill(color);
				break;
			case 3: // Diamond
				g.moveTo(0, -s);
				g.lineTo(s, 0);
				g.lineTo(0, s);
				g.lineTo(-s, 0);
				g.closePath();
				g.fill(color);
				break;
			case 4: // Hexagon
				for (let i = 0; i < 6; i++) {
					const a = (Math.PI / 3) * i - Math.PI / 6;
					const x = Math.cos(a) * s;
					const y = Math.sin(a) * s;
					if (i === 0) g.moveTo(x, y);
					else g.lineTo(x, y);
				}
				g.closePath();
				g.fill(color);
				break;
			case 5: // Cross
				g.rect(-s * 0.35, -s, s * 0.7, s * 2);
				g.fill(color);
				g.rect(-s, -s * 0.35, s * 2, s * 0.7);
				g.fill(color);
				break;
		}
	}

	// ---------- Stats ----------

	private adjustStat(key: keyof StatAllocation, delta: number): void {
		const next = { ...this.allocation };
		next[key] = Math.max(0, next[key] + delta);
		if (totalPointsSpent(next) > CHAR_POINT_BUDGET) return;
		this.allocation = next;
		this.refreshAll();
	}

	private remainingPoints(): number {
		return CHAR_POINT_BUDGET - totalPointsSpent(this.allocation);
	}

	private refreshAll(): void {
		this.drawModel();

		this.classButtons.forEach((btn, i) => {
			btn.setActive(CLASSES[i] === this.selectedClass);
		});

		const remaining = this.remainingPoints();
		this.pointsRemainingText.text = `Points remaining: ${remaining} / ${CHAR_POINT_BUDGET}`;

		const finals = computeCharacterStats(this.selectedClass, this.allocation);

		for (const row of this.statRows) {
			const alloc = this.allocation[row.key];
			row.valueText.text = String(alloc);

			const finalVal =
				row.key === "hp"
					? finals.maxHp
					: row.key === "movement"
						? finals.movement
						: row.key === "attack"
							? finals.attack
							: finals.defense;

			row.finalText.text = `→ ${finalVal}`;

			const cost = STAT_POINT_COST[row.key];
			row.plus.setEnabled(remaining >= cost);
			row.minus.setEnabled(alloc > 0);
		}
	}

	private statLabel(key: keyof StatAllocation): string {
		switch (key) {
			case "movement":
				return "Move";
			case "attack":
				return "Attack";
			case "defense":
				return "Defense";
			case "hp":
				return "HP (+3)";
		}
	}

	// ---------- Name input (HTML overlay) ----------

	private createNameInput(): void {
		this.destroyNameInput();
		const input = document.createElement("input");
		input.type = "text";
		input.value = this.name;
		input.maxLength = 16;
		input.placeholder = "Name";
		input.style.cssText = `
			position: absolute;
			z-index: 10;
			font-size: 16px;
			padding: 6px 10px;
			border-radius: 6px;
			border: 2px solid #555;
			background: #1a1a1a;
			color: #fff;
			outline: none;
			width: 180px;
		`;
		input.addEventListener("input", () => {
			this.name = input.value.trim() || "Hunter";
		});
		document.body.appendChild(input);
		this.nameInput = input;
		this.positionNameInput();
	}

	private positionNameInput(): void {
		if (!this.nameInput) return;
		const canvas = this.game.app.canvas;
		const rect = canvas.getBoundingClientRect();
		const panelX = this.game.app.screen.width * 0.55;
		const y = this.game.app.screen.height * 0.12;
		this.nameInput.style.left = `${rect.left + panelX}px`;
		this.nameInput.style.top = `${rect.top + y}px`;
	}

	private destroyNameInput(): void {
		if (this.nameInput) {
			this.nameInput.remove();
			this.nameInput = null;
		}
	}

	// ---------- Confirm ----------

	private onConfirm(): void {
		const character = createCharacter(
			this.name,
			this.selectedClass,
			this.allocation,
			this.modelIndex,
		);
		this.repo.save(character);
		this.game.session.character = character;
		void this.game.sceneManager.changeScene(new LobbyScene(this.game));
	}
}
