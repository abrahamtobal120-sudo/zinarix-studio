# Informe de seguridad — Zinarix Studio

Fecha: 14/11/2026, 9:29:53 p.m.

**Puntaje general: 0/100**

Resumen: 35 críticos · 402 altos · 312 medios · 36 bajos

## Proyecto

_Archivos revisados: 19510 (se respetan .gitignore y carpetas pesadas)._

### [ALTO] Llave de Google
- Ubicación: `.md/notas/api.md:1`
- Categoría: Secreto
- Detalle: valor: AIz… (39 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `apps/cli/test/commands.test.ts:71`
- Categoría: Secreto
- Detalle: valor: SEC… (38 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `apps/desktop/google-oauth.local.json:1`
- Categoría: Secreto
- Detalle: valor: cli… (52 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/scripts/browser-shot.mjs:7`
- Categoría: Código inseguro
- Detalle: import { execFileSync } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/scripts/build-editions.mjs:11`
- Categoría: Código inseguro
- Detalle: import { spawnSync } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/scripts/build-especial.mjs:4`
- Categoría: Código inseguro
- Detalle: import { spawnSync } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/scripts/dist.mjs:5`
- Categoría: Código inseguro
- Detalle: import { spawnSync } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/scripts/install-local.mjs:3`
- Categoría: Código inseguro
- Detalle: import { execFileSync } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/scripts/start-local.mjs:2`
- Categoría: Código inseguro
- Detalle: import { spawnSync, spawn } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/scripts/video-e2e.mjs:4`
- Categoría: Código inseguro
- Detalle: import { execFileSync } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] eval / new Function
- Ubicación: `apps/desktop/scripts/video-e2e.mjs:86`
- Categoría: Código inseguro
- Detalle: win.$$eval('.vs-clip', (els) =>
- Solución: Evita ejecutar texto como código; usa JSON.parse o una tabla de funciones.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/src/main/agent.ts:1`
- Categoría: Código inseguro
- Detalle: import { spawn } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/src/main/debug/cdpBackend.ts:1`
- Categoría: Código inseguro
- Detalle: import { spawn, type ChildProcess } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/src/main/debug/dapBackend.ts:1`
- Categoría: Código inseguro
- Detalle: import { spawn, type ChildProcess } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/src/main/debug/manager.ts:1`
- Categoría: Código inseguro
- Detalle: import { spawnSync } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/src/main/git.ts:1`
- Categoría: Código inseguro
- Detalle: import { execFile } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/src/main/lsp.ts:1`
- Categoría: Código inseguro
- Detalle: import { spawn, type ChildProcess } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `apps/desktop/src/main/lsp.ts:364`
- Categoría: Código inseguro
- Detalle: createHash('sha1').update(this.root ?? '').digest('hex').slice(0, 12),
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `apps/desktop/src/main/main.ts:936`
- Categoría: Código inseguro
- Detalle: createHash('sha1').update(target).digest('hex').slice(0, 16),
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/src/main/mcp.ts:16`
- Categoría: Código inseguro
- Detalle: import { spawn, type ChildProcess } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `apps/desktop/src/main/mcp.ts:146`
- Categoría: Código inseguro
- Detalle: const h = createHash('sha1').update(`${server}\0${tool}`).digest('hex').slice(0, 6);
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `apps/desktop/src/main/phonePage.ts:269`
- Categoría: Código inseguro
- Detalle: s.innerHTML = ICONS[name] || '';
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `apps/desktop/src/main/security.ts:218`
- Categoría: Código inseguro
- Detalle: re: /\.innerHTML\s*=|dangerouslySetInnerHTML|document\.write\s*\(/,
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/src/main/security.ts:245`
- Categoría: Código inseguro
- Detalle: re: /child_process|\bexecSync\s*\(|\bexec\s*\(\s*`[^`]*\$\{/,
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] Verificación TLS desactivada
- Ubicación: `apps/desktop/src/main/security.ts:1225`
- Categoría: Código inseguro
- Detalle: { host, port, servername: host, timeout: 10_000, rejectUnauthorized: false },
- Solución: Activa la verificación de certificados; si es un certificado propio, agrégalo como CA de confianza.

### [BAJO] URL sin cifrar (http://)
- Ubicación: `apps/desktop/src/main/security.ts:1299`
- Categoría: Código inseguro
- Detalle: title: 'http:// no redirige a https://',
- Solución: Usa https:// para no enviar datos en texto plano.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/src/main/supabase.ts:1`
- Categoría: Código inseguro
- Detalle: import { execFile } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/src/main/system.ts:1`
- Categoría: Código inseguro
- Detalle: import { spawn } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/src/main/terminal-env.ts:1`
- Categoría: Código inseguro
- Detalle: import { execFileSync } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/src/main/terminal.ts:1`
- Categoría: Código inseguro
- Detalle: import { spawn } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/src/main/tunnel.ts:1`
- Categoría: Código inseguro
- Detalle: import { spawn, spawnSync } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/src/main/tunnel.ts:2`
- Categoría: Código inseguro
- Detalle: import type { ChildProcess } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/src/main/vercel.ts:1`
- Categoría: Código inseguro
- Detalle: import { execFile } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/src/main/video.ts:9`
- Categoría: Código inseguro
- Detalle: import { spawn, spawnSync } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `apps/desktop/src/main/video.ts:206`
- Categoría: Código inseguro
- Detalle: return createHash('sha1').update(`${path}|${mtime}|${what}`).digest('hex').slice(0, 24);
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `apps/desktop/src/main/watch.ts:77`
- Categoría: Código inseguro
- Detalle: const sha = (text: string) => createHash('sha1').update(text).digest('hex');
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `apps/desktop/src/main/workspace.ts:1`
- Categoría: Código inseguro
- Detalle: import { execFile, spawn } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `apps/desktop/src/preload/designPreview.ts:74`
- Categoría: Código inseguro
- Detalle: shadow.innerHTML = `
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `apps/desktop/src/preload/designPreview.ts:219`
- Categoría: Código inseguro
- Detalle: if (!keep) e.el.innerHTML = e.before;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [CRÍTICO] Contraseña en una URL de conexión
- Ubicación: `apps/desktop/test/agent-escape.test.ts:287`
- Categoría: Secreto
- Detalle: valor: pos… (23 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Llave de Anthropic
- Ubicación: `apps/desktop/test/main-hardening.test.ts:248`
- Categoría: Secreto
- Detalle: valor: sk-… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Contraseña en una URL de conexión
- Ubicación: `apps/desktop/test/main-hardening.test.ts:358`
- Categoría: Secreto
- Detalle: valor: pos… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Llave de OpenAI
- Ubicación: `apps/desktop/test/multi-ai.test.ts:432`
- Categoría: Secreto
- Detalle: valor: sk-… (44 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Credenciales de cuenta de servicio (Google Cloud)
- Ubicación: `apps/desktop/test/security.test.ts:48`
- Categoría: Secreto
- Detalle: valor: "ty… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `eslint.config.js:33`
- Categoría: Código inseguro
- Detalle: 'ImportDeclaration[source.value=/^(node:)?child_process$/] ImportSpecifier[imported.name=/^(exec|execSync)$/]',
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [CRÍTICO] Llave de Anthropic
- Ubicación: `packages/core/test/core.test.ts:547`
- Categoría: Secreto
- Detalle: valor: sk-… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `packages/providers/src/adapters/cli-agent.ts:1`
- Categoría: Código inseguro
- Detalle: import { spawn } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [CRÍTICO] Llave de Anthropic
- Ubicación: `packages/providers/test/adapters.test.ts:320`
- Categoría: Secreto
- Detalle: valor: sk-… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Llave de Anthropic
- Ubicación: `packages/providers/test/adapters.test.ts:339`
- Categoría: Secreto
- Detalle: valor: sk-… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Llave de OpenAI
- Ubicación: `packages/providers/test/http.test.ts:56`
- Categoría: Secreto
- Detalle: valor: sk-… (36 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Llave de OpenAI
- Ubicación: `packages/security/test/redact.test.ts:20`
- Categoría: Secreto
- Detalle: valor: sk-… (36 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Clave de servicio de Supabase / JWT
- Ubicación: `packages/security/test/redact.test.ts:57`
- Categoría: Secreto
- Detalle: valor: eyJ… (92 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Contraseña en una URL de conexión
- Ubicación: `packages/security/test/redact.test.ts:61`
- Categoría: Secreto
- Detalle: valor: pos… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Llave privada
- Ubicación: `packages/security/test/redact.test.ts:62`
- Categoría: Secreto
- Detalle: valor: ---… (31 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Llave privada
- Ubicación: `packages/security/test/redact.test.ts:159`
- Categoría: Secreto
- Detalle: valor: ---… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `scripts/audit.mjs:16`
- Categoría: Código inseguro
- Detalle: import { spawnSync } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/.agents/skills/launch/scripts/monaco-paste.ts:7`
- Categoría: Código inseguro
- Detalle: import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [BAJO] Contenedor ejecutándose como root
- Ubicación: `vendor/vscode-main/.devcontainer/Dockerfile:15`
- Categoría: Código inseguro
- Detalle: USER root
- Solución: Crea un usuario sin privilegios y usa USER app.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/.github/actions/detect-missing-caches/detect.ts:6`
- Categoría: Código inseguro
- Detalle: import { execFileSync } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/.github/hooks/scripts/worktree-build-fast.ts:6`
- Categoría: Código inseguro
- Detalle: import * as child_process from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/.github/hooks/scripts/worktree-build-fast.ts:10`
- Categoría: Código inseguro
- Detalle: const result = child_process.spawnSync('git', args, {
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/.github/hooks/scripts/worktree-build-fast.ts:26`
- Categoría: Código inseguro
- Detalle: const result = child_process.spawnSync(pnpm, args, {
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/.github/rulesets/rulesets.ts:11`
- Categoría: Código inseguro
- Detalle: import { execFileSync } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/.github/skills/auto-perf-optimize/scripts/chat-memory-smoke.mts:19`
- Categoría: Código inseguro
- Detalle: import { spawn, type ChildProcess } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/.github/skills/auto-perf-optimize/scripts/chat-session-switch-smoke.mts:21`
- Categoría: Código inseguro
- Detalle: import { spawn, type ChildProcess } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/.github/skills/auto-perf-optimize/scripts/workbench-css-performance.mts:12`
- Categoría: Código inseguro
- Detalle: import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/.github/skills/azure-pipelines/azure-pipeline.ts:22`
- Categoría: Código inseguro
- Detalle: import { spawn, execSync } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/.github/skills/azure-pipelines/azure-pipeline.ts:211`
- Categoría: Código inseguro
- Detalle: execSync(`${process.platform === 'win32' ? 'where' : 'which'} ${command}`, { stdio: 'ignore' });
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/.github/skills/azure-pipelines/azure-pipeline.ts:220`
- Categoría: Código inseguro
- Detalle: execSync('az extension show --name azure-devops', { stdio: 'ignore' });
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/.github/skills/azure-pipelines/azure-pipeline.ts:229`
- Categoría: Código inseguro
- Detalle: return execSync('git branch --show-current', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/.github/skills/azure-pipelines/azure-pipeline.ts:246`
- Categoría: Código inseguro
- Detalle: execSync('az extension add --name azure-devops', { stdio: 'inherit' });
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/.github/workflows/workspace_image/image.ts:27`
- Categoría: Código inseguro
- Detalle: import { execFile, spawn, spawnSync, type ChildProcess, type SpawnSyncOptions } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/.vscode/extensions/vscode-selfhost-test-provider/src/failureTracker.ts:6`
- Categoría: Código inseguro
- Detalle: import { spawn } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/.vscode/extensions/vscode-selfhost-test-provider/src/testOutputScanner.ts:14`
- Categoría: Código inseguro
- Detalle: import { ChildProcessWithoutNullStreams } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/.vscode/extensions/vscode-selfhost-test-provider/src/vscodeTestRunner.ts:6`
- Categoría: Código inseguro
- Detalle: import { spawn } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [BAJO] URL sin cifrar (http://)
- Ubicación: `vendor/vscode-main/cglicenses.json:57`
- Categoría: Código inseguro
- Detalle: "http://www.apache.org/licenses/",
- Solución: Usa https:// para no enviar datos en texto plano.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/cli/src/auth.rs:968`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/eslint.config.js:1529`
- Categoría: Código inseguro
- Detalle: 'child_process',
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/configuration-editing/src/test/importExportProfiles.test.ts:52`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] eval / new Function
- Ubicación: `vendor/vscode-main/extensions/copilot/.esbuild.mts:151`
- Categoría: Código inseguro
- Detalle: vscode = eval('require(' + JSON.stringify('vscode') + ')');
- Solución: Evita ejecutar texto como código; usa JSON.parse o una tabla de funciones.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/.esbuild.mts:243`
- Categoría: Código inseguro
- Detalle: 'child_process',
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/.esbuild.mts:407`
- Categoría: Código inseguro
- Detalle: const child_process = await import('child_process');
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/.esbuild.mts:408`
- Categoría: Código inseguro
- Detalle: child_process.execFileSync(
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/script/compareStestAlternativeRuns.ts:8`
- Categoría: Código inseguro
- Detalle: import { execFile } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/script/electron/simulationWorkbenchMain.js:9`
- Categoría: Código inseguro
- Detalle: const child_process = require('child_process');
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/script/electron/simulationWorkbenchMain.js:88`
- Categoría: Código inseguro
- Detalle: /** @type {Map<string, child_process.ChildProcess>} */
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/script/electron/simulationWorkbenchMain.js:103`
- Categoría: Código inseguro
- Detalle: const child = child_process.spawn(
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/script/scoredEditsReconciler.ts:5`
- Categoría: Código inseguro
- Detalle: import { execSync } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/script/scoredEditsReconciler.ts:65`
- Categoría: Código inseguro
- Detalle: const gitOutput = execSync('git diff --name-only --diff-filter=U').toString();
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/script/setup/createVenv.mts:6`
- Categoría: Código inseguro
- Detalle: import { execSync } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/script/setup/createVenv.mts:28`
- Categoría: Código inseguro
- Detalle: execSync(`${pythonCommand} --version`, { stdio: 'ignore' });
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/script/setup/createVenv.mts:43`
- Categoría: Código inseguro
- Detalle: execSync(`${python} -c "import sys;version=sys.version_info;print(version);assert (3,10) <= version < (3,13),'Python version must be >=3.10,
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/script/setup/createVenv.mts:53`
- Categoría: Código inseguro
- Detalle: execSync(`${uvPath} --version`, { stdio: 'ignore' });
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/script/setup/createVenv.mts:61`
- Categoría: Código inseguro
- Detalle: execSync(`uv --version`, { stdio: 'ignore' });
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/script/setup/createVenv.mts:71`
- Categoría: Código inseguro
- Detalle: execSync(command, { stdio: 'inherit' });
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/byok/vscode-node/test/customEndpointProvider.spec.ts:201`
- Categoría: Secreto
- Detalle: valor: api… (22 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/byok/vscode-node/test/customEndpointProvider.spec.ts:382`
- Categoría: Secreto
- Detalle: valor: api… (22 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/byok/vscode-node/test/customEndpointProvider.spec.ts:443`
- Categoría: Secreto
- Detalle: valor: api… (22 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/byok/vscode-node/test/customEndpointProvider.spec.ts:491`
- Categoría: Secreto
- Detalle: valor: api… (22 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/byok/vscode-node/test/customEndpointProvider.spec.ts:531`
- Categoría: Secreto
- Detalle: valor: api… (22 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/byok/vscode-node/test/customEndpointProvider.spec.ts:656`
- Categoría: Secreto
- Detalle: valor: api… (23 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/byok/vscode-node/test/customEndpointProvider.spec.ts:677`
- Categoría: Secreto
- Detalle: valor: api… (23 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/byok/vscode-node/test/customEndpointProvider.spec.ts:948`
- Categoría: Secreto
- Detalle: valor: API… (23 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/byok/vscode-node/test/customEndpointProvider.spec.ts:989`
- Categoría: Secreto
- Detalle: valor: api… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/byok/vscode-node/test/customEndpointProvider.spec.ts:1001`
- Categoría: Secreto
- Detalle: valor: api… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/byok/vscode-node/test/geminiNativeProvider.spec.ts:406`
- Categoría: Secreto
- Detalle: valor: api… (19 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/byok/vscode-node/test/openAIProvider.spec.ts:69`
- Categoría: Secreto
- Detalle: valor: api… (18 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/byok/vscode-node/test/openAIProvider.spec.ts:78`
- Categoría: Secreto
- Detalle: valor: api… (18 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/byok/vscode-node/test/openAIProvider.spec.ts:125`
- Categoría: Secreto
- Detalle: valor: api… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chatSessions/copilotcli/node/copilotcliSession.ts:8`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chatSessions/copilotcli/node/test/copilotCliAuth.spec.ts:127`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chatSessions/copilotcli/node/test/missionControlApiClient.spec.ts:52`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chatSessions/copilotcli/vscode-node/copilotCLISessionTracker.ts:6`
- Categoría: Código inseguro
- Detalle: import { execFile } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chatSessions/vscode-node/test/copilotCLITerminalIntegration.spec.ts:618`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Token de GitHub
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chronicle/common/test/secretFilter.spec.ts:11`
- Categoría: Secreto
- Detalle: valor: ghp… (40 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Token de GitHub
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chronicle/common/test/secretFilter.spec.ts:16`
- Categoría: Secreto
- Detalle: valor: gho… (40 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Llave de AWS
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chronicle/common/test/secretFilter.spec.ts:48`
- Categoría: Secreto
- Detalle: valor: AKI… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Token de GitHub
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chronicle/common/test/secretFilter.spec.ts:53`
- Categoría: Secreto
- Detalle: valor: git… (93 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Token de GitHub
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chronicle/common/test/secretFilter.spec.ts:67`
- Categoría: Secreto
- Detalle: valor: ghp… (40 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Llave privada
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chronicle/common/test/secretFilter.spec.ts:76`
- Categoría: Secreto
- Detalle: valor: ---… (31 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Llave privada
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chronicle/common/test/secretFilter.spec.ts:84`
- Categoría: Secreto
- Detalle: valor: ---… (35 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Contraseña en una URL de conexión
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chronicle/common/test/secretFilter.spec.ts:89`
- Categoría: Secreto
- Detalle: valor: mon… (31 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Contraseña en una URL de conexión
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chronicle/common/test/secretFilter.spec.ts:96`
- Categoría: Secreto
- Detalle: valor: pos… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Contraseña en una URL de conexión
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chronicle/common/test/secretFilter.spec.ts:102`
- Categoría: Secreto
- Detalle: valor: red… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Webhook de Slack/Discord
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chronicle/common/test/secretFilter.spec.ts:123`
- Categoría: Secreto
- Detalle: valor: htt… (54 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Token de GitHub
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chronicle/common/test/secretFilter.spec.ts:154`
- Categoría: Secreto
- Detalle: valor: ghp… (40 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Token de GitHub
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chronicle/common/test/secretFilter.spec.ts:161`
- Categoría: Secreto
- Detalle: valor: ghp… (40 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Token de GitHub
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chronicle/common/test/secretFilter.spec.ts:171`
- Categoría: Secreto
- Detalle: valor: ghp… (40 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Token de GitHub
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chronicle/common/test/secretFilter.spec.ts:183`
- Categoría: Secreto
- Detalle: valor: ghp… (40 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chronicle/node/test/cloudSessionApiClient.spec.ts:23`
- Categoría: Secreto
- Detalle: valor: acc… (23 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/chronicle/node/test/cloudSessionStoreClient.spec.ts:25`
- Categoría: Secreto
- Detalle: valor: acc… (23 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/completions-core/vscode-node/extension/src/copilotPanel/webView/suggestionsPanelWebview.ts:166`
- Categoría: Código inseguro
- Detalle: loadingContainer.innerHTML = `${message.solutions.length} Suggestions`;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/githubMcp/test/node/githubMcpDefinitionProvider.spec.ts:136`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/githubMcp/test/node/githubMcpDefinitionProvider.spec.ts:459`
- Categoría: Secreto
- Detalle: valor: acc… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/githubMcp/test/node/githubMcpDefinitionProvider.spec.ts:468`
- Categoría: Secreto
- Detalle: valor: acc… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/githubMcp/test/node/githubMcpDefinitionProvider.spec.ts:489`
- Categoría: Secreto
- Detalle: valor: acc… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/inlineEdits/test/vscode-node/isInlineSuggestion.spec.ts:757`
- Categoría: Secreto
- Detalle: valor: pas… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/inlineEdits/test/vscode-node/isInlineSuggestion.spec.ts:764`
- Categoría: Secreto
- Detalle: valor: pas… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/intents/test/node/toolCallingLoopIdentity.spec.ts:59`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Verificación TLS desactivada
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/log/vscode-node/loggingActions.ts:434`
- Categoría: Código inseguro
- Detalle: rejectUnauthorized: false,
- Solución: Activa la verificación de certificados; si es un certificado propio, agrégalo como CA de confianza.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/mcp/vscode-node/util.ts:6`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/onboardDebug/node/copilotDebugWorker/open.ts:6`
- Categoría: Código inseguro
- Detalle: import { spawn } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] eval / new Function
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/prompts/node/inline/pythonCookbookData.ts:52`
- Categoría: Código inseguro
- Detalle: 'S102': 'Replace the use of `exec()` with a safer alternative, such as defining a function or using `eval()` for specific cases.  [Before]  
- Solución: Evita ejecutar texto como código; usa JSON.parse o una tabla de funciones.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/prompts/node/inline/pythonCookbookData.ts:66`
- Categoría: Código inseguro
- Detalle: 'S303': 'Replace the use of the weak MD5 hash function with the secure SHA-256 hash function.  [Before]   ```python from cryptography.hazmat
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [ALTO] eval / new Function
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/prompts/node/inline/pythonCookbookData.ts:70`
- Categoría: Código inseguro
- Detalle: 'S307': 'Replace the insecure `eval()` function with `ast.literal_eval()` for safer evaluation of user input.  [Before]   ```python x = eval
- Solución: Evita ejecutar texto como código; usa JSON.parse o una tabla de funciones.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/prompts/node/inline/pythonCookbookData.ts:85`
- Categoría: Código inseguro
- Detalle: 'S324': 'Replace the use of the weak MD5 hash function with a secure SHA256 hash function.  [Before]   ```python import hashlib  def certifi
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [ALTO] Verificación TLS desactivada
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/prompts/node/inline/pythonCookbookData.ts:100`
- Categoría: Código inseguro
- Detalle: 'S501': 'Remove the `verify=False` parameter to ensure SSL certificate verification is enabled.  [Before]   ```python import requests  reque
- Solución: Activa la verificación de certificados; si es un certificado propio, agrégalo como CA de confianza.

### [ALTO] eval / new Function
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/prompts/node/inline/pythonCookbookData.ts:661`
- Categoría: Código inseguro
- Detalle: 'PGH001': 'Replace the use of `eval()` with a safer alternative to prevent arbitrary code execution.  [Before]   ```python def foo():     x 
- Solución: Evita ejecutar texto como código; usa JSON.parse o una tabla de funciones.

### [ALTO] eval / new Function
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/prompts/node/inline/pythonCookbookData.ts:913`
- Categoría: Código inseguro
- Detalle: 'RUF101': 'Replace deprecated rule code with the canonical rule code for better codebase consistency.  [Before]   ```python x = eval(command
- Solución: Evita ejecutar texto como código; usa JSON.parse o una tabla de funciones.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/test/vscode-node/session.test.ts:135`
- Categoría: Secreto
- Detalle: valor: acc… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/test/vscode-node/session.test.ts:141`
- Categoría: Secreto
- Detalle: valor: acc… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/test/vscode-node/session.test.ts:160`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/test/vscode-node/session.test.ts:166`
- Categoría: Secreto
- Detalle: valor: acc… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/test/vscode-node/session.test.ts:172`
- Categoría: Secreto
- Detalle: valor: acc… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/test/vscode-node/session.test.ts:212`
- Categoría: Secreto
- Detalle: valor: acc… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/tools/node/test/sessionStoreSqlTool.spec.ts:63`
- Categoría: Secreto
- Detalle: valor: acc… (23 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/typescriptContext/serverPlugin/src/common/baseContextProviders.ts:159`
- Categoría: Código inseguro
- Detalle: const hash = session.host.createHash('md5'); // CodeQL [SM04514] The 'md5' algorithm is used to compute a shorter string to represent a symb
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/typescriptContext/serverPlugin/src/common/typescripts.ts:673`
- Categoría: Código inseguro
- Detalle: const hash = hashProvider.createHash('md5'); // CodeQL [SM04514] The 'md5' algorithm is used to compute a shorter string to represent a symb
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/typescriptContext/serverPlugin/src/common/typescripts.ts:730`
- Categoría: Código inseguro
- Detalle: const hash = context.host.createHash('md5'); // CodeQL [SM04514] The 'md5' algorithm is used to compute a shorter string to represent a symb
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/typescriptContext/vscode-node/ts7/baseContextProviders.ts:154`
- Categoría: Código inseguro
- Detalle: const hash = createHash('md5'); // CodeQL [SM04514] Used only as a compact cache key, not for security.
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/typescriptContext/vscode-node/ts7/typescripts.ts:278`
- Categoría: Código inseguro
- Detalle: const hash = createHash('md5'); // CodeQL [SM04514] Used only as a compact cache key, not for security.
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `vendor/vscode-main/extensions/copilot/src/extension/typescriptContext/vscode-node/ts7/typescripts.ts:292`
- Categoría: Código inseguro
- Detalle: const hash = createHash('md5'); // CodeQL [SM04514] Used only as a compact cache key, not for security.
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/authentication/test/node/enterprise.spec.ts:63`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/authentication/test/node/quotaTokenRefresh.spec.ts:139`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/authentication/test/node/quotaTokenRefresh.spec.ts:161`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/authentication/test/node/quotaTokenRefresh.spec.ts:166`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/authentication/test/node/session.spec.ts:263`
- Categoría: Secreto
- Detalle: valor: acc… (33 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/authentication/test/node/session.spec.ts:442`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/chat/node/hookExecutor.ts:6`
- Categoría: Código inseguro
- Detalle: import { spawn } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/git/vscode-node/gitServiceImpl.ts:8`
- Categoría: Código inseguro
- Detalle: import { execFile } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [CRÍTICO] Llave privada
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/ignore/node/test/remoteContentExclusion.spec.ts:689`
- Categoría: Secreto
- Detalle: valor: ---… (31 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Llave privada
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/ignore/node/test/remoteContentExclusion.spec.ts:690`
- Categoría: Secreto
- Detalle: valor: ---… (31 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/otel/node/test/otelIdentity.spec.ts:24`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/search/vscode-node/test/searchServiceImpl.spec.ts:85`
- Categoría: Secreto
- Detalle: valor: api… (23 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/workspaceChunkSearch/node/codeSearch/repoTracker.ts:5`
- Categoría: Código inseguro
- Detalle: import { exec } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/workspaceChunkSearch/test/node/codeSearchChunkSearch.spec.ts:45`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/workspaceChunkSearch/test/node/codeSearchChunkSearch.spec.ts:159`
- Categoría: Secreto
- Detalle: valor: acc… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/workspaceChunkSearch/test/node/codeSearchChunkSearch.spec.ts:275`
- Categoría: Secreto
- Detalle: valor: acc… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/workspaceChunkSearch/test/node/codeSearchChunkSearch.spec.ts:296`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/workspaceChunkSearch/test/node/codeSearchChunkSearch.spec.ts:315`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/workspaceChunkSearch/test/node/codeSearchChunkSearch.spec.ts:376`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/workspaceChunkSearch/test/node/codeSearchChunkSearch.spec.ts:386`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/workspaceChunkSearch/test/node/codeSearchChunkSearch.spec.ts:401`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/workspaceChunkSearch/test/node/codeSearchChunkSearch.spec.ts:419`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/workspaceChunkSearch/test/node/codeSearchChunkSearch.spec.ts:434`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/workspaceChunkSearch/test/node/codeSearchChunkSearch.spec.ts:441`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/workspaceChunkSearch/test/node/codeSearchChunkSearch.spec.ts:459`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/workspaceChunkSearch/test/node/codeSearchChunkSearch.spec.ts:490`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/workspaceChunkSearch/test/node/codeSearchChunkSearch.spec.ts:519`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/workspaceChunkSearch/test/node/codeSearchChunkSearch.spec.ts:731`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/copilot/src/platform/workspaceChunkSearch/test/node/codeSearchChunkSearch.spec.ts:743`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Llave de OpenAI
- Ubicación: `vendor/vscode-main/extensions/copilot/test/prompts/fixtures/devcontainer/devContainerConfigTestData.json:570`
- Categoría: Secreto
- Detalle: valor: sk-… (40 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/esbuild-common.test.mts:7`
- Categoría: Código inseguro
- Detalle: import { execFile, spawn } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/git/src/askpassManager.ts:9`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/git/src/git.ts:9`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/github-authentication/src/test/enterpriseStorage.test.ts:24`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/github-authentication/src/test/extension.test.ts:83`
- Categoría: Secreto
- Detalle: valor: acc… (32 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/github-authentication/src/test/extension.test.ts:248`
- Categoría: Secreto
- Detalle: valor: acc… (36 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/github-authentication/src/test/github.test.ts:40`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/github-authentication/src/test/github.test.ts:334`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/github-authentication/src/test/githubEnterprise.test.ts:355`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/github-authentication/src/test/githubEnterprise.test.ts:452`
- Categoría: Secreto
- Detalle: valor: acc… (32 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/extensions/github-authentication/src/test/sessionProvenance.test.ts:199`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/grunt/src/main.ts:8`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/gulp/src/main.ts:8`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [BAJO] URL sin cifrar (http://)
- Ubicación: `vendor/vscode-main/extensions/html-language-features/cgmanifest.json:58`
- Categoría: Código inseguro
- Detalle: "http://www.apache.org/licenses/",
- Solución: Usa https:// para no enviar datos en texto plano.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/jake/src/main.ts:8`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/extensions/markdown-language-features/notebook/index.ts:339`
- Categoría: Código inseguro
- Detalle: previewNode.innerHTML = (ctx.workspace.isTrusted
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/markdown-language-features/scripts/markdownEditorPackage.test.mts:7`
- Categoría: Código inseguro
- Detalle: import { execFile, spawn } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/extensions/mermaid-markdown-features/preview-src/markdown/index.ts:45`
- Categoría: Código inseguro
- Detalle: mermaidContainer.innerHTML = content;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/extensions/mermaid-markdown-features/preview-src/markdownEditor/index.ts:71`
- Categoría: Código inseguro
- Detalle: element.innerHTML = html;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/extensions/mermaid-markdown-features/preview-src/notebook/index.ts:50`
- Categoría: Código inseguro
- Detalle: liveEl.innerHTML = content;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/extensions/mermaid-markdown-features/preview-src/shared/diagramManager.ts:257`
- Categoría: Código inseguro
- Detalle: controls.innerHTML = `
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/extensions/mermaid-markdown-features/preview-src/shared/index.ts:88`
- Categoría: Código inseguro
- Detalle: mermaidContainer.innerHTML = '';
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/extensions/notebook-renderers/src/index.ts:112`
- Categoría: Código inseguro
- Detalle: element.innerHTML = trustedHtml as string;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/extensions/notebook-renderers/src/index.ts:142`
- Categoría: Código inseguro
- Detalle: element.innerHTML = trustedHtml as string;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/extensions/notebook-renderers/src/index.ts:232`
- Categoría: Código inseguro
- Detalle: headerSection.innerHTML = errorLocation;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/extensions/notebook-renderers/src/linkify.ts:93`
- Categoría: Código inseguro
- Detalle: span.innerHTML = this.createHtml(part.value)!;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/npm/esbuild.browser.mts:22`
- Categoría: Código inseguro
- Detalle: 'child_process',
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/npm/src/features/packageJSONContribution.ts:11`
- Categoría: Código inseguro
- Detalle: import type * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/npm/src/features/packageJSONContribution.ts:305`
- Categoría: Código inseguro
- Detalle: const cp = await import('child_process');
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] eval / new Function
- Ubicación: `vendor/vscode-main/extensions/php-language-features/src/features/phpGlobals.ts:183`
- Categoría: Código inseguro
- Detalle: description: 'Evaluates the string given in code_str as PHP code. Among other things, this can be useful for storing code in a database text
- Solución: Evita ejecutar texto como código; usa JSON.parse o una tabla de funciones.

### [ALTO] eval / new Function
- Ubicación: `vendor/vscode-main/extensions/php-language-features/src/features/phpGlobals.ts:207`
- Categoría: Código inseguro
- Detalle: description: 'If called from within a function, the return statement immediately ends execution of the current function, and returns its arg
- Solución: Evita ejecutar texto como código; usa JSON.parse o una tabla de funciones.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/php-language-features/src/features/validationProvider.ts:6`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/terminal-suggest/scripts/terminalScriptHelpers.ts:7`
- Categoría: Código inseguro
- Detalle: import { exec } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/terminal-suggest/src/fig/autocomplete-parser/parseArguments.ts:37`
- Categoría: Código inseguro
- Detalle: import { exec, type ExecException } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] SQL armado con texto (posible inyección SQL)
- Ubicación: `vendor/vscode-main/extensions/terminal-suggest/src/fig/autocomplete-parser/parseArguments.ts:1122`
- Categoría: Código inseguro
- Detalle: exec(`${executable} -c "${command}"`, (error: ExecException | null, stdout: string, stderr: string) => {
- Solución: Usa consultas parametrizadas (?, $1, :nombre) en lugar de concatenar valores.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/terminal-suggest/src/fig/autocomplete-parser/parseArguments.ts:1122`
- Categoría: Código inseguro
- Detalle: exec(`${executable} -c "${command}"`, (error: ExecException | null, stdout: string, stderr: string) => {
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/terminal-suggest/src/shell/bash.ts:8`
- Categoría: Código inseguro
- Detalle: import { type ExecOptionsWithStringEncoding } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/terminal-suggest/src/shell/common.ts:7`
- Categoría: Código inseguro
- Detalle: import { exec, spawn, type ExecOptionsWithStringEncoding, type SpawnOptionsWithoutStdio } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/terminal-suggest/src/shell/fish.ts:9`
- Categoría: Código inseguro
- Detalle: import { type ExecOptionsWithStringEncoding } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/terminal-suggest/src/shell/pwsh.ts:8`
- Categoría: Código inseguro
- Detalle: import { type ExecOptionsWithStringEncoding } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/terminal-suggest/src/shell/zsh.ts:9`
- Categoría: Código inseguro
- Detalle: import { type ExecOptionsWithStringEncoding } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/terminal-suggest/src/terminalSuggestMain.ts:6`
- Categoría: Código inseguro
- Detalle: import { ExecOptionsWithStringEncoding } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/extensions/theme-seti/icons/preview.html:85`
- Categoría: Código inseguro
- Detalle: style.innerHTML = cssContent.join('\n');
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/tunnel-forwarding/src/extension.ts:6`
- Categoría: Código inseguro
- Detalle: import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/typescript-language-features/src/configuration/configuration.electron.ts:9`
- Categoría: Código inseguro
- Detalle: import * as child_process from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/typescript-language-features/src/configuration/configuration.electron.ts:97`
- Categoría: Código inseguro
- Detalle: const out = child_process.execFileSync('node', ['-e', 'console.log(process.execPath)'], {
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/typescript-language-features/src/tsServer/serverProcess.electron.ts:6`
- Categoría: Código inseguro
- Detalle: import * as child_process from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/typescript-language-features/src/tsServer/serverProcess.electron.ts:220`
- Categoría: Código inseguro
- Detalle: private readonly _process: child_process.ChildProcess,
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/typescript-language-features/src/tsServer/serverProcess.electron.ts:279`
- Categoría: Código inseguro
- Detalle: private readonly _process: child_process.ChildProcess,
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/typescript-language-features/src/tsServer/serverProcess.electron.ts:373`
- Categoría: Código inseguro
- Detalle: child_process.spawn(execPath, [...execArgv, tsServerPath, ...runtimeArgs], {
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/typescript-language-features/src/tsServer/serverProcess.electron.ts:378`
- Categoría: Código inseguro
- Detalle: child_process.fork(tsServerPath, runtimeArgs, {
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `vendor/vscode-main/extensions/vscode-api-tests/src/singlefolder-tests/browser.test.ts:310`
- Categoría: Código inseguro
- Detalle: const accept = crypto.createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base6
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] Math.random para valores secretos
- Ubicación: `vendor/vscode-main/extensions/vscode-api-tests/src/singlefolder-tests/browser.tools.test.ts:103`
- Categoría: Código inseguro
- Detalle: const token = `${Date.now()}-${Math.random()}`;
- Solución: Usa crypto.randomUUID() o crypto.getRandomValues().

### [BAJO] URL sin cifrar (http://)
- Ubicación: `vendor/vscode-main/extensions/vscode-api-tests/src/singlefolder-tests/languages.test.ts:122`
- Categoría: Código inseguro
- Detalle: assert.strictEqual(link2.target && link2.target.toString(), 'http://a.com/');
- Solución: Usa https:// para no enviar datos en texto plano.

### [ALTO] eval / new Function
- Ubicación: `vendor/vscode-main/extensions/vscode-api-tests/src/singlefolder-tests/module.test.ts:42`
- Categoría: Código inseguro
- Detalle: const asyncImport = new Function('url', 'return import(url)');
- Solución: Evita ejecutar texto como código; usa JSON.parse o una tabla de funciones.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/vscode-test-resolver/src/download.ts:9`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/vscode-test-resolver/src/extension.ts:7`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/extensions/vscode-test-resolver/src/util/processes.ts:5`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] CORS abierto a cualquier origen
- Ubicación: `vendor/vscode-main/scripts/chat-simulation/common/mock-llm-server.ts:665`
- Categoría: Código inseguro
- Detalle: res.setHeader('Access-Control-Allow-Origin', '*');
- Solución: Limita los orígenes permitidos a tus dominios.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/scripts/chat-simulation/common/utils.js:20`
- Categoría: Código inseguro
- Detalle: const { execSync, execFileSync, spawn } = require('child_process');
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/scripts/chat-simulation/common/utils.js:134`
- Categoría: Código inseguro
- Detalle: const { spawnSync } = require('child_process');
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/scripts/chat-simulation/common/utils.js:317`
- Categoría: Código inseguro
- Detalle: require('child_process').execSync(`sleep 0.5`);
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/scripts/chat-simulation/common/utils.js:572`
- Categoría: Código inseguro
- Detalle: try { execSync(`pkill -9 -P ${pid}`, { stdio: 'ignore' }); }
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/scripts/chat-simulation/common/utils.js:585`
- Categoría: Código inseguro
- Detalle: try { execSync('pkill -9 -f crashpad_handler.*vscode-chat-simulation', { stdio: 'ignore' }); }
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/scripts/chat-simulation/test-chat-perf-regression.js:205`
- Categoría: Código inseguro
- Detalle: const { execSync } = require('child_process');
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/scripts/chat-simulation/test-chat-perf-regression.js:207`
- Categoría: Código inseguro
- Detalle: execSync('pnpm run gulp vscode', {
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/scripts/code-agent-host.js:8`
- Categoría: Código inseguro
- Detalle: const cp = require('child_process');
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/scripts/code-oss-launcher/launch.ts:10`
- Categoría: Código inseguro
- Detalle: import { spawn } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/scripts/code-oss-launcher/lib/runDirs.ts:10`
- Categoría: Código inseguro
- Detalle: import { spawnSync } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/scripts/code-oss-launcher/managed.test.ts:7`
- Categoría: Código inseguro
- Detalle: import { spawn, type ChildProcess } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/scripts/code-oss-launcher/waitForCdp.test.ts:7`
- Categoría: Código inseguro
- Detalle: import { spawn } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/scripts/code-server.js:8`
- Categoría: Código inseguro
- Detalle: const cp = require('child_process');
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] CORS abierto a cualquier origen
- Ubicación: `vendor/vscode-main/scripts/code-sessions-web.js:69`
- Categoría: Código inseguro
- Detalle: 'Access-Control-Allow-Origin': '*',
- Solución: Limita los orígenes permitidos a tus dominios.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/scripts/code-web.js:12`
- Categoría: Código inseguro
- Detalle: const cp = require('child_process');
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] CORS abierto a cualquier origen
- Ubicación: `vendor/vscode-main/scripts/mock-policy-server/server.ts:174`
- Categoría: Código inseguro
- Detalle: res.setHeader('Access-Control-Allow-Origin', '*');
- Solución: Limita los orígenes permitidos a tus dominios.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/scripts/sync-agent-host-protocol.ts:30`
- Categoría: Código inseguro
- Detalle: import { execFileSync } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/scripts/xterm-update.js:6`
- Categoría: Código inseguro
- Detalle: const cp = require('child_process');
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] SQL armado con texto (posible inyección SQL)
- Ubicación: `vendor/vscode-main/scripts/xterm-update.js:33`
- Categoría: Código inseguro
- Detalle: cp.exec(`pnpm view ${moduleName} versions --json`, { cwd: vscodeDir }, (err, stdout, stderr) => {
- Solución: Usa consultas parametrizadas (?, $1, :nombre) en lugar de concatenar valores.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/scripts/xterm-update.js:33`
- Categoría: Código inseguro
- Detalle: cp.exec(`pnpm view ${moduleName} versions --json`, { cwd: vscodeDir }, (err, stdout, stderr) => {
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/scripts/xterm-update.js:104`
- Categoría: Código inseguro
- Detalle: cp.execSync(`pnpm add${workspaceRoot} ${modulesWithVersion.map(toCaretRange).join(' ')}`, { cwd });
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/base/browser/dompurify/dompurify.js:1845`
- Categoría: Código inseguro
- Detalle: doc.documentElement.innerHTML = IS_EMPTY_INPUT ? emptyHTML : dirtyPayload;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [BAJO] URL sin cifrar (http://)
- Ubicación: `vendor/vscode-main/src/vs/base/common/marked/marked.js:923`
- Categoría: Código inseguro
- Detalle: href = 'http://' + cap[0];
- Solución: Usa https:// para no enviar datos en texto plano.

### [BAJO] URL sin cifrar (http://)
- Ubicación: `vendor/vscode-main/src/vs/base/common/oauth.ts:865`
- Categoría: Código inseguro
- Detalle: if (!metadata[uri].startsWith('https://') && !metadata[uri].startsWith('http://')) {
- Solución: Usa https:// para no enviar datos en texto plano.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/base/node/processes.ts:6`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/base/node/ps.ts:6`
- Categoría: Código inseguro
- Detalle: import { exec } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] SQL armado con texto (posible inyección SQL)
- Ubicación: `vendor/vscode-main/src/vs/base/node/ps.ts:223`
- Categoría: Código inseguro
- Detalle: exec(`${ps} ${args}`, { maxBuffer: 1000 * 1024, env: { LC_NUMERIC: 'en_US.UTF-8' } }, (err, stdout, stderr) => {
- Solución: Usa consultas parametrizadas (?, $1, :nombre) en lugar de concatenar valores.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/base/node/ps.ts:223`
- Categoría: Código inseguro
- Detalle: exec(`${ps} ${args}`, { maxBuffer: 1000 * 1024, env: { LC_NUMERIC: 'en_US.UTF-8' } }, (err, stdout, stderr) => {
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/base/node/terminalEncoding.ts:9`
- Categoría: Código inseguro
- Detalle: import { exec } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/base/parts/ipc/node/ipc.cp.ts:6`
- Categoría: Código inseguro
- Detalle: import { ChildProcess, fork, ForkOptions } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `vendor/vscode-main/src/vs/base/parts/ipc/node/ipc.net.ts:40`
- Categoría: Código inseguro
- Detalle: const hash = createHash('sha1');// CodeQL [SM04514] SHA1 must be used here to respect the WebSocket protocol specification
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/base/test/common/envfile.test.ts:122`
- Categoría: Secreto
- Detalle: valor: PAS… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/base/test/common/oauth.test.ts:183`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/base/test/common/oauth.test.ts:191`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/code/node/cli.ts:6`
- Categoría: Código inseguro
- Detalle: import { ChildProcess, spawn, SpawnOptions, StdioOptions } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/editor/browser/controller/editContext/native/screenReaderContentRich.ts:218`
- Categoría: Código inseguro
- Detalle: domNode.innerHTML = trustedhtml as string;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/editor/browser/view/domLineBreaksComputer.ts:150`
- Categoría: Código inseguro
- Detalle: containerDomNode.innerHTML = trustedhtml as string;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/editor/browser/view/viewLayer.ts:521`
- Categoría: Código inseguro
- Detalle: this._domNode.innerHTML = newLinesHTML as string; // explains the ugly casts -> https://github.com/microsoft/vscode/issues/106396#issuecomme
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/editor/browser/view/viewLayer.ts:542`
- Categoría: Código inseguro
- Detalle: hugeDomNode.innerHTML = invalidLinesHTML as string;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/editor/browser/widget/diffEditor/components/diffEditorViewZones/renderLines.ts:82`
- Categoría: Código inseguro
- Detalle: domNode.innerHTML = trustedhtml as string;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/editor/browser/widget/markdownRenderer/browser/editorMarkdownCodeBlockRenderer.ts:55`
- Categoría: Código inseguro
- Detalle: root.innerHTML = content as string;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/editor/contrib/inlineCompletions/browser/view/ghostText/ghostTextView.ts:699`
- Categoría: Código inseguro
- Detalle: domNode.innerHTML = trustedhtml as string;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/editor/contrib/stickyScroll/browser/stickyScrollWidget.ts:495`
- Categoría: Código inseguro
- Detalle: lineHTMLNode.innerHTML = newLine as string;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/editor/standalone/browser/colorizer.ts:47`
- Categoría: Código inseguro
- Detalle: domNode.innerHTML = trustedhtml as string;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/browser/agentHostProtocolClient.ts:2710`
- Categoría: Secreto
- Detalle: valor: aut… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/common/sshRemoteAgentHost.ts:40`
- Categoría: Secreto
- Detalle: valor: Pas… (21 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/agentHostCheckpointService.ts:368`
- Categoría: Código inseguro
- Detalle: : buildChatCheckpointRefName(createHash('sha1').update(chatUri.toString()).digest('hex').slice(0, 16), turnNumber);
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/agentHostGitService.ts:6`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/agentHostWorkspaceFiles.ts:6`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/codex/codexAgent.ts:7`
- Categoría: Código inseguro
- Detalle: import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/codex/codexSavedHistoryStore.ts:7`
- Categoría: Código inseguro
- Detalle: import { execFile } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/codex/codexSavedThreadReader.ts:6`
- Categoría: Código inseguro
- Detalle: import { spawn } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/codex/codexTurnDiff.ts:52`
- Categoría: Código inseguro
- Detalle: return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes.buffer).digest('hex');
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/copilot/copilotPluginConverters.ts:6`
- Categoría: Código inseguro
- Detalle: import { spawn } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [BAJO] URL sin cifrar (http://)
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/copilot/localModelBridge/shim/constants.ts:228`
- Categoría: Código inseguro
- Detalle: export const SENTINEL_ORIGIN = 'http://on-device.vscode.invalid';
- Solución: Usa https:// para no enviar datos en texto plano.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/copilot/localModelBridge/shim/processRunner.ts:6`
- Categoría: Código inseguro
- Detalle: import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/devContainerAgentHostService.ts:7`
- Categoría: Código inseguro
- Detalle: import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] SQL armado con texto (posible inyección SQL)
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/devContainerAgentHostService.ts:866`
- Categoría: Código inseguro
- Detalle: await exec(`git config --global --add safe.directory ${shellEscape(rootFolder)}`);
- Solución: Usa consultas parametrizadas (?, $1, :nombre) en lugar de concatenar valores.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/devContainerAgentHostService.ts:866`
- Categoría: Código inseguro
- Detalle: await exec(`git config --global --add safe.directory ${shellEscape(rootFolder)}`);
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] SQL armado con texto (posible inyección SQL)
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/devContainerAgentHostService.ts:889`
- Categoría: Código inseguro
- Detalle: const configured = await exec(`git config --get ${key}`, { ignoreExitCode: true });
- Solución: Usa consultas parametrizadas (?, $1, :nombre) en lugar de concatenar valores.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/devContainerAgentHostService.ts:889`
- Categoría: Código inseguro
- Detalle: const configured = await exec(`git config --get ${key}`, { ignoreExitCode: true });
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] SQL armado con texto (posible inyección SQL)
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/devContainerAgentHostService.ts:893`
- Categoría: Código inseguro
- Detalle: await exec(`git config --global --replace-all ${key} ${shellEscape(value)}`);
- Solución: Usa consultas parametrizadas (?, $1, :nombre) en lugar de concatenar valores.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/devContainerAgentHostService.ts:893`
- Categoría: Código inseguro
- Detalle: await exec(`git config --global --replace-all ${key} ${shellEscape(value)}`);
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/devContainerSamples.ts:51`
- Categoría: Código inseguro
- Detalle: const legacyName = `${folder}-${createHash('md5').update(url).digest('hex')}`;
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/devContainerShell.ts:6`
- Categoría: Código inseguro
- Detalle: import type { ChildProcessWithoutNullStreams } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/localAgentHostMetadata.ts:6`
- Categoría: Código inseguro
- Detalle: import { execFile } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/missionControl/missionControlAuthentication.ts:344`
- Categoría: Secreto
- Detalle: valor: aut… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/missionControl/missionControlProjects.ts:6`
- Categoría: Código inseguro
- Detalle: import { execFile } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] SQL armado con texto (posible inyección SQL)
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/remoteAgentHostCliInstaller.ts:60`
- Categoría: Código inseguro
- Detalle: const { code: existsCode } = await exec(`test -x ${cliBin}`, { ignoreExitCode: true });
- Solución: Usa consultas parametrizadas (?, $1, :nombre) en lugar de concatenar valores.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/remoteAgentHostCliInstaller.ts:60`
- Categoría: Código inseguro
- Detalle: const { code: existsCode } = await exec(`test -x ${cliBin}`, { ignoreExitCode: true });
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] SQL armado con texto (posible inyección SQL)
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/remoteAgentHostCliInstaller.ts:63`
- Categoría: Código inseguro
- Detalle: const { code: touchCode } = await exec(`touch -- ${cliBin}`, { ignoreExitCode: true });
- Solución: Usa consultas parametrizadas (?, $1, :nombre) en lugar de concatenar valores.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/remoteAgentHostCliInstaller.ts:63`
- Categoría: Código inseguro
- Detalle: const { code: touchCode } = await exec(`touch -- ${cliBin}`, { ignoreExitCode: true });
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] SQL armado con texto (posible inyección SQL)
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/remoteAgentHostCliInstaller.ts:104`
- Categoría: Código inseguro
- Detalle: const { code: versionCode } = await exec(`${cliBin} --version`, { ignoreExitCode: true });
- Solución: Usa consultas parametrizadas (?, $1, :nombre) en lugar de concatenar valores.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/remoteAgentHostCliInstaller.ts:104`
- Categoría: Código inseguro
- Detalle: const { code: versionCode } = await exec(`${cliBin} --version`, { ignoreExitCode: true });
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] SQL armado con texto (posible inyección SQL)
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/remoteAgentHostCliInstaller.ts:137`
- Categoría: Código inseguro
- Detalle: const { code, stdout } = await exec(`${cliBin} --version && (${cliBin} update; update_code=$?; echo ${updateExitCodeMarker}$update_code; tru
- Solución: Usa consultas parametrizadas (?, $1, :nombre) en lugar de concatenar valores.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/remoteAgentHostCliInstaller.ts:137`
- Categoría: Código inseguro
- Detalle: const { code, stdout } = await exec(`${cliBin} --version && (${cliBin} update; update_code=$?; echo ${updateExitCodeMarker}$update_code; tru
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] SQL armado con texto (posible inyección SQL)
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/remoteAgentHostCliInstaller.ts:168`
- Categoría: Código inseguro
- Detalle: const { code } = await exec(`${candidate} --version`, { ignoreExitCode: true });
- Solución: Usa consultas parametrizadas (?, $1, :nombre) en lugar de concatenar valores.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/remoteAgentHostCliInstaller.ts:168`
- Categoría: Código inseguro
- Detalle: const { code } = await exec(`${candidate} --version`, { ignoreExitCode: true });
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/shared/agentEditAttributionService.ts:6`
- Categoría: Código inseguro
- Detalle: import { execFile } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/sshProxyCommand.ts:6`
- Categoría: Código inseguro
- Detalle: import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/sshProxyJump.ts:6`
- Categoría: Código inseguro
- Detalle: import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] SQL armado con texto (posible inyección SQL)
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/sshRemoteAgentHostHelpers.ts:477`
- Categoría: Código inseguro
- Detalle: const { code } = await exec(`kill -0 ${pid} 2>/dev/null`, { ignoreExitCode: true });
- Solución: Usa consultas parametrizadas (?, $1, :nombre) en lugar de concatenar valores.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/sshRemoteAgentHostHelpers.ts:477`
- Categoría: Código inseguro
- Detalle: const { code } = await exec(`kill -0 ${pid} 2>/dev/null`, { ignoreExitCode: true });
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [CRÍTICO] Llave privada
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/sshRemoteAgentHostService.ts:329`
- Categoría: Secreto
- Detalle: valor: ---… (37 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Llave privada
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/sshRemoteAgentHostService.ts:332`
- Categoría: Secreto
- Detalle: valor: ---… (35 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/sshRemoteAgentHostService.ts:10`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/wslRemoteAgentHostHelpers.ts:6`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/node/wslRemoteAgentHostService.ts:7`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/common/ahpJsonlLogger.test.ts:663`
- Categoría: Secreto
- Detalle: valor: pas… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/common/cloudSandboxAgentHost.test.ts:25`
- Categoría: Secreto
- Detalle: valor: acc… (33 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/electron-browser/agentHostProtocolClient.test.ts:6382`
- Categoría: Secreto
- Detalle: valor: aut… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/agentHostRequestService.test.ts:1010`
- Categoría: Secreto
- Detalle: valor: pas… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/agentHostRequestService.test.ts:1033`
- Categoría: Secreto
- Detalle: valor: pas… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/claudeProxyAuth.test.ts:75`
- Categoría: Secreto
- Detalle: valor: api… (31 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/copilotAccountService.test.ts:226`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/copilotAccountService.test.ts:246`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/copilotCustomizationInstallations.test.ts:2549`
- Categoría: Secreto
- Detalle: valor: sec… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/copilotEntraAuthentication.test.ts:142`
- Categoría: Secreto
- Detalle: valor: acc… (44 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/copilotEntraAuthentication.test.ts:163`
- Categoría: Secreto
- Detalle: valor: acc… (44 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/copilotEntraAuthentication.test.ts:220`
- Categoría: Secreto
- Detalle: valor: acc… (33 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/copilotEntraAuthentication.test.ts:263`
- Categoría: Secreto
- Detalle: valor: acc… (32 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/copilotEntraAuthentication.test.ts:265`
- Categoría: Secreto
- Detalle: valor: acc… (33 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/copilotEntraAuthentication.test.ts:335`
- Categoría: Secreto
- Detalle: valor: acc… (33 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/copilotEntraAuthentication.test.ts:408`
- Categoría: Secreto
- Detalle: valor: acc… (33 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/copilotGitHubCredentials.test.ts:40`
- Categoría: Secreto
- Detalle: valor: acc… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/copilotGitHubCredentials.test.ts:41`
- Categoría: Secreto
- Detalle: valor: acc… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/copilotGitHubCredentials.test.ts:43`
- Categoría: Secreto
- Detalle: valor: acc… (40 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/localModelBridge/copilotRequestHandler.test.ts:862`
- Categoría: Secreto
- Detalle: valor: api… (23 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/localModelBridge/fakeServingAccess.ts:85`
- Categoría: Secreto
- Detalle: valor: api… (23 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlAuthentication.test.ts:140`
- Categoría: Secreto
- Detalle: valor: aut… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:187`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:290`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:313`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:322`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:337`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:356`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:374`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:390`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:409`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:802`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:837`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:912`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:975`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:999`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:1021`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:1054`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:2219`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:2257`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:2303`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:2374`
- Categoría: Secreto
- Detalle: valor: acc… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:2433`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:2465`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:2512`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:2545`
- Categoría: Secreto
- Detalle: valor: acc… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:2685`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:3089`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:3590`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:3867`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/missionControlProtocolServer.test.ts:3911`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/protocolServerHandler.test.ts:3549`
- Categoría: Secreto
- Detalle: valor: acc… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/protocolServerHandler.test.ts:4717`
- Categoría: Secreto
- Detalle: valor: sec… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/protocolServerHandler.test.ts:4754`
- Categoría: Secreto
- Detalle: valor: sec… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/protocolServerHandler.test.ts:4765`
- Categoría: Secreto
- Detalle: valor: sec… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/protocolServerHandler.test.ts:4820`
- Categoría: Secreto
- Detalle: valor: sec… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/protocolServerHandler.test.ts:6396`
- Categoría: Secreto
- Detalle: valor: SEC… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/protocolServerHandler.test.ts:6407`
- Categoría: Secreto
- Detalle: valor: SEC… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/sshRemoteAgentHostService.test.ts:1176`
- Categoría: Secreto
- Detalle: valor: pas… (21 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Llave privada
- Ubicación: `vendor/vscode-main/src/vs/platform/agentHost/test/node/sshRemoteAgentHostService.test.ts:2230`
- Categoría: Secreto
- Detalle: valor: ---… (35 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `vendor/vscode-main/src/vs/platform/backup/electron-main/backupMainService.ts:414`
- Categoría: Código inseguro
- Detalle: return createHash('md5').update(key).digest('hex'); // CodeQL [SM04514] Using MD5 to convert a file path to a fixed length
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] Math.random para valores secretos
- Ubicación: `vendor/vscode-main/src/vs/platform/browserView/electron-browser/preload-browserView.ts:261`
- Categoría: Código inseguro
- Detalle: const frameToken = `frame-${Date.now()}-${Math.random().toString(36).slice(2)}`;
- Solución: Usa crypto.randomUUID() o crypto.getRandomValues().

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/cssDev/node/cssDevService.ts:6`
- Categoría: Código inseguro
- Detalle: import { spawn } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/extensionManagement/node/extensionLifecycle.ts:6`
- Categoría: Código inseguro
- Detalle: import { ChildProcess, fork } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/externalTerminal/node/externalTerminalService.ts:6`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/git/node/localGitService.ts:6`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/github/test/common/githubChannel.test.ts:2317`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/github/test/common/githubChannel.test.ts:2501`
- Categoría: Secreto
- Detalle: valor: sec… (22 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/github/test/common/githubChannel.test.ts:2627`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/github/test/node/missionControlClient.test.ts:75`
- Categoría: Secreto
- Detalle: valor: acc… (33 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/github/test/node/missionControlClient.test.ts:905`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/github/test/node/missionControlClient.test.ts:940`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/github/test/node/missionControlClient.test.ts:958`
- Categoría: Secreto
- Detalle: valor: sec… (40 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/github/test/node/pullRequestMutationService.test.ts:797`
- Categoría: Secreto
- Detalle: valor: sec… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `vendor/vscode-main/src/vs/platform/languagePacks/node/languagePacks.ts:173`
- Categoría: Código inseguro
- Detalle: const md5 = createHash('md5'); // CodeQL [SM04514] Used to create an hash for language pack extension version, which is not a security issue
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [ALTO] Verificación TLS desactivada
- Ubicación: `vendor/vscode-main/src/vs/platform/localTranscription/node/localTranscriptionService.ts:391`
- Categoría: Código inseguro
- Detalle: process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
- Solución: Activa la verificación de certificados; si es un certificado propio, agrégalo como CA de confianza.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/mcp/test/common/envVarResolution.test.ts:94`
- Categoría: Secreto
- Detalle: valor: ACC… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/mcp/test/common/envVarResolution.test.ts:98`
- Categoría: Secreto
- Detalle: valor: ACC… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/mcp/test/common/envVarResolution.test.ts:115`
- Categoría: Secreto
- Detalle: valor: ACC… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/mcp/test/common/envVarResolution.test.ts:162`
- Categoría: Secreto
- Detalle: valor: ACC… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/mcp/test/common/envVarResolution.test.ts:166`
- Categoría: Secreto
- Detalle: valor: ACC… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/native/electron-main/macScreenWindows.ts:6`
- Categoría: Código inseguro
- Detalle: import { execFile } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/native/electron-main/nativeHostMainService.ts:7`
- Categoría: Código inseguro
- Detalle: import { exec } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/remote/node/wsl.ts:7`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/remoteTunnel/node/codeTunnelCliProcess.ts:10`
- Categoría: Código inseguro
- Detalle: import { ChildProcess, spawn, SpawnOptions, StdioOptions } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/remoteTunnel/node/codeTunnelCliProcess.ts:49`
- Categoría: Código inseguro
- Detalle: /** Injectable for tests; defaults to the real `child_process.spawn`. */
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/request/test/electron-main/requestService.test.ts:201`
- Categoría: Secreto
- Detalle: valor: pas… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/request/test/electron-main/requestService.test.ts:203`
- Categoría: Secreto
- Detalle: valor: pas… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/request/test/electron-main/requestService.test.ts:214`
- Categoría: Secreto
- Detalle: valor: pas… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/request/test/node/requestService.test.ts:362`
- Categoría: Secreto
- Detalle: valor: pas… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/sandbox/node/sandboxHelper.ts:6`
- Categoría: Código inseguro
- Detalle: import { execFile } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/shell/node/shellEnv.ts:6`
- Categoría: Código inseguro
- Detalle: import { spawn } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/terminal/node/ptyService.ts:6`
- Categoría: Código inseguro
- Detalle: import { execFile, exec } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/terminal/node/terminalProcess.ts:7`
- Categoría: Código inseguro
- Detalle: import { exec } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] SQL armado con texto (posible inyección SQL)
- Ubicación: `vendor/vscode-main/src/vs/platform/terminal/node/terminalProcess.ts:650`
- Categoría: Código inseguro
- Detalle: exec('lsof -OPln -p ' + this._ptyProcess.pid + ' | grep cwd', { env: { ...process.env, LANG: 'en_US.UTF-8' } }, (error, stdout, stderr) => {
- Solución: Usa consultas parametrizadas (?, $1, :nombre) en lugar de concatenar valores.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/terminal/node/terminalProfiles.ts:7`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/terminal/test/node/terminalEnvironment.test.ts:312`
- Categoría: Secreto
- Detalle: valor: API… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/terminal/test/node/terminalEnvironment.test.ts:318`
- Categoría: Secreto
- Detalle: valor: CLI… (36 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/platform/terminal/test/node/terminalEnvironment.test.ts:319`
- Categoría: Secreto
- Detalle: valor: AUT… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Clave de servicio de Supabase / JWT
- Ubicación: `vendor/vscode-main/src/vs/platform/terminal/test/node/terminalEnvironment.test.ts:336`
- Categoría: Secreto
- Detalle: valor: eyJ… (108 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Token de GitHub
- Ubicación: `vendor/vscode-main/src/vs/platform/terminal/test/node/terminalEnvironment.test.ts:344`
- Categoría: Secreto
- Detalle: valor: ghp… (40 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Llave de Google
- Ubicación: `vendor/vscode-main/src/vs/platform/terminal/test/node/terminalEnvironment.test.ts:352`
- Categoría: Secreto
- Detalle: valor: AIz… (39 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [CRÍTICO] Llave privada
- Ubicación: `vendor/vscode-main/src/vs/platform/tunnel/test/node/selfSignedCert.test.ts:23`
- Categoría: Secreto
- Detalle: valor: ---… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/update/electron-main/updateService.snap.ts:6`
- Categoría: Código inseguro
- Detalle: import { spawn } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/platform/update/electron-main/updateService.win32.ts:6`
- Categoría: Código inseguro
- Detalle: import { ChildProcess, spawn } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [BAJO] URL sin cifrar (http://)
- Ubicación: `vendor/vscode-main/src/vs/platform/url/common/urlApprovalPatterns.ts:109`
- Categoría: Código inseguro
- Detalle: } else if (displayPattern.startsWith('http://')) {
- Solución: Usa https:// para no enviar datos en texto plano.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `vendor/vscode-main/src/vs/platform/workspaces/node/workspaces.ts:32`
- Categoría: Código inseguro
- Detalle: return createHash('md5').update(configPathStr).digest('hex'); // CodeQL [SM04514] Using MD5 to convert a file path to a fixed length
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `vendor/vscode-main/src/vs/platform/workspaces/node/workspaces.ts:53`
- Categoría: Código inseguro
- Detalle: return createHash('md5').update(folderUri.toString()).digest('hex'); // CodeQL [SM04514] Using MD5 to convert a file path to a fixed length
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] Hash débil (MD5/SHA-1)
- Ubicación: `vendor/vscode-main/src/vs/platform/workspaces/node/workspaces.ts:80`
- Categoría: Código inseguro
- Detalle: return createHash('md5').update(folderUri.fsPath).update(ctime ? String(ctime) : '').digest('hex'); // CodeQL [SM04514] Using MD5 to convert
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/server/node/extensionHostConnection.ts:6`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/server/node/server.cli.ts:8`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/server/node/server.cli.ts:385`
- Categoría: Código inseguro
- Detalle: return cp.execSync('uname -r', { encoding: 'utf8' }).includes('-microsoft-');
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/sessions/browser/parts/mobile/contributions/mobileDiffView.ts:490`
- Categoría: Código inseguro
- Detalle: content.innerHTML = html;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/sessions/browser/parts/mobile/contributions/mobileMultiDiffView.ts:932`
- Categoría: Código inseguro
- Detalle: template.innerHTML = htmlParts.join('');
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/sessions/contrib/chat/test/browser/newChatWidget.test.ts:3038`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/sessions/contrib/chat/test/browser/newChatWidget.test.ts:3156`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/sessions/contrib/providers/remoteAgentHost/test/browser/connectionDiagnosticsService.test.ts:382`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/sessions/contrib/providers/remoteAgentHost/test/browser/remoteAgentHost.contribution.test.ts:96`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/sessions/contrib/providers/remoteAgentHost/test/browser/remoteAgentHost.contribution.test.ts:412`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/sessions/contrib/providers/remoteAgentHost/test/browser/remoteAgentHost.contribution.test.ts:462`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/sessions/contrib/providers/remoteAgentHost/test/browser/remoteAgentHost.contribution.test.ts:492`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/sessions/test/e2e/extensions/sessions-e2e-mock/extension.js:61`
- Categoría: Secreto
- Detalle: valor: acc… (59 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/browser/mainThreadLanguageModels.ts:368`
- Categoría: Secreto
- Detalle: valor: acc… (32 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Math.random para valores secretos
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/common/extHostTypeConverters.ts:443`
- Categoría: Código inseguro
- Detalle: const key = `__uri_${Math.random().toString(16).slice(2, 8)}`;
- Solución: Usa crypto.randomUUID() o crypto.getRandomValues().

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/node/extHostMcpNode.ts:6`
- Categoría: Código inseguro
- Detalle: import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/node/extHostTunnelService.ts:7`
- Categoría: Código inseguro
- Detalle: import { exec } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/test/browser/extHostAuthentication.integrationTest.ts:946`
- Categoría: Secreto
- Detalle: valor: acc… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/test/browser/extHostAuthentication.integrationTest.ts:989`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/test/browser/extHostAuthentication.integrationTest.ts:1507`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/test/browser/extHostXaaAuthProvider.test.ts:87`
- Categoría: Secreto
- Detalle: valor: acc… (37 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/test/browser/mainThreadAuthentication.integrationTest.ts:113`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/test/browser/mainThreadAuthentication.test.ts:81`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/test/browser/mainThreadAuthentication.test.ts:174`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/test/browser/mainThreadGitHub.test.ts:191`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/test/browser/mainThreadMcp.test.ts:368`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/test/common/extHostMcp.test.ts:330`
- Categoría: Secreto
- Detalle: valor: API… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/test/common/extHostMcp.test.ts:342`
- Categoría: Secreto
- Detalle: valor: Api… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/test/common/extHostMcp.test.ts:359`
- Categoría: Secreto
- Detalle: valor: Api… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/test/common/extHostMcp.test.ts:426`
- Categoría: Secreto
- Detalle: valor: Api… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/test/common/extHostMcp.test.ts:542`
- Categoría: Secreto
- Detalle: valor: Api… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/test/common/extHostMcp.test.ts:543`
- Categoría: Secreto
- Detalle: valor: Api… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/test/common/extHostMcp.test.ts:553`
- Categoría: Secreto
- Detalle: valor: Api… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/test/common/extHostMcp.test.ts:561`
- Categoría: Secreto
- Detalle: valor: Api… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/test/common/extHostMcp.test.ts:575`
- Categoría: Secreto
- Detalle: valor: Api… (20 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] eval / new Function
- Ubicación: `vendor/vscode-main/src/vs/workbench/api/worker/extHostExtensionService.ts:87`
- Categoría: Código inseguro
- Detalle: initFn = new Function('module', 'exports', 'require', fullSource); // CodeQL [SM01632] js/eval-call there is no alternative until we move to
- Solución: Evita ejecutar texto como código; usa JSON.parse o una tabla de funciones.

### [BAJO] URL sin cifrar (http://)
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/browserView/common/browserView.ts:100`
- Categoría: Código inseguro
- Detalle: url = 'http://' + url;
- Solución: Usa https:// para no enviar datos en texto plano.

### [BAJO] URL sin cifrar (http://)
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/browserView/common/browserView.ts:103`
- Categoría: Código inseguro
- Detalle: url = 'http://' + url;
- Solución: Usa https:// para no enviar datos en texto plano.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/browser/chatDebug/chatDebugToolCallContentRenderer.ts:96`
- Categoría: Código inseguro
- Detalle: contentEl.innerHTML = trustedHtml as string;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [BAJO] URL sin cifrar (http://)
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/browser/voiceClient/voiceClientService.ts:1920`
- Categoría: Código inseguro
- Detalle: .replace('ws://', 'http://')
- Solución: Usa https:// para no enviar datos en texto plano.

### [MEDIO] Math.random para valores secretos
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/browser/widget/chatContentParts/chatProgressContentPart.ts:393`
- Categoría: Código inseguro
- Detalle: return candidates[Math.floor(Math.random() * candidates.length)];
- Solución: Usa crypto.randomUUID() o crypto.getRandomValues().

### [BAJO] URL sin cifrar (http://)
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/common/connectorRecommendations.ts:52`
- Categoría: Código inseguro
- Detalle: const httpIndex = lowercaseToken.indexOf('http://');
- Solución: Usa https:// para no enviar datos en texto plano.

### [BAJO] URL sin cifrar (http://)
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/common/widget/annotations.ts:13`
- Categoría: Código inseguro
- Detalle: export const contentRefUrl = 'http://_vscodecontentref_'; // must be lowercase for URI
- Solución: Usa https:// para no enviar datos en texto plano.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHost/agentHostCustomizationMarketplaceInstallProvider.test.ts:1613`
- Categoría: Secreto
- Detalle: valor: sec… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:167`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:186`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:187`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:204`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:222`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:601`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:602`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:640`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:641`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:683`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:684`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:724`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:730`
- Categoría: Secreto
- Detalle: valor: acc… (34 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:810`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:811`
- Categoría: Secreto
- Detalle: valor: acc… (36 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:951`
- Categoría: Secreto
- Detalle: valor: acc… (33 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:1059`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:1113`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:1334`
- Categoría: Secreto
- Detalle: valor: cli… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:1646`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:1663`
- Categoría: Secreto
- Detalle: valor: cli… (36 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:1693`
- Categoría: Secreto
- Detalle: valor: cli… (36 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:1825`
- Categoría: Secreto
- Detalle: valor: sec… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:1938`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2021`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2029`
- Categoría: Secreto
- Detalle: valor: acc… (33 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2077`
- Categoría: Secreto
- Detalle: valor: cli… (42 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2078`
- Categoría: Secreto
- Detalle: valor: cli… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2128`
- Categoría: Secreto
- Detalle: valor: cli… (42 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2135`
- Categoría: Secreto
- Detalle: valor: cli… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2141`
- Categoría: Secreto
- Detalle: valor: cli… (42 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2142`
- Categoría: Secreto
- Detalle: valor: cli… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2145`
- Categoría: Secreto
- Detalle: valor: cli… (42 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2146`
- Categoría: Secreto
- Detalle: valor: cli… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2225`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2235`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2276`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2279`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2317`
- Categoría: Secreto
- Detalle: valor: acc… (32 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2350`
- Categoría: Secreto
- Detalle: valor: acc… (39 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2364`
- Categoría: Secreto
- Detalle: valor: acc… (32 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2394`
- Categoría: Secreto
- Detalle: valor: acc… (32 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2411`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2431`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2432`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2433`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2434`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2464`
- Categoría: Secreto
- Detalle: valor: acc… (32 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2465`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2492`
- Categoría: Secreto
- Detalle: valor: acc… (31 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2500`
- Categoría: Secreto
- Detalle: valor: acc… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2501`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2502`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2601`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2642`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2644`
- Categoría: Secreto
- Detalle: valor: acc… (31 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2647`
- Categoría: Secreto
- Detalle: valor: acc… (34 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2655`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2656`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2690`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2691`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2692`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2693`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2716`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2717`
- Categoría: Secreto
- Detalle: valor: acc… (37 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2718`
- Categoría: Secreto
- Detalle: valor: acc… (35 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2719`
- Categoría: Secreto
- Detalle: valor: acc… (38 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2766`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2767`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2768`
- Categoría: Secreto
- Detalle: valor: acc… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2769`
- Categoría: Secreto
- Detalle: valor: acc… (37 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2770`
- Categoría: Secreto
- Detalle: valor: acc… (41 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2809`
- Categoría: Secreto
- Detalle: valor: acc… (34 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2810`
- Categoría: Secreto
- Detalle: valor: acc… (31 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2811`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2812`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2833`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2835`
- Categoría: Secreto
- Detalle: valor: acc… (31 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2866`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2868`
- Categoría: Secreto
- Detalle: valor: acc… (31 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2906`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2937`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2938`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2940`
- Categoría: Secreto
- Detalle: valor: acc… (32 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2982`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:2983`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:3017`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:3018`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:3058`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:3119`
- Categoría: Secreto
- Detalle: valor: acc… (35 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:3171`
- Categoría: Secreto
- Detalle: valor: acc… (38 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:3220`
- Categoría: Secreto
- Detalle: valor: acc… (35 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:3267`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:3287`
- Categoría: Secreto
- Detalle: valor: acc… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:3289`
- Categoría: Secreto
- Detalle: valor: acc… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:3343`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:3350`
- Categoría: Secreto
- Detalle: valor: acc… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:3378`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:3379`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:3414`
- Categoría: Secreto
- Detalle: valor: acc… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAuth.test.ts:3453`
- Categoría: Secreto
- Detalle: valor: acc… (31 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostAutoTierScope.test.ts:32`
- Categoría: Secreto
- Detalle: valor: acc… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostClientTools.test.ts:3084`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostCustomizationService.test.ts:1109`
- Categoría: Secreto
- Detalle: valor: acc… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/agentHostCustomizationService.test.ts:1235`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/copilotEntraAuthentication.test.ts:74`
- Categoría: Secreto
- Detalle: valor: acc… (39 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/copilotEntraAuthentication.test.ts:77`
- Categoría: Secreto
- Detalle: valor: acc… (36 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/copilotEntraAuthentication.test.ts:153`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/copilotEntraAuthentication.test.ts:430`
- Categoría: Secreto
- Detalle: valor: acc… (32 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/stateToProgressAdapter.test.ts:3199`
- Categoría: Secreto
- Detalle: valor: cli… (40 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/agentSessions/stateToProgressAdapter.test.ts:3230`
- Categoría: Secreto
- Detalle: valor: cli… (40 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/aiCustomization/copilotConnectorsService.test.ts:90`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/aiCustomization/copilotConnectorsService.test.ts:117`
- Categoría: Secreto
- Detalle: valor: acc… (31 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/aiCustomization/copilotConnectorsService.test.ts:775`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/aiCustomization/copilotConnectorsService.test.ts:776`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/aiCustomization/copilotConnectorsService.test.ts:790`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/aiCustomization/copilotConnectorsService.test.ts:791`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/aiCustomization/copilotConnectorsService.test.ts:807`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/aiCustomization/copilotConnectorsService.test.ts:808`
- Categoría: Secreto
- Detalle: valor: acc… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/aiCustomization/copilotConnectorsService.test.ts:809`
- Categoría: Secreto
- Detalle: valor: acc… (37 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/aiCustomization/copilotConnectorsService.test.ts:822`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/aiCustomization/copilotConnectorsService.test.ts:823`
- Categoría: Secreto
- Detalle: valor: acc… (35 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/aiCustomization/copilotConnectorsService.test.ts:834`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/aiCustomization/copilotConnectorsService.test.ts:854`
- Categoría: Secreto
- Detalle: valor: acc… (37 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/aiCustomization/copilotConnectorsService.test.ts:866`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/aiCustomization/copilotConnectorsService.test.ts:1021`
- Categoría: Secreto
- Detalle: valor: acc… (33 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/chatSetup/chatSetupCopilotAccount.test.ts:196`
- Categoría: Secreto
- Detalle: valor: acc… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxAgentHostService.test.ts:55`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxAgentHostService.test.ts:534`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxAgentHostService.test.ts:569`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxAgentHostService.test.ts:1151`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxAgentHostService.test.ts:1172`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:852`
- Categoría: Secreto
- Detalle: valor: acc… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:863`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:880`
- Categoría: Secreto
- Detalle: valor: acc… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:891`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:1149`
- Categoría: Secreto
- Detalle: valor: acc… (23 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:1537`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:1601`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:2200`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:2241`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:2488`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:2721`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:2885`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:3072`
- Categoría: Secreto
- Detalle: valor: acc… (34 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:4007`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:4008`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:4049`
- Categoría: Secreto
- Detalle: valor: acc… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:4055`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:4059`
- Categoría: Secreto
- Detalle: valor: acc… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:4079`
- Categoría: Secreto
- Detalle: valor: acc… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:4085`
- Categoría: Secreto
- Detalle: valor: acc… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:4897`
- Categoría: Secreto
- Detalle: valor: acc… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxApiService.test.ts:4912`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxCredentialRefresh.test.ts:302`
- Categoría: Secreto
- Detalle: valor: acc… (30 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxCredentialRefresh.test.ts:316`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxCredentialRefresh.test.ts:530`
- Categoría: Secreto
- Detalle: valor: acc… (35 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxCredentialRefresh.test.ts:704`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/cloudSandboxIdentityTokenProvider.test.ts:422`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/missionControlContribution.test.ts:61`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/missionControlContribution.test.ts:1236`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/missionControlContribution.test.ts:1237`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/missionControlContribution.test.ts:1403`
- Categoría: Secreto
- Detalle: valor: acc… (32 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/missionControlEnvironmentService.test.ts:813`
- Categoría: Secreto
- Detalle: valor: acc… (24 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/remoteAgentHostAuthenticationResolver.test.ts:35`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/remoteAgentHostAuthenticationResolver.test.ts:191`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/remoteAgentHost/remoteAgentHostChatContribution.test.ts:114`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/browser/widget/input/chatInputModeValidation.test.ts:380`
- Categoría: Secreto
- Detalle: valor: acc… (25 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/chat/test/electron-browser/pluginGitCommandService.test.ts:236`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/debug/node/debugAdapter.ts:6`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/debug/node/terminals.ts:6`
- Categoría: Código inseguro
- Detalle: import * as cp from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/issue/test/browser/baseIssueReporterService.test.ts:125`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/issue/test/browser/baseIssueReporterService.test.ts:130`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/issue/test/browser/baseIssueReporterService.test.ts:141`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/issue/test/browser/issueFormService.test.ts:858`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/issue/test/electron-browser/issueService.test.ts:107`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/issue/test/electron-browser/issueService.test.ts:108`
- Categoría: Secreto
- Detalle: valor: acc… (29 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [BAJO] URL sin cifrar (http://)
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/mcp/common/mcpConfiguration.ts:314`
- Categoría: Código inseguro
- Detalle: patternErrorMessage: localize('app.mcp.json.url.pattern', "The URL must start with 'http://' or 'https://'."),
- Solución: Usa https:// para no enviar datos en texto plano.

### [BAJO] URL sin cifrar (http://)
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/mcp/common/mcpServerConfigurationForm.ts:170`
- Categoría: Código inseguro
- Detalle: result.url = localize('mcpForm.url.invalid', "The URL must start with 'http://' or 'https://'.");
- Solución: Usa https:// para no enviar datos en texto plano.

### [MEDIO] Ejecución de comandos del sistema
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/mcp/node/mcpStdioStateHandler.ts:6`
- Categoría: Código inseguro
- Detalle: import { ChildProcessWithoutNullStreams } from 'child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/notebook/browser/diff/inlineDiff/notebookDeletedCellDecorator.ts:264`
- Categoría: Código inseguro
- Detalle: editorContainer.innerHTML = (ttPolicy?.createHTML(codeHtml) || codeHtml) as string;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/notebook/browser/view/cellParts/cellDragRenderer.ts:55`
- Categoría: Código inseguro
- Detalle: element.innerHTML = linesHtml as string;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/notebook/browser/view/cellParts/codeCell.ts:430`
- Categoría: Código inseguro
- Detalle: this._inputCollapseElement.innerHTML = (collapsedCellTTPolicy?.createHTML(content) ?? content) as string;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/notebook/browser/view/cellParts/codeCell.ts:568`
- Categoría: Código inseguro
- Detalle: element.innerHTML = (collapsedCellTTPolicy?.createHTML(richEditorText) ?? richEditorText) as string;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/notebook/browser/view/cellParts/markupCell.ts:270`
- Categoría: Código inseguro
- Detalle: element.innerHTML = (collapsedCellTTPolicy?.createHTML(richEditorText) ?? richEditorText) as string;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/notebook/browser/view/renderers/webviewPreloads.ts:2473`
- Categoría: Código inseguro
- Detalle: el.innerHTML = trustedHtml as string; // CodeQL [SM03712] The rendered content comes from VS Code's tokenizer and is considered safe
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/notebook/browser/view/renderers/webviewPreloads.ts:2990`
- Categoría: Código inseguro
- Detalle: this.element.innerHTML = trustedHtml as string;  // CodeQL [SM03712] The content comes from renderer extensions, not from direct user input.
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/remoteTunnel/test/electron-browser/remoteTunnel.contribution.test.ts:44`
- Categoría: Secreto
- Detalle: valor: acc… (27 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/sessions/providers/agentHost/test/browser/agentHostArtifactIntegrations.test.ts:666`
- Categoría: Secreto
- Detalle: valor: acc… (26 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] HTML sin sanitizar (posible XSS)
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/update/browser/releaseNotesEditor.ts:1300`
- Categoría: Código inseguro
- Detalle: code.innerHTML = block.html;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] CORS abierto a cualquier origen
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/webview/browser/pre/service-worker.js:472`
- Categoría: Código inseguro
- Detalle: 'Access-Control-Allow-Origin': '*',
- Solución: Limita los orígenes permitidos a tus dominios.

### [MEDIO] CORS abierto a cualquier origen
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/webview/browser/pre/service-worker.js:572`
- Categoría: Código inseguro
- Detalle: 'Access-Control-Allow-Origin': '*',
- Solución: Limita los orígenes permitidos a tus dominios.

### [BAJO] URL sin cifrar (http://)
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.ts:1493`
- Categoría: Código inseguro
- Detalle: if (!isCommand && (href.startsWith('https://') || href.startsWith('http://'))) {
- Solución: Usa https:// para no enviar datos en texto plano.

### [BAJO] URL sin cifrar (http://)
- Ubicación: `vendor/vscode-main/src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStartedService.ts:617`
- Categoría: Código inseguro
- Detalle: if (href.startsWith('https://') || href.startsWith('http://')) {
- Solución: Usa https:// para no enviar datos en texto plano.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/services/accounts/test/browser/defaultAccount.test.ts:1525`
- Categoría: Secreto
- Detalle: valor: acc… (32 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/services/accounts/test/browser/defaultAccount.test.ts:1587`
- Categoría: Secreto
- Detalle: valor: acc… (32 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [ALTO] Contraseña o secreto escrito en el código
- Ubicación: `vendor/vscode-main/src/vs/workbench/services/accounts/test/browser/defaultAccount.test.ts:1670`
- Categoría: Secreto
- Detalle: valor: acc… (28 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

## Dependencias

_Dependencias revisadas: 3720 en pnpm-lock.yaml, vendor/vscode-main/cli/Cargo.lock, vendor/vscode-main/copilot_shim/Cargo.lock, vendor/vscode-main/extensions/copilot/test/requirements.txt, vendor/vscode-main/pnpm-lock.yaml, vendor/vscode-main/remote/pnpm-lock.yaml_

### [MEDIO] @vitest/mocker@4.1.11 (npm)
- Ubicación: `pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-qxg6-89mg-rqv8: Vitest: Code injection via unauthenticated manual mock registration
    GHSA-xp26-3454-mjgp: Vitest: Windows backslash traversal bypasses the @vitest/mocker redirect allowlist fix
- Solución: Actualiza a 4.1.12 o superior.

### [MEDIO] fast-uri@3.1.8 (npm)
- Ubicación: `pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-w74x-v6f9-j3xg: fast-uri vulnerable to URI scheme spoofing via percent-encoded scheme decoding
    GHSA-wjr9-j795-jxcr: fast-uri vulnerable to host confusion via unchecked WHATWG host canonicalization
    GHSA-333x-w4r6-6crp: fast-uri vulnerable to scheme injection via an unescaped first-segment colon in suffix references
    GHSA-xhq7-xmqj-769h: fast-uri vulnerable to improper path equivalence in relative reference normalization
- Solución: Actualiza a 2.4.8 o superior.

### [MEDIO] minimatch@10.2.6 (npm)
- Ubicación: `pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-g3hv-75wg-m249: minimatch has potential denial of service via globparts amplification
- Solución: Actualiza a 11.0.1 o superior.

### [MEDIO] minimatch@9.0.9 (npm)
- Ubicación: `pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-g3hv-75wg-m249: minimatch has potential denial of service via globparts amplification
- Solución: Actualiza a 11.0.1 o superior.

### [MEDIO] anyhow@1.0.101 (crates.io)
- Ubicación: `vendor/vscode-main/cli/Cargo.lock`
- Categoría: Dependencia
- Detalle: RUSTSEC-2026-0190: Unsoundness in `Error::downcast_mut()`
- Solución: Actualiza a 1.0.103 o superior.

### [MEDIO] derivative@2.2.0 (crates.io)
- Ubicación: `vendor/vscode-main/cli/Cargo.lock`
- Categoría: Dependencia
- Detalle: RUSTSEC-2024-0388: `derivative` is unmaintained; consider using an alternative
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] event-listener@5.4.1 (crates.io)
- Ubicación: `vendor/vscode-main/cli/Cargo.lock`
- Categoría: Dependencia
- Detalle: RUSTSEC-2026-0221: `event-listener` allows `!Send` tags to cross thread boundaries via `StackSlot`
- Solución: Actualiza a 5.4.2 o superior.

### [MEDIO] h2@0.4.13 (crates.io)
- Ubicación: `vendor/vscode-main/cli/Cargo.lock`
- Categoría: Dependencia
- Detalle: RUSTSEC-2026-0258: h2 unbounded empty DATA frames
- Solución: Actualiza a 0.4.16 o superior.

### [MEDIO] instant@0.1.13 (crates.io)
- Ubicación: `vendor/vscode-main/cli/Cargo.lock`
- Categoría: Dependencia
- Detalle: RUSTSEC-2024-0384: `instant` is unmaintained
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] libz-sys@1.1.23 (crates.io)
- Ubicación: `vendor/vscode-main/cli/Cargo.lock`
- Categoría: Dependencia
- Detalle: RUSTSEC-2026-0418: libz-sys build script leaks environment variables in the build directory
- Solución: Actualiza a 1.1.31 o superior.

### [MEDIO] number_prefix@0.4.0 (crates.io)
- Ubicación: `vendor/vscode-main/cli/Cargo.lock`
- Categoría: Dependencia
- Detalle: RUSTSEC-2025-0119: number_prefix crate is unmaintained
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] pin-utils@0.1.0 (crates.io)
- Ubicación: `vendor/vscode-main/cli/Cargo.lock`
- Categoría: Dependencia
- Detalle: RUSTSEC-2026-0441: `pin-utils` is unmaintained
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] proc-macro-error2@2.0.1 (crates.io)
- Ubicación: `vendor/vscode-main/cli/Cargo.lock`
- Categoría: Dependencia
- Detalle: RUSTSEC-2026-0173: proc-macro-error2 is unmaintained
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] rand@0.7.3 (crates.io)
- Ubicación: `vendor/vscode-main/cli/Cargo.lock`
- Categoría: Dependencia
- Detalle: RUSTSEC-2026-0097: Rand is unsound with a custom logger using `rand::rng()`
    GHSA-cq8v-f236-94qc: Rand is unsound with a custom logger using rand::rng()
- Solución: Actualiza a 0.9.3 o superior.

### [ALTO] russh@0.37.1 (crates.io)
- Ubicación: `vendor/vscode-main/cli/Cargo.lock`
- Categoría: Dependencia
- Detalle: GHSA-47hw-gvq5-r2gm: russh: Client-side channel-scoped Handler callbacks fire for channel IDs the client never opened
    GHSA-4r3c-5hpg-58qr: Russh SSH message fields were decoded through allocation-first parsers before field-specific bounds
    GHSA-f5v4-2wr6-hqmg: russh has pre-auth DoS via unbounded allocation in its keyboard-interactive auth handler
    GHSA-g9f8-wqj9-fjw5: Russh: Unchecked CryptoVec allocation and growth handling is reachable
- Solución: Actualiza a 0.65.0 o superior.

### [ALTO] russh-cryptovec@0.7.0 (crates.io)
- Ubicación: `vendor/vscode-main/cli/Cargo.lock`
- Categoría: Dependencia
- Detalle: GHSA-g9f8-wqj9-fjw5: Russh: Unchecked CryptoVec allocation and growth handling is reachable
    RUSTSEC-2026-0153: Unchecked `CryptoVec` allocation and growth handling
- Solución: Actualiza a 0.60.3 o superior.

### [MEDIO] rustix@1.1.3 (crates.io)
- Ubicación: `vendor/vscode-main/cli/Cargo.lock`
- Categoría: Dependencia
- Detalle: RUSTSEC-2026-0486: xattr functions mark unwritten bytes as initialized when given a zero-length buffer
- Solución: Actualiza a 1.1.6 o superior.

### [MEDIO] tokio@1.52.1 (crates.io)
- Ubicación: `vendor/vscode-main/cli/Cargo.lock`
- Categoría: Dependencia
- Detalle: RUSTSEC-2026-0386: `AsyncFd::new` and related constructors violate I/O safety
- Solución: Actualiza a 1.51.6 o superior.

### [MEDIO] zbus_names@2.6.1 (crates.io)
- Ubicación: `vendor/vscode-main/cli/Cargo.lock`
- Categoría: Dependencia
- Detalle: RUSTSEC-2026-0371: `zbus_names` is unmaintained
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [CRÍTICO] zip@0.6.6 (crates.io)
- Ubicación: `vendor/vscode-main/cli/Cargo.lock`
- Categoría: Dependencia
- Detalle: GHSA-m665-v7pm-7grj: zip: Critical Parser Differential & Security Control Bypass via Dual-Header Inconsistencies (Zip Cloaking) Leading to Arbitrary File Overwrite & RCE
    GHSA-8hxf-qr8p-62x4: zip: AES Entry HMAC Authentication Bypass on Premature EOF
    RUSTSEC-2026-0367:  Insecure Preservation of SUID/SGID Bits during ZIP Extraction Leading to Potential Privilege Escalation
    RUSTSEC-2026-0368: zip: `ZipArchive::extract` creates symbolic links whose attacker-controlled targets are outside the destination directory
- Solución: Actualiza a 9.0.5 o superior.

### [MEDIO] zvariant@3.15.2 (crates.io)
- Ubicación: `vendor/vscode-main/cli/Cargo.lock`
- Categoría: Dependencia
- Detalle: RUSTSEC-2026-0370: `zvariant` is unmaintained
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] zvariant_derive@3.15.2 (crates.io)
- Ubicación: `vendor/vscode-main/cli/Cargo.lock`
- Categoría: Dependencia
- Detalle: RUSTSEC-2026-0372: `zvariant_derive` is unmaintained
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] rustix@1.1.5 (crates.io)
- Ubicación: `vendor/vscode-main/copilot_shim/Cargo.lock`
- Categoría: Dependencia
- Detalle: RUSTSEC-2026-0486: xattr functions mark unwritten bytes as initialized when given a zero-length buffer
- Solución: Actualiza a 1.1.6 o superior.

### [MEDIO] @anthropic-ai/sdk@0.82.0 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-p7fg-763f-g4gf
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] @azure/msal-node@5.4.0 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-xcx6-jx8p-x3h5
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] @hono/node-server@1.19.17 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-jpvv-r467-5p4w
    GHSA-rmxm-3fg6-px4f
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] @modelcontextprotocol/sdk@1.29.0 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-22jm-h49p-29qw
    GHSA-46jr-4wx8-v453
    GHSA-6prh-2h8m-c8cw
    GHSA-6qxp-vccf-f47h
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] @modelcontextprotocol/sdk@1.30.0 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-22jm-h49p-29qw
    GHSA-46jr-4wx8-v453
    GHSA-6prh-2h8m-c8cw
    GHSA-6qxp-vccf-f47h
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] @octokit/request-error@3.0.3 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-xx4v-prfh-6cgc
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] @octokit/request@6.2.8 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-rmvr-2pp2-xj38
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] @opentelemetry/core@1.30.1 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-8988-4f7v-96qf
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] @opentelemetry/core@2.5.1 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-8988-4f7v-96qf
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] @vitest/mocker@4.1.11 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-qxg6-89mg-rqv8: Vitest: Code injection via unauthenticated manual mock registration
    GHSA-xp26-3454-mjgp: Vitest: Windows backslash traversal bypasses the @vitest/mocker redirect allowlist fix
- Solución: Actualiza a 4.1.12 o superior.

### [MEDIO] body-parser@2.3.0 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-27r3-jxmh-p828
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] braces@2.3.2 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-grv7-fg5c-xmjg
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] csv-parse@6.2.1 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-8cw4-87c7-c6xx
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] decode-uri-component@0.2.2 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-qr28-fpjm-wq7f
    GHSA-vcc3-ghjq-m6fr
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] diff@7.0.0 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-73rr-hh4g-fpgx
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] dompurify@3.4.16 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-c6gr-qvv4-5v3f
    GHSA-cg2g-xh64-v4q7
    GHSA-mrv2-3pqr-j5jr
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] electron@42.10.0 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-2p8c-gr87-2676
    GHSA-3qxv-5xgr-q7w9
    GHSA-98mx-cjp9-gchm
    GHSA-997q-gvvc-jwmx
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] fast-uri@3.1.8 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-w74x-v6f9-j3xg: fast-uri vulnerable to URI scheme spoofing via percent-encoded scheme decoding
    GHSA-wjr9-j795-jxcr: fast-uri vulnerable to host confusion via unchecked WHATWG host canonicalization
    GHSA-333x-w4r6-6crp: fast-uri vulnerable to scheme injection via an unescaped first-segment colon in suffix references
    GHSA-xhq7-xmqj-769h: fast-uri vulnerable to improper path equivalence in relative reference normalization
- Solución: Actualiza a 2.4.8 o superior.

### [MEDIO] fast-xml-parser@5.8.0 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-474x-hrwr-fgx4
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] follow-redirects@1.16.1 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-mrwp-f3q8-3g9p
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] glob@10.5.0 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-3g3m-2fjr-6pw4
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] glob@11.1.0 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-3g3m-2fjr-6pw4
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] hono@4.13.13 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-3gg2-335m-rxc6
    GHSA-46wx-v44x-9hh2
    GHSA-4h7h-rv7c-7m2v
    GHSA-4m76-xfj5-7975
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] hono@4.13.7 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-3gg2-335m-rxc6
    GHSA-46wx-v44x-9hh2
    GHSA-4h7h-rv7c-7m2v
    GHSA-4m76-xfj5-7975
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] image-size@1.0.2 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-w3rx-r6r6-pgpr
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] ip-address@10.7.2 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-rxp7-6hxx-x8q5
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] katex@0.16.21 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-238p-pmpm-9mq7
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] katex@0.16.22 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-238p-pmpm-9mq7
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] katex@0.16.47 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-238p-pmpm-9mq7
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] markdown-it@14.3.2 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-gfr2-rv44-r23c
    GHSA-vfgh-jcmw-g37q
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] micromatch@3.1.10 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-952p-6rrq-rcjv
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] minimatch@10.2.4 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-g3hv-75wg-m249: minimatch has potential denial of service via globparts amplification
- Solución: Actualiza a 11.0.1 o superior.

### [MEDIO] minimatch@10.2.6 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-g3hv-75wg-m249: minimatch has potential denial of service via globparts amplification
- Solución: Actualiza a 11.0.1 o superior.

### [MEDIO] minimatch@9.0.9 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-g3hv-75wg-m249: minimatch has potential denial of service via globparts amplification
- Solución: Actualiza a 11.0.1 o superior.

### [MEDIO] node-forge@1.4.0 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-2vgq-wchc-25w7
    GHSA-4487-j8r4-4g2f
    GHSA-4642-5mcj-2rqw
    GHSA-525v-9gp9-w22h
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] postcss@7.0.39 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-6g55-p6wh-862q
    GHSA-7fh5-64p2-3v2j
    GHSA-fxqj-rqcc-2cmp
    GHSA-qx2v-qp2m-jg93
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] proxy-addr@2.0.7 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-jqcg-44mw-7w3h
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] qs@6.16.0 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-6pq8-jhm2-2vcw
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] serialize-javascript@7.0.5 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-m5mm-p8h7-m29v
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] shell-quote@1.10.0 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-pqg4-j6r4-53mv
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] undici@7.29.1 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-2m5v-pch6-74hx
    GHSA-4qv8-2p9j-2685
    GHSA-4w7w-5xrc-9h26
    GHSA-55wc-3pg8-jfw6
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] uuid@3.4.0 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-w5hq-g745-h8pq
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] uuid@8.3.2 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-w5hq-g745-h8pq
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] vite@8.0.16 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-587h-7wmj-h5pm
    GHSA-698v-4r3x-3vcv
    GHSA-9jrq-w75r-8gcw
    GHSA-r825-w8mm-5pxw
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] zod@3.25.76 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-mrhx-c7xc-m3w5
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] zod@4.4.3 (npm)
- Ubicación: `vendor/vscode-main/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-mrhx-c7xc-m3w5
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] katex@0.16.47 (npm)
- Ubicación: `vendor/vscode-main/remote/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-238p-pmpm-9mq7
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] undici@7.29.1 (npm)
- Ubicación: `vendor/vscode-main/remote/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-2m5v-pch6-74hx
    GHSA-4qv8-2p9j-2685
    GHSA-4w7w-5xrc-9h26
    GHSA-55wc-3pg8-jfw6
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] zod@3.25.76 (npm)
- Ubicación: `vendor/vscode-main/remote/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-mrhx-c7xc-m3w5
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

### [MEDIO] zod@4.4.3 (npm)
- Ubicación: `vendor/vscode-main/remote/pnpm-lock.yaml`
- Categoría: Dependencia
- Detalle: GHSA-mrhx-c7xc-m3w5
- Solución: Revisa el aviso y actualiza a una versión sin la vulnerabilidad.

## Mi equipo

_Puertos escuchando en TODAS las interfaces (accesibles desde la red): 23_
_Firewall de Windows: activo en todos los perfiles_

### [BAJO] Puerto 135 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.

### [ALTO] Puerto 445 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Este servicio no debería estar expuesto: escúchalo solo en 127.0.0.1 o bloquéalo en el firewall.

### [BAJO] Puerto 664 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.

### [BAJO] Puerto 2179 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.

### [BAJO] Puerto 5040 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.

### [BAJO] Puerto 7680 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.

### [BAJO] Puerto 10001 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.

### [BAJO] Puerto 10001 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.

### [BAJO] Puerto 16993 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.

### [BAJO] Puerto 49664 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.

### [BAJO] Puerto 49665 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.

### [BAJO] Puerto 49666 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.

### [BAJO] Puerto 49667 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.

### [BAJO] Puerto 49668 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.

### [BAJO] Puerto 49877 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.

### [BAJO] Puerto 8777 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.

### [BAJO] Puerto 11434 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.

### [BAJO] Puerto 48867 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.

### [BAJO] Puerto 63842 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Si no lo necesitas desde otros equipos, haz que escuche solo en 127.0.0.1.

### [ALTO] Puerto 139 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Este servicio no debería estar expuesto: escúchalo solo en 127.0.0.1 o bloquéalo en el firewall.

### [ALTO] Puerto 139 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Este servicio no debería estar expuesto: escúchalo solo en 127.0.0.1 o bloquéalo en el firewall.

### [ALTO] Puerto 139 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Este servicio no debería estar expuesto: escúchalo solo en 127.0.0.1 o bloquéalo en el firewall.

### [ALTO] Puerto 139 abierto a la red (TCP)

- Categoría: Sistema

- Solución: Este servicio no debería estar expuesto: escúchalo solo en 127.0.0.1 o bloquéalo en el firewall.
