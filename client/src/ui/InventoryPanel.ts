import { Container, Graphics, Text } from "pixi.js";
import type { ItemData } from "@relic-hunter/shared";

const GENERAL_SLOTS = 6;
const GEAR_SLOTS = 3;
const SLOT = 40;
const GAP = 10;
const PAD = 10;
const PANEL_W = PAD * 2 + GEAR_SLOTS * SLOT + (GEAR_SLOTS - 1) * GAP;
const PANEL_H = PAD * 2 + 18 + SLOT + GAP + SLOT + 50;

const ACTION_BTN_SIZE = 40;
const ACTION_ROW_GAP = 8;
const ACTION_ROW_Y_GAP = 10;
const SLIDE_EASE_MS = 90;

type ActionKey = "inspect" | "swap" | "drop";

interface ActionButton {
	key: ActionKey;
	bg: Graphics;
	icon: Graphics;
	container: Container;
	targetY: number;
	currentY: number;
}

/**
 * 9-slot icon inventory. General slots (only) are clickable — selecting
 * one shows Inspect/Swap/Drop icons below the panel and the info popup
 * to its right. Items are a fixed 6-slot array with possible nulls, NOT
 * a compacting growable array — Drop leaves a real gap at its own index.
 * @author ShaAnder
 */
export class InventoryPanel {
	readonly view = new Container();

	private bg = new Graphics();
	private titleText: Text;
	private gearSlots: Graphics[] = [];
	private generalSlots: Graphics[] = [];
	private generalHitZones: Graphics[] = [];
	private generalLabels: Text[] = [];
	private open = false;

	private currentItems: (ItemData | null)[] = new Array(GENERAL_SLOTS).fill(
		null,
	);
	private selectedIndex: number | null = null;
	private actionButtons: ActionButton[] = [];
	private readonly hiddenY = PANEL_H;
	private readonly shownY = PANEL_H + ACTION_ROW_Y_GAP;

	private inspectPopup = new Container();
	private inspectBg = new Graphics();
	private inspectIcon = new Graphics();
	private inspectName!: Text;
	private inspectDesc!: Text;

	private onDrop: ((index: number) => void) | null = null;
	private onSwapRequested: ((index: number) => void) | null = null;

	constructor() {
		this.bg.roundRect(0, 0, PANEL_W, PANEL_H, 8);
		this.bg.fill({ color: 0x1a1a1a, alpha: 0.92 });
		this.bg.stroke({ width: 1, color: 0x555555 });
		this.view.addChild(this.bg);

		this.titleText = new Text({
			text: "Inventory",
			style: { fill: 0xffffff, fontSize: 13, fontWeight: "bold" },
		});
		this.titleText.x = PAD;
		this.titleText.y = 6;
		this.view.addChild(this.titleText);

		const gearIcons = [this.drawSword, this.drawShield, this.drawRing];
		for (let i = 0; i < GEAR_SLOTS; i++) {
			const slot = new Graphics();
			slot.roundRect(0, 0, SLOT, SLOT, 4);
			slot.fill(0x222222);
			slot.stroke({ width: 1, color: 0x666666 });
			gearIcons[i].call(this, slot);
			slot.x = PAD + i * (SLOT + GAP);
			slot.y = 26;
			this.gearSlots.push(slot);
			this.view.addChild(slot);
		}

		for (let i = 0; i < GENERAL_SLOTS; i++) {
			const slot = new Graphics();
			slot.roundRect(0, 0, SLOT, SLOT, 4);
			slot.fill(0x222222);
			slot.stroke({ width: 1, color: 0x666666 });
			slot.x = PAD + (i % 3) * (SLOT + GAP);
			slot.y = 26 + SLOT + GAP + Math.floor(i / 3) * (SLOT + GAP);
			this.generalSlots.push(slot);
			this.view.addChild(slot);

			const label = new Text({
				text: "",
				style: { fill: 0xffffff, fontSize: 9 },
			});
			label.anchor.set(0.5);
			label.x = slot.x + SLOT / 2;
			label.y = slot.y + SLOT / 2;
			this.generalLabels.push(label);
			this.view.addChild(label);

			// Dedicated, static hit zone — never cleared or redrawn, so sync()
			// repainting the slot's visuals (including the item icon) can never
			// disturb its clickable area.
			const hitZone = new Graphics();
			hitZone.rect(0, 0, SLOT, SLOT);
			hitZone.fill({ color: 0xffffff, alpha: 0.001 });
			hitZone.x = slot.x;
			hitZone.y = slot.y;
			hitZone.eventMode = "static";
			hitZone.cursor = "pointer";
			hitZone.on("pointerdown", () => this.handleSlotClick(i));
			this.generalHitZones.push(hitZone);
			this.view.addChild(hitZone);
		}

		this.buildActionButtons();
		this.buildInspectPopup();

		this.view.visible = false;
	}

