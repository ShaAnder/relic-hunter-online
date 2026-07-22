import { Container, Graphics, Text } from "pixi.js";
import type { ItemData } from "@relic-hunter/shared";

const GENERAL_SLOTS = 6;
const PANEL_WIDTH = 260;
const PANEL_HEIGHT = 190;

/**
 * Compact inventory readout — 3 gear placeholders (Weapon/Armor/Accessory,
 * always empty per `11-item-inventory-win-design.md`, no gear items exist
 * in the pool yet) + the 6 general slots that chests actually fill.
 *
 * General slots always render as a fixed 6 rows (item name or "—" for an
 * empty slot) rather than a variable-length list — this keeps the panel's
 * height constant as items are found, instead of it growing/shrinking and
 * shoving whatever's below it around.
 *
 * Positioned directly beneath CharacterPanel — same width, same x, stacked
 * via a fixed vertical offset in layout().
 */
export class InventoryPanel {
	readonly view = new Container();

	private bg = new Graphics();
	private titleText: Text;
	private gearText: Text;
	private slotTexts: Text[] = [];

	constructor() {
		this.bg.roundRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 8);
		this.bg.fill({ color: 0x1a1a1a, alpha: 0.85 });
		this.bg.stroke({ width: 1, color: 0x555555 });
		this.view.addChild(this.bg);

		this.titleText = new Text({
			text: "Inventory",
			style: { fill: 0xffffff, fontSize: 14, fontWeight: "bold" },
		});
		this.titleText.x = 12;
		this.titleText.y = 10;
		this.view.addChild(this.titleText);

		this.gearText = new Text({
			text: "Weapon: —   Armor: —   Acc: —",
			style: { fill: 0x777777, fontSize: 11 },
		});
		this.gearText.x = 12;
		this.gearText.y = 32;
		this.view.addChild(this.gearText);

		for (let i = 0; i < GENERAL_SLOTS; i++) {
			const slotText = new Text({
				text: "—",
				style: { fill: 0xcccccc, fontSize: 13 },
			});
			slotText.x = 12;
			slotText.y = 56 + i * 20;
			this.slotTexts.push(slotText);
			this.view.addChild(slotText);
		}
	}

	/** Refresh the 6 general slots from the mercenary's current items. */
	sync(items: ItemData[]): void {
		this.titleText.text = `Inventory (${items.length}/${GENERAL_SLOTS})`;

		for (let i = 0; i < GENERAL_SLOTS; i++) {
			const item = items[i];
			this.slotTexts[i].text = item ? `• ${item.name}` : "—";
			this.slotTexts[i].style.fill = item ? 0xffffff : 0x555555;
		}
	}

	/** Position directly beneath CharacterPanel (260×110 at y=12). */
	layout(screenWidth: number): void {
		this.view.x = screenWidth - 280;
		this.view.y = 12 + 110 + 8; // CharacterPanel's y + height + a small gap
	}
}
