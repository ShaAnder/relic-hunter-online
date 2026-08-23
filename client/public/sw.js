// Minimal — exists purely to satisfy Chrome's PWA installability
// requirement (a registered service worker with a fetch handler).
// No caching/offline logic yet; that's a real, separate feature.
self.addEventListener("fetch", () => {});
