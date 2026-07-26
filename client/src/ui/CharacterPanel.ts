import { Container, Graphics, Text } from "pixi.js";
import type { CharacterData } from "@relic-hunter/shared";
import type { MercenaryState } from "@relic-hunter/shared";

const PANEL_W = 316;
const PANEL_H = 110;
const PORTRAIT_SIZE = 74;
const CONTENT_X = 14 + PORTRAIT_SIZE + 16;
const HP_BAR_WIDTH = PANEL_W - CONTENT_X - 14;

/**
 * Top-left hunter readout: silhouette, HP bar, Mov/Atk/Def/AP.
 * Live values come from MercenaryState + TurnManager AP.
 * @param none - constructed empty, fed via setFromState
 * @author ShaAnder
 */
export class CharacterPanel {
	readonly view = new Container();

	private bg = new Graphics();
	private portrait = new Graphics();
	private hpBarBg = new Graphics();
	private hpBarFill = new Graphics();
	private hpText: Text;
	private nameText: Text;
	private statsText: Text;
	private infoBlock = new Container();

	constructor() {
		this.bg.roundRect(0, 0, PANEL_W, PANEL_H, 8);
		this.bg.fill({ color: 0x1a1a1a, alpha: 0.9 });
		this.bg.stroke({ width: 1, color: 0x555555 });
		this.view.addChild(this.bg);

		// Portrait — left side, vertically centered in the panel
		this.drawPortrait(0x4a9eff);
		this.portrait.x = 14;
		this.portrait.y = (PANEL_H - PORTRAIT_SIZE) / 2;
		this.view.addChild(this.portrait);

		// Info block sits BESIDE the portrait, left-aligned starting at CONTENT_X —
		// not centered under it, this is a side-by-side layout, not a stack.
		this.nameText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 14, fontWeight: "bold" },
		});
		this.nameText.x = CONTENT_X;
		this.nameText.y = this.portrait.y;
		this.infoBlock.addChild(this.nameText);

		this.hpBarBg.roundRect(CONTENT_X, 0, HP_BAR_WIDTH, 14, 3);
		this.hpBarBg.y = this.portrait.y + 22;
		this.hpBarBg.fill(0x333333);
		this.infoBlock.addChild(this.hpBarBg);

		this.hpBarFill.y = this.portrait.y + 22;
		this.infoBlock.addChild(this.hpBarFill);

		this.hpText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 10, fontWeight: "bold" },
		});
		this.hpText.x = CONTENT_X;
		this.hpText.y = this.portrait.y + 38;
		this.infoBlock.addChild(this.hpText);

		this.statsText = new Text({
			text: "",
			style: { fill: 0x88ccff, fontSize: 13 },
		});
		this.statsText.x = CONTENT_X;
		this.statsText.y = this.portrait.y + 54;
		this.infoBlock.addChild(this.statsText);

		this.view.addChild(this.infoBlock);
	}

	/**
	 * Sync name/class from CharacterData and live HP/AP/stats from state.
	 * @param character - creation data (name, class) or null
	 * @param state - live MercenaryState for currentHp / stats
	 * @param apRemaining - current AP from TurnManager
	 * @param baseAP - max AP this turn
	 */
	setFromState(
		character: CharacterData | null,
		state: MercenaryState | null,
		apRemaining: number,
		baseAP: number,
	): void {
		if (!character || !state) {
			this.nameText.text = "???";
			this.statsText.text = "";
			this.hpText.text = "";
			this.hpBarFill.clear();
			return;
		}
		this.nameText.text = `${character.name}  ·  ${this.capitalize(character.characterClass)}`;
		this.statsText.text =
			`Mov ${state.stats.movement}   Atk ${state.stats.attack}   ` +
			`Def ${state.stats.defense}   AP ${apRemaining}/${baseAP}`;

		const maxHp = state.hpCeiling > 0 ? state.hpCeiling : state.stats.maxHp;
		const hpRatio = Math.max(0, Math.min(1, state.currentHp / maxHp));
		this.hpText.text = `${state.currentHp}/${maxHp}`;

		this.hpBarFill.clear();
		this.hpBarFill.roundRect(CONTENT_X, 0, HP_BAR_WIDTH * hpRatio, 14, 3);
		this.hpBarFill.fill(hpRatio > 0.3 ? 0x2ecc71 : 0xe74c3c);
	}

	/** Top-left corner, small margin. */
	layout(_screenWidth: number, _screenHeight: number): void {
		this.view.x = 16;
		this.view.y = 16;
	}

	get panelWidth(): number {
		return PANEL_W;
	}

	get panelHeight(): number {
		return PANEL_H;
	}

	private drawPortrait(color: number): void {
		this.portrait.clear();
		this.portrait.circle(PORTRAIT_SIZE / 2, 14, 12);
		this.portrait.fill(color);
		this.portrait.ellipse(PORTRAIT_SIZE / 2, 42, 18, 16);
		this.portrait.fill(color);
		this.portrait.roundRect(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE, 6);
		this.portrait.stroke({ width: 2, color: 0x555555 });
	}

	private capitalize(s: string): string {
		return s.charAt(0).toUpperCase() + s.slice(1);
	}
}
