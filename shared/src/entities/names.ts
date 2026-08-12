const HUNTER_NAMES = [
	"Aldric",
	"Brynn",
	"Cassia",
	"Dorian",
	"Elara",
	"Finnick",
	"Genna",
	"Hollis",
	"Isolde",
	"Joran",
	"Kael",
	"Liora",
	"Mordecai",
	"Nessa",
	"Osric",
	"Petra",
	"Quill",
	"Rosalind",
	"Soren",
	"Thora",
];

/** Picks a random hunter name for an AI-controlled unit. Not seeded — cosmetic variety, not something that needs reproducibility. */
export function generateHunterName(): string {
	return HUNTER_NAMES[Math.floor(Math.random() * HUNTER_NAMES.length)];
}
