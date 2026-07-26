import { Container, Graphics, Text } from "pixi.js";
import type { ItemData } from "@relic-hunter/shared";

const GENERAL_SLOTS = 6;
const GEAR_SLOTS = 3;
const SLOT = 40;
const GAP = 10;
const PAD = 10;
const PANEL_W = PAD * 2 + GEAR_SLOTS * SLOT + (GEAR_SLOTS - 1) * GAP;
const PANEL_H = PAD * 2 + 18 + SLOT + GAP + SLOT + 50;

/**
 * 9-slot icon inventory — 3 gear silhouettes + 6 general item orbs.
 * Hidden by default; toggled via the bag icon next to CharacterPanel.
 * @author ShaAnder
 */
export class InventoryPanel {
	readonly view = new Container();

	private bg = new Graphics();
	private titleText: Text;
	private gearSlots: Graphics[] = [];
	private generalSlots: Graphics[] = [];
	private generalLabels: Text[] = [];
	private open = false;

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

		// Gear row (Weapon / Armor / Accessory silhouettes)
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

		// General row (6 empty orbs)
		for (let i = 0; i < GENERAL_SLOTS; i++) {
			const slot = new Graphics();
			slot.roundRect(0, 0, SLOT, SLOT, 4);
			slot.fill(0x222222);
			slot.stroke({ width: 1, color: 0x666666 });
			slot.x = PAD + (i % 3) * (SLOT + GAP);
			slot.y = 26 + SLOT + GAP + Math.floor(i / 3) * (SLOT + GAP);
			// second row of 3 for the remaining 3 slots
			if (i >= 3) {
				slot.y = 26 + SLOT + GAP + (SLOT + GAP);
				slot.x = PAD + (i - 3) * (SLOT + GAP);
			}
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
		}

		this.view.visible = false;
	}

	/** Refresh the 6 general slots from live items. Gear stays empty placeholders. */
	sync(items: ItemData[]): void {
		this.titleText.text = `Inventory (${items.length}/${GENERAL_SLOTS})`;
		for (let i = 0; i < GENERAL_SLOTS; i++) {
			const item = items[i];
			const slot = this.generalSlots[i];
			slot.clear();
			slot.roundRect(0, 0, SLOT, SLOT, 4);
			slot.fill(0x222222);
			slot.stroke({ width: 1, color: item ? 0xd4af37 : 0x666666 });
			if (item) {
				// Simple orb placeholder for any item
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

	toggle(): void {
		this.open = !this.open;
		this.view.visible = this.open;
	}

	close(): void {
		this.open = false;
		this.view.visible = false;
	}

	get isOpen(): boolean {
		return this.open;
	}

	/** Right of the bag icon, bottom-aligned to the same margin CharacterPanel uses. */
	layoutRightOfBag(bagX: number, screenHeight: number): void {
		this.view.x = bagX + 40 + 8;
		this.view.y = screenHeight - 16 - PANEL_H;
	}

	get panelWidth(): number {
		return PANEL_W;
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
}
