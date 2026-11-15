import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { Command } from 'commander';
import {
  REVIEW_IGNORE_FILE,
  REVIEW_SEVERITIES,
  atLeast,
  githubReview,
  parseIgnoreFile,
  parseUnifiedDiff,
  postedFingerprints,
  projectReviewGuidance,
  reviewDiff,
  reviewMarkdown,
  reviewText,
  scanAddedLines,
} from '@omni/core';
import type { ReviewComplete, ReviewResult, ReviewSeverity } from '@omni/core';
import { ExitCode, OmniError } from '@omni/shared';
import { interruptSignal, omni } from '../context.js';
import { c, errln, outln, printJson, readStdin } from '../io.js';

export interface ReviewOpts {
  base?: string;
  pr?: string;
  diff?: string;
  model: string[];
  verifier?: string;
  verify: boolean;
  format: 'text' | 'markdown' | 'json' | 'github';
  out?: string;
  post?: boolean;
  failOn?: string;
  lang?: string;
  instructions?: string;
  /** false: no secrets / insecure code scanners (--no-security). */
  security: boolean;
  /** false: do not read .zinarix/review.md, AGENTS.md and the ignore list (--no-project). */
  project: boolean;
}

function exec(cmd: 'git' | 'gh', args: string[]): Promise<string> {
  return new Promise((res, rej) =>
    execFile(
      cmd,
      args,
      {
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' },
      },
      (e, stdout, stderr) =>
        e
          ? rej(new Error((stderr || e.message).trim().split('\n').slice(-4).join('\n')))
          : res(stdout),
    ),
  );
}

/** PR number of a GitHub Actions `pull_request` run, when there is one. */
export function prFromActions(env: NodeJS.ProcessEnv = process.env): number | undefined {
  if (!env.GITHUB_EVENT_PATH) return undefined;
  try {
    const ev = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as {
      pull_request?: { number?: number };
      number?: number;
    };
    return ev.pull_request?.number ?? undefined;
  } catch {
    return undefined;
  }
}

/** `::warning file=…,line=…::…` lines GitHub Actions turns into annotations on the PR. */
export function annotations(r: ReviewResult): string[] {
  const esc = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const prop = (s: string) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
  return r.findings.map((f) => {
    const level = f.severity === 'critical' || f.severity === 'high' ? 'error' : 'warning';
    return `::${level} file=${prop(f.file)},line=${f.line},title=${prop(`[${f.severity}] ${f.title}`)}::${esc(
      [f.detail, f.fix ? `Fix: ${f.fix}` : ''].filter(Boolean).join('\n'),
    )}`;
  });
}

export function parseSeverity(s: string | undefined): ReviewSeverity | undefined {
  if (!s) return undefined;
  const v = s.toLowerCase() as ReviewSeverity;
  if (!REVIEW_SEVERITIES.includes(v))
    throw new OmniError('config', `--fail-on: usa ${REVIEW_SEVERITIES.join(' | ')}`);
  return v;
}

