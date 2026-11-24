import assert from 'node:assert/strict';
import { paginate, pageCount } from './src/paginate.mjs';

const items = [1, 2, 3, 4, 5, 6, 7];
assert.deepEqual(paginate(items, 1, 3), [1, 2, 3]);
assert.deepEqual(paginate(items, 2, 3), [4, 5, 6]);
assert.deepEqual(paginate(items, 3, 3), [7]);
assert.deepEqual(paginate(items, 4, 3), []);
assert.equal(pageCount(items, 3), 3);
assert.equal(pageCount([1, 2, 3, 4], 2), 2);
assert.equal(pageCount([], 5), 0);
