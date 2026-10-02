import { Container } from "pixi.js";
import * as RH from "@relic-hunter/shared";
import { EngineCompilerHarness } from "@/rendering/engine/EngineCompilerHarness";
import { FloorRenderer } from "@/rendering/engine/floor/FloorRenderer";
import { preloadMapMaterials } from "@/rendering/engine/materials/mapMaterialFactory";
import { preloadBarrierMaterials } from "@/rendering/engine/materials/barrierMaterialFactory";
/**
 * Editor-only owner of a real engine-rendered floor preview.
 *
 * MapCreatorScene owns authored data. This object owns only the transient
 * compiler and Pixi/GPU representation used to inspect that authored state.
 *
 * Reusing the production path keeps projection, painter order, elevation,
 * material resolution and barrier rendering identical to gameplay.
 */
export class MapCreatorEnginePreview {
	readonly view = new Container();
	private readonly groundRoot = new Container();
	private readonly worldDepthRoot = new Container();
	private readonly compiler = new EngineCompilerHarness();
	private readonly renderer = new FloorRenderer(this.groundRoot, this.worldDepthRoot, "active");
	private ready = false;
	constructor() {
		/**
		 * Static world strata and dynamic doors need the same sortable sibling
		 * domain they use in gameplay.
		 */
		this.worldDepthRoot.sortableChildren =
			true;
		this.view.addChild(this.groundRoot, this.worldDepthRoot);
	}
	/**
	 * Load the exact resources consumed by the production renderer.
	 *
	 * Both preload functions are already idempotent, and this guard keeps the
	 * editor-level lifecycle explicit as well.
	 */
	async initialize(): Promise<void> {
		if (this.ready) {
			return;
		}
		await Promise.all([
			preloadMapMaterials(),
			preloadBarrierMaterials(),
		]);
		this.ready =
			true;
	}
	/**
	 * Render one authored floor through the real engine pipeline.
	 *
	 * An editor refresh represents a new structural generation. Until profiling
	 * proves this too expensive, correctness is simpler if both CPU compilation
	 * and GPU/Pixi runtime caches are invalidated together.
	 */
	render(bundle: RH.MapBundle, floorIndex: number): void {
		if (!this.ready) {
			throw new Error("MapCreatorEnginePreview.render called before initialize");
		}
		const floors = RH.compileMapBundle(bundle);
		const source = floors[floorIndex];
		if (!source) {
			this.renderer.deactivate();
			return;
		}
		this.compiler.invalidate();
		this.renderer.clearCache();
		const compiled = this.compiler.compile(source, {
			/**
			 * A stable editor seed keeps deterministic visual variants in the
			 * same places while repeatedly previewing unchanged authored data.
			 */
			mapSeed: 0,
			floorIndex,
		});
		this.renderer.mount(compiled, {
			renderWorld: true,
		});
		/**
		 * Preview shows authored geometry directly. Gameplay fog and room focus
		 * have no authoring observer here and are deliberately disabled.
		 */
		this.renderer.updatePresentation({
			fog: null,
			focusRoom: null,
			forceWashed: false,
		});
	}
	/**
	 * Scene-exit cleanup: release all retained runtime/GPU resources.
	 */
	destroy(): void {
		this.renderer.destroy();
		this.view.removeChildren();
		this.view.destroy({
			children: true,
		});
	}
}