	/** Refresh from live items. Treats missing/undefined entries as empty slots, not a shorter array. */
	sync(items: (ItemData | null)[]): void {
		this.currentItems = items;
		const filledCount = items.filter(
			(i) => i !== null && i !== undefined,
		).length;
		this.titleText.text = `Inventory (${filledCount}/${GENERAL_SLOTS})`;

		for (let i = 0; i < GENERAL_SLOTS; i++) {
			const item = items[i] ?? null;
			const slot = this.generalSlots[i];
			slot.clear();
			slot.roundRect(0, 0, SLOT, SLOT, 4);
			slot.fill(0x222222);
			slot.stroke({
				width: 1,
				color: i === this.selectedIndex ? 0xffd700 : item ? 0xd4af37 : 0x666666,
			});
			if (item) {
				slot.circle(SLOT / 2, SLOT / 2, 12);
				slot.fill(
					item.id.includes("crown") || item.id.includes("ember")
						? 0xffd700
						: 0x88ccff,
				);
			}
			this.generalLabels[i].text = item ? item.name.slice(0, 4) : "";
		}
	}

	/** Fired when Drop is confirmed — caller owns actually nulling the real array at this index. */
	setOnDrop(handler: (index: number) => void): void {
		this.onDrop = handler;
	}

	/** Reserved for the full swap flow (pick target, hover another, confirm) — not yet wired, button stays disabled. */
	setOnSwapRequested(handler: (index: number) => void): void {
		this.onSwapRequested = handler;
	}

	update(deltaTime: number): void {
		const deltaMs = (deltaTime / 60) * 1000;
		const step = ACTION_ROW_Y_GAP * (deltaMs / SLIDE_EASE_MS);

		for (const btn of this.actionButtons) {
			if (btn.currentY === btn.targetY) continue;
			btn.currentY =
				btn.currentY < btn.targetY
					? Math.min(btn.targetY, btn.currentY + step)
					: Math.max(btn.targetY, btn.currentY - step);
			btn.container.y = btn.currentY;

			const travelled = Math.abs(btn.currentY - this.hiddenY);
			const fullTravel = Math.abs(this.shownY - this.hiddenY);
			btn.container.alpha =
				fullTravel > 0 ? Math.min(1, travelled / fullTravel) : 1;
		}
	}

	toggle(): void {
		this.open = !this.open;
		this.view.visible = this.open;
		if (!this.open) this.deselect();
	}

	close(): void {
		this.open = false;
		this.view.visible = false;
		this.deselect();
	}

	get isOpen(): boolean {
		return this.open;
	}

	layoutRightOfCharacter(
		characterX: number,
		characterY: number,
		characterWidth: number,
	): void {
		this.view.x = characterX + characterWidth + 8;
		this.view.y = characterY;
	}

	get panelWidth(): number {
		return PANEL_W;
	}

	// ---------- selection + action buttons ----------

	private handleSlotClick(index: number): void {
		if (!this.currentItems[index]) return;
		this.selectedIndex = this.selectedIndex === index ? null : index;
		this.sync(this.currentItems);
		this.updateActionButtonPositions();
		if (this.selectedIndex === null) this.inspectPopup.visible = false;
	}

	private deselect(): void {
		this.selectedIndex = null;
		this.updateActionButtonPositions();
		this.inspectPopup.visible = false;
	}

	/** Row of 3 icon buttons below the panel — hidden until a slot is selected. Swap stays disabled for now, the full pick-a-target flow isn't built yet. */
	private buildActionButtons(): void {
		const keys: ActionKey[] = ["inspect", "swap", "drop"];
		const drawIcon = {
			inspect: this.drawInspectIcon,
			swap: this.drawSwapIcon,
			drop: this.drawDropIcon,
		};

		const rowWidth = ACTION_BTN_SIZE * 3 + ACTION_ROW_GAP * 2;
		const startX = (PANEL_W - rowWidth) / 2;

		keys.forEach((key, i) => {
			const container = new Container();
			const bg = new Graphics();
			bg.roundRect(0, 0, ACTION_BTN_SIZE, ACTION_BTN_SIZE, 6);
			bg.fill(0x2a2a2a);
			bg.stroke({ width: 1, color: 0x666666 });
			bg.eventMode = "static";
			bg.cursor = "pointer";
			bg.on("pointerdown", () => this.handleActionClick(key));
			container.addChild(bg);

			const icon = new Graphics();
			drawIcon[key].call(this, icon);
			container.addChild(icon);

			container.x = startX + i * (ACTION_BTN_SIZE + ACTION_ROW_GAP);
			container.y = this.hiddenY;
			container.alpha = 0;
			this.view.addChild(container);

			this.actionButtons.push({
				key,
				bg,
				icon,
				container,
				targetY: this.hiddenY,
				currentY: this.hiddenY,
			});
		});

		// Swap permanently disabled — placeholder until the full pick-target
		// swap flow exists. Not gated on fullness yet.
		const swapBtn = this.actionButtons.find((b) => b.key === "swap")!;
		swapBtn.bg.alpha = 0.4;
		swapBtn.icon.alpha = 0.4;
		swapBtn.container.eventMode = "none";
	}

