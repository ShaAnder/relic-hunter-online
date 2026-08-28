import { Container, Text, Ticker } from "pixi.js";

import type { Game } from "@/core/game/Game";
import { RefocusButton } from "@/ui/buttons/RefocusButton";
import { LogsButton } from "@/ui/buttons/LogButton";
import { BagButton } from "@/ui/buttons/BagButton";
import { InspectButton } from "@/ui/buttons/InspectButton";
import { ActionMenu } from "@/ui/buttons/ActionMenu";
import { CharacterPanel } from "@/ui/CharacterPanel";
import { DeckTracker } from "@/ui/DeckTracker";
import { InventoryPanel } from "@/ui/InventoryPanel";
import {
	HunterSummaryPanel,
	type HunterSummaryEntry,
} from "@/ui/HunterSummaryPanel";
import { LogPanel } from "@/ui/LogPanel";
import type { GestureRouter } from "@/input/GestureRouter";
import type { MatchLogEntry } from "@/core/game/GameSession";
import type {
	MercenaryState,
	ItemData,
	CharacterData,
} from "@relic-hunter/shared";
import type { TurnManager } from "@/systems/TurnManager";
import { uiPx } from "@/math/uiScale";

/**
 * Owns the map's presentation chrome under one root.
 *
 * MapHud owns UI objects, their presentation/layout, and UI-level interaction
 * routing. MapScene remains responsible for the gameplay consequences of
 * those interactions until the later MapController extraction.
 *
 * @author ShaAnderton
 */
export class MapHud {
	readonly view = new Container();

	private bossAlertText: Text;
	private feedbackText: Text;
	private feedbackTimer = 0;

	private refocusButton: RefocusButton;
	private logsButton: LogsButton;
	private logPanel: LogPanel;
	private bagButton: BagButton;
	private inspectButton: InspectButton;
	private actionMenu: ActionMenu;
	private characterPanel: CharacterPanel;
	private deckTracker: DeckTracker;
	private inventoryPanel: InventoryPanel;
	private hunterSummaryPanel: HunterSummaryPanel;

	constructor(private game: Game) {
		this.bossAlertText = new Text({
			text: "⚠ ALERT ⚠",
			style: { fill: 0xff2222, fontSize: 72, fontWeight: "bold" },
		});
		this.bossAlertText.anchor.set(0.5);
		this.bossAlertText.visible = false;
		this.view.addChild(this.bossAlertText);

		this.feedbackText = new Text({
			text: "",
			style: {
				fill: 0xffd700,
				fontSize: 16,
				fontWeight: "bold",
				wordWrap: true,
				wordWrapWidth: 480,
				align: "center",
			},
		});
		this.feedbackText.visible = false;
		this.view.addChild(this.feedbackText);

		this.bagButton = new BagButton();
		this.view.addChild(this.bagButton.view);

		this.inspectButton = new InspectButton();
		this.view.addChild(this.inspectButton.view);

		this.logsButton = new LogsButton();
		this.view.addChild(this.logsButton.view);

		this.logPanel = new LogPanel();
		this.view.addChild(this.logPanel.view);

		this.refocusButton = new RefocusButton();
		this.view.addChild(this.refocusButton.view);

		this.actionMenu = new ActionMenu();
		this.view.addChild(this.actionMenu.view);

		this.characterPanel = new CharacterPanel();
		this.view.addChild(this.characterPanel.view);

		this.deckTracker = new DeckTracker();
		this.view.addChild(this.deckTracker.view);

		this.inventoryPanel = new InventoryPanel();
		this.view.addChild(this.inventoryPanel.view);

		this.hunterSummaryPanel = new HunterSummaryPanel();
		this.view.addChild(this.hunterSummaryPanel.view);
	}

	/** The item-drop consequence (clearing the source slot) is gameplay state — MapScene supplies it. */
	setInventoryOnDrop(handler: (index: number) => void): void {
		this.inventoryPanel.setOnDrop(handler);
	}

	/** MapScene owns the router; this just adds MapHud's own scroll surfaces. */
	registerScrollSurfaces(router: GestureRouter): void {
		router.register(this.logPanel);
		router.register(this.hunterSummaryPanel);
	}

