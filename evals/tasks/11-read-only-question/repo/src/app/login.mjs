import { recordEvent } from '../infra/journal.mjs';

export function login(user) {
  recordEvent('login', user);
  return { user, at: Date.now() };
}
