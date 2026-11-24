import { getUsr } from './users.mjs';

export function isAdmin(id) {
  return getUsr(id)?.role === 'admin';
}
