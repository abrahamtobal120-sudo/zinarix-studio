/**
 * Environment handed to child shells (agent commands and the integrated terminal). Provider
 * keys the app can read from the environment (ANTHROPIC_API_KEY, OPENAI_API_KEY…, from the
 * catalog's envVars) and its own OMNI_* secrets never reach them: an approved command
 * could otherwise send them anywhere (`curl -H "k: $ANTHROPIC_API_KEY" …`).
 */

/** Used until the catalog is loaded (and in tests): the most common provider key names. */
const DEFAULT_NAMES = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'MISTRAL_API_KEY',
  'XAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'HF_TOKEN',
];

let credentialNames = new Set(DEFAULT_NAMES);

/** Same rule as the secret-name check used for set_env_var: names that hold credentials. */
const SECRETISH = /key|token|secret|password|passwd|pwd|credential|auth|pat$/i;

/**
 * Registers the catalog's environment variable names. Only the ones that hold credentials
 * are removed (AWS_REGION or AZURE_OPENAI_ENDPOINT stay: commands may legitimately use them).
 */
export function setCredentialEnvNames(names: Iterable<string>): void {
  const next = new Set(DEFAULT_NAMES);
  for (const n of names) if (SECRETISH.test(n)) next.add(n);
  credentialNames = next;
}

export function isCredentialEnv(name: string): boolean {
  if (/^OMNI_/i.test(name)) return /^OMNI_KEY_/i.test(name) || SECRETISH.test(name);
  return credentialNames.has(name);
}

/** A copy of `env` without provider credentials or the app's own secrets. */
export function childEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !isCredentialEnv(k)) out[k] = v;
  return out;
}
