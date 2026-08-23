import { Container, Graphics, Text } from "pixi.js";
import type { Scene } from "@/core/scenes/Scene";
import type { Game } from "@/core/game/Game";
import { Button } from "@/ui/generics/Button";
import { computeFitScale } from "@/math/fitScale";
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

/** Flavor-only for now — describes each class's intended identity. */
const CLASS_FLAVOR: Record<CharacterClass, string> = {
	tank: "Takes half damage from ranged attacks.",
	brawler: "Projects a powerful Zone of Control.",
	hunter: "Strikes true from range with unmatched precision.",
	scout: "Can detect and disarm nearby traps.",
	mage: "Casts spells that arc over obstacles and allies.",
	summoner: "Can summon a monster to fight at their side.",
};

/** Short bullet rundown of why a player might pick each class. */
const CLASS_PURPOSE: Record<CharacterClass, string[]> = {
	tank: [
		"Absorbs hheavy hits",
		"Excels at holding ground",
		"Thrives on the front line",
	],
	brawler: [
		"Punishes gap closers",
		"Strong space controller",
		"Rewards front-line play",
	],
	hunter: [
		"Keep trap detection",
		"Rewards map awareness",
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

const MODEL_COUNT = CLASSES.length;

/** Shared width for flavor + purpose block (left-aligned lines, centered block). */
const LEFT_COPY_WIDTH = 280;

/** Gap under flavor before the first bullet, and between bullets. */
const PURPOSE_GAP_AFTER_FLAVOR = 16;
const PURPOSE_GAP_BETWEEN = 12;

/**
 * Character creation screen.
 * Left: silhouette + class name + flavor + purpose bullets.
 * Right: 12-point allocation table with escalating costs and live totals.
 * Confirm writes through CharacterRepository and GameSession → Lobby.
 * @author ShaAnder
 */
export class CharacterCreationScene implements Scene {
	readonly view = new Container();
	private content = new Container();

	private readonly repo = new LocalCharacterRepo();

	private readonly DESIGN_WIDTH = 1000;
	private readonly DESIGN_HEIGHT = 600;

	private selectedClass: CharacterClass = "brawler";
	private allocation: StatAllocation = {
		movement: 0,
		attack: 0,
		defense: 0,
		hp: 0,
	};
	private name = "Hunter";

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

	private nameInputDesignX = 0;
	private nameInputDesignY = 0;
	private currentScale = 1;

	/** Design-space X for the left column centre — used when stacking purpose lines. */
	private leftCenterX = 0;
	/** Vertical midline for arrows + centered left stack. */
	private leftMidY = 0;

	constructor(private game: Game) {
		this.content.addChild(this.modelContainer);
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

	private buildUI(): void {
		this.view.addChild(this.content);

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
		this.content.addChild(this.leftArrow.view);
		this.content.addChild(this.rightArrow.view);

		this.classNameText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 31, fontWeight: "bold" },
		});
		this.classNameText.anchor.set(0.5, 0);
		this.content.addChild(this.classNameText);

		this.classFlavorText = new Text({
			text: "",
			style: {
				fill: 0x88ccff,
				fontSize: 24,
				wordWrap: true,
				wordWrapWidth: LEFT_COPY_WIDTH,
				align: "center",
				lineHeight: 30,
			},
		});
		this.classFlavorText.anchor.set(0.5, 0);
		this.content.addChild(this.classFlavorText);

		for (let i = 0; i < 3; i++) {
			const line = new Text({
				text: "",
				style: {
					fill: 0xcccccc,
					fontSize: 24,
					wordWrap: true,
					wordWrapWidth: LEFT_COPY_WIDTH,
					align: "left",
					lineHeight: 30,
				},
			});
			line.anchor.set(0, 0);
			this.classPurposeTexts.push(line);
			this.content.addChild(line);
		}

		this.pointsRemainingText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 22, fontWeight: "bold" },
		});
		this.content.addChild(this.pointsRemainingText);

		const headerLabels = ["Stat", "", "Value", "", "Total", "Next Cost"];
		for (const text of headerLabels) {
			const t = new Text({
				text,
				style: { fill: 0x888888, fontSize: 15, fontWeight: "bold" },
			});
			this.tableHeaders.push(t);
			this.content.addChild(t);
		}

		for (const key of STAT_KEYS) {
			const label = new Text({
				text: this.statLabel(key),
				style: { fill: 0xcccccc, fontSize: 20 },
			});

			const minus = new Button({
				text: "▼",
				width: 40,
				height: 34,
				fontSize: 16,
				onClick: () => this.adjustStat(key, -1),
			});

			const valueText = new Text({
				text: "0",
				style: { fill: 0xffffff, fontSize: 20, fontWeight: "bold" },
			});
			valueText.anchor.set(0.5, 0);

			const plus = new Button({
				text: "▲",
				width: 40,
				height: 34,
				fontSize: 16,
				onClick: () => this.adjustStat(key, 1),
			});

			const totalText = new Text({
				text: "",
				style: { fill: 0x88ccff, fontSize: 18, fontWeight: "bold" },
			});
			totalText.anchor.set(0.5, 0);

			const nextCostText = new Text({
				text: "",
				style: { fill: 0xaaaaaa, fontSize: 16 },
			});
			nextCostText.anchor.set(0.5, 0);

			this.content.addChild(label);
			this.content.addChild(minus.view);
			this.content.addChild(valueText);
			this.content.addChild(plus.view);
			this.content.addChild(totalText);
			this.content.addChild(nextCostText);

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

		this.backBtn = new Button({
			text: "Back",
			width: 140,
			height: 48,
			fontSize: 18,
			onClick: () => {
				void this.game.sceneManager.changeScene(new MainMenuScene(this.game));
			},
		});
		this.content.addChild(this.backBtn.view);

		this.confirmBtn = new Button({
			text: "Confirm",
			width: 180,
			height: 56,
			fontSize: 20,
			bgColor: 0x2e7d32,
			activeColor: 0x43a047,
			onClick: () => this.onConfirm(),
		});
		this.content.addChild(this.confirmBtn.view);

		this.layout(this.game.app.screen.width, this.game.app.screen.height);
	}

	private layout(width: number, height: number): void {
		const panelX = this.DESIGN_WIDTH * 0.55;
		let y = this.DESIGN_HEIGHT * 0.18;

		y += 50;
		this.nameInputDesignX = panelX;
		this.nameInputDesignY = this.DESIGN_HEIGHT * 0.12;

		this.pointsRemainingText.x = panelX;
		this.pointsRemainingText.y = y;
		y += 42;

		const COL_LABEL = 0;
		const COL_MINUS = 140;
		const COL_VALUE = 200;
		const COL_PLUS = 250;
		const COL_TOTAL = 320;
		const COL_NEXT_COST = 400;

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

		let attackRowY = y;

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

			y += 52;
		}

		this.confirmBtn.view.x = panelX;
		this.confirmBtn.view.y = y + 28;

		this.backBtn.view.x = panelX + 200;
		this.backBtn.view.y = y + 32;

		this.leftCenterX = this.DESIGN_WIDTH * 0.26;
		const PICKER_CONTAINER_HALF_WIDTH = 170;
		// Arrows stay on the Attack-row midline — do not move with the stack
		const arrowsY = attackRowY;

		this.leftArrow.view.x = this.leftCenterX - PICKER_CONTAINER_HALF_WIDTH - 48;
		this.leftArrow.view.y = arrowsY - 24;
		this.rightArrow.view.x = this.leftCenterX + PICKER_CONTAINER_HALF_WIDTH;
		this.rightArrow.view.y = arrowsY - 24;

		// Arrows stay on attack-row midline; stack sits ~20% of design height lower
		this.leftMidY = arrowsY + this.DESIGN_HEIGHT * 0.2;

		this.currentScale = computeFitScale(
			width,
			height,
			this.DESIGN_WIDTH,
			this.DESIGN_HEIGHT,
		);
		this.content.scale.set(this.currentScale);
		this.content.x = (width - this.DESIGN_WIDTH * this.currentScale) / 2;
		this.content.y = (height - this.DESIGN_HEIGHT * this.currentScale) / 2;

		// Icon + name + flavor + bullets centered on leftMidY (below arrows)
		this.layoutLeftStack(this.leftMidY);
	}

	/**
	 * Places silhouette, name, flavor, and purpose as one vertical stack
	 * whose centre sits on midY. Arrows are positioned separately and
	 * stay put when copy reflows.
	 */
	private layoutLeftStack(midY: number): void {
		const MODEL_HALF = 48;
		const nameGap = 16;
		const flavorGap = 12;

		// Provisional top: model centre will be shifted after we know total height
		let modelCenterY = midY;
		this.modelContainer.x = this.leftCenterX;
		this.modelContainer.y = modelCenterY;

		this.classNameText.x = this.leftCenterX;
		this.classNameText.y = modelCenterY + MODEL_HALF + nameGap;

		this.classFlavorText.x = this.leftCenterX;
		this.classFlavorText.y =
			this.classNameText.y + this.classNameText.height + flavorGap;

		this.layoutPurposeBullets();

		const stackTop = modelCenterY - MODEL_HALF;
		let stackBottom = this.classFlavorText.y + this.classFlavorText.height;
		for (const line of this.classPurposeTexts) {
			if (!line.visible || line.text.length === 0) continue;
			stackBottom = Math.max(stackBottom, line.y + line.height);
		}

		const stackCenter = (stackTop + stackBottom) / 2;
		const dy = midY - stackCenter;

		this.modelContainer.y += dy;
		this.classNameText.y += dy;
		this.classFlavorText.y += dy;
		for (const line of this.classPurposeTexts) {
			line.y += dy;
		}
	}

	/**
	 * Stack purpose bullets from real text heights so wrapped lines never
	 * overlap. Left edges align; the block is centered under the silhouette.
	 */
	private layoutPurposeBullets(): void {
		const purposeLeft = this.leftCenterX - LEFT_COPY_WIDTH / 2;
		let nextY =
			this.classFlavorText.y +
			this.classFlavorText.height +
			PURPOSE_GAP_AFTER_FLAVOR;

		for (const line of this.classPurposeTexts) {
			line.x = purposeLeft;
			line.y = nextY;
			if (line.text.length === 0) {
				line.visible = false;
				continue;
			}
			line.visible = true;
			nextY += Math.max(line.height, 30) + PURPOSE_GAP_BETWEEN;
		}
	}

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
			case 0:
				g.circle(0, 0, s);
				g.fill(color);
				g.circle(-s * 0.3, -s * 0.35, s * 0.35);
				g.fill({ color: 0xffffff, alpha: 0.35 });
				break;
			case 1:
				g.roundRect(-s, -s, s * 2, s * 2, 8);
				g.fill(color);
				break;
			case 2:
				g.moveTo(0, -s);
				g.lineTo(s, s);
				g.lineTo(-s, s);
				g.closePath();
				g.fill(color);
				break;
			case 3:
				g.moveTo(0, -s);
				g.lineTo(s, 0);
				g.lineTo(0, s);
				g.lineTo(-s, 0);
				g.closePath();
				g.fill(color);
				break;
			case 4:
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
			case 5:
				g.rect(-s * 0.35, -s, s * 0.7, s * 2);
				g.fill(color);
				g.rect(-s, -s * 0.35, s * 2, s * 0.7);
				g.fill(color);
				break;
		}
	}

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

		// Heights are valid only after text is assigned — restack + re-center
		if (this.leftMidY !== 0) {
			this.layoutLeftStack(this.leftMidY);
		} else {
			this.layoutPurposeBullets();
		}

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
		const scaledX = this.nameInputDesignX * this.currentScale + this.content.x;
		const scaledY = this.nameInputDesignY * this.currentScale + this.content.y;
		this.nameInput.style.left = `${rect.left + scaledX}px`;
		this.nameInput.style.top = `${rect.top + scaledY}px`;
	}

	private destroyNameInput(): void {
		if (this.nameInput) {
			this.nameInput.remove();
			this.nameInput = null;
		}
	}

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
