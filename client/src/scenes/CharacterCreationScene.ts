import { Container, Graphics, Text } from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import { Button } from "@/ui/generics/Button";
import {
	type CharacterClass,
	type StatAllocation,
	CHAR_POINT_BUDGET,
	costOfNextPoint,
	totalPointsSpent,
	computeCharacterStats,
	createCharacter,
	ALL_CLASSES as CLASSES,
} from "@relic-hunter/shared";
import { LocalCharacterRepo } from "@/core/entities/CharacterRepo";
import { LobbyScene } from "./LobbyScene";
import { MainMenuScene } from "./MainMenuScene";

/** Flavor-only for now — describes each class's intended identity, no underlying system implemented yet. */
const CLASS_FLAVOR: Record<CharacterClass, string> = {
	tank: "Takes half damage from ranged attacks.",
	brawler: "Projects a powerful Zone of Control.",
	hunter: "Strikes true from range with unmatched precision.",
	scout: "Can detect and disarm nearby traps.",
	mage: "Casts spells that arc over obstacles and allies.",
	summoner: "Can summon a monster to fight at their side.",
};

/** Short bullet-style rundown of why a player might pick each class — separate from the one-line mechanical flavor above. */
const CLASS_PURPOSE: Record<CharacterClass, string[]> = {
	tank: [
		"Absorbs hits meant for your team",
		"Excels at holding chokepoints and doorways",
		"Thrives against ranged-heavy enemies",
	],
	brawler: [
		"Punishes anyone who gets close",
		"Strong at controlling the space around itself",
		"Rewards aggressive, front-line play",
	],
	hunter: [
		"Deals consistent damage from a safe distance",
		"Rewards precise positioning and line-of-sight play",
		"Struggles up close — plan your angles",
	],
	scout: [
		"Reveals hidden dangers before they hurt you",
		"Great for exploring safely and efficiently",
		"A strong pick for cautious, methodical players",
	],
	mage: [
		"Can hit targets other classes can't reach",
		"Flexible positioning, less reliant on straight lines",
		"Rewards players who like creative angles",
	],
	summoner: [
		"Never fights alone",
		"Adds an extra body to soak hits or flank",
		"Great for players who like commanding multiple units",
	],
};

const STAT_KEYS: (keyof StatAllocation)[] = [
	"movement",
	"attack",
	"defense",
	"hp",
];

// One model shape per class now — index matches CLASSES directly, no
// independent model-cycling state anymore.
const MODEL_COUNT = CLASSES.length;

/**
 * Character creation screen.
 * Left: silhouette + class name + flavor, arrows cycle class (model is
 * tied 1:1 to class, not independently selectable anymore).
 * Right: 12-point allocation table with escalating costs and live totals.
 * Confirm writes through CharacterRepository and GameSession → Lobby.
 */
export class CharacterCreationScene implements Scene {
	readonly view = new Container();

	private readonly repo = new LocalCharacterRepo();

	// ---------- State ----------
	private selectedClass: CharacterClass = "brawler";
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
	private classNameText!: Text;
	private classFlavorText!: Text;
	private classPurposeTexts: Text[] = [];
	private leftArrow!: Button;
	private rightArrow!: Button;

	private tableHeaders: Text[] = [];
	private statRows: {
		key: keyof StatAllocation;
		label: Text;
		minus: Button;
		valueText: Text;
		plus: Button;
		totalText: Text;
		nextCostText: Text;
	}[] = [];

	private pointsRemainingText!: Text;
	private confirmBtn!: Button;
	private backBtn!: Button;
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

		// Class/model arrows — now cycle class directly, moved further out
		// to leave room for the name + flavor text stacked beneath the icon.
		this.leftArrow = new Button({
			text: "◀",
			width: 48,
			height: 48,
			fontSize: 22,
			onClick: () => this.cycleClass(-1),
		});
		this.rightArrow = new Button({
			text: "▶",
			width: 48,
			height: 48,
			fontSize: 22,
			onClick: () => this.cycleClass(1),
		});
		this.view.addChild(this.leftArrow.view);
		this.view.addChild(this.rightArrow.view);

