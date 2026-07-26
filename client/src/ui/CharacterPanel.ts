import { Container, Graphics, Text } from "pixi.js";
import type { CharacterData } from "@relic-hunter/shared";
import type { MercenaryState } from "@relic-hunter/shared";

const PANEL_W = 300;
const PANEL_H = 108;
const PORTRAIT_SIZE = 58;

/**
 * Bottom-left hunter readout: silhouette, HP bar, Mov/Atk/Def/AP.
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

	constructor() {
		this.bg.roundRect(0, 0, PANEL_W, PANEL_H, 8);
		this.bg.fill({ color: 0x1a1a1a, alpha: 0.9 });
		this.bg.stroke({ width: 1, color: 0x555555 });
		this.view.addChild(this.bg);

		// Silhouette portrait (left)
		this.drawPortrait(0x4a9eff);
		this.portrait.x = 12;
		this.portrait.y = 26;
		this.view.addChild(this.portrait);

		// HP bar above the stats block
		this.hpBarBg.roundRect(76, 12, 190, 14, 3);
		this.hpBarBg.fill(0x333333);
		this.view.addChild(this.hpBarBg);
		this.view.addChild(this.hpBarFill);

		this.hpText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 11, fontWeight: "bold" },
		});
		this.hpText.x = 80;
		this.hpText.y = 12;
		this.view.addChild(this.hpText);

		this.nameText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 14, fontWeight: "bold" },
		});
		this.nameText.x = 76;
		this.nameText.y = 32;
		this.view.addChild(this.nameText);

		this.statsText = new Text({
			text: "",
			style: { fill: 0x88ccff, fontSize: 13 },
		});
		this.statsText.x = 76;
		this.statsText.y = 56;
		this.view.addChild(this.statsText);
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
		this.hpBarFill.roundRect(76, 12, 190 * hpRatio, 14, 3);
		this.hpBarFill.fill(hpRatio > 0.3 ? 0x2ecc71 : 0xe74c3c);
	}

	/* Bottom-left coner with small margin */
	layout(_screenWidth: number, screenHeight: number): void {
		this.view.x = 16;
		this.view.y = screenHeight - PANEL_H - 16;
	}

	get panelWidth(): number {
		return PANEL_W;
	}

	get panelHeight(): number {
		return PANEL_H;
	}

	private drawPortrait(color: number): void {
		this.portrait.clear();
		// Head
		this.portrait.circle(PORTRAIT_SIZE / 2, 14, 12);
		this.portrait.fill(color);
		// Body
		this.portrait.ellipse(PORTRAIT_SIZE / 2, 42, 18, 16);
		this.portrait.fill(color);
		// Frame
		this.portrait.roundRect(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE, 6);
		this.portrait.stroke({ width: 2, color: 0x555555 });
	}

	private capitalize(s: string): string {
		return s.charAt(0).toUpperCase() + s.slice(1);
	}
}