	/** All HUD roots that should block board click-through. */
	get interactiveSurfaces(): Container[] {
		return [
			this.bagButton.view,
			this.inspectButton.view,
			this.logsButton.view,
			this.logPanel.view,
			this.refocusButton.view,
			this.actionMenu.view,
			this.characterPanel.view,
			this.deckTracker.view,
			this.inventoryPanel.view,
			this.hunterSummaryPanel.view,
		];
	}

	get logsButtonView(): Container {
		return this.logsButton.view;
	}

	get logPanelView(): Container {
		return this.logPanel.view;
	}

	get refocusView(): Container {
		return this.refocusButton.view;
	}

	/** UI-level delegation for ActionMenu. Gameplay consequences stay in MapScene. */
	handleActionClick(
		screenX: number,
		screenY: number,
	): ReturnType<ActionMenu["handleClick"]> {
		return this.actionMenu.handleClick(screenX, screenY);
	}

	getActionButtonScreenPosition(
		key: Parameters<ActionMenu["getButtonScreenPosition"]>[0],
	): { x: number; y: number } | null {
		return this.actionMenu.getButtonScreenPosition(key);
	}

	setMoveActive(active: boolean): void {
		this.actionMenu.setMoveActive(active);
	}

	closeActionMenu(): void {
		this.actionMenu.closeMenu();
	}

	setActionMenuVisible(visible: boolean): void {
		this.actionMenu.view.visible = visible;
	}

	updateActionMenu(deltaTime: number): void {
		this.actionMenu.update(deltaTime);
	}

	syncActions(
		turnManager: TurnManager,
		special: Parameters<ActionMenu["sync"]>[1],
	): void {
		this.actionMenu.sync(turnManager, special);
	}

	syncCharacterPanel(
		character: CharacterData | null,
		state: MercenaryState | null,
		apRemaining: number,
		baseAP: number,
	): void {
		this.characterPanel.setFromState(character, state, apRemaining, baseAP);
	}

	syncDeckTracker(turnManager: TurnManager): void {
		this.deckTracker.sync(turnManager);
	}

	syncInventoryPanel(items: (ItemData | null)[]): void {
		this.inventoryPanel.sync(items);
	}

	setInventoryTargetItemId(id: string | null): void {
		this.inventoryPanel.setTargetItemId(id);
	}

	syncHunterSummary(entries: HunterSummaryEntry[]): void {
		this.hunterSummaryPanel.sync(entries);
	}

	setActionMenuSubmenuToggled(callback: (open: boolean) => void): void {
		this.actionMenu.onSubmenuToggled = callback;
	}

	/** Layout all HUD chrome. margin/w/h/s are the same values MapScene's own layout already computes. */
	layout(w: number, h: number, s: number, margin: number): void {
		for (const v of [
			this.bagButton.view,
			this.inspectButton.view,
			this.logsButton.view,
			this.logPanel.view,
			this.refocusButton.view,
			this.characterPanel.view,
			this.deckTracker.view,
			this.inventoryPanel.view,
			this.hunterSummaryPanel.view,
		]) {
			v.scale.set(s);
		}

		const gap = uiPx(8, s);
		const btn = uiPx(40, s);
		const panelW = this.characterPanel.panelWidth * s;
		const panelH = this.characterPanel.panelHeight * s;

		this.characterPanel.view.x = margin;
		this.characterPanel.view.y = margin;

		const bagX = margin;
		const bagY = margin + panelH + gap;

		this.bagButton.view.x = bagX;
		this.bagButton.view.y = bagY;

		this.inspectButton.view.x = bagX + btn + gap;
		this.inspectButton.view.y = bagY;

		this.logsButton.view.x = this.inspectButton.view.x + btn + gap;
		this.logsButton.view.y = bagY;

		this.logPanel.view.x = bagX;
		this.logPanel.view.y = bagY + uiPx(56, s);

		this.hunterSummaryPanel.view.x = margin;
		this.hunterSummaryPanel.view.y = bagY + uiPx(56, s);

		this.inventoryPanel.view.x = margin + panelW + gap;
		this.inventoryPanel.view.y = margin;

		this.deckTracker.view.x = w - uiPx(88, s) - margin;
		this.deckTracker.view.y = margin;

		this.actionMenu.layout(w, h, s);

		this.refocusButton.view.x = w - uiPx(28, s);
		this.refocusButton.view.y = h / 2;
	}

