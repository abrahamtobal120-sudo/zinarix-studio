// Money is added up in whole cents to avoid floating point drift.
export const toCents = (amount) => Math.floor(amount * 100);
export const fromCents = (cents) => cents / 100;
