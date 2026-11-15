/**
 * Light security scanners shared by the desktop security center and the code review (app,
 * `omni review` CLI and the GitHub Action): hard-coded secrets and insecure code patterns.
 * Pure: text in, findings out.
 */

// ---------------------------------------------------------------------------------------
// Secrets

export interface SecurityFinding {
  severity: 'crítico' | 'alto' | 'medio' | 'bajo';
  title: string;
  where?: string;
  detail?: string;
  fix?: string;
  /** Broad group for filtering/badges: Secreto, Código inseguro, Dependencia, etc. */
  category?: string;
}

const SECRET_RULES: { name: string; re: RegExp; severity: SecurityFinding['severity'] }[] = [
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
    name: 'Llave de almacenamiento de Azure',
    re: /\bDefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]{40,}/,
    severity: 'crítico',
  },
  { name: 'Llave de Mailgun', re: /\bkey-[0-9a-f]{32}\b/, severity: 'alto' },
  {
    name: 'Credenciales de cuenta de servicio (Google Cloud)',
    re: /"type"\s*:\s*"service_account"/,
    severity: 'alto',
  },
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
  // Enough to recognise the kind of value, never enough to narrow it down (the text goes
  // to the model and to reports).
  return s.length <= 8 ? '****' : `${s.slice(0, 3)}… (${s.length} caracteres)`;
}

export function scanSecretsInText(path: string, text: string): SecurityFinding[] {
  const out: SecurityFinding[] = [];
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
        category: 'Secreto',
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

const CODE_RULES: { re: RegExp; ext: RegExp; f: Omit<SecurityFinding, 'where'> }[] = [
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
    re: /Access-Control-Allow-Credentials["']?\s*[:,]\s*["']?true/i,
    ext: /\.(m?[jt]sx?|py|php|go|java|cs|conf|ya?ml)$/,
    f: {
      severity: 'alto',
      title: 'CORS con credenciales habilitadas',
      fix: 'Si permites credenciales, nunca uses origin "*": lista orígenes exactos.',
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

export function scanCodeInText(path: string, text: string): SecurityFinding[] {
  const out: SecurityFinding[] = [];
  const rules = CODE_RULES.filter((r) => r.ext.test(path));
  if (!rules.length || /(^|\/)(test|tests|__tests__|spec|fixtures?|examples?)\//i.test(path))
    return out;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length > 1000 || /^\s*(\/\/|#|\*|--)/.test(line)) continue;
    for (const r of rules)
      if (r.re.test(line))
        out.push({
          ...r.f,
          category: 'Código inseguro',
          where: `${path}:${i + 1}`,
          detail: line.trim().slice(0, 140),
        });
  }
  return out;
}
