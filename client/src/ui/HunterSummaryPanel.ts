import { Container, Graphics, Text } from "pixi.js";
import type { ItemData } from "@relic-hunter/shared";
import { pointInContainer } from "@/rendering/HitTest";
import type { ScrollSurface } from "@/input/GestureRouter";

const CARD_W = 220;
const CARD_GAP = 8;
const PAD = 8;
const PORTRAIT_SIZE = 28;
const CONTENT_X = PAD + PORTRAIT_SIZE + 8;
const HP_BAR_WIDTH = CARD_W - CONTENT_X - PAD;
const SLOT = 18;
const SLOT_GAP = 3;
const ROW2_Y = PAD + PORTRAIT_SIZE + 6;
const CARD_H = ROW2_Y + SLOT + PAD;
/** ~2.5 cards visible at once — enough to feel useful without overflowing small screens. */
const VIEWPORT_H = 190;

export interface HunterSummaryEntry {
	id: string;
	label: string;
	accentColor: number;
	currentHp: number;
	maxHp: number;
	hpCeiling: number;
	items: (ItemData | null)[];
}
/**
 * Drop-down of individual, self-backed hunter cards — no shared panel
 * background, each hunter is its own compact card: small portrait, name
 * + HP bar on one line, 6-slot public inventory below. Toggled via
 * InspectButton, same open/close pattern as LogPanel. Implements
 * ScrollSurface — see LogPanel for why gestures route this way rather
 * than through Pixi's own event system.
 * @author ShaAnder
 */
export class HunterSummaryPanel implements ScrollSurface {
	readonly view = new Container();

	private cardsContainer = new Container();
	private clipMask = new Graphics();
	private scrollOffset = 0;
	private contentHeight = 0;
	private open = false;

	constructor() {
		this.clipMask.rect(0, 0, CARD_W, VIEWPORT_H);
		this.clipMask.fill(0xffffff);
		this.view.addChild(this.clipMask);
		this.cardsContainer.mask = this.clipMask;

		this.view.addChild(this.cardsContainer);
		this.view.visible = false;
	}

	sync(entries: HunterSummaryEntry[]): void {
		this.cardsContainer.removeChildren();

		entries.forEach((entry, i) => {
			const card = this.buildCard(entry);
			card.y = i * (CARD_H + CARD_GAP);
			this.cardsContainer.addChild(card);
		});

		this.contentHeight =
			entries.length * CARD_H + Math.max(0, entries.length - 1) * CARD_GAP;
		this.clampScroll();
	}

	/** False when closed — a hidden panel must never claim a gesture just because the pointer happens to be where it would render. */
	hitTest(screenX: number, screenY: number): boolean {
		if (!this.open) return false;
		return pointInContainer(screenX, screenY, this.view);
	}

	/** Same convention as LogPanel: wheel-down (positive deltaY) moves further down the list. */
	handleWheel(deltaY: number): boolean {
		this.scrollOffset += Math.sign(deltaY) * (CARD_H / 3);
		this.clampScroll();
		return true;
	}

	/** Content follows the finger — dragging up (negative deltaY) scrolls further down the list. */
	handleDrag(_deltaX: number, deltaY: number): boolean {
		this.scrollOffset -= deltaY;
		this.clampScroll();
		return true;
	}

	private clampScroll(): void {
		const maxOffset = Math.max(0, this.contentHeight - VIEWPORT_H);
		this.scrollOffset = Math.min(maxOffset, Math.max(0, this.scrollOffset));
		this.cardsContainer.y = -this.scrollOffset;
	}

	private buildCard(entry: HunterSummaryEntry): Container {
		const card = new Container();

		const bg = new Graphics();
		bg.roundRect(0, 0, CARD_W, CARD_H, 6);
		bg.fill({ color: 0x1a1a1a, alpha: 0.95 });
		bg.stroke({ width: 1, color: entry.accentColor, alpha: 0.6 });
		card.addChild(bg);

		card.addChild(this.buildPortrait(entry.accentColor));

		const nameText = new Text({
			text: entry.label,
			style: { fill: 0xffffff, fontSize: 11, fontWeight: "bold" },
		});
		nameText.x = CONTENT_X;
		nameText.y = PAD;
		card.addChild(nameText);

		const hpBarBg = new Graphics();
		hpBarBg.roundRect(CONTENT_X, PAD + 14, HP_BAR_WIDTH, 8, 2);
		hpBarBg.fill(0x333333);
		card.addChild(hpBarBg);

		const trueMax = Math.max(1, entry.maxHp);
		const ceiling = Math.max(1, entry.hpCeiling);
		const current = Math.max(0, entry.currentHp);
		const fillRatio = Math.min(1, current / trueMax);
		const ceilingRatio = Math.min(1, ceiling / trueMax);

		const hpBarFill = new Graphics();
		hpBarFill.roundRect(CONTENT_X, PAD + 14, HP_BAR_WIDTH * fillRatio, 8, 2);
		hpBarFill.fill(fillRatio > 0.3 ? 0x2ecc71 : 0xe74c3c);
		card.addChild(hpBarFill);

		if (ceilingRatio < 1) {
			const lost = new Graphics();
			lost.roundRect(
				CONTENT_X + HP_BAR_WIDTH * ceilingRatio,
				PAD + 14,
				HP_BAR_WIDTH * (1 - ceilingRatio),
				8,
				2,
			);
			lost.fill({ color: 0x000000, alpha: 0.55 });
			card.addChild(lost);
		}

		const hpText = new Text({
			text: `${current}/${ceiling}`,
			style: { fill: 0xaaaaaa, fontSize: 8 },
		});
		hpText.anchor.set(1, 0);
		hpText.x = CARD_W - PAD;
		hpText.y = PAD + 14;
		card.addChild(hpText);

		for (let s = 0; s < 6; s++) {
			const slot = new Graphics();
			slot.roundRect(0, 0, SLOT, SLOT, 3);
			slot.fill(0x2a2a2a);
			slot.stroke({ width: 1, color: 0x555555 });
			slot.x = PAD + s * (SLOT + SLOT_GAP);
			slot.y = ROW2_Y;
			card.addChild(slot);

			const item = entry.items[s];
			if (item) {
				const dot = new Graphics();
				dot.circle(SLOT / 2, SLOT / 2, 5);
				dot.fill(0xd4af37);
				dot.x = slot.x;
				dot.y = slot.y;
				card.addChild(dot);
			}
		}

		return card;
	}

	/** Same head-circle + shoulder-ellipse technique as CharacterPanel's portrait, scaled down to fit a compact card. */
	private buildPortrait(color: number): Graphics {
		const g = new Graphics();
		g.roundRect(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE, 4);
		g.fill({ color: 0x222222, alpha: 0.6 });
		g.stroke({ width: 1, color: 0x555555 });
		g.circle(PORTRAIT_SIZE / 2, PORTRAIT_SIZE * 0.36, PORTRAIT_SIZE * 0.16);
		g.fill(color);
		g.ellipse(
			PORTRAIT_SIZE / 2,
			PORTRAIT_SIZE * 0.72,
			PORTRAIT_SIZE * 0.24,
			PORTRAIT_SIZE * 0.2,
		);
		g.fill(color);
		g.x = PAD;
		g.y = PAD;
		return g;
	}

	toggle(): void {
		this.open = !this.open;
		this.view.visible = this.open;
		if (this.open) {
			this.scrollOffset = 0;
			this.clampScroll();
		}
	}

	get isOpen(): boolean {
		return this.open;
	}

	layout(x: number, y: number): void {
		this.view.x = x;
		this.view.y = y;
	}
}
