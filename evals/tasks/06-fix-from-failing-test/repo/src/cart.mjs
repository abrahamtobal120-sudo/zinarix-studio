import { toCents, fromCents } from './money.mjs';

export function total(cart) {
  let cents = 0;
  for (const line of cart.lines) cents += toCents(line.price) * line.qty;
  if (cart.coupon) cents -= Math.round((cents * cart.coupon.percent) / 100);
  return fromCents(cents);
}
