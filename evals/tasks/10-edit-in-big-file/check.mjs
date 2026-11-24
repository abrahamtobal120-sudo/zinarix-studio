import assert from 'node:assert/strict';
import { routes } from './src/routes.mjs';

assert.equal(routes.length, 256);
const find = (method, path) => routes.filter((r) => r.method === method && r.path === path);
const v2 = find('POST', '/api/v2/orders/:id/refund');
assert.equal(v2.length, 1);
assert.equal(v2[0].handler, 'refundOrderV2');
assert.equal(v2[0].auth, 'admin');
const v1 = find('POST', '/api/v1/orders/:id/refund');
assert.equal(v1.length, 1);
assert.equal(v1[0].handler, 'refundOrderV1');
assert.equal(v1[0].auth, 'user');
assert.equal(routes.filter((r) => r.auth === 'admin').length, 1);
assert.equal(find('POST', '/api/v2/payments/:id/refund')[0].handler, 'refundPaymentV2');
assert.equal(routes.filter((r) => r.handler === 'refundOrderV1').length, 1);
