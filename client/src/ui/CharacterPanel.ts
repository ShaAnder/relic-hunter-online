import { Container, Graphics, Text } from "pixi.js";
import type { CharacterData } from "@relic-hunter/shared";

/**
 * Compact read-only character summary used in MapScene (top-right)
 * and reusable anywhere we need a quick hunter readout.
 */
export class CharacterPanel {
	readonly view = new Container();

	private bg = new Graphics();
	private nameText: Text;
	private metaText: Text;
	private statsText: Text;

	constructor() {
		this.bg.roundRect(0, 0, 260, 110, 8);
		this.bg.fill({ color: 0x1a1a1a, alpha: 0.85 });
		this.bg.stroke({ width: 1, color: 0x555555 });
		this.view.addChild(this.bg);

		this.nameText = new Text({
			text: "",
			style: { fill: 0xffffff, fontSize: 16, fontWeight: "bold" },
		});
		this.nameText.x = 12;
		this.nameText.y = 10;
		this.view.addChild(this.nameText);

		this.metaText = new Text({
			text: "",
			style: { fill: 0xaaaaaa, fontSize: 13 },
		});
		this.metaText.x = 12;
		this.metaText.y = 34;
		this.view.addChild(this.metaText);

		this.statsText = new Text({
			text: "",
			style: { fill: 0x88ccff, fontSize: 13 },
		});
		this.statsText.x = 12;
		this.statsText.y = 58;
		this.view.addChild(this.statsText);
	}

	/** Update the panel from the active CharacterData (or clear it). */
	setCharacter(character: CharacterData | null): void {
		if (!character) {
			this.nameText.text = "No character";
			this.metaText.text = "";
			this.statsText.text = "";
			return;
		}

		this.nameText.text = character.name;
		this.metaText.text = `${this.capitalize(character.characterClass)}  ·  Model ${character.modelIndex + 1}`;
		this.statsText.text =
			`Mov ${character.stats.movement}  Atk ${character.stats.attack}  ` +
			`Def ${character.stats.defense}  HP ${character.stats.maxHp}  AP ${character.stats.ap}`;
	}

	/** Position the panel in the top-right corner. */
	layout(screenWidth: number): void {
		this.view.x = screenWidth - 280;
		this.view.y = 12;
	}

	private capitalize(s: string): string {
		return s.charAt(0).toUpperCase() + s.slice(1);
	}
}