		this.classNameText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 20, fontWeight: "bold" },
		});
		this.classNameText.anchor.set(0.5, 0);
		this.view.addChild(this.classNameText);

		this.classFlavorText = new Text({
			text: "",
			style: {
				fill: 0x88ccff,
				fontSize: 13,
				wordWrap: true,
				wordWrapWidth: 260,
				align: "center",
			},
		});
		this.classFlavorText.anchor.set(0.5, 0);
		this.view.addChild(this.classFlavorText);

		// One Text per bullet line, not one Text with embedded newlines —
		// more reliable than depending on Pixi's wordWrap to respect

		// same pattern LogPanel's rows already use successfully.
		for (let i = 0; i < 3; i++) {
			const line = new Text({
				text: "",
				style: {
					fill: 0xaaaaaa,
					fontSize: 12,
					wordWrap: true,
					wordWrapWidth: 260,
				},
			});
			line.anchor.set(0.5, 0);
			this.classPurposeTexts.push(line);
			this.view.addChild(line);
		}

		// Points remaining
		this.pointsRemainingText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 18, fontWeight: "bold" },
		});
		this.view.addChild(this.pointsRemainingText);

		// Table headers — no gridlines, just aligned column labels
		const headerLabels = ["Stat", "", "Value", "", "Total", "Next Cost"];
		for (const text of headerLabels) {
			const t = new Text({
				text,
				style: { fill: 0x888888, fontSize: 12, fontWeight: "bold" },
			});
			this.tableHeaders.push(t);
			this.view.addChild(t);
		}

		// Stat rows
		for (const key of STAT_KEYS) {
			const label = new Text({
				text: this.statLabel(key),
				style: { fill: 0xcccccc, fontSize: 16 },
			});

			const minus = new Button({
				text: "▼",
				width: 32,
				height: 28,
				fontSize: 14,
				onClick: () => this.adjustStat(key, -1),
			});

			const valueText = new Text({
				text: "0",
				style: { fill: 0xffffff, fontSize: 16, fontWeight: "bold" },
			});
			valueText.anchor.set(0.5, 0);

			const plus = new Button({
				text: "▲",
				width: 32,
				height: 28,
				fontSize: 14,
				onClick: () => this.adjustStat(key, 1),
			});

			const totalText = new Text({
				text: "",
				style: { fill: 0x88ccff, fontSize: 15, fontWeight: "bold" },
			});
			totalText.anchor.set(0.5, 0);

			const nextCostText = new Text({
				text: "",
				style: { fill: 0xaaaaaa, fontSize: 13 },
			});
			nextCostText.anchor.set(0.5, 0);

			this.view.addChild(label);
			this.view.addChild(minus.view);
			this.view.addChild(valueText);
			this.view.addChild(plus.view);
			this.view.addChild(totalText);
			this.view.addChild(nextCostText);

			this.statRows.push({
				key,
				label,
				minus,
				valueText,
				plus,
				totalText,
				nextCostText,
			});
		}

		// Back to main menu
		this.backBtn = new Button({
			text: "Back",
			width: 120,
			height: 40,
			fontSize: 15,
			onClick: () => {
				void this.game.sceneManager.changeScene(new MainMenuScene(this.game));
			},
		});
		this.view.addChild(this.backBtn.view);

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
		// ===== RIGHT SIDE computed FIRST — the left side anchors to its =====
		// ===== real Attack-row position, not an independent estimate.  =====
		const panelX = width * 0.55;
		let y = height * 0.18;

		// Name input is positioned separately via HTML overlay
		y += 50;

		this.pointsRemainingText.x = panelX;
		this.pointsRemainingText.y = y;
		y += 36;

		// Column x-offsets, shared by both the header row and every stat row
		const COL_LABEL = 0;
		const COL_MINUS = 130;
		const COL_VALUE = 180;
		const COL_PLUS = 220;
		const COL_TOTAL = 285;
		const COL_NEXT_COST = 360;

		const headerOffsets = [
			COL_LABEL,
			COL_MINUS,
			COL_VALUE,
			COL_PLUS,
			COL_TOTAL,
			COL_NEXT_COST,
		];
		this.tableHeaders.forEach((header, i) => {
			header.x = panelX + headerOffsets[i];
			header.y = y;
		});
		y += 24;

		let attackRowY = y; // captured below, once we reach the actual Attack row

		for (const row of this.statRows) {
			row.label.x = panelX + COL_LABEL;
			row.label.y = y + 6;

			row.minus.view.x = panelX + COL_MINUS;
			row.minus.view.y = y;

			row.valueText.x = panelX + COL_VALUE;
			row.valueText.y = y + 4;

			row.plus.view.x = panelX + COL_PLUS;
			row.plus.view.y = y;

			row.totalText.x = panelX + COL_TOTAL;
			row.totalText.y = y + 4;

			row.nextCostText.x = panelX + COL_NEXT_COST;
			row.nextCostText.y = y + 4;

			if (row.key === "attack") attackRowY = y;

			y += 44;
		}

		this.confirmBtn.view.x = panelX;
		this.confirmBtn.view.y = y + 24;

		this.backBtn.view.x = 24;
		this.backBtn.view.y = 24;

		// ===== LEFT SIDE: silhouette + class name + flavor + purpose =====
		// Icon is vertically anchored to the real Attack row's Y, not an
		// estimated block-center — matches wherever the table actually is.
		const leftCenterX = width * 0.26;
		const PICKER_CONTAINER_HALF_WIDTH = 170;
		const modelY = attackRowY;

		this.modelContainer.x = leftCenterX;
		this.modelContainer.y = modelY;

		this.leftArrow.view.x = leftCenterX - PICKER_CONTAINER_HALF_WIDTH - 48;
		this.leftArrow.view.y = modelY - 24;
		this.rightArrow.view.x = leftCenterX + PICKER_CONTAINER_HALF_WIDTH;
		this.rightArrow.view.y = modelY - 24;

		this.classNameText.x = leftCenterX;
		this.classNameText.y = modelY + 70;

		this.classFlavorText.x = leftCenterX;
		this.classFlavorText.y = modelY + 100;

		this.classPurposeTexts.forEach((line, i) => {
			line.x = leftCenterX;
			line.y = modelY + 140 + i * 18;
		});
	}

	// ---------- Model silhouettes ----------

	/** Cycles class directly — model is derived 1:1 from class index now, no separate model state. */
	private cycleClass(dir: number): void {
		const currentIndex = CLASSES.indexOf(this.selectedClass);
		const nextIndex = (currentIndex + dir + MODEL_COUNT) % MODEL_COUNT;
		this.selectedClass = CLASSES[nextIndex];
		this.refreshAll();
	}

	private drawModel(): void {
		const g = this.modelGraphics;
		g.clear();

		const color = 0xe74c3c;
		const s = 48;
		const modelIndex = CLASSES.indexOf(this.selectedClass);

		switch (modelIndex) {
			case 0: // Tank — Circle
				g.circle(0, 0, s);
				g.fill(color);
				g.circle(-s * 0.3, -s * 0.35, s * 0.35);
				g.fill({ color: 0xffffff, alpha: 0.35 });
				break;
			case 1: // Brawler — Square
				g.roundRect(-s, -s, s * 2, s * 2, 8);
				g.fill(color);
				break;
			case 2: // Hunter — Triangle
				g.moveTo(0, -s);
				g.lineTo(s, s);
				g.lineTo(-s, s);
				g.closePath();
				g.fill(color);
				break;
			case 3: // Scout — Diamond
				g.moveTo(0, -s);
				g.lineTo(s, 0);
				g.lineTo(0, s);
				g.lineTo(-s, 0);
				g.closePath();
				g.fill(color);
				break;
			case 4: // Mage — Hexagon
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
			case 5: // Summoner — Cross
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

		this.classNameText.text =
			this.selectedClass.charAt(0).toUpperCase() + this.selectedClass.slice(1);
		this.classFlavorText.text = CLASS_FLAVOR[this.selectedClass];
		const purposeLines = CLASS_PURPOSE[this.selectedClass];
		this.classPurposeTexts.forEach((textObj, i) => {
			textObj.text = purposeLines[i] ? `• ${purposeLines[i]}` : "";
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

			row.totalText.text = String(finalVal);

			const nextCost = costOfNextPoint(row.key, alloc);
			row.nextCostText.text = `${nextCost} pt${nextCost === 1 ? "" : "s"}`;

			row.plus.setEnabled(remaining >= nextCost);
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
			CLASSES.indexOf(this.selectedClass),
		);
		this.repo.save(character);
		this.game.session.character = character;
		void this.game.sceneManager.changeScene(new LobbyScene(this.game));
	}
}
