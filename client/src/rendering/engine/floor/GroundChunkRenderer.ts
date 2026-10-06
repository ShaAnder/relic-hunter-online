import type { Container } from "pixi.js";
import { perf } from "@/perf/PerfMonitor";
import { QuadBatchBuilder } from "../batching/QuadBatchBuilder";
import type { RenderChunkId } from "../chunks/ChunkCoord";
import type {
	CompiledFloorVisual,
	CompiledTileSurface,
	VisualUvs,
} from "../compiler/CompiledFloorVisual";
import {
	GpuMaterialLibrary,
	type ResolvedGroundGpuMaterial,
} from "../gpu/GpuMaterialLibrary";
import { createStaticGroundMesh } from "../gpu/StaticMeshFactory";
import type { FogPresentationBuffer } from "../presentation/FogPresentationBuffer";
import { GroundPresentationCode } from "../presentation/PresentationDiff";
import { GroundChunkHandle } from "./GroundChunkHandle";

interface OrderedTile {
	tile: CompiledTileSurface;

	/**
	 * Stable tie-breaker matching compiler insertion order when two tiles share
	 * the same legacy painter depth.
	 */
	sourceOrder: number;
}

/**
 * Builds the active floor's static ground as one globally ordered mesh.
 *
 * The previous depth-strata fix restored visual correctness but turned painter
 * depth into batch identity, producing hundreds of tiny meshes. Ground does not
 * need to interleave with actors or walls because the entire ground root is
 * already below the world-depth root. We can therefore preserve exact tile
 * painter order inside one index buffer and submit the floor in one draw.
 */
export class GroundChunkRenderer {
	private readonly materialLibrary = new GpuMaterialLibrary();
	private handle: GroundChunkHandle | null = null;
	private readonly chunkIds = new Set<RenderChunkId>();

	constructor(private readonly root: Container) {
		/**
		 * The ground root now contains a single ordered mesh, so child zIndex
		 * sorting is unnecessary overhead.
		 */
		this.root.sortableChildren = false;
	}

	get chunkCount(): number {
		return this.chunkIds.size;
	}

	get meshCount(): number {
		return this.handle?.meshCount ?? 0;
	}

	get vertexCount(): number {
		return this.handle?.vertexCount ?? 0;
	}

	mount(compiled: CompiledFloorVisual): void {
		this.destroy();

		if (compiled.tiles.length === 0) {
			return;
		}

		for (const chunk of compiled.chunks.values()) {
			if (chunk.tiles.length > 0) {
				this.chunkIds.add(chunk.chunkId);
			}
		}

		const orderedTiles: OrderedTile[] = compiled.tiles.map(
			(tile, sourceOrder) => ({
				tile,
				sourceOrder,
			}),
		);

		/**
		 * Legacy ground used per-tile zIndex. A single mesh cannot use Pixi child
		 * sorting between its quads, so encode the exact same painter order
		 * directly into triangle submission order.
		 */
		orderedTiles.sort(
			(a, b) => a.tile.depth - b.tile.depth || a.sourceOrder - b.sourceOrder,
		);

		const builder = new QuadBatchBuilder();
		let sharedMaterial: ResolvedGroundGpuMaterial | null = null;

		for (const entry of orderedTiles) {
			const tile = entry.tile;
			const material = this.materialLibrary.resolveGround(
				tile.material,
				tile.topology.sameSurfaceMask,
			);

			if (!sharedMaterial) {
				sharedMaterial = material;
			} else if (
				sharedMaterial.batchKey !== material.batchKey ||
				sharedMaterial.texture.source !== material.texture.source
			) {
				throw new Error(
					"GroundChunkRenderer: ground atlas contract produced incompatible GPU materials",
				);
			}

			const tileIndex = tile.coord.y * compiled.width + tile.coord.x;

			const surfaceUvs = surfaceUvsForTile(tile);

			builder.addQuad(
				tile.quad,
				tile.uvs,
				tileIndex,
				GroundPresentationCode.Normal,
				{
					surfaceUvs,

					primaryAtlasRect: material.primary.atlasRect,

					underlayAtlasRect: material.underlay?.atlasRect ?? [0, 0, 0, 0],

					edgeAtlasRect: material.edgeAtlasRect ?? [0, 0, 0, 0],

					primaryParams: [
						material.primary.samplingMode,
						material.primary.repeatTilesX,
						material.primary.repeatTilesY,
						material.primary.wrapMode,
					],

					underlayParams: material.underlay
						? [
								material.underlay.samplingMode,
								material.underlay.repeatTilesX,
								material.underlay.repeatTilesY,
								material.underlay.wrapMode,
							]
						: [0, 1, 1, 0],

					edgeParams: [material.edgeMode, tile.topology.sameSurfaceMask, 0, 0],

					animationParams: [
						material.animationSpeed,
						material.windInfluence,
						0,
						0,
					],
				},
			);
		}

		if (!sharedMaterial) {
			return;
		}

		const data = builder.freeze();
		const meshHandle = createStaticGroundMesh(data, sharedMaterial);

		/**
		 * One mesh means Pixi performs one ground submission while the index
		 * buffer itself preserves exact tile painter order.
		 */
		this.handle = new GroundChunkHandle(meshHandle, compiled.chunkSize);
		this.handle.attach(this.root);

		perf.setCounter("engine.groundChunkCount", this.chunkIds.size);
		perf.setCounter("engine.groundMeshCount", this.handle.meshCount);
		perf.setCounter("engine.groundVertexCount", this.handle.vertexCount);
	}

	updatePresentation(
		dirtyChunkIds: ReadonlySet<RenderChunkId>,
		mapWidth: number,
		fog: FogPresentationBuffer,
		focusCellKeys: ReadonlySet<string> | null,
		forceWashed: boolean,
	): void {
		this.handle?.updatePresentation(
			dirtyChunkIds,
			mapWidth,
			fog,
			focusCellKeys,
			forceWashed,
		);
	}

	allChunkIds(): ReadonlySet<RenderChunkId> {
		return new Set(this.chunkIds);
	}

	attach(): void {
		this.handle?.attach(this.root);
	}

	detach(): void {
		this.handle?.detach();
	}

	destroy(): void {
		this.handle = null;
		this.chunkIds.clear();
	}
}

/**
 * Remap the compiler's ordinary 0..1 tile UVs into one region of the shared
 * texture atlas.
 */
function surfaceUvsForTile(tile: CompiledTileSurface): VisualUvs {
	const x = tile.coord.x;
	const y = tile.coord.y;

	return [x, y, x + 1, y, x + 1, y + 1, x, y + 1];
}

/**
 * LEARNING NOTE:
 *
 * Painter order and batch identity are separate concepts. The failed strata
 * version made every depth a different batch, which was visually correct but
 * produced hundreds of Mesh objects. Here the index buffer itself stores the
 * required tile order, while a texture atlas lets visually different tiles
 * remain compatible with the same GPU material and therefore the same mesh.
 */
