/**
 * Project files the agent treats specially, whatever the model (or a prompt injection) says:
 *  - secret files are never read by the agent's free read tools (their content would go to
 *    the model provider and could be exfiltrated later);
 *  - files that make other programs run code (git hooks and config, package scripts, editor
 *    tasks, CI) or hold secrets are approved one change at a time, never "always".
 * Paths are workspace-relative with forward slashes.
 */

const SECRET_FILE: RegExp[] = [
  /(^|\/)\.env(\.(?!(example|sample|template|dist|defaults)$)[^/]+)?$/i,
  /(^|\/)\.envrc$/i,
  /\.(pem|key|p12|pfx|jks|keystore|ppk|kdbx|asc|gpg)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(_sk)?$/i,
  /(^|\/)\.(npmrc|pypirc|netrc|git-credentials|htpasswd|pgpass|my\.cnf)$/i,
  /(^|\/)\.aws\/credentials$/i,
  /(^|\/)\.docker\/config\.json$/i,
  /(^|\/)(credentials|service[-_]?account[^/]*|gcp[-_]?key[^/]*)\.json$/i,
  /(^|\/)[^/]*\.tfvars$/i,
  /(^|\/)\.ssh\//i,
];

export function isSecretFile(rel: string): boolean {
  const p = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  return SECRET_FILE.some((re) => re.test(p));
}

const EXECUTES: RegExp[] = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.husky\//,
  /(^|\/)\.githooks\//,
  /(^|\/)\.(vscode|idea|devcontainer|zed|fleet|cursor|claude)\//,
  /(^|\/)\.github\/workflows\//,
  /(^|\/)\.gitlab-ci\.ya?ml$/,
  /(^|\/)package\.json$/,
  /(^|\/)\.(yarnrc(\.yml)?|pnpmfile\.c?js)$/,
  /(^|\/)(pnpm-workspace\.yaml|bunfig\.toml|\.mise\.toml|\.tool-versions)$/,
  /(^|\/)(Makefile|justfile|Taskfile\.ya?ml)$/,
  /(^|\/)\.(pre-commit-config\.yaml|lintstagedrc[^/]*)$/,
  // A workspace opened at the home folder: shell startup files and this app's own data.
  /^\.(bashrc|bash_profile|bash_login|profile|zshrc|zprofile|zshenv|zlogin|xprofile|xinitrc)$/,
  /^\.config\/(fish|autostart|systemd)\//,
  /^\.(omni|local\/bin)\//,
];

/** Why a write to this path must be approved one at a time; null = an ordinary project file. */
export function protectedWrite(rel: string): string | null {
  const p = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  if (isSecretFile(p))
    return '⚠️ Este archivo guarda secretos o credenciales. Revisa el cambio con cuidado.';
  if (EXECUTES.some((re) => re.test(p)))
    return '⚠️ Este archivo hace que otros programas ejecuten código (git, npm, el editor o CI). Un cambio aquí puede ejecutar comandos más tarde sin preguntarte: revísalo con cuidado.';
  return null;
}
