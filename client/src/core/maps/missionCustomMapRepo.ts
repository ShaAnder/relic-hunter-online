import {
	DevFileCustomMapRepo,
	DualWriteCustomMapRepo,
	LocalCustomMapRepo,
	type CustomMapRepo,
} from "./CustomMapRepo";

/**
 * The single source Mission Select and Loading both read custom maps
 * from — deliberately the exact same repo Map Creator saves through
 * (see MapCreatorScene), not the raw `CUSTOM_MAPS` static import.
 *
 * Why this matters: `CUSTOM_MAPS` is resolved once, at module load
 * time — it's whatever was bundled/registered when the page opened.
 * Saving a map through Map Creator never touches that array in
 * memory; it writes localStorage immediately and, in dev, a real file
 * on disk. A scene that reads `CUSTOM_MAPS` directly can never see
 * that write without an actual page reload — which is exactly the
 * "save works, but nothing can play it until you refresh" bug this
 * exists to fix.
 *
 * Only list()/load() are ever meant to be called through this export
 * — Mission Select and Loading only ever need to read. That's not
 * just convention: it's what makes this safe to use unmodified in a
 * packaged build. DevFileCustomMapRepo.list()/load() only ever read
 * the static, bundled CUSTOM_MAPS registry — no network call, so nothing
 * about them depends on a dev server existing. Its save()/delete()
 * are the only methods that reach out to the local dev endpoint, and
 * this module intentionally never calls them — Map Creator is the
 * only thing that should.
 */
export const missionCustomMapRepo: CustomMapRepo = new DualWriteCustomMapRepo(
	new DevFileCustomMapRepo(),
	new LocalCustomMapRepo(),
);
