import { getUser } from './users.mjs';

export function isAdmin(id) {
  return getUser(id)?.role === 'admin';
}
