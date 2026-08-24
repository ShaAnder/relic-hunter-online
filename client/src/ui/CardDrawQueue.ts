import { Container } from "pixi.js";
import type { CardData } from "@relic-hunter/shared";
import { Card, CARD_WIDTH, CARD_HEIGHT } from "@/entities/Card";

function easeOutCubic(t: number): number {
	return 1 - Math.pow(1 - t, 3);
}

function tween(ms: number, onStep: (t: number) => void): Promise<void> {
	return new Promise((resolve) => {
		const start = performance.now();
		const frame = (): void => {
			const t = Math.min(1, (performance.now() - start) / ms);
			onStep(t);
			if (t < 1) requestAnimationFrame(frame);
			else resolve();
		};
		requestAnimationFrame(frame);
	});
}

const CASCADE_DX = 14;
const CASCADE_DY = -18;

export type CardDrawQueueOptions = {
	/** Full-screen layer; origin is screen centre after layout. */
	layer: Container;
	/** Hand holder position in the same space as `layer` children. */
	getHandTarget: () => { x: number; y: number };
	/** Fired after a card finishes flying — push into real hand here. */
	onCollected: (card: CardData) => void;
};

type StackEntry = {
	card: Card;
	data: CardData;
};

/**
 * Cascade draw presenter.
 * One or many cards rise into a centre stack; player taps the front
 * card to send it into the hand. Remaining cards ease forward.
 */
export class CardDrawQueue {
	private pending: CardData[] = [];
	private stack: StackEntry[] = [];
	private presenting = false;
	private flying = false;

	private layer: Container;
	private getHandTarget: () => { x: number; y: number };
	private onCollected: (card: CardData) => void;

	constructor(opts: CardDrawQueueOptions) {
		this.layer = opts.layer;
		this.getHandTarget = opts.getHandTarget;
		this.onCollected = opts.onCollected;
	}

	/** True while cards are on-screen or still queued. */
	get isActive(): boolean {
		return (
			this.presenting ||
			this.flying ||
			this.stack.length > 0 ||
			this.pending.length > 0
		);
	}

	/** Queue cards; starts a cascade if nothing is showing yet. */
	enqueue(cards: CardData | CardData[]): void {
		const list = Array.isArray(cards) ? cards : [cards];
		if (list.length === 0) return;
		this.pending.push(...list);
		if (!this.presenting && this.stack.length === 0 && !this.flying) {
			void this.presentBatch();
		}
	}

	/**
	 * Click anywhere while a stack is waiting.
	 * Collects the front (top) card only.
	 */
	tryCollect(): boolean {
		if (this.flying || this.stack.length === 0) return false;
		const front = this.stack[this.stack.length - 1];
		void this.flyFront(front);
		return true;
	}

	/** Pull all pending into one cascade, staggered rise. */
	private async presentBatch(): Promise<void> {
		if (this.pending.length === 0) return;
		this.presenting = true;

		const PRESENT_SCALE = 1.35;
		const START_SCALE = 0.95;

		const batch = this.pending.splice(0, this.pending.length);
		const entries: StackEntry[] = batch.map((data) => {
			const card = new Card(data);
			card.view.eventMode = "none";
			card.view.cursor = "pointer";
			card.view.alpha = 0;
			card.view.scale.set(START_SCALE);
			card.view.pivot.set(CARD_WIDTH / 2, CARD_HEIGHT / 2);
			this.layer.addChild(card.view);
			return { card, data };
		});

		for (let i = 0; i < entries.length; i++) {
			const { card } = entries[i];
			const slot = i;
			const endX = slot * CASCADE_DX;
			const endY = slot * CASCADE_DY;
			const startY = endY + 90;

			card.view.x = endX;
			card.view.y = startY;

			if (i > 0) await tween(70, () => {});

			void tween(300, (t) => {
				const e = easeOutCubic(t);
				card.view.alpha = e;
				card.view.y = startY + (endY - startY) * e;
				card.view.scale.set(START_SCALE + (PRESENT_SCALE - START_SCALE) * e);
			});
		}

		await tween(300 + entries.length * 70, () => {});

		this.stack.push(...entries);
		this.enableFrontOnly();
		this.presenting = false;

		if (this.pending.length > 0 && this.stack.length === 0) {
			void this.presentBatch();
		}
	}

	private enableFrontOnly(): void {
		this.stack.forEach((entry, i) => {
			const isFront = i === this.stack.length - 1;
			entry.card.view.eventMode = isFront ? "static" : "none";
			entry.card.view.cursor = isFront ? "pointer" : "default";
			entry.card.view.removeAllListeners("pointerdown");
			if (isFront) {
				entry.card.view.on("pointerdown", () => {
					if (this.flying) return;
					void this.flyFront(entry);
				});
			}
		});
		this.layoutStack(false);
	}

	private layoutStack(animate: boolean): void {
		this.stack.forEach((entry, i) => {
			const x = i * CASCADE_DX;
			const y = i * CASCADE_DY;
			if (!animate) {
				entry.card.view.x = x;
				entry.card.view.y = y;
				return;
			}
			const sx = entry.card.view.x;
			const sy = entry.card.view.y;
			void tween(180, (t) => {
				const e = easeOutCubic(t);
				entry.card.view.x = sx + (x - sx) * e;
				entry.card.view.y = sy + (y - sy) * e;
			});
		});
	}

	/**
	 * Global position of the front (top, currently tappable) card in the
	 * stack — null if nothing is currently presenting. Used by tutorial
	 * UI pointers to point at "the card you need to collect", distinct
	 * from getCardScreenPosition on Hand, which only knows about cards
	 * already actually in the hand.
	 */
	getFrontCardScreenPosition(): { x: number; y: number } | null {
		if (this.stack.length === 0) return null;
		const front = this.stack[this.stack.length - 1];
		return front.card.view.getGlobalPosition();
	}

	private async flyFront(entry: StackEntry): Promise<void> {
		if (this.flying) return;
		const idx = this.stack.indexOf(entry);
		if (idx === -1) return;

		this.flying = true;
		this.stack.splice(idx, 1);
		entry.card.view.eventMode = "none";
		entry.card.view.removeAllListeners("pointerdown");

		this.layoutStack(true);
		this.enableFrontOnly();

		const target = this.getHandTarget();
		const startX = entry.card.view.x;
		const startY = entry.card.view.y;
		const startScale = entry.card.view.scale.x;

		await tween(400, (t) => {
			const e = easeOutCubic(t);
			entry.card.view.x = startX + (target.x - startX) * e;
			entry.card.view.y = startY + (target.y - startY) * e;
			entry.card.view.scale.set(startScale * (1 - 0.65 * e));
			entry.card.view.alpha = 1 - e;
		});

		entry.card.view.removeFromParent();
		this.onCollected(entry.data);
		this.flying = false;

		if (this.stack.length === 0 && this.pending.length > 0) {
			void this.presentBatch();
		}
	}
}
