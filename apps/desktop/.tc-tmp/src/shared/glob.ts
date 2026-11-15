/** Converts a glob (*, **, ?, {a,b}) to an anchored RegExp over "/"-separated paths. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  let inBraces = 0;
  const g = glob.replace(/^\.\//, '');
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      inBraces++;
      re += '(?:';
    } else if (c === '}' && inBraces) {
      inBraces--;
      re += ')';
    } else if (c === ',' && inBraces) re += '|';
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  // A pattern without a slash matches the file name anywhere ("*.ts" == "**/*.ts").
  return new RegExp(g.includes('/') ? `^${re}$` : `^(?:.*/)?${re}$`, 'i');
}
