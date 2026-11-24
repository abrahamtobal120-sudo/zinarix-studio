import assert from 'node:assert/strict';
import { total } from './src/cart.mjs';

assert.equal(total({ lines: [{ price: 2.5, qty: 2 }] }), 5);
assert.equal(total({ lines: [{ price: 1.15, qty: 1 }] }), 1.15);
assert.equal(total({ lines: [{ price: 4.35, qty: 1 }] }), 4.35);
assert.equal(total({ lines: [{ price: 0.29, qty: 3 }] }), 0.87);
assert.equal(
  total({
    lines: [
      { price: 19.99, qty: 2 },
      { price: 0.01, qty: 2 },
    ],
    coupon: { percent: 10 },
  }),
  36,
);