export function registerReview(program: Command): void {
  program
    .command('review')
    .description(
      'Revisa con IA un diff (cambios locales, una rama o un PR) y da hallazgos por severidad / AI code review',
    )
    .option('--base <ref>', 'revisa la rama actual contra esta base (git diff base...HEAD)')
    .option('--pr <number>', 'revisa un pull request de GitHub (usa gh)')
    .option('--diff <file>', 'revisa un archivo .diff ("-" = stdin)')
    .option(
      '-m, --model <provider/model>',
      'modelo que revisa (repítelo para usar varios)',
      (v: string, list: string[]) => [...list, v],
      [] as string[],
    )
    .option('--verifier <provider/model>', 'modelo que verifica cada hallazgo')
    .option('--no-verify', 'no verificar los hallazgos (más rápido, más falsos positivos)')
    .option('--format <text|markdown|json|github>', 'formato de salida', 'text')
    .option('--out <file>', 'además guarda la revisión en Markdown en este archivo')
    .option('--post', 'publica los hallazgos como una revisión del PR (con gh)')
    .option('--fail-on <severity>', 'termina con código 6 si hay hallazgos de esta severidad o más')
    .option('--instructions <text>', 'guía extra para los revisores (reglas del proyecto…)')
    .option('--no-security', 'no buscar secretos ni código inseguro en las líneas nuevas')
    .option(
      '--no-project',
      'no leer .zinarix/review.md, AGENTS.md ni .zinarix/review-ignore.json del proyecto',
    )
    .action(async (opts: ReviewOpts, cmd: Command) => {
      const lang =
        (cmd.parent?.opts<{ lang?: string }>().lang ?? process.env.OMNI_LANG) === 'en'
          ? 'en'
          : 'es';
      const failOn = parseSeverity(opts.failOn);
      if (!['text', 'markdown', 'json', 'github'].includes(opts.format))
        throw new OmniError('config', '--format: usa text | markdown | json | github');
      const prNo = opts.pr ? Number(opts.pr) : opts.post ? prFromActions() : undefined;
      if (opts.pr && !(prNo && prNo > 0)) throw new OmniError('config', '--pr: número no válido');
      if (opts.post && !prNo)
        throw new OmniError(
          'config',
          '--post necesita --pr <número> (o correr en un pull_request de GitHub Actions)',
        );

      let patch: string;
      let instructions = opts.instructions;
      let head: string | undefined;
      let nwo: string | undefined;
      if (opts.diff)
        patch = opts.diff === '-' ? await readStdin() : readFileSync(opts.diff, 'utf8');
      else if (opts.pr || (prNo && !opts.base)) {
        patch = await exec('gh', ['pr', 'diff', String(prNo), '--color', 'never']);
      } else if (opts.base) {
        if (opts.base.startsWith('-'))
          throw new OmniError('config', '--base: referencia no válida');
        patch = await exec('git', [
          'diff',
          `${opts.base}...HEAD`,
          '--no-color',
          '--no-ext-diff',
          '-M',
        ]);
      } else patch = await exec('git', ['diff', 'HEAD', '--no-color', '--no-ext-diff', '-M']);
      if (prNo) {
        const info = JSON.parse(
          await exec('gh', ['pr', 'view', String(prNo), '--json', 'title,body,url,headRefOid']),
        ) as { title: string; body: string; url: string; headRefOid: string };
        head = info.headRefOid;
        nwo = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(info.url)?.[1];
        instructions = [
          instructions,
          `Pull request "${info.title}".\n${(info.body ?? '').slice(0, 4000)}`,
        ]
          .filter(Boolean)
          .join('\n\n');
      }

      const files = parseUnifiedDiff(patch);
      if (!files.length) {
        errln(c.dim(lang === 'en' ? 'Nothing to review.' : 'No hay cambios que revisar.'));
        return;
      }
      const core = omni();
      const signal = interruptSignal();
      const complete: ReviewComplete = async (model, messages, s) => {
        const r = await core.complete({ model, role: 'chat', maxTokens: 4096, messages }, s);
        return { text: r.text, model: r.provider ? `${r.provider}/${r.model}` : model, usd: r.usd };
      };
      const root = process.cwd();
      const readLocal = async (p: string) => {
        const abs = resolve(root, p);
        const r = relative(root, abs);
        if (!r || r.startsWith('..') || isAbsolute(r)) return undefined;
        return readFile(abs, 'utf8').catch(() => undefined);
      };
      const ignore = opts.project
        ? parseIgnoreFile(await readLocal(REVIEW_IGNORE_FILE)).map((e) => e.fingerprint)
        : [];
      if (opts.project) {
        const guide = await projectReviewGuidance(readLocal);
        instructions = [guide, instructions].filter(Boolean).join('\n\n');
      }
      const quietProgress = opts.format === 'json' || !process.stderr.isTTY;
      const result = await reviewDiff(files, complete, {
        models: opts.model.length ? opts.model : [undefined],
        verifier: opts.verify ? opts.verifier : null,
        instructions,
        signal,
        extra: opts.security ? scanAddedLines(files) : [],
        ignore,
        readFile: readLocal,
        onProgress: (p) => {
          if (quietProgress || p.phase === 'done') return;
          process.stderr.write(
            c.dim(`\r${p.phase === 'review' ? 'revisando' : 'verificando'} ${p.done}/${p.total}  `),
          );
        },
      });
      if (!quietProgress) process.stderr.write('\r\x1b[K');

      switch (opts.format) {
        case 'json':
          printJson(result);
          break;
        case 'markdown':
          outln(reviewMarkdown(result, lang));
          break;
        case 'github':
          for (const l of annotations(result)) outln(l);
          outln(reviewText(result, lang));
          break;
        default:
          outln(reviewText(result, lang));
      }
      if (opts.out) writeFileSync(opts.out, reviewMarkdown(result, lang));
      if (process.env.GITHUB_STEP_SUMMARY)
        writeFileSync(process.env.GITHUB_STEP_SUMMARY, reviewMarkdown(result, lang), { flag: 'a' });

      if (opts.post && prNo && result.findings.length) {
        if (!nwo || !head) throw new Error('No reconozco el repositorio del pull request.');
        // Findings an earlier run already posted on this PR are not posted again.
        const bodies = await Promise.all(
          (['comments', 'reviews'] as const).map((what) =>
            exec('gh', [
              'api',
              '--paginate',
              `repos/${nwo}/pulls/${prNo}/${what}`,
              '--jq',
              '.[].body',
            ]).catch(() => ''),
          ),
        );
        const gh = githubReview(result, files, undefined, lang, postedFingerprints(bodies));
        if (!gh.comments.length && gh.skipped === result.findings.length) {
          errln(
            c.dim(
              lang === 'en'
                ? `Every finding is already on PR #${prNo}: nothing new to post.`
                : `Todos los hallazgos ya están en el PR #${prNo}: nada nuevo que publicar.`,
            ),
          );
        } else await postReview(nwo, prNo, head, gh, lang);
      }
      if (failOn && result.findings.some((f) => atLeast(f.severity, failOn)))
        process.exitCode = ExitCode.findings;
    });
}

async function postReview(
  nwo: string,
  prNo: number,
  head: string,
  gh: ReturnType<typeof githubReview>,
  lang: 'es' | 'en',
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'omni-review-'));
  try {
    const file = join(dir, 'review.json');
    writeFileSync(
      file,
      JSON.stringify({ commit_id: head, event: 'COMMENT', body: gh.body, comments: gh.comments }),
    );
    await exec('gh', ['api', '-X', 'POST', `repos/${nwo}/pulls/${prNo}/reviews`, '--input', file]);
    const extra = gh.skipped
      ? lang === 'en'
        ? ` (${gh.skipped} already there, not repeated)`
        : ` (${gh.skipped} ya estaban, no se repitieron)`
      : '';
    errln(
      c.dim(
        lang === 'en'
          ? `Review posted on PR #${prNo}.${extra}`
          : `Revisión publicada en el PR #${prNo}.${extra}`,
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
