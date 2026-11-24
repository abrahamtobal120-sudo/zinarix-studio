let nextId = 1;
const rows = new Map();

export const store = {
  async save(order) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (!order.items || order.items.length === 0) throw new Error('order has no items');
    const saved = { ...order, id: nextId++ };
    rows.set(saved.id, saved);
    return saved;
  },
  async get(id) {
    return rows.get(id) ?? null;
  },
};
