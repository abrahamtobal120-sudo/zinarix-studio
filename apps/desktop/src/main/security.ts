import { createHash } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isIP, connect } from 'node:net';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { connect as tlsConnect } from 'node:tls';
import type { ToolDefinition } from '@omni/shared';
import { redact } from '@omni/security';
import { deniedPath, execFile, expandPath } from './system.js';
import type { Workspace } from './workspace.js';

/**
 * Defensive security tools: audit the user's own project, dependencies, computer, local
 * network and websites. Nothing here attacks third parties: port scans are limited to the
 * user's own machine and private networks, and website checks are a single normal visit.
 */

export const SECURITY_TOOLS: ToolDefinition[] = [
  {
    name: 'security_scan_project',
    description:
      'Audit the open project: leaked secrets (API keys, tokens, private keys, passwords in code, committed .env files) and insecure code patterns (injection, eval, weak crypto, disabled TLS checks, open CORS…). Read-only, no approval needed. Returns findings with file:line, severity and how to fix.',
    parameters: {
      type: 'object',
      properties: {
        checks: {
          type: 'array',
          items: { type: 'string', enum: ['secrets', 'code'] },
          description: 'Default: both',
        },
      },
    },
  },
  {
    name: 'audit_dependencies',
    description:
      'Check the project dependencies (package-lock.json, pnpm-lock.yaml, yarn.lock, requirements.txt, poetry.lock, Cargo.lock, go.sum, composer.lock, Gemfile.lock) against the OSV vulnerability database (osv.dev). Sends package names and versions (no code) to osv.dev; needs approval once.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'security_check_system',
    description:
      "Audit the user's own computer (read-only): listening ports and their programs, firewall status, pending security updates, SSH server hardening, extra admin (uid 0) accounts, disk encryption, permissions of ~/.ssh and world-writable files in the home folder. Needs approval.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'port_scan',
    description:
      "Scan TCP ports of the user's OWN devices only: localhost or private network addresses (192.168.x.x, 10.x.x.x, 172.16-31.x.x), a single host or a /24 range for device discovery. Public internet hosts are refused. Needs approval.",
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'e.g. "localhost", "192.168.1.20" or "192.168.1.0/24"',
        },
        ports: {
          type: 'string',
          description: 'e.g. "22,80,443" or "1-1024". Default: the 100 most common ports',
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'check_site_security',
    description:
      'Check the security of a website the user owns or uses: HTTPS certificate (validity, expiry, issuer, hostname), TLS version, HTTP→HTTPS redirect, security headers (HSTS, CSP, X-Frame-Options…), cookie flags and information leaks. One normal visit; needs approval per site.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
  {
    name: 'file_hash',
    description:
      'Compute SHA-256 / SHA-1 / MD5 of a file (project path or absolute) to verify a download or detect changes. Optionally compare with an expected hash.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        expected: { type: 'string', description: 'Optional expected hash to compare' },
      },
      required: ['path'],
    },
  },
];

export const SECURITY_PROMPT_PART = `- Security (defensive, for the user's own project, computer, network and sites):
  - security_scan_project: leaked secrets and insecure code in the project (no approval).
  - audit_dependencies: known vulnerabilities in dependencies (osv.dev).
  - security_check_system: hardening review of this computer.
  - port_scan: open ports of the user's own devices (localhost / private LAN only).
  - check_site_security: HTTPS certificate, TLS and security headers of a website.
  - file_hash: verify file integrity.
  When auditing, report findings ordered by severity (crítico, alto, medio, bajo) with a concrete fix for each, and offer to apply the fixes (with approval). Only help defend systems the user owns or is authorized to test; refuse to attack, break into or scan third-party systems, and never reveal full secret values (show them masked).`;

// ---------------------------------------------------------------------------------------
// Secrets

export interface Finding {
  severity: 'crítico' | 'alto' | 'medio' | 'bajo';
  title: string;
  where?: string;
  detail?: string;
  fix?: string;
}

