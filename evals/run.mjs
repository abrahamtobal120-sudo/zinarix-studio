#!/usr/bin/env node
// Task bench for the Zinarix agent (A10 of README-ESTUDIO.md).
//
//   node evals/run.mjs --selfcheck                 every task fails as shipped and passes
//                                                  with its reference solution (no model used)
//   node evals/run.mjs --model provider/model      run the agent (`omni agent`) on every task
//       [--task 01,07] [--runs 3] [--max-steps 25] [--timeout 600] [--keep] [--label name]
//
// A task is a folder in evals/tasks/<id>/:
//   task.json   { title, prompt, approve?: "full" | "auto-edit" | "read-only", crlf?: [paths] }
//   repo/       the project the agent works on (copied to a temp folder for each run)
//   check.mjs   hidden check: copied in only after the agent finished; exit code 0 = solved
//   solution/   reference solution laid over repo/ (used by --selfcheck)
// The agent's final answer is written to __answer__.txt before the check runs.
import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const tasksDir = join(here, 'tasks');
const cli = join(root, 'apps/cli/dist/index.js');

function parseArgs(argv) {
  const opts = { runs: 1, maxSteps: 25, timeout: 600 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--selfcheck') opts.selfcheck = true;
    else if (a === '--keep') opts.keep = true;
    else if (a === '--model' || a === '-m') opts.model = value();
    else if (a === '--task') opts.tasks = value().split(',');
    else if (a === '--runs') opts.runs = Number(value());
    else if (a === '--max-steps') opts.maxSteps = Number(value());
    else if (a === '--timeout') opts.timeout = Number(value());
    else if (a === '--label') opts.label = value();
    else throw new Error(`unknown option: ${a}`);
  }
  for (const k of ['runs', 'maxSteps', 'timeout'])
    if (!Number.isInteger(opts[k]) || opts[k] < 1)
      throw new Error(`--${k} must be a positive integer`);
  return opts;
}

