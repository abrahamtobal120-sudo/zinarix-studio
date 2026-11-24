import assert from 'node:assert/strict';
import { createOrder } from './src/service.mjs';
import { store } from './src/store.mjs';

const order = await createOrder('ana', [{ sku: 'a', qty: 1 }]);
assert.ok(Number.isInteger(order.id), 'id');
assert.equal(order.customer, 'ana');
assert.equal((await store.get(order.id)).customer, 'ana');
const second = await createOrder('luis', [{ sku: 'b', qty: 2 }]);
assert.notEqual(second.id, order.id);
await assert.rejects(createOrder('ana', []), /no items/);
