import { store } from './store.mjs';

export async function createOrder(customer, items) {
  const order = { customer, items, createdAt: Date.now() };
  let saved = {};
  store
    .save(order)
    .then((s) => {
      saved = s;
    })
    .catch(() => {});
  return { ...order, id: saved.id };
}
