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
  constructor(_capacity) {
    throw new Error('not implemented');
  }
}
