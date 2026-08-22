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
	private hpBarLost = new Graphics();
	private hpText: Text;
	private nameText: Text;
	private movLabel: Text;
	private movNumber: Text;
	private atkLabel: Text;
	private atkNumber: Text;
	private defLabel: Text;
	private defNumber: Text;
	private apText: Text;
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
		this.hpBarLost.y = this.portrait.y + 22;
		this.infoBlock.addChild(this.hpBarLost);

		this.hpText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 10, fontWeight: "bold" },
		});
		this.hpText.x = CONTENT_X;
		this.hpText.y = this.portrait.y + 38;
		this.infoBlock.addChild(this.hpText);

		const statY = this.portrait.y + 54;
		const makeStatText = (fill = 0xffffff): Text =>
			new Text({ text: "", style: { fill, fontSize: 13 } });

		this.movLabel = makeStatText();
		this.movNumber = makeStatText();
		this.atkLabel = makeStatText();
		this.atkNumber = makeStatText();
		this.defLabel = makeStatText();
		this.defNumber = makeStatText();
		this.apText = makeStatText();

		// Each slot's label starts at a fixed offset; its number sits
		// right after the label's own width. Labels never change their
		// own text, so this never reflows — only the number's content
		// (and color) ever changes on refresh.
		this.movLabel.text = "Mov ";
		this.movLabel.x = CONTENT_X;
		this.movNumber.x = this.movLabel.x + this.movLabel.width;

		this.atkLabel.text = "Atk ";
		this.atkLabel.x = CONTENT_X + 50;
		this.atkNumber.x = this.atkLabel.x + this.atkLabel.width;

		this.defLabel.text = "Def ";
		this.defLabel.x = CONTENT_X + 100;
		this.defNumber.x = this.defLabel.x + this.defLabel.width;

		this.apText.x = CONTENT_X + 150;

		for (const t of [
			this.movLabel,
			this.movNumber,
			this.atkLabel,
			this.atkNumber,
			this.defLabel,
			this.defNumber,
			this.apText,
		]) {
			t.y = statY;
			this.infoBlock.addChild(t);
		}

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
			this.movNumber.text = "";
			this.atkNumber.text = "";
			this.defNumber.text = "";
			this.apText.text = "";
			this.hpText.text = "";
			this.hpBarFill.clear();
			this.hpBarLost.clear();
			return;
		}
		this.nameText.text = `${character.name}  ·  ${this.capitalize(character.characterClass)}`;

		this.setMovementStatText(
			state.stats.movement,
			state.temporaryStatBonus.movement,
		);
		this.setAttackStatText(state.stats.attack, state.temporaryStatBonus.attack);
		this.setDefenseStatText(
			state.stats.defense,
			state.temporaryStatBonus.defense,
		);
		this.apText.text = `AP ${apRemaining}/${baseAP}`;

		const trueMaxHp = state.stats.maxHp;
		const ceiling = Math.max(1, state.hpCeiling);
		const current = Math.max(0, state.currentHp);

		const fillRatio = Math.max(0, Math.min(1, current / trueMaxHp));
		const ceilingRatio = Math.max(0, Math.min(1, ceiling / trueMaxHp));

		// current / ceiling — heal target is the reduced max
		this.hpText.text = `${current}/${ceiling}`;

		this.hpBarFill.clear();
		this.hpBarFill.roundRect(CONTENT_X, 0, HP_BAR_WIDTH * fillRatio, 14, 3);
		this.hpBarFill.fill(fillRatio > 0.3 ? 0x2ecc71 : 0xe74c3c);

		// Black out the strip you can never heal into (ceiling → true max)
		this.hpBarLost.clear();
		if (ceilingRatio < 1) {
			const lostX = CONTENT_X + HP_BAR_WIDTH * ceilingRatio;
			const lostW = HP_BAR_WIDTH * (1 - ceilingRatio);
			this.hpBarLost.roundRect(lostX, 0, lostW, 14, 3);
			this.hpBarLost.fill({ color: 0x000000, alpha: 0.55 });
		}
	}

	/** Movement has no A/C special-card concept — always a plain numeric bonus. */
	private setMovementStatText(base: number, bonus: number): void {
		this.movNumber.text = `${base + bonus}`;
		this.movNumber.style.fill =
			bonus > 0 ? 0x4a9eff : bonus < 0 ? 0xe74c3c : 0xffffff;
	}

	/** "A" here means a flat 2x multiplier, "C" means 1.5x — matches computeAttackValue exactly. Different meaning from defense's "A"/"C" despite the same letters. */
	private setAttackStatText(base: number, bonus: number | "A" | "C"): void {
		if (bonus === "A") {
			this.atkNumber.text = `${base * 2}`;
			this.atkNumber.style.fill = 0x4a9eff;
			return;
		}
		if (bonus === "C") {
			this.atkNumber.text = `${Math.round(base * 1.5)}`;
			this.atkNumber.style.fill = 0x4a9eff;
			return;
		}
		this.atkNumber.text = `${base + bonus}`;
		this.atkNumber.style.fill =
			bonus > 0 ? 0x4a9eff : bonus < 0 ? 0xe74c3c : 0xffffff;
	}

	/** "A" here means full immunity, "C" means a 1.5x defense ceiling — matches resolveHazardRoll's own handling of these cards. */
	private setDefenseStatText(base: number, bonus: number | "A" | "C"): void {
		if (bonus === "A") {
			this.defNumber.text = "IMM";
			this.defNumber.style.fill = 0x4a9eff;
			return;
		}
		if (bonus === "C") {
			this.defNumber.text = `${Math.round(base * 1.5)}`;
			this.defNumber.style.fill = 0x4a9eff;
			return;
		}
		this.defNumber.text = `${base + bonus}`;
		this.defNumber.style.fill =
			bonus > 0 ? 0x4a9eff : bonus < 0 ? 0xe74c3c : 0xffffff;
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
