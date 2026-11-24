import { getUser } from './users.mjs';

export function greet(id) {
  const user = getUser(id);
  return user ? 'Hello, ' + user.name + '!' : 'Hello, stranger!';
}
