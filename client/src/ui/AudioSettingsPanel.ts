import { Container, Text } from "pixi.js";
import type { Game } from "@/core/game/Game";
import { Slider } from "./generics/Slider";

/**
 * The actual audio-settings content: one row per volume (Master,
 * Music, Effects), each a label + slider + live percentage readout,
 * wired straight into AudioService. Deliberately just a Container-
 * wrapping class, not a Scene or Overlay itself — it doesn't know or
 * care whether it's embedded in a full-screen Settings scene or
 * layered as a pause-menu overlay. That's exactly what lets the same
 * panel serve both places without being duplicated.
 */
export class AudioSettingsPanel {
	readonly view = new Container();

	constructor(game: Game, stage: Container) {
		const rows: {
			label: string;
			getValue: () => number;
			setValue: (v: number) => void;
		}[] = [
			{
				label: "Master",
				getValue: () => game.audio.getMasterVolume(),
				setValue: (v) => game.audio.setMasterVolume(v),
			},
			{
				label: "Music",
				getValue: () => game.audio.getMusicVolume(),
				setValue: (v) => game.audio.setMusicVolume(v),
			},
			{
				label: "Effects",
				getValue: () => game.audio.getSfxVolume(),
				setValue: (v) => game.audio.setSfxVolume(v),
			},
		];

		rows.forEach((row, i) => {
			const rowContainer = new Container();
			rowContainer.y = i * 70;

			const label = new Text({
				text: row.label,
				style: { fill: 0xffffff, fontSize: 20 },
			});
			rowContainer.addChild(label);

			const percentLabel = new Text({
				text: `${Math.round(row.getValue() * 100)}%`,
				style: { fill: 0xaaaaaa, fontSize: 16 },
			});
			percentLabel.x = 320;
			rowContainer.addChild(percentLabel);

			// stage is passed straight through to Slider — it needs the
			// real application-level stage for its drag handling
			// (see Slider.ts / Hand.ts's card-drag for why), and since
			// this panel might be embedded inside a Scene or an Overlay,
			// it can't assume which one owns "the stage" — the caller
			// who actually knows has to hand it in.
			const slider = new Slider(stage, {
				width: 240,
				value: row.getValue(),
				onChange: (v) => {
					row.setValue(v);
					percentLabel.text = `${Math.round(v * 100)}%`;
				},
			});
			slider.view.x = 0;
			slider.view.y = 30;
			rowContainer.addChild(slider.view);

			this.view.addChild(rowContainer);
		});
	}
}