	hitTestBag(screenX: number, screenY: number): boolean {
		return this.bagButton.hitTest(screenX, screenY);
	}

	hitTestInspect(screenX: number, screenY: number): boolean {
		return this.inspectButton.hitTest(screenX, screenY);
	}

	hitTestLogsButton(screenX: number, screenY: number): boolean {
		return this.logsButton.hitTest(screenX, screenY);
	}

	toggleLogPanel(): void {
		this.logPanel.toggle();
	}

	get isLogPanelOpen(): boolean {
		return this.logPanel.isOpen;
	}

	closeLogPanelIfOpen(): void {
		if (this.logPanel.isOpen) this.logPanel.toggle();
	}

	toggleInventoryPanel(): void {
		this.inventoryPanel.toggle();
	}

	closeInventoryIfOpen(): void {
		if (this.inventoryPanel.isOpen) this.inventoryPanel.close();
	}

	toggleHunterSummaryPanel(): void {
		this.hunterSummaryPanel.toggle();
	}

	closeHunterSummaryIfOpen(): void {
		if (this.hunterSummaryPanel.isOpen) this.hunterSummaryPanel.toggle();
	}

	syncLogPanel(matchLog: MatchLogEntry[]): void {
		this.logPanel.sync(matchLog);
	}

	setLogsChromeVisible(visible: boolean): void {
		this.logsButton.view.visible = visible;
	}

	setBagVisible(visible: boolean): void {
		this.bagButton.view.visible = visible;
	}

	setInspectVisible(visible: boolean): void {
		this.inspectButton.view.visible = visible;
	}

	setCharacterPanelVisible(visible: boolean): void {
		this.characterPanel.view.visible = visible;
	}

	setDeckTrackerVisible(visible: boolean): void {
		this.deckTracker.view.visible = visible;
	}

	hitTestRefocus(screenX: number, screenY: number): boolean {
		return this.refocusButton.hitTest(screenX, screenY);
	}

	setRefocusVisible(visible: boolean): void {
		this.refocusButton.view.visible = visible;
	}

	/** Ticks the feedback message's auto-hide timer, plus any owned widgets that need a per-frame tick. */
	update(deltaTime: number): void {
		this.actionMenu.update(deltaTime);
		this.inventoryPanel.update(deltaTime);

		if (this.feedbackTimer > 0) {
			this.feedbackTimer -= deltaTime;
			if (this.feedbackTimer <= 0) {
				this.feedbackText.visible = false;
			}
		}
	}

	showFeedbackMessage(message: string): void {
		this.feedbackText.text = this.capToSevenWords(message);
		this.feedbackText.visible = true;
		this.feedbackText.x =
			(this.game.app.screen.width - this.feedbackText.width) / 2;
		this.feedbackText.y = 140;
		this.feedbackTimer = 150;
	}

	private capToSevenWords(message: string): string {
		const words = message.split(" ");
		if (words.length <= 7) return message;
		return words.slice(0, 7).join(" ") + "…";
	}

	showBossAlert(durationMs: number): Promise<void> {
		return new Promise((resolve) => {
			this.bossAlertText.x = this.game.app.screen.width / 2;
			this.bossAlertText.y = this.game.app.screen.height / 2;
			this.bossAlertText.visible = true;
			const startTime = performance.now();
			const tick = (): void => {
				const elapsedMs = performance.now() - startTime;
				if (elapsedMs >= durationMs) {
					this.bossAlertText.visible = false;
					Ticker.shared.remove(tick);
					resolve();
					return;
				}
				this.bossAlertText.alpha =
					0.4 + Math.abs(Math.sin(elapsedMs / 500)) * 0.6;
			};
			Ticker.shared.add(tick);
		});
	}
}
