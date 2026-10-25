'use strict';

/**
 * Einfacher In-Memory-Cache mit TTL. Parallele Anfragen auf denselben Key
 * teilen sich ein Promise, damit Upstream-APIs nicht mehrfach getroffen werden.
 */
class TtlCache {
  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
    this.store = new Map();
  }

  async wrap(key, ttlMs, loader) {
    const hit = this.store.get(key);
    if (hit && hit.expires > Date.now()) return hit.promise;

    const promise = loader();
    this.store.set(key, { promise, expires: Date.now() + ttlMs });
    if (this.store.size > this.maxEntries) {
      this.store.delete(this.store.keys().next().value);
    }
    // Fehler nicht cachen
    promise.catch(() => {
      if (this.store.get(key)?.promise === promise) this.store.delete(key);
    });
    return promise;
  }

  clear() {
    this.store.clear();
  }
}

module.exports = { TtlCache };
