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

			if (t < 1) {
				requestAnimationFrame(frame);
			} else {
				resolve();
			}
		};

		requestAnimationFrame(frame);
	});
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		window.setTimeout(resolve, ms);
	});
}

/**
 * Horizontal/vertical offset between cards in the presentation cascade.
 */
const CASCADE_DX = 14;
const CASCADE_DY = -18;

/**
 * Time between the start of each card's flight into the hand.
 *
 * The flights overlap:
 *
 * Card 1: 0ms
 * Card 2: 90ms
 * Card 3: 180ms
 * Card 4: 270ms
 * Card 5: 360ms
 */
const COLLECTION_STAGGER_MS = 90;

/**
 * How long an individual card takes to fly into the hand.
 */
const COLLECTION_DURATION_MS = 400;

export type CardDrawQueueOptions = {
	/**
	 * Full-screen layer; origin is screen centre after layout.
	 */
	layer: Container;

	/**
	 * Hand holder position in the same space as `layer` children.
	 */
	getHandTarget: () => {
		x: number;
		y: number;
	};

	/**
	 * Fired after a card finishes flying.
	 *
	 * The caller should push the card into the real hand here.
	 */
	onCollected: (card: CardData) => void;
};

type StackEntry = {
	card: Card;
	data: CardData;
};

/**
 * Cascade draw presenter.
 *
 * Cards rise into a centre stack. A single click on the front card
 * collects the ENTIRE currently presented stack.
 *
 * Collection is staggered so each card begins its flight slightly
 * after the previous one:
 *
 *   Card 1 ────────────────>
 *      Card 2 ────────────────>
 *         Card 3 ────────────────>
 *            Card 4 ────────────────>
 *
 * This keeps the presentation feeling like a single draw event while
 * still giving every card its own visible movement.
 */
export class CardDrawQueue {
	private pending: CardData[] = [];

	private stack: StackEntry[] = [];

	private presenting = false;

	private flying = false;

	private layer: Container;

	private getHandTarget: () => {
		x: number;
		y: number;
	};

	private onCollected: (card: CardData) => void;

	constructor(opts: CardDrawQueueOptions) {
		this.layer = opts.layer;
		this.getHandTarget = opts.getHandTarget;
		this.onCollected = opts.onCollected;
	}

	/**
	 * True while cards are on-screen or still queued.
	 */
	get isActive(): boolean {
		return (
			this.presenting ||
			this.flying ||
			this.stack.length > 0 ||
			this.pending.length > 0
		);
	}

	/**
	 * Queue one or more cards.
	 *
	 * If nothing is currently being presented, the queue immediately
	 * starts presenting them as one batch.
	 */
	enqueue(cards: CardData | CardData[]): void {
		const list = Array.isArray(cards) ? cards : [cards];

		if (list.length === 0) {
			return;
		}

		this.pending.push(...list);

		if (!this.presenting && this.stack.length === 0 && !this.flying) {
			void this.presentBatch();
		}
	}

	/**
	 * Click anywhere while a stack is waiting.
	 *
	 * ONE click collects the entire currently presented stack.
	 *
	 * Previously this collected only the front card. That behaviour
	 * meant drawing five cards required five separate clicks.
	 */
	tryCollect(): boolean {
		if (this.flying || this.presenting || this.stack.length === 0) {
			return false;
		}

		void this.flyAll();

		return true;
	}

	/**
	 * Present all currently pending cards as one visual cascade.
	 *
	 * Cards enter the stack one after another with a small stagger.
	 */
	private async presentBatch(): Promise<void> {
		if (this.pending.length === 0) {
			return;
		}

		if (this.presenting) {
			return;
		}

		this.presenting = true;

		const PRESENT_SCALE = 1.35;
		const START_SCALE = 0.95;

		/*
		 * Take the current pending cards as one batch.
		 *
		 * Anything enqueued while this animation is running remains in
		 * `pending` and will be handled afterwards.
		 */
		const batch = this.pending.splice(0, this.pending.length);

		const entries: StackEntry[] = batch.map((data) => {
			const card = new Card(data);

			/*
			 * Cards are not individually clickable here.
			 *
			 * The queue's global click handling decides when the stack
			 * should be collected.
			 */
			card.view.eventMode = "none";
			card.view.cursor = "pointer";

			card.view.alpha = 0;
			card.view.scale.set(START_SCALE);

			card.view.pivot.set(CARD_WIDTH / 2, CARD_HEIGHT / 2);

			this.layer.addChild(card.view);

			return {
				card,
				data,
			};
		});

		/*
		 * Present each card with a small stagger.
		 *
		 * IMPORTANT:
		 *
		 * The tween itself is not awaited.
		 *
		 * We only await the 70ms stagger between starts, meaning
		 * all card presentations overlap.
		 */
		const presentationPromises: Promise<void>[] = [];

		for (let i = 0; i < entries.length; i++) {
			const { card } = entries[i];

			const slot = i;

			const endX = slot * CASCADE_DX;
			const endY = slot * CASCADE_DY;

			const startY = endY + 90;

			card.view.x = endX;
			card.view.y = startY;

			if (i > 0) {
				await delay(70);
			}

			presentationPromises.push(
				tween(300, (t) => {
					const e = easeOutCubic(t);

					card.view.alpha = e;

					card.view.y = startY + (endY - startY) * e;

					card.view.scale.set(START_SCALE + (PRESENT_SCALE - START_SCALE) * e);
				}),
			);
		}

		/*
		 * Wait for every presentation animation to finish.
		 */
		await Promise.all(presentationPromises);

		this.stack.push(...entries);

		this.enableFrontOnly();

		this.presenting = false;

		/*
		 * If another draw arrived while this batch was presenting,
		 * don't present it until the current stack has been collected.
		 */
	}

