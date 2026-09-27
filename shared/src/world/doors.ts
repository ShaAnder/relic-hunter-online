/**
 * Authoritative semantic state for a dynamic door.
 *
 * Phase 4 establishes the shared state vocabulary and renderer seam.
 * Current traversal/LOS behavior is deliberately preserved until gameplay
 * explicitly starts consuming these states.
 */
export type DoorState = "closed" | "opening" | "open" | "closing";
