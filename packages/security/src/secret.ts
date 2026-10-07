import { inspect } from 'node:util';
import { registerSecret } from './redact.js';

/** Masks a key for display: `sk-…a9F2`. Short values are fully hidden. */
export function maskKey(value: string): string {
  if (value.length < 12) return '••••';
  const prefixMatch = /^[A-Za-z]{2,6}[-_]/.exec(value);
  const prefix = prefixMatch ? prefixMatch[0] : value.slice(0, 2);
  return `${prefix}…${value.slice(-4)}`;
}

/**
 * Opaque wrapper for credentials. Every implicit conversion (string coercion, JSON,
 * util.inspect / console.log) yields the masked form; only `reveal()` returns the value,
 * and it should be called exactly where a header is built.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
    registerSecret(value);
  }

  reveal(): string {
    return this.#value;
  }

  get masked(): string {
    return maskKey(this.#value);
  }

  get isEmpty(): boolean {
    return this.#value.length === 0;
  }

  toString(): string {
    return this.masked;
  }

  toJSON(): string {
    return this.masked;
  }

  [Symbol.toPrimitive](): string {
    return this.masked;
  }

  [inspect.custom](): string {
    return `Secret(${this.masked})`;
  }
}