	/**
	 * Enable only the front card as the visible interaction target.
	 *
	 * We retain this for compatibility with any existing code that
	 * directly interacts with the front card.
	 */
	private enableFrontOnly(): void {
		this.stack.forEach((entry, i) => {
			const isFront = i === this.stack.length - 1;

			entry.card.view.eventMode = isFront ? "static" : "none";

			entry.card.view.cursor = isFront ? "pointer" : "default";

			entry.card.view.removeAllListeners("pointerdown");

			if (isFront) {
				entry.card.view.on("pointerdown", () => {
					if (this.flying || this.presenting) {
						return;
					}

					void this.flyAll();
				});
			}
		});

		this.layoutStack(false);
	}

	/**
	 * Position the waiting stack.
	 */
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
	 * Global position of the front/top card.
	 *
	 * Used by tutorial UI pointers to identify the card currently
	 * waiting to be collected.
	 */
	getFrontCardScreenPosition(): {
		x: number;
		y: number;
	} | null {
		if (this.stack.length === 0) {
			return null;
		}

		const front = this.stack[this.stack.length - 1];

		return front.card.view.getGlobalPosition();
	}

	/**
	 * Collect the entire visible stack.
	 *
	 * This is the important part of the new behaviour.
	 *
	 * A single click takes:
	 *
	 *   [A, B, C, D, E]
	 *
	 * and starts:
	 *
	 *   A -> hand immediately
	 *   B -> hand +90ms
	 *   C -> hand +180ms
	 *   D -> hand +270ms
	 *   E -> hand +360ms
	 *
	 * The individual 400ms flights overlap.
	 */
	private async flyAll(): Promise<void> {
		if (this.flying || this.presenting || this.stack.length === 0) {
			return;
		}

		this.flying = true;

		/*
		 * Snapshot the stack.
		 *
		 * We clear `this.stack` immediately because these cards are
		 * no longer waiting for collection.
		 */
		const entries = [...this.stack];

		this.stack.length = 0;

		/*
		 * Disable all interaction immediately so another pointer event
		 * cannot start another collection.
		 */
		for (const entry of entries) {
			entry.card.view.eventMode = "none";
			entry.card.view.cursor = "default";
			entry.card.view.removeAllListeners("pointerdown");
		}

		/*
		 * The cards should retain their current visual positions while
		 * they begin flying.
		 *
		 * Do NOT call layoutStack(true) here because the stack has already
		 * been emptied.
		 */

		/*
		 * Capture the target once for the entire collection.
		 *
		 * This means all cards fly toward the same hand position even if
		 * layout changes during the animation.
		 */
		const target = this.getHandTarget();

		const flightPromises: Promise<void>[] = [];

		/*
		 * Start each card after the configured stagger.
		 *
		 * We await only the delay, NOT the flight.
		 *
		 * Therefore:
		 *
		 * 0ms   -> Card A flight begins
		 * 90ms  -> Card B flight begins
		 * 180ms -> Card C flight begins
		 * 270ms -> Card D flight begins
		 * 360ms -> Card E flight begins
		 *
		 * while each individual flight lasts 400ms.
		 */
		for (let i = 0; i < entries.length; i++) {
			if (i > 0) {
				await delay(COLLECTION_STAGGER_MS);
			}

			flightPromises.push(this.flyEntry(entries[i], target));
		}

		/*
		 * Wait until every card has finished.
		 */
		await Promise.all(flightPromises);

		this.flying = false;

		/*
		 * If cards were enqueued while the current batch was flying,
		 * start presenting them now.
		 */
		if (this.stack.length === 0 && this.pending.length > 0) {
			void this.presentBatch();
		}
	}

	/**
	 * Fly one card into the player's hand.
	 *
	 * This method intentionally knows nothing about the hand itself.
	 * It simply presents the animation and then tells the owner that
	 * the card has been collected.
	 */
	private async flyEntry(
		entry: StackEntry,
		target: {
			x: number;
			y: number;
		},
	): Promise<void> {
		const startX = entry.card.view.x;
		const startY = entry.card.view.y;
		const startScale = entry.card.view.scale.x;

		await tween(COLLECTION_DURATION_MS, (t) => {
			const e = easeOutCubic(t);

			entry.card.view.x = startX + (target.x - startX) * e;

			entry.card.view.y = startY + (target.y - startY) * e;

			entry.card.view.scale.set(startScale * (1 - 0.65 * e));

			entry.card.view.alpha = 1 - e;
		});

		entry.card.view.removeFromParent();

		/*
		 * This is where MapScene/Hand receives the actual card.
		 *
		 * Because every card has its own flight promise, this fires
		 * once per card as each animation reaches the hand.
		 */
		this.onCollected(entry.data);
	}
}
