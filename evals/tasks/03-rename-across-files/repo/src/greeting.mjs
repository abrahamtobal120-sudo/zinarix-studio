import { getUsr } from './users.mjs';

export function greet(id) {
  const user = getUsr(id);
  return user ? 'Hello, ' + user.name + '!' : 'Hello, stranger!';
}
