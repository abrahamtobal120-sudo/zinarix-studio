const USERS = [
  { id: 1, name: 'Ada', role: 'admin' },
  { id: 2, name: 'Linus', role: 'dev' },
  { id: 3, name: 'Grace', role: 'dev' },
];

export function getUsr(id) {
  return USERS.find((u) => u.id === id) ?? null;
}

export function allIds() {
  return USERS.map((u) => u.id);
}