function loadTasks(filter) {
  const ids = readdirSync(tasksDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const wanted = filter ? ids.filter((id) => filter.some((f) => id.startsWith(f))) : ids;
  if (!wanted.length) throw new Error('no task matches');
  return wanted.map((id) => {
    const dir = join(tasksDir, id);
    const def = JSON.parse(readFileSync(join(dir, 'task.json'), 'utf8'));
    return { id, dir, approve: 'full', crlf: [], ...def };
  });
}

/** Git stores the fixtures with LF; tasks about Windows line endings get CRLF back here. */
function applyCrlf(work, files) {
  for (const rel of files) {
    const file = join(work, rel);
    if (!existsSync(file)) continue;
    writeFileSync(file, readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'));
  }
}

function prepare(task) {
  const work = mkdtempSync(join(tmpdir(), `zinarix-eval-${task.id}-`));
  cpSync(join(task.dir, 'repo'), work, { recursive: true });
  applyCrlf(work, task.crlf);
  return work;
}

function check(task, work) {
  cpSync(join(task.dir, 'check.mjs'), join(work, '__check__.mjs'));
  const r = spawnSync(process.execPath, ['__check__.mjs'], {
    cwd: work,
    encoding: 'utf8',
    timeout: 60_000,
  });
  const detail = (r.stderr || r.stdout || '').trim().split('\n').slice(0, 12).join('\n');
  return { pass: r.status === 0, detail: r.status === 0 ? '' : detail };
}

function selfcheck(tasks) {
  let bad = 0;
  for (const task of tasks) {
    const work = prepare(task);
    try {
      const before = check(task, work);
      cpSync(join(task.dir, 'solution'), work, { recursive: true });
      applyCrlf(work, task.crlf);
      const after = check(task, work);
      const ok = !before.pass && after.pass;
      if (!ok) bad++;
      const why = before.pass
        ? 'the check passes on the untouched repo'
        : after.pass
          ? ''
          : `the reference solution fails:\n${after.detail}`;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${task.id}${why ? ` — ${why}` : ''}`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  console.log(`${tasks.length - bad}/${tasks.length} tasks are sound`);
  return bad === 0;
}

/**
 * The agent's result from its event stream (one JSON object per line). A run that was
 * killed has no final "result" event: what it did until then is rebuilt from the events,
 * with `stuckAt` telling where it stopped.
 */
function fromEvents(stdout) {
  const partial = {
    text: '',
    steps: 0,
    tools: [],
    filesChanged: [],
    usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
  };
  let last = '';
  for (const line of stdout.split('\n')) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === 'result') return ev;
    if (ev.type === 'text') {
      partial.text += ev.delta;
      last = `writing step ${partial.steps + 1} (${partial.text.length} characters so far)`;
      continue;
    }
    if (ev.type === 'step') {
      partial.steps = ev.step;
      partial.usage.inputTokens += ev.inputTokens;
      partial.usage.outputTokens += ev.outputTokens;
      partial.usage.usd =
        partial.usage.usd === null || ev.usd === null ? null : partial.usage.usd + ev.usd;
      partial.text = '';
    } else if (ev.type === 'tool_result')
      partial.tools.push({ name: ev.name, ok: ev.ok, ...(ev.denied ? { denied: ev.denied } : {}) });
    else if (ev.type === 'file_changed') partial.filesChanged.push(ev.path);
    last = JSON.stringify(ev).slice(0, 300);
  }
  return last ? { ...partial, stuckAt: last } : null;
}

function runAgent(task, work, opts) {
  const args = [
    cli,
    'agent',
    '--approve',
    task.approve,
    '--stream-json',
    '--quiet',
    '-C',
    work,
    '-m',
    opts.model,
    '--max-steps',
    String(task.maxSteps ?? opts.maxSteps),
    '-p',
    task.prompt,
  ];
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, args, { cwd: work, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeout * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const result = fromEvents(stdout);
      resolve({ code, result, stderr: stderr.trim(), timedOut, wallMs: Date.now() - started });
    });
  });
}

async function runOne(task, opts) {
  const work = prepare(task);
  try {
    const run = await runAgent(task, work, opts);
    const r = run.result;
    writeFileSync(join(work, '__answer__.txt'), r?.text ?? '');
    const verdict = check(task, work);
    const tools = r?.tools ?? [];
    return {
      task: task.id,
      pass: verdict.pass,
      stop: run.timedOut ? 'timeout' : (r?.stop ?? 'crash'),
      steps: r?.steps ?? 0,
      toolCalls: tools.length,
      toolErrors: tools.filter((t) => !t.ok && !t.denied).length,
      denied: tools.filter((t) => t.denied).length,
      filesChanged: r?.filesChanged?.length ?? 0,
      inputTokens: r?.usage?.inputTokens ?? 0,
      outputTokens: r?.usage?.outputTokens ?? 0,
      usd: r?.usage?.usd ?? null,
      seconds: Math.round(run.wallMs / 100) / 10,
      error:
        r?.error ??
        (r?.stuckAt ? `stuck at: ${r.stuckAt}` : undefined) ??
        (r ? undefined : run.stderr.split('\n').slice(-3).join(' ')),
      checkDetail: verdict.detail || undefined,
      ...(opts.keep ? { dir: work } : {}),
    };
  } finally {
    if (!opts.keep) rmSync(work, { recursive: true, force: true });
  }
}

const sum = (rows, key) => rows.reduce((n, r) => n + (r[key] ?? 0), 0);
const kTok = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const usd = (n) => (n === null ? '–' : `$${n.toFixed(4)}`);

function report(rows, opts) {
  const lines = [
    `| Task | Result | Stop | Steps | Tools (errors) | Tokens in → out | Cost | Time |`,
    `|---|---|---|---|---|---|---|---|`,
  ];
  for (const r of rows)
    lines.push(
      `| ${r.task} | ${r.pass ? 'pass' : 'FAIL'} | ${r.stop} | ${r.steps} | ${r.toolCalls} (${r.toolErrors}) | ${kTok(r.inputTokens)} → ${kTok(r.outputTokens)} | ${usd(r.usd)} | ${r.seconds}s |`,
    );
  const passed = rows.filter((r) => r.pass).length;
  const priced = rows.every((r) => r.usd !== null);
  const summary = {
    model: opts.model,
    label: opts.label,
    date: new Date().toISOString(),
    runs: rows.length,
    passed,
    passRate: Math.round((passed / rows.length) * 1000) / 10,
    inputTokens: sum(rows, 'inputTokens'),
    outputTokens: sum(rows, 'outputTokens'),
    usd: priced ? Math.round(sum(rows, 'usd') * 10000) / 10000 : null,
    seconds: Math.round(sum(rows, 'seconds')),
    steps: sum(rows, 'steps'),
    toolErrors: sum(rows, 'toolErrors'),
  };
  lines.push(
    '',
    `**${opts.model}**: ${passed}/${rows.length} solved (${summary.passRate} %) · ${kTok(summary.inputTokens)} → ${kTok(summary.outputTokens)} tokens · ${usd(summary.usd)} · ${summary.seconds}s · ${summary.steps} steps · ${summary.toolErrors} tool errors`,
  );
  return { text: lines.join('\n'), summary };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const tasks = loadTasks(opts.tasks);
  if (opts.selfcheck) {
    process.exit(selfcheck(tasks) ? 0 : 1);
  }
  if (!opts.model) throw new Error('give --model provider/model, or --selfcheck');
  if (!existsSync(cli)) throw new Error(`build the CLI first (pnpm build): ${cli} is missing`);

  const rows = [];
  for (let run = 1; run <= opts.runs; run++) {
    for (const task of tasks) {
      const row = await runOne(task, opts);
      rows.push({ run, ...row });
      console.error(
        `${row.pass ? 'pass' : 'FAIL'} ${task.id} · ${row.stop} · ${row.steps} steps · ${row.seconds}s${row.error ? ` · ${row.error}` : ''}`,
      );
    }
  }
  const { text, summary } = report(rows, opts);
  console.log(text);
  const outDir = join(here, 'results');
  mkdirSync(outDir, { recursive: true });
  const name = `${summary.date.slice(0, 16).replace(/[:T]/g, '-')}-${(opts.label ?? opts.model).replace(/[^a-zA-Z0-9._-]+/g, '_')}.json`;
  writeFileSync(join(outDir, name), JSON.stringify({ summary, rows }, null, 2) + '\n');
  console.error(`saved evals/results/${name}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
