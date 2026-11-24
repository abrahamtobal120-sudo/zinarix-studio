import { store } from './store.mjs';

export async function createOrder(customer, items) {
  const order = { customer, items, createdAt: Date.now() };
  return await store.save(order);
}
