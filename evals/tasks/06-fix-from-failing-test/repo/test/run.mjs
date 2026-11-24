import assert from 'node:assert/strict';
import { total } from '../src/cart.mjs';

assert.equal(total({ lines: [{ price: 2.5, qty: 2 }] }), 5);
assert.equal(total({ lines: [{ price: 1.15, qty: 1 }] }), 1.15);
console.log('ok');
