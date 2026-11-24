/**
 * Least-recently-used cache.
 *
 *   new LRU(capacity)   capacity is a positive integer, otherwise a RangeError is thrown
 *   get(key)            the value, or undefined; makes the key the most recently used
 *   set(key, value)     adds or replaces; makes the key the most recently used; when the
 *                       cache is over capacity the least recently used key is removed
 *   has(key)            true / false; does NOT change the order
 *   delete(key)         removes the key; returns whether it was there
 *   size                number of keys (a getter)
 *   keys()              array of keys, least recently used first
 */
export class LRU {
  #map = new Map();
  #capacity;

  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new RangeError('capacity must be a positive integer');
    this.#capacity = capacity;
  }

  get(key) {
    if (!this.#map.has(key)) return undefined;
    const value = this.#map.get(key);
    this.#map.delete(key);
    this.#map.set(key, value);
    return value;
  }

  set(key, value) {
    this.#map.delete(key);
    this.#map.set(key, value);
    if (this.#map.size > this.#capacity) this.#map.delete(this.#map.keys().next().value);
  }

  has(key) {
    return this.#map.has(key);
  }

  delete(key) {
    return this.#map.delete(key);
  }

  get size() {
    return this.#map.size;
  }

  keys() {
    return [...this.#map.keys()];
  }
}
