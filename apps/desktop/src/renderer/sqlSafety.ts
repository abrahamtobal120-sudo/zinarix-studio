/**
 * Conservative detection of SQL that may write (DML/DDL), used before running a query on a
 * real database (Supabase, BigQuery). False positives only cost one extra confirmation; false
 * negatives would run a write silently, so when in doubt it says "write".
 */

/**
 * Blanks string literals, quoted identifiers and comments (left to right, so a quote inside a
 * comment or a dash inside a string is handled), so their contents don't count. A backslash is
 * not treated as an escape: a string that ends "early" only leaves more text to inspect.
 */
function stripLiterals(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end;
      out += ' ';
    } else if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += ' ';
    } else if (c === "'" || c === '"' || c === '`') {
      const end = sql.indexOf(c, i + 1);
      i = end < 0 ? sql.length : end + 1;
      out += `${c}${c}`;
    } else if (c === '$') {
      const tag = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i));
      const end = tag ? sql.indexOf(tag[0], i + tag[0].length) : -1;
      if (tag && end >= 0) {
        i = end + tag[0].length;
        out += ' ';
      } else {
        out += c;
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const WRITE_WORD =
  /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|merge|copy|call|do|vacuum|comment|into|reindex|refresh|execute|lock|begin|commit|rollback)\b/i;
const READ_START = /^\s*\(*\s*(select|with|explain|show|table|values|describe)\b/i;

/** True when the query could change data or schema (or runs more than one statement). */
export function isWriteSql(sql: string): boolean {
  const s = stripLiterals(sql)
    .trim()
    .replace(/;[\s;]*$/, '');
  if (!s) return false;
  if (s.includes(';')) return true; // several statements
  if (!READ_START.test(s)) return true;
  return WRITE_WORD.test(s);
}

/** A short excerpt of the query to show in a confirmation. */
export function sqlExcerpt(sql: string, max = 240): string {
  const one = sql.trim().replace(/\s+/g, ' ');
  return one.length > max ? `${one.slice(0, max)}…` : one;
}