	private updateActionButtonPositions(): void {
		const shown = this.selectedIndex !== null;
		for (const btn of this.actionButtons) {
			btn.targetY = shown ? this.shownY : this.hiddenY;
		}
	}

	private handleActionClick(key: ActionKey): void {
		if (this.selectedIndex === null) return;
		const index = this.selectedIndex;
		const item = this.currentItems[index];
		if (!item) return;

		if (key === "inspect") {
			if (this.inspectPopup.visible) {
				this.inspectPopup.visible = false;
			} else {
				this.showInspectPopup(item);
			}
		} else if (key === "drop") {
			this.onDrop?.(index);
			this.deselect(); // also closes the inspect popup if it was open on this item
		} else if (key === "swap") {
			this.onSwapRequested?.(index);
		}
	}

	// ---------- inspect popup ----------

	/** Sits to the right of the panel. */
	private buildInspectPopup(): void {
		this.inspectBg.roundRect(0, 0, 200, 100, 8);
		this.inspectBg.fill({ color: 0x111111, alpha: 0.96 });
		this.inspectBg.stroke({ width: 1, color: 0x666666 });
		this.inspectPopup.addChild(this.inspectBg);

		this.inspectIcon.circle(24, 24, 14);
		this.inspectPopup.addChild(this.inspectIcon);

		this.inspectName = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 13, fontWeight: "bold" },
		});
		this.inspectName.x = 48;
		this.inspectName.y = 10;
		this.inspectPopup.addChild(this.inspectName);

		this.inspectDesc = new Text({
			text: "",
			style: {
				fill: 0xaaaaaa,
				fontSize: 10,
				wordWrap: true,
				wordWrapWidth: 180,
			},
		});
		this.inspectDesc.x = 10;
		this.inspectDesc.y = 46;
		this.inspectPopup.addChild(this.inspectDesc);

		const closeBg = new Graphics();
		closeBg.circle(0, 0, 8);
		closeBg.fill(0x333333);
		closeBg.x = 190;
		closeBg.y = 10;
		closeBg.eventMode = "static";
		closeBg.cursor = "pointer";
		closeBg.on("pointerdown", () => (this.inspectPopup.visible = false));
		this.inspectPopup.addChild(closeBg);

		this.inspectPopup.x = PANEL_W + GAP;
		this.inspectPopup.y = 0;
		this.inspectPopup.visible = false;
		this.view.addChild(this.inspectPopup);
	}

	private showInspectPopup(item: ItemData): void {
		this.inspectIcon.clear();
		this.inspectIcon.circle(24, 24, 14);
		this.inspectIcon.fill(
			item.id.includes("crown") || item.id.includes("ember")
				? 0xffd700
				: 0x88ccff,
		);
		this.inspectName.text = item.name;
		this.inspectDesc.text = item.description ?? "No description.";
		this.inspectPopup.visible = true;
	}

	// --- gear silhouettes ---
	private drawSword(g: Graphics): void {
		g.moveTo(20, 8);
		g.lineTo(20, 32);
		g.stroke({ width: 3, color: 0x888888 });
		g.moveTo(14, 14);
		g.lineTo(26, 14);
		g.stroke({ width: 2, color: 0x888888 });
	}

	private drawShield(g: Graphics): void {
		g.moveTo(12, 10);
		g.lineTo(28, 10);
		g.lineTo(28, 22);
		g.lineTo(20, 32);
		g.lineTo(12, 22);
		g.closePath();
		g.stroke({ width: 2, color: 0x888888 });
	}

	private drawRing(g: Graphics): void {
		g.circle(20, 20, 10);
		g.stroke({ width: 2, color: 0x888888 });
		g.circle(20, 20, 5);
		g.stroke({ width: 1, color: 0x888888 });
	}

	// --- action icons ---
	private drawInspectIcon(g: Graphics): void {
		g.circle(16, 16, 8);
		g.stroke({ width: 2, color: 0xcccccc });
		g.moveTo(22, 22);
		g.lineTo(28, 28);
		g.stroke({ width: 2, color: 0xcccccc });
	}

	private drawSwapIcon(g: Graphics): void {
		g.moveTo(10, 14);
		g.lineTo(26, 14);
		g.lineTo(22, 10);
		g.stroke({ width: 2, color: 0xcccccc });
		g.moveTo(30, 26);
		g.lineTo(14, 26);
		g.lineTo(18, 30);
		g.stroke({ width: 2, color: 0xcccccc });
	}

	private drawDropIcon(g: Graphics): void {
		g.moveTo(20, 10);
		g.lineTo(20, 26);
		g.moveTo(14, 20);
		g.lineTo(20, 26);
		g.lineTo(26, 20);
		g.stroke({ width: 2, color: 0xcccccc });
		g.moveTo(12, 30);
		g.lineTo(28, 30);
		g.stroke({ width: 2, color: 0xcccccc });
	}
}