const SECRET_RULES: { name: string; re: RegExp; severity: Finding['severity'] }[] = [
  {
    name: 'Llave privada',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
    severity: 'crítico',
  },
  { name: 'Llave de AWS', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, severity: 'crítico' },
  {
    name: 'Token de GitHub',
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/,
    severity: 'crítico',
  },
  { name: 'Token de GitLab', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/, severity: 'crítico' },
  { name: 'Llave de Anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/, severity: 'crítico' },
  {
    name: 'Llave de OpenAI',
    re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/,
    severity: 'crítico',
  },
  { name: 'Llave de Google', re: /\bAIza[0-9A-Za-z_-]{35}\b/, severity: 'alto' },
  { name: 'Llave de Stripe', re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/, severity: 'crítico' },
  { name: 'Token de Slack', re: /\bxox[abposr]-[0-9A-Za-z-]{10,}\b/, severity: 'alto' },
  {
    name: 'Webhook de Slack/Discord',
    re: /https:\/\/(?:hooks\.slack\.com\/services|discord(?:app)?\.com\/api\/webhooks)\/[\w/-]{20,}/,
    severity: 'alto',
  },
  { name: 'Llave de Groq', re: /\bgsk_[A-Za-z0-9]{40,}\b/, severity: 'crítico' },
  { name: 'Llave de Hugging Face', re: /\bhf_[A-Za-z0-9]{30,}\b/, severity: 'alto' },
  { name: 'Llave de SendGrid', re: /\bSG\.[\w-]{16,}\.[\w-]{20,}\b/, severity: 'alto' },
  { name: 'Llave de Twilio', re: /\bSK[0-9a-fA-F]{32}\b/, severity: 'alto' },
  {
    name: 'Clave de servicio de Supabase / JWT',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
    severity: 'alto',
  },
  {
    name: 'Contraseña en una URL de conexión',
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/'"]+:[^\s@/'"]{3,}@/,
    severity: 'crítico',
  },
  {
    name: 'Contraseña o secreto escrito en el código',
    re: /\b(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["'](?![^"']*(?:\$\{|\{\{|<|example|changeme|your[_-]|xxx|\*\*\*|placeholder|process\.env))[^"'\s]{8,}["']/i,
    severity: 'alto',
  },
];

export function mask(v: string): string {
  const s = v.trim();
  return s.length <= 8 ? '****' : `${s.slice(0, 4)}…${s.slice(-2)} (${s.length} caracteres)`;
}

export function scanSecretsInText(path: string, text: string): Finding[] {
  const out: Finding[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length > 2000) continue;
    for (const r of SECRET_RULES) {
      const m = r.re.exec(line);
      if (!m) continue;
      out.push({
        severity: r.severity,
        title: r.name,
        where: `${path}:${i + 1}`,
        detail: `valor: ${mask(m[0])}`,
        fix: 'Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.',
      });
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Insecure code patterns (light static analysis)

const CODE_RULES: { re: RegExp; ext: RegExp; f: Omit<Finding, 'where'> }[] = [
  {
    re: /\beval\s*\(|new\s+Function\s*\(/,
    ext: /\.(m?[jt]sx?|cjs)$/,
    f: {
      severity: 'alto',
      title: 'eval / new Function',
      fix: 'Evita ejecutar texto como código; usa JSON.parse o una tabla de funciones.',
    },
  },
  {
    re: /\.innerHTML\s*=|dangerouslySetInnerHTML|document\.write\s*\(/,
    ext: /\.(m?[jt]sx?|html)$/,
    f: {
      severity: 'medio',
      title: 'HTML sin sanitizar (posible XSS)',
      fix: 'Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.',
    },
  },
  {
    re: /\b(?:query|execute|exec|raw)\s*\(\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+)/i,
    ext: /\.(m?[jt]sx?|py|php|rb|go|java|cs)$/,
    f: {
      severity: 'alto',
      title: 'SQL armado con texto (posible inyección SQL)',
      fix: 'Usa consultas parametrizadas (?, $1, :nombre) en lugar de concatenar valores.',
    },
  },
  {
    re: /cursor\.execute\s*\(\s*f["']|\.execute\s*\(\s*["'][^"']*%s?["']\s*%/,
    ext: /\.py$/,
    f: {
      severity: 'alto',
      title: 'SQL con f-string o % (posible inyección SQL)',
      fix: 'Pasa los valores como segundo argumento: cursor.execute(sql, (valor,)).',
    },
  },
  {
    re: /child_process|\bexecSync\s*\(|\bexec\s*\(\s*`[^`]*\$\{/,
    ext: /\.(m?[jt]sx?|cjs)$/,
    f: {
      severity: 'medio',
      title: 'Ejecución de comandos del sistema',
      fix: 'Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.',
    },
  },
  {
    re: /\b(?:os\.system|subprocess\.\w+\([^)]*shell\s*=\s*True)/,
    ext: /\.py$/,
    f: {
      severity: 'alto',
      title: 'Comando con shell=True / os.system',
      fix: 'Usa subprocess.run([...]) con lista de argumentos y shell=False.',
    },
  },
  {
    re: /\b(?:pickle\.loads?|yaml\.load\s*\((?![^)]*SafeLoader))/,
    ext: /\.py$/,
    f: {
      severity: 'alto',
      title: 'Deserialización insegura',
      fix: 'Usa json o yaml.safe_load; nunca pickle con datos externos.',
    },
  },
  {
    re: /createHash\(\s*["'](?:md5|sha1)["']|hashlib\.(?:md5|sha1)\(|\bMD5\.Create\(|md5\s*\(/i,
    ext: /\.(m?[jt]sx?|py|php|cs|go|java|rb)$/,
    f: {
      severity: 'medio',
      title: 'Hash débil (MD5/SHA-1)',
      fix: 'Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.',
    },
  },
  {
    re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|CURLOPT_SSL_VERIFYPEER\s*,\s*(?:0|false)/,
    ext: /./,
    f: {
      severity: 'alto',
      title: 'Verificación TLS desactivada',
      fix: 'Activa la verificación de certificados; si es un certificado propio, agrégalo como CA de confianza.',
    },
  },
  {
    re: /Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*["']|origin\s*:\s*["']\*["']|cors\(\s*\)/,
    ext: /\.(m?[jt]sx?|py|php|go|java|cs|conf)$/,
    f: {
      severity: 'medio',
      title: 'CORS abierto a cualquier origen',
      fix: 'Limita los orígenes permitidos a tus dominios.',
    },
  },
  {
    re: /Math\.random\(\).*(?:token|password|secret|key|id)|(?:token|password|secret|key)\w*\s*=.*Math\.random\(\)/i,
    ext: /\.(m?[jt]sx?)$/,
    f: {
      severity: 'medio',
      title: 'Math.random para valores secretos',
      fix: 'Usa crypto.randomUUID() o crypto.getRandomValues().',
    },
  },
  {
    re: /\bDEBUG\s*=\s*True\b|app\.run\([^)]*debug\s*=\s*True/,
    ext: /\.py$/,
    f: {
      severity: 'medio',
      title: 'Modo DEBUG activado',
      fix: 'Desactívalo en producción (lee el valor de una variable de entorno).',
    },
  },
  {
    re: /jwt\.(?:decode|verify)\([^)]*(?:algorithms\s*=\s*\[\s*["']none|verify\s*=\s*False|options\s*=\s*\{[^}]*verify_signature["']?\s*:\s*False)/i,
    ext: /\.(m?[jt]sx?|py)$/,
    f: {
      severity: 'crítico',
      title: 'JWT sin verificar firma',
      fix: 'Verifica siempre la firma con un algoritmo fijo (HS256/RS256).',
    },
  },
  {
    re: /["']http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|schemas\.|www\.w3\.org|json-schema\.org|xmlns)/,
    ext: /\.(m?[jt]sx?|py|php|go|java|cs|rb|json|ya?ml)$/,
    f: {
      severity: 'bajo',
      title: 'URL sin cifrar (http://)',
      fix: 'Usa https:// para no enviar datos en texto plano.',
    },
  },
  {
    re: /(?:^|\s)chmod\s+(?:-R\s+)?0?777\b|os\.chmod\([^)]*0o?777/,
    ext: /\.(sh|bash|py|m?[jt]s|ya?ml|Dockerfile)$|Dockerfile$/,
    f: {
      severity: 'medio',
      title: 'Permisos 777',
      fix: 'Da solo los permisos necesarios (p. ej. 755 para carpetas, 644 para archivos).',
    },
  },
  {
    re: /^\s*USER\s+root\b/,
    ext: /Dockerfile$/,
    f: {
      severity: 'bajo',
      title: 'Contenedor ejecutándose como root',
      fix: 'Crea un usuario sin privilegios y usa USER app.',
    },
  },
];

export function scanCodeInText(path: string, text: string): Finding[] {
  const out: Finding[] = [];
  const rules = CODE_RULES.filter((r) => r.ext.test(path));
  if (!rules.length || /(^|\/)(test|tests|__tests__|spec|fixtures?|examples?)\//i.test(path))
    return out;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length > 1000 || /^\s*(\/\/|#|\*|--)/.test(line)) continue;
    for (const r of rules)
      if (r.re.test(line))
        out.push({ ...r.f, where: `${path}:${i + 1}`, detail: line.trim().slice(0, 140) });
  }
  return out;
}

const SEVERITY_ORDER = { crítico: 0, alto: 1, medio: 2, bajo: 3 } as const;

export function formatFindings(title: string, findings: Finding[], notes: string[] = []): string {
  const sorted = [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  const count = (s: Finding['severity']) => sorted.filter((f) => f.severity === s).length;
  const head = `${title}\nResumen: ${count('crítico')} críticos · ${count('alto')} altos · ${count('medio')} medios · ${count('bajo')} bajos`;
  const shown = sorted
    .slice(0, 200)
    .map(
      (f) =>
        `[${f.severity.toUpperCase()}] ${f.title}${f.where ? ` — ${f.where}` : ''}${f.detail ? `\n    ${f.detail}` : ''}${f.fix ? `\n    Solución: ${f.fix}` : ''}`,
    );
  if (sorted.length > shown.length) shown.push(`… ${sorted.length - shown.length} hallazgos más`);
  return [head, ...notes, '', ...(shown.length ? shown : ['Sin hallazgos. ✓'])].join('\n');
}

export async function scanProject(
  ws: Workspace,
  checks: string[],
): Promise<{ text: string; findings: Finding[] }> {
  const doSecrets = !checks.length || checks.includes('secrets');
  const doCode = !checks.length || checks.includes('code');
  const files = await ws.listFiles(20_000);
  const findings: Finding[] = [];
  const notes: string[] = [];
  let scanned = 0;
  for (const path of files) {
    if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp[34]|lock|min\.js|map)$/i.test(path))
      continue;
    if (/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(path)) continue;
    let text: string;
    try {
      const abs = ws.resolve(path);
      if (statSync(abs).size > 1_000_000) continue;
      text = await readFile(abs, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue;
    scanned++;
    if (doSecrets) findings.push(...scanSecretsInText(path, text));
    if (doCode) findings.push(...scanCodeInText(path, text));
  }
  if (doSecrets) {
    // .env files tracked by git are a leak even if their values look harmless.
    const tracked = await execFile('git', [
      '-C',
      ws.root,
      'ls-files',
      '--',
      '*.env',
      '.env*',
      '**/.env*',
    ]);
    if (tracked.code === 0)
      for (const f of tracked.out
        .split('\n')
        .filter((x) => x && !/\.(example|sample|template)$/.test(x)))
        findings.push({
          severity: 'crítico',
          title: 'Archivo .env subido a git',
          where: f,
          fix: `Ejecuta "git rm --cached ${f}", agrégalo a .gitignore y rota los secretos que contenga.`,
        });
    if (existsSync(join(ws.root, '.env'))) {
      const ign = await execFile('git', ['-C', ws.root, 'check-ignore', '-q', '.env']);
      if (ign.code === 1)
        findings.push({
          severity: 'alto',
          title: '.env no está en .gitignore',
          where: '.env',
          fix: 'Agrega ".env" a .gitignore para no subirlo por error.',
        });
    }
  }
  notes.push(`Archivos revisados: ${scanned} (se respetan .gitignore y carpetas pesadas).`);
  return {
    text: formatFindings('== Auditoría de seguridad del proyecto ==', findings, notes),
    findings,
  };
}

// ---------------------------------------------------------------------------------------
// Dependencies (OSV.dev)

export interface Dep {
  ecosystem: string;
  name: string;
  version: string;
  file: string;
}

export function parseLockfile(file: string, text: string): Dep[] {
  const deps: Dep[] = [];
  const add = (ecosystem: string, name: string, version: string) => {
    const v = version.replace(/^[v=^~]/, '').trim();
    if (name && /^\d/.test(v)) deps.push({ ecosystem, name, version: v, file });
  };
  const base = file.split('/').pop()!;
  if (base === 'package-lock.json') {
    try {
      const j = JSON.parse(text) as {
        packages?: Record<string, { version?: string; link?: boolean }>;
        dependencies?: Record<string, { version?: string }>;
      };
      for (const [k, v] of Object.entries(j.packages ?? {}))
        if (k && !v.link && v.version) add('npm', k.replace(/^.*node_modules\//, ''), v.version);
      if (!j.packages)
        for (const [k, v] of Object.entries(j.dependencies ?? {}))
          if (v.version) add('npm', k, v.version);
    } catch {
      // invalid lockfile
    }
  } else if (base === 'pnpm-lock.yaml') {
    for (const m of text.matchAll(/^ {2}['"]?\/?((?:@[^/@\s]+\/)?[^/@\s'"(]+)[@/](\d[^:('"\s]*)/gm))
      add('npm', m[1]!, m[2]!);
  } else if (base === 'yarn.lock') {
    for (const m of text.matchAll(
      /^"?((?:@[^@\s"]+\/)?[^@\s",]+)@[^\n]*\n\s+version:?\s+"?([^"\s]+)/gm,
    ))
      add('npm', m[1]!, m[2]!);
  } else if (/^requirements.*\.txt$/.test(base)) {
    for (const m of text.matchAll(/^([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*==\s*([\w.]+)/gm))
      add('PyPI', m[1]!, m[2]!);
  } else if (base === 'poetry.lock' || base === 'Cargo.lock') {
    const eco = base === 'Cargo.lock' ? 'crates.io' : 'PyPI';
    for (const m of text.matchAll(
      /\[\[package\]\]\s*\nname\s*=\s*"([^"]+)"\s*\nversion\s*=\s*"([^"]+)"/g,
    ))
      add(eco, m[1]!, m[2]!);
  } else if (base === 'go.sum') {
    for (const m of text.matchAll(/^(\S+)\s+v([^\s/]+?)(?:\/go\.mod)?\s/gm))
      add('Go', m[1]!, m[2]!.replace(/\+incompatible$/, ''));
  } else if (base === 'composer.lock') {
    try {
      const j = JSON.parse(text) as { packages?: { name: string; version: string }[] };
      for (const p of j.packages ?? []) add('Packagist', p.name, p.version);
    } catch {
      // invalid lockfile
    }
  } else if (base === 'Gemfile.lock') {
    for (const m of text.matchAll(/^ {4}([a-zA-Z0-9_-]+) \(([\d.]+)\)/gm))
      add('RubyGems', m[1]!, m[2]!);
  }
  const seen = new Set<string>();
  return deps.filter((d) => {
    const k = `${d.ecosystem}:${d.name}@${d.version}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Numeric version comparison ("4.17.9" < "4.17.16"); pre-release tags compare as text. */
export function compareVersions(a?: string, b?: string): number {
  const pa = (a ?? '').split(/[.+-]/);
  const pb = (b ?? '').split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = Number(x);
    const ny = Number(y);
    const d = Number.isNaN(nx) || Number.isNaN(ny) ? x.localeCompare(y) : nx - ny;
    if (d) return d;
  }
  return 0;
}

const LOCKFILES =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|requirements[^/]*\.txt|poetry\.lock|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock)$/;

export async function auditDependencies(ws: Workspace, signal: AbortSignal): Promise<string> {
  const files = (await ws.listFiles(20_000)).filter(
    (f) => LOCKFILES.test(f) && !f.includes('node_modules/'),
  );
  if (!files.length)
    return 'No encontré archivos de dependencias con versiones exactas (package-lock.json, pnpm-lock.yaml, requirements.txt, Cargo.lock…).';
  const deps: Dep[] = [];
  for (const f of files) deps.push(...parseLockfile(f, await readFile(ws.resolve(f), 'utf8')));
  const vulnsByDep = new Map<number, string[]>();
  for (let i = 0; i < deps.length; i += 500) {
    const chunk = deps.slice(i, i + 500);
    const r = await fetch('https://api.osv.dev/v1/querybatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        queries: chunk.map((d) => ({
          package: { ecosystem: d.ecosystem, name: d.name },
          version: d.version,
        })),
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    });
    if (!r.ok) throw new Error(`osv.dev respondió ${r.status}`);
    const j = (await r.json()) as { results: { vulns?: { id: string }[] }[] };
    j.results.forEach((res, k) => {
      if (res.vulns?.length)
        vulnsByDep.set(
          i + k,
          res.vulns.map((v) => v.id),
        );
    });
  }
  const findings: Finding[] = [];
  const ids = [...new Set([...vulnsByDep.values()].flat())].slice(0, 60);
  const details = new Map<
    string,
    { summary?: string; severity: Finding['severity']; fixed?: string }
  >();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const r = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        });
        const v = (await r.json()) as {
          summary?: string;
          database_specific?: { severity?: string };
          affected?: { ranges?: { events?: { fixed?: string }[] }[] }[];
        };
        const sev = (v.database_specific?.severity ?? '').toUpperCase();
        const fixed = v.affected
          ?.flatMap((a) => a.ranges ?? [])
          .flatMap((x) => x.events ?? [])
          .find((e) => e.fixed)?.fixed;
        details.set(id, {
          summary: v.summary,
          severity:
            sev === 'CRITICAL'
              ? 'crítico'
              : sev === 'HIGH'
                ? 'alto'
                : sev === 'LOW'
                  ? 'bajo'
                  : 'medio',
          fixed,
        });
      } catch {
        details.set(id, { severity: 'medio' });
      }
    }),
  );
  for (const [k, list] of vulnsByDep) {
    const d = deps[k]!;
    const infos = list.map((id) => ({
      id,
      ...(details.get(id) ?? { severity: 'medio' as const }),
    }));
    const worst = infos.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])[0]!;
    const fixed = infos.map((x) => x.fixed).filter(Boolean);
    findings.push({
      severity: worst.severity,
      title: `${d.name}@${d.version} (${d.ecosystem})`,
      where: d.file,
      detail: infos
        .slice(0, 4)
        .map((x) => `${x.id}${x.summary ? `: ${x.summary}` : ''}`)
        .join('\n    '),
      fix: fixed.length
        ? `Actualiza a ${fixed.sort(compareVersions).at(-1)} o superior.`
        : 'Revisa el aviso y actualiza a una versión sin la vulnerabilidad.',
    });
  }
  return formatFindings('== Vulnerabilidades en dependencias (osv.dev) ==', findings, [
    `Dependencias revisadas: ${deps.length} en ${files.join(', ')}`,
  ]);
}

// ---------------------------------------------------------------------------------------
// This computer

export async function checkSystem(): Promise<string> {
  const os = platform();
  const findings: Finding[] = [];
  const notes: string[] = [];
  const run = (f: string, a: string[]) => execFile(f, a, { timeout: 20_000 });

  // Listening ports
  const ports =
    os === 'win32'
      ? await run('netstat', ['-ano', '-p', 'TCP'])
      : os === 'darwin'
        ? await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'])
        : await run('ss', ['-tlnpH']);
  const exposed = ports.out
    .split('\n')
    .filter((l) => /LISTEN/i.test(l) || os === 'linux')
    .filter((l) => /(?:^|\s)(?:0\.0\.0\.0|\*|\[::\]|::):\d+|\*:\d+/.test(l));
  notes.push(
    `Puertos escuchando en TODAS las interfaces (accesibles desde la red): ${exposed.length}`,
  );
  for (const l of exposed.slice(0, 30)) {
    const port = /:(\d+)\b/.exec(l.replace(/^\S+\s+\S+\s+\S+\s+/, ''))?.[1] ?? '?';
    const proc = /users:\(\("([^"]+)"/.exec(l)?.[1] ?? l.trim().split(/\s+/)[0];
    const risky = [
      '21',
      '23',
      '445',
      '139',
      '3389',
      '5900',
      '6379',
      '27017',
      '9200',
      '11211',
      '2375',
      '3306',
      '5432',
    ].includes(port);
    findings.push({
      severity: risky ? 'alto' : 'bajo',
      title: `Puerto ${port} abierto a la red${proc ? ` (${proc})` : ''}`,
      fix: risky
        ? 'Este servicio no debería estar expuesto: escúchalo solo en 127.0.0.1 o bloquéalo en el firewall.'
        : 'Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.',
    });
  }

  // Firewall
  if (os === 'linux') {
    const ufw = await run('ufw', ['status']);
    const fwd = await run('firewall-cmd', ['--state']);
    const active = /Status: active/i.test(ufw.out) || /^running/m.test(fwd.out);
    const unknown = ufw.code === 127 && fwd.code === 127;
    notes.push(
      `Firewall: ${active ? 'activo' : unknown ? 'no se encontró ufw ni firewalld (puede haber reglas nftables/iptables)' : 'INACTIVO'}`,
    );
    if (!active)
      findings.push({
        severity: unknown ? 'medio' : 'alto',
        title: unknown ? 'No se detectó un firewall configurado' : 'Firewall desactivado',
        fix: 'Instala/activa uno: "sudo ufw enable" (Ubuntu/Arch con ufw) o "sudo systemctl enable --now firewalld".',
      });
  } else if (os === 'darwin') {
    const fw = await run('/usr/libexec/ApplicationFirewall/socketfilterfw', ['--getglobalstate']);
    const on = /enabled/i.test(fw.out);
    notes.push(`Firewall: ${on ? 'activo' : 'INACTIVO'}`);
    if (!on)
      findings.push({
        severity: 'alto',
        title: 'Firewall de macOS desactivado',
        fix: 'Ajustes del Sistema → Red → Firewall → Activar.',
      });
  } else if (os === 'win32') {
    const fw = await run('netsh', ['advfirewall', 'show', 'allprofiles', 'state']);
    const off = (fw.out.match(/OFF|DESACTIVADO/gi) ?? []).length;
    notes.push(
      `Firewall de Windows: ${off ? `${off} perfil(es) desactivado(s)` : 'activo en todos los perfiles'}`,
    );
    if (off)
      findings.push({
        severity: 'alto',
        title: 'Firewall de Windows desactivado en algún perfil',
        fix: 'Seguridad de Windows → Firewall y protección de red → activar.',
      });
  }

  // Pending updates
  if (os === 'linux') {
    const tries: [string, string[], RegExp][] = [
      ['checkupdates', [], /\S/],
      ['apt', ['list', '--upgradable'], /upgradable from/],
      ['dnf', ['-q', 'check-update'], /\S/],
    ];
    for (const [cmd, args, re] of tries) {
      const r = await run(cmd, args);
      if (r.code === 127) continue;
      const n = r.out.split('\n').filter((l) => re.test(l) && !/^Listing/.test(l)).length;
      notes.push(`Actualizaciones pendientes (${cmd}): ${n}`);
      if (n > 0)
        findings.push({
          severity: n > 50 ? 'alto' : 'medio',
          title: `${n} paquetes sin actualizar`,
          fix: 'Actualiza el sistema (p. ej. "sudo pacman -Syu" o "sudo apt upgrade"); muchas actualizaciones corrigen fallas de seguridad.',
        });
      break;
    }
  }

  // SSH server
  const sshd = os === 'win32' ? '' : '/etc/ssh/sshd_config';
  if (sshd && existsSync(sshd)) {
    const active =
      os === 'linux'
        ? (await run('systemctl', ['is-active', 'sshd'])).out.trim() === 'active' ||
          (await run('systemctl', ['is-active', 'ssh'])).out.trim() === 'active'
        : false;
    try {
      const conf = await readFile(sshd, 'utf8');
      const val = (k: string) =>
        new RegExp(`^\\s*${k}\\s+(\\S+)`, 'mi').exec(conf)?.[1]?.toLowerCase();
      notes.push(`Servidor SSH: ${active ? 'ACTIVO' : 'inactivo'}`);
      if (active && val('permitrootlogin') === 'yes')
        findings.push({
          severity: 'alto',
          title: 'SSH permite entrar como root',
          fix: 'En /etc/ssh/sshd_config pon "PermitRootLogin no" y reinicia sshd.',
        });
      if (active && val('passwordauthentication') !== 'no')
        findings.push({
          severity: 'medio',
          title: 'SSH acepta contraseñas',
          fix: 'Usa llaves SSH y pon "PasswordAuthentication no".',
        });
    } catch {
      // not readable
    }
  }

  // Extra uid 0 accounts
  if (os !== 'win32' && existsSync('/etc/passwd')) {
    const root0 = (await readFile('/etc/passwd', 'utf8'))
      .split('\n')
      .filter((l) => l.split(':')[2] === '0' && !l.startsWith('root:'));
    for (const l of root0)
      findings.push({
        severity: 'crítico',
        title: `Cuenta con privilegios de root: ${l.split(':')[0]}`,
        fix: 'Revisa si es legítima; una cuenta uid 0 extra suele indicar intrusión.',
      });
  }

  // Disk encryption
  if (os === 'linux') {
    const lsblk = await run('lsblk', ['-o', 'TYPE,MOUNTPOINT', '-nr']);
    const crypt = /\bcrypt\b/.test(lsblk.out);
    notes.push(`Cifrado de disco: ${crypt ? 'sí (LUKS)' : 'no detectado'}`);
    if (!crypt)
      findings.push({
        severity: 'medio',
        title: 'Disco sin cifrar',
        fix: 'Si pierdes el equipo, tus archivos quedan legibles. Considera LUKS al reinstalar o cifrar tu carpeta personal.',
      });
  } else if (os === 'darwin') {
    const fv = await run('fdesetup', ['status']);
    const on = /On/.test(fv.out);
    notes.push(`FileVault: ${on ? 'activo' : 'INACTIVO'}`);
    if (!on)
      findings.push({
        severity: 'medio',
        title: 'FileVault desactivado',
        fix: 'Ajustes del Sistema → Privacidad y seguridad → FileVault.',
      });
  }

  // ~/.ssh permissions (metadata only, never contents)
  const ssh = join(homedir(), '.ssh');
  if (os !== 'win32' && existsSync(ssh)) {
    const mode = statSync(ssh).mode & 0o777;
    if (mode & 0o077)
      findings.push({
        severity: 'alto',
        title: `~/.ssh tiene permisos ${mode.toString(8)}`,
        fix: 'Ejecuta "chmod 700 ~/.ssh && chmod 600 ~/.ssh/id_*".',
      });
  }

  // World-writable files in home
  if (os !== 'win32') {
    const ww = await run('find', [
      homedir(),
      '-maxdepth',
      '3',
      '-type',
      'f',
      '-perm',
      '-0002',
      '-not',
      '-path',
      '*/node_modules/*',
    ]);
    const list = ww.out.split('\n').filter(Boolean).slice(0, 20);
    if (list.length)
      findings.push({
        severity: 'medio',
        title: `${list.length} archivo(s) que cualquier usuario puede modificar`,
        detail: list.join('\n    '),
        fix: 'Quita el permiso de escritura para otros: chmod o-w <archivo>.',
      });
  }

  return redact(
    formatFindings(`== Revisión de seguridad de este equipo (${os}) ==`, findings, notes),
  );
}

// ---------------------------------------------------------------------------------------
// Port scan (own devices only)

const TOP_PORTS = [
  21, 22, 23, 25, 53, 80, 81, 88, 110, 111, 135, 139, 143, 389, 443, 445, 465, 514, 548, 554, 587,
  631, 873, 993, 995, 1080, 1194, 1433, 1521, 1723, 1883, 1900, 2049, 2082, 2083, 2222, 2375, 2376,
  3000, 3001, 3128, 3306, 3389, 3690, 4000, 4200, 4443, 5000, 5001, 5060, 5173, 5353, 5432, 5601,
  5672, 5900, 5984, 6000, 6379, 6443, 7000, 7001, 7070, 7443, 8000, 8008, 8009, 8080, 8081, 8086,
  8088, 8443, 8500, 8888, 9000, 9001, 9090, 9092, 9100, 9200, 9300, 9418, 9443, 10000, 10250, 11211,
  11434, 15672, 25565, 27017, 32400, 49152, 50000, 51820, 62078,
];

const SERVICE: Record<number, string> = {
  21: 'FTP',
  22: 'SSH',
  23: 'Telnet',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP',
  110: 'POP3',
  139: 'NetBIOS',
  143: 'IMAP',
  443: 'HTTPS',
  445: 'SMB',
  548: 'AFP',
  554: 'RTSP (cámara)',
  631: 'Impresora (IPP)',
  1433: 'SQL Server',
  1883: 'MQTT',
  1900: 'UPnP',
  2375: 'Docker (sin TLS)',
  3000: 'Dev server',
  3306: 'MySQL',
  3389: 'Escritorio remoto (RDP)',
  5000: 'Dev server / UPnP',
  5173: 'Vite',
  5432: 'PostgreSQL',
  5900: 'VNC',
  6379: 'Redis',
  8080: 'HTTP alterno',
  8443: 'HTTPS alterno',
  9100: 'Impresora',
  9200: 'Elasticsearch',
  11211: 'Memcached',
  11434: 'Ollama',
  27017: 'MongoDB',
  32400: 'Plex',
  51820: 'WireGuard',
  62078: 'iPhone sync',
};

const RISKY_PORTS = new Set([21, 23, 445, 139, 2375, 3389, 5900, 6379, 9200, 11211, 27017, 1883]);

export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  const v = ip.toLowerCase();
  return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

export function parsePorts(spec: string | undefined): number[] {
  if (!spec?.trim()) return TOP_PORTS;
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const [a, b] = part
      .trim()
      .split('-')
      .map((x) => Number(x.trim()));
    if (!a || a < 1 || a > 65535) continue;
    const end = b && b >= a ? Math.min(b, 65535) : a;
    for (let p = a; p <= end && out.size < 2048; p++) out.add(p);
  }
  if (!out.size) throw new Error('Puertos inválidos.');
  return [...out];
}

/**
 * Resolves a scan target to a list of IPs. Public hosts are refused unless `allowPublic`
 * is set — which only the user can set, by attesting in the scanner UI that the target is
 * theirs or authorized. The AI's own port_scan tool never passes it, so the model cannot
 * self-authorize scanning a third party.
 */
export async function resolveScanTargets(
  target: string,
  opts: { allowPublic?: boolean } = {},
): Promise<{ ips: string[]; public: boolean }> {
  const t = target
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  const cidr = /^(\d+\.\d+\.\d+)\.\d+\/(\d+)$/.exec(t);
  if (cidr) {
    if (Number(cidr[2]) < 24)
      throw new Error('Solo se permiten rangos /24 o más pequeños (máximo 256 direcciones).');
    const ip = `${cidr[1]}.1`;
    const isPub = !isPrivateIp(ip);
    if (isPub && !opts.allowPublic)
      throw new Error('Solo se pueden escanear rangos de tu red privada.');
    return { ips: Array.from({ length: 254 }, (_, i) => `${cidr[1]}.${i + 1}`), public: isPub };
  }
  const host = t.split(':')[0]!;
  const ips = isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((x) => x.address);
  const ip = ips[0];
  if (!ip) throw new Error(`No se pudo resolver ${host}`);
  const isPub = !isPrivateIp(ip);
  if (isPub && !opts.allowPublic)
    throw new Error(
      'Por seguridad y por ley, la IA solo escanea tus equipos (localhost o tu red local). Para un objetivo público, usa el Escáner del Centro de seguridad y confirma que es tuyo o que tienes autorización.',
    );
  return { ips: [ip], public: isPub };
}

/** A short, polite service/version probe: read the banner, or ask HTTP if the port is silent. */
function grabBanner(host: string, port: number, timeout: number): Promise<string> {
  return new Promise((res) => {
    const s = connect({ host, port, timeout });
    let data = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      s.destroy();
      const line =
        data
          .replace(/\r/g, '')
          .split('\n')
          .find((l) => l.trim()) ?? '';
      if (/^HTTP\//.test(line)) {
        const server = /server:\s*(.+)/i.exec(data)?.[1]?.trim();
        res(server ? `HTTP · ${server}` : 'HTTP');
      } else res(line.trim().slice(0, 80));
    };
    s.once('connect', () => {
      // Many services greet on connect; web servers stay silent until asked. Wait briefly,
      // then send a harmless HTTP HEAD if nothing arrived.
      setTimeout(() => {
        if (!data && !s.destroyed) s.write(`HEAD / HTTP/1.0\r\nHost: ${host}\r\n\r\n`);
      }, 350);
    });
    s.on('data', (d) => {
      data += d.toString('latin1');
      if (data.length > 2048 || /\r?\n\r?\n/.test(data)) finish();
    });
    s.once('error', () => {
      if (!settled) {
        settled = true;
        res('');
      }
    });
    s.once('timeout', finish);
    setTimeout(finish, timeout);
  });
}

export interface ScanHit {
  port: number;
  service: string;
  banner?: string;
  risky: boolean;
}
export interface ScanHostResult {
  host: string;
  reverse?: string;
  openPorts: ScanHit[];
}

/**
 * nmap-style scan with service/version detection, used by the Scanner UI. Reports progress
 * and returns structured results. Public targets require `authorized` (set by the user).
 */
export async function runScan(
  o: {
    target: string;
    ports?: string;
    serviceDetection?: boolean;
    authorized?: boolean;
  },
  signal: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<{ hosts: ScanHostResult[]; public: boolean; scannedPorts: number }> {
  const { ips, public: isPub } = await resolveScanTargets(o.target, { allowPublic: o.authorized });
  const sweep = ips.length > 1;
  const ports = sweep
    ? [21, 22, 23, 80, 139, 443, 445, 554, 3389, 5000, 8080, 9100, 62078]
    : parsePorts(o.ports);
  const jobs: [string, number][] = ips.flatMap((h) => ports.map((p) => [h, p] as [string, number]));
  const open = new Map<string, number[]>();
  let i = 0;
  let done = 0;
  const worker = async () => {
    while (i < jobs.length && !signal.aborted) {
      const [h, p] = jobs[i++]!;
      if (await probe(h, p, sweep ? 450 : 800)) open.set(h, [...(open.get(h) ?? []), p]);
      if (onProgress && ++done % 20 === 0) onProgress(done, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: sweep ? 128 : 100 }, worker));
  onProgress?.(jobs.length, jobs.length);
  const hosts: ScanHostResult[] = [];
  for (const [host, list] of [...open].sort()) {
    const sorted = list.sort((a, b) => a - b);
    const banners = new Map<number, string>();
    if (o.serviceDetection !== false && !signal.aborted)
      await Promise.all(
        sorted.map(async (p) => {
          const b = await grabBanner(host, p, 2000);
          if (b) banners.set(p, redact(b));
        }),
      );
    let reverse: string | undefined;
    try {
      reverse = (await dns.reverse(host))[0];
    } catch {
      // no PTR
    }
    hosts.push({
      host,
      reverse,
      openPorts: sorted.map((p) => ({
        port: p,
        service: SERVICE[p] ?? 'desconocido',
        banner: banners.get(p),
        risky: RISKY_PORTS.has(p),
      })),
    });
  }
  return { hosts, public: isPub, scannedPorts: ports.length };
}

function probe(host: string, port: number, timeout: number): Promise<boolean> {
  return new Promise((res) => {
    const s = connect({ host, port, timeout });
    const done = (ok: boolean) => {
      s.destroy();
      res(ok);
    };
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
}

export async function portScan(
  target: string,
  portsSpec: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  const { ips: hosts } = await resolveScanTargets(target);
  const sweep = hosts.length > 1;
  const ports = sweep
    ? [22, 80, 443, 445, 554, 3389, 5000, 8080, 9100, 62078]
    : parsePorts(portsSpec);
  const jobs: [string, number][] = hosts.flatMap((h) =>
    ports.map((p) => [h, p] as [string, number]),
  );
  const open = new Map<string, number[]>();
  let i = 0;
  const worker = async () => {
    while (i < jobs.length && !signal.aborted) {
      const [h, p] = jobs[i++]!;
      if (await probe(h, p, sweep ? 400 : 700)) open.set(h, [...(open.get(h) ?? []), p]);
    }
  };
  await Promise.all(Array.from({ length: 64 }, worker));
  const findings: Finding[] = [];
  const lines: string[] = [];
  for (const [h, list] of [...open].sort()) {
    lines.push(
      `${h}: ${list
        .sort((a, b) => a - b)
        .map((p) => `${p}${SERVICE[p] ? ` (${SERVICE[p]})` : ''}`)
        .join(', ')}`,
    );
    for (const p of list)
      if (RISKY_PORTS.has(p))
        findings.push({
          severity: p === 23 || p === 2375 ? 'crítico' : 'alto',
          title: `${h}:${p} ${SERVICE[p] ?? ''} accesible`,
          fix: 'Este servicio no debería estar expuesto en la red: desactívalo, ponle contraseña/TLS o limítalo con el firewall.',
        });
  }
  return formatFindings(
    `== Escaneo de puertos: ${target} (${hosts.length} equipo(s), ${ports.length} puertos) ==`,
    findings,
    [
      lines.length
        ? `Puertos abiertos:\n${lines.join('\n')}`
        : 'No se encontraron puertos abiertos.',
    ],
  );
}

// ---------------------------------------------------------------------------------------
// Website check

function certInfo(
  host: string,
  port: number,
): Promise<{
  valid: boolean;
  error?: string;
  daysLeft: number;
  issuer: string;
  protocol: string;
  altNames: string;
}> {
  return new Promise((res, rej) => {
    const s = tlsConnect(
      { host, port, servername: host, timeout: 10_000, rejectUnauthorized: false },
      () => {
        const c = s.getPeerCertificate();
        const daysLeft = Math.floor((new Date(c.valid_to).getTime() - Date.now()) / 86_400_000);
        res({
          valid: s.authorized,
          error: s.authorizationError ? String(s.authorizationError) : undefined,
          daysLeft,
          issuer: [c.issuer?.O, c.issuer?.CN].filter(Boolean).join(' / '),
          protocol: s.getProtocol() ?? '?',
          altNames: c.subjectaltname ?? '',
        });
        s.end();
      },
    );
    s.once('error', rej);
    s.once('timeout', () => {
      s.destroy();
      rej(new Error('tiempo de espera agotado'));
    });
  });
}

export async function checkSite(input: string, signal: AbortSignal): Promise<string> {
  const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  if (url.hostname === '169.254.169.254') throw new Error('Dirección no permitida.');
  const findings: Finding[] = [];
  const notes: string[] = [];
  const timeout = () => AbortSignal.any([signal, AbortSignal.timeout(15_000)]);

  if (url.protocol === 'https:') {
    try {
      const c = await certInfo(url.hostname, Number(url.port) || 443);
      notes.push(
        `Certificado: ${c.valid ? 'válido' : `INVÁLIDO (${c.error})`} · emisor ${c.issuer} · vence en ${c.daysLeft} días · ${c.protocol}`,
      );
      if (!c.valid)
        findings.push({
          severity: 'crítico',
          title: 'Certificado HTTPS inválido',
          detail: c.error,
          fix: "Renueva o corrige el certificado (p. ej. Let's Encrypt con certbot).",
        });
      else if (c.daysLeft < 14)
        findings.push({
          severity: 'alto',
          title: `El certificado vence en ${c.daysLeft} días`,
          fix: 'Renuévalo o automatiza la renovación.',
        });
      if (/TLSv1(\.0|\.1)?$/.test(c.protocol))
        findings.push({
          severity: 'alto',
          title: `Protocolo antiguo ${c.protocol}`,
          fix: 'Desactiva TLS 1.0/1.1 y usa TLS 1.2+.',
        });
    } catch (e) {
      findings.push({
        severity: 'alto',
        title: 'No se pudo establecer HTTPS',
        detail: (e as Error).message,
      });
    }
    // HTTP → HTTPS redirect
    try {
      const plain = new URL(url);
      plain.protocol = 'http:';
      plain.port = '';
      const r = await fetch(plain, { redirect: 'manual', signal: timeout() });
      const loc = r.headers.get('location') ?? '';
      if (!(r.status >= 300 && r.status < 400 && loc.startsWith('https:')))
        findings.push({
          severity: 'medio',
          title: 'http:// no redirige a https://',
          fix: 'Redirige todo el tráfico HTTP a HTTPS (301).',
        });
    } catch {
      notes.push('El puerto 80 (http) no responde.');
    }
  } else {
    findings.push({
      severity: url.hostname === 'localhost' || isPrivateIp(url.hostname) ? 'bajo' : 'alto',
      title: 'El sitio no usa HTTPS',
      fix: "Activa HTTPS con un certificado (Let's Encrypt es gratis).",
    });
  }

  const r = await fetch(url, { redirect: 'follow', signal: timeout() });
  const h = r.headers;
  notes.push(`Respuesta: HTTP ${r.status} · ${r.url}`);
  const need: [string, Finding['severity'], string][] = [
    [
      'strict-transport-security',
      'medio',
      'Agrega "Strict-Transport-Security: max-age=31536000; includeSubDomains".',
    ],
    [
      'content-security-policy',
      'medio',
      'Define una Content-Security-Policy para frenar XSS e inyección de scripts.',
    ],
    ['x-content-type-options', 'bajo', 'Agrega "X-Content-Type-Options: nosniff".'],
    ['referrer-policy', 'bajo', 'Agrega "Referrer-Policy: strict-origin-when-cross-origin".'],
  ];
  for (const [name, sev, fix] of need) {
    if (name === 'strict-transport-security' && url.protocol !== 'https:') continue;
    if (!h.get(name)) findings.push({ severity: sev, title: `Falta el encabezado ${name}`, fix });
  }
  const csp = h.get('content-security-policy') ?? '';
  if (!h.get('x-frame-options') && !/frame-ancestors/i.test(csp))
    findings.push({
      severity: 'medio',
      title: 'Sin protección contra clickjacking',
      fix: 'Agrega "X-Frame-Options: DENY" o "frame-ancestors \'none\'" en la CSP.',
    });
  if (/'unsafe-inline'|'unsafe-eval'/.test(csp))
    findings.push({
      severity: 'bajo',
      title: 'La CSP permite unsafe-inline/unsafe-eval',
      fix: 'Usa nonces o hashes en lugar de unsafe-inline.',
    });
  const server = h.get('server');
  const powered = h.get('x-powered-by');
  if (powered || (server && /\d/.test(server)))
    findings.push({
      severity: 'bajo',
      title: 'El servidor revela su software y versión',
      detail: [server, powered].filter(Boolean).join(' · '),
      fix: 'Oculta la versión (server_tokens off, quitar X-Powered-By).',
    });
  if (h.get('access-control-allow-origin') === '*')
    findings.push({
      severity: 'medio',
      title: 'CORS abierto (Access-Control-Allow-Origin: *)',
      fix: 'Limita los orígenes permitidos si la respuesta contiene datos privados.',
    });
  for (const c of h.getSetCookie()) {
    const name = c.split('=')[0];
    const miss = [
      !/;\s*secure/i.test(c) && url.protocol === 'https:' && 'Secure',
      !/;\s*httponly/i.test(c) && 'HttpOnly',
      !/;\s*samesite/i.test(c) && 'SameSite',
    ].filter(Boolean);
    if (miss.length)
      findings.push({
        severity: 'medio',
        title: `La cookie "${name}" no tiene ${miss.join(', ')}`,
        fix: 'Marca las cookies de sesión con Secure; HttpOnly; SameSite=Lax.',
      });
  }
  for (const path of ['/.git/HEAD', '/.env']) {
    try {
      const x = await fetch(new URL(path, url), { redirect: 'manual', signal: timeout() });
      const body = x.ok ? (await x.text()).slice(0, 200) : '';
      if (x.ok && (path === '/.git/HEAD' ? body.startsWith('ref:') : /^\s*[A-Z_]+=/m.test(body)))
        findings.push({
          severity: 'crítico',
          title: `${path} es público`,
          fix: `Bloquea el acceso a ${path} en el servidor y rota cualquier secreto expuesto.`,
        });
    } catch {
      // ignore
    }
  }
  return formatFindings(`== Seguridad del sitio ${url.host} ==`, findings, notes);
}

// ---------------------------------------------------------------------------------------
// File hash

export async function fileHash(abs: string, expected?: string): Promise<string> {
  const denied = deniedPath(abs, 'read');
  if (denied) throw new Error(denied);
  const data = await readFile(abs);
  const sums = Object.fromEntries(
    ['sha256', 'sha1', 'md5'].map((a) => [a, createHash(a).update(data).digest('hex')]),
  );
  const lines = [
    `${abs} (${data.length} bytes)`,
    `SHA-256: ${sums.sha256}`,
    `SHA-1:   ${sums.sha1}`,
    `MD5:     ${sums.md5}`,
  ];
  if (expected) {
    const e = expected
      .trim()
      .toLowerCase()
      .replace(/^sha256:/, '');
    const match = Object.entries(sums).find(([, v]) => v === e);
    lines.push(
      match
        ? `✓ Coincide con el hash esperado (${match[0].toUpperCase()}).`
        : '✗ NO coincide con el hash esperado: el archivo es distinto o fue alterado.',
    );
  }
  return lines.join('\n');
}

export function resolveAnyPath(p: string, ws: Workspace | undefined): string {
  if (p.startsWith('~') || /^([a-z]:)?[\\/]/i.test(p)) return expandPath(p);
  if (!ws) throw new Error('Abre una carpeta o usa una ruta absoluta.');
  return ws.resolve(p);
}

// ---------------------------------------------------------------------------------------
// Approval texts

export const SECURITY_APPROVAL = new Set([
  'audit_dependencies',
  'security_check_system',
  'port_scan',
  'check_site_security',
]);

/** Security tools that work without an open project folder. */
export const SECURITY_NO_PROJECT = new Set([
  'security_check_system',
  'port_scan',
  'check_site_security',
  'file_hash',
]);

export function securityPreview(
  name: string,
  a: Record<string, unknown>,
): { risk: 'medium'; warning: string; allowKey: string; action: string; url?: string } {
  switch (name) {
    case 'audit_dependencies':
      return {
        risk: 'medium',
        warning:
          'Se enviarán los nombres y versiones de tus dependencias (no tu código) a osv.dev, la base pública de vulnerabilidades de Google.',
        allowKey: 'sec:osv',
        action: 'revisar vulnerabilidades de las dependencias',
      };
    case 'security_check_system':
      return {
        risk: 'medium',
        warning:
          'La IA revisará la seguridad de tu equipo: puertos abiertos, firewall, actualizaciones, SSH, cifrado y permisos. Solo lee, no cambia nada.',
        allowKey: 'sec:system',
        action: 'revisar la seguridad de este equipo',
      };
    case 'port_scan': {
      const target = String(a.target ?? '');
      return {
        risk: 'medium',
        warning: `Escaneo de puertos de ${target}. Hazlo solo en equipos tuyos o con permiso de su dueño: escanear equipos ajenos puede ser ilegal. Solo se permiten localhost y tu red local.`,
        allowKey: `sec:scan:${target}`,
        action: `escanear puertos de ${target}${a.ports ? ` (${String(a.ports)})` : ''}`,
      };
    }
    default: {
      const url = String(a.url ?? '');
      let host = url;
      try {
        host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).host;
      } catch {
        // as typed
      }
      return {
        risk: 'medium',
        warning: `Se visitará ${host} como lo haría un navegador (unas pocas peticiones normales) para revisar su certificado, cifrado y encabezados de seguridad.`,
        allowKey: `sec:site:${host}`,
        action: `revisar la seguridad de ${host}`,
        url,
      };
    }
  }
}
