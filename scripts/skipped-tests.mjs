// Lists the tests a JUnit report (vitest --reporter=junit) marks as skipped, as Markdown.
// Used by .github/workflows/nightly.yml for the run summary: a tool that stopped being found
// shows up there instead of hiding behind a green check.
import { readFileSync } from 'node:fs';

const xml = readFileSync(process.argv[2] ?? 'nightly.xml', 'utf8');
const unescape = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const rows = [];
for (const m of xml.matchAll(/<testcase\s([^>]*?)(\/?)>([\s\S]*?)(?=<testcase\s|<\/testsuite>)/g)) {
  if (m[2] === '/' || !/^\s*<skipped/.test(m[3])) continue;
  const attr = (k) => unescape(m[1].match(new RegExp(`(?:^|\\s)${k}="([^"]*)"`))?.[1] ?? '');
  rows.push(`- ${attr('classname')} › ${attr('name')}`);
}
console.log(`### Tests still skipped: ${rows.length}\n`);
console.log(rows.slice(0, 150).join('\n'));
