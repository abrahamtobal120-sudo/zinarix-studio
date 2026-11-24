export function parse(version) {
  const [core, pre] = version.split('-');
  const [major, minor, patch] = core.split('.').map(Number);
  return { major, minor, patch, pre: pre ?? '' };
}

// -1 when a is older than b, 1 when it is newer, 0 when they are the same.
export function compare(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (const key of ['major', 'minor', 'patch']) {
    if (x[key] < y[key]) return -1;
    if (x[key] > y[key]) return 1;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === '') return 1;
  if (y.pre === '') return -1;
  return x.pre < y.pre ? -1 : 1;
}

export const sort = (versions) => [...versions].sort(compare);
