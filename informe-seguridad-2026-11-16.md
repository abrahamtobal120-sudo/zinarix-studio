# Informe de seguridad — Zinarix Studio

Fecha: 16/11/2026, 2:22:49 p.m.

**Puntaje general: 0/100**

Resumen: 5 críticos · 18 altos · 118 medios · 29 bajos

## Proyecto

_Archivos revisados: 13882 (se respetan .gitignore y carpetas pesadas)._

### [ALTO] Llave de Google

- Ubicación: `.md/notas/api.md:1`
- Categoría: Secreto
- Detalle: valor: AIz… (39 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [MEDIO] Ejecución de comandos del sistema

- Ubicación: `apps/cli/src/commands/review.ts:1`
- Categoría: Código inseguro
- Detalle: import { execFile } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] Contraseña o secreto escrito en el código

- Ubicación: `apps/cli/test/commands.test.ts:71`
- Categoría: Secreto
- Detalle: valor: SEC… (38 caracteres)
- Solución: Mueve el valor a una variable de entorno o a un gestor de secretos, agrégalo a .gitignore y REVÓCALO/rótalo en el servicio: si ya se subió a git, sigue en el historial.

### [BAJO] URL sin cifrar (http://)

- Ubicación: `apps/desktop/blender/scripts/addons/zinarix_ai/__init__.py:189`
- Categoría: Código inseguro
- Detalle: layout.prop(self, "base_url", placeholder=info.get("base_url") or "http://host:port/v1")
- Solución: Usa https:// para no enviar datos en texto plano.

### [ALTO] Comando con shell=True / os.system

- Ubicación: `apps/desktop/blender/scripts/addons/zinarix_ai/agent.py:145`
- Categoría: Código inseguro
- Detalle: "- No network access, no subprocess, no os.system, no installing packages.",
- Solución: Usa subprocess.run([...]) con lista de argumentos y shell=False.

### [ALTO] Comando con shell=True / os.system

- Ubicación: `apps/desktop/blender/scripts/addons/zinarix_ai/client.py:358`
- Categoría: Código inseguro
- Detalle: ("os.system", r"\bos\s*\.\s*system\b"),
- Solución: Usa subprocess.run([...]) con lista de argumentos y shell=False.

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

- Ubicación: `apps/desktop/scripts/chrome-shot.mjs:5`
- Categoría: Código inseguro
- Detalle: import { execFileSync } from 'node:child_process';
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

- Ubicación: `apps/desktop/scripts/ui-audit.mjs:8`
- Categoría: Código inseguro
- Detalle: import { execFileSync } from 'node:child_process';
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

- Ubicación: `apps/desktop/src/main/hooks.ts:1`
- Categoría: Código inseguro
- Detalle: import { spawn } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema

- Ubicación: `apps/desktop/src/main/jupyter.ts:1`
- Categoría: Código inseguro
- Detalle: import { execFile, spawn, type ChildProcess } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Hash débil (MD5/SHA-1)

- Ubicación: `apps/desktop/src/main/knowledge.ts:67`
- Categoría: Código inseguro
- Detalle: return createHash('sha1').update(`${c.title ?? c.source}\n${c.text}`).digest('base64').slice(0, 16);
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

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

- Ubicación: `apps/desktop/src/main/main.ts:1085`
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

### [MEDIO] Ejecución de comandos del sistema

- Ubicación: `apps/desktop/src/main/sandbox.ts:11`
- Categoría: Código inseguro
- Detalle: import { spawn } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema

- Ubicación: `apps/desktop/src/main/sandboxWin.ts:21`
- Categoría: Código inseguro
- Detalle: import { spawn } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema

- Ubicación: `apps/desktop/src/main/scene3d.ts:10`
- Categoría: Código inseguro
- Detalle: import { spawn, type ChildProcess } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [ALTO] Verificación TLS desactivada

- Ubicación: `apps/desktop/src/main/security.ts:953`
- Categoría: Código inseguro
- Detalle: { host, port, servername: host, timeout: 10_000, rejectUnauthorized: false },
- Solución: Activa la verificación de certificados; si es un certificado propio, agrégalo como CA de confianza.

### [BAJO] URL sin cifrar (http://)

- Ubicación: `apps/desktop/src/main/security.ts:1027`
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

- Ubicación: `apps/desktop/src/main/testing.ts:1`
- Categoría: Código inseguro
- Detalle: import { spawn, type ChildProcess } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Ejecución de comandos del sistema

- Ubicación: `apps/desktop/src/main/transcribe.ts:12`
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

- Ubicación: `apps/desktop/src/main/vercel.ts:2`
- Categoría: Código inseguro
- Detalle: import { execFile } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Hash débil (MD5/SHA-1)

- Ubicación: `apps/desktop/src/main/vercel.ts:469`
- Categoría: Código inseguro
- Detalle: sha: createHash('sha1').update(f.data).digest('hex'),
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [MEDIO] Ejecución de comandos del sistema

- Ubicación: `apps/desktop/src/main/video.ts:9`
- Categoría: Código inseguro
- Detalle: import { spawn, spawnSync } from 'node:child_process';
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

### [MEDIO] Hash débil (MD5/SHA-1)

- Ubicación: `apps/desktop/src/main/video.ts:266`
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

- Ubicación: `apps/desktop/src/preload/designPreview.ts:107`
- Categoría: Código inseguro
- Detalle: shadow.innerHTML = `
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)

- Ubicación: `apps/desktop/src/preload/designPreview.ts:252`
- Categoría: Código inseguro
- Detalle: if (!keep) e.el.innerHTML = e.before;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] Ejecución de comandos del sistema

- Ubicación: `apps/desktop/src/shared/sandbox.ts:246`
- Categoría: Código inseguro
- Detalle: "const net = require('net'), cp = require('child_process');",
- Solución: Si recibe datos del usuario, usa execFile/spawn con argumentos en lista (sin shell) y valida la entrada.

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

### [MEDIO] HTML sin sanitizar (posible XSS)

- Ubicación: `blender/doc/python_api/static/js/version_switch.js:139`
- Categoría: Código inseguro
- Detalle: clone.querySelector("span").innerHTML = title;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] HTML sin sanitizar (posible XSS)

- Ubicación: `blender/doc/python_api/static/js/version_switch.js:148`
- Categoría: Código inseguro
- Detalle: link.innerHTML = title;
- Solución: Usa textContent, o sanitiza con DOMPurify antes de insertar HTML.

### [MEDIO] Hash débil (MD5/SHA-1)

- Ubicación: `blender/intern/cycles/blender/addon/osl.py:258`
- Categoría: Código inseguro
- Detalle: md5 = hashlib.md5(usedforsecurity=False)
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [BAJO] URL sin cifrar (http://)

- Ubicación: `blender/release/license/licenses.json:4`
- Categoría: Código inseguro
- Detalle: "url": "http://tavmjong.free.fr/FONTS/ArevCopyright.txt"
- Solución: Usa https:// para no enviar datos en texto plano.

### [BAJO] URL sin cifrar (http://)

- Ubicación: `blender/scripts/addons_core/bl_pkg/__init__.py:445`
- Categoría: Código inseguro
- Detalle: supported_schemas = ("http://", "https://")
- Solución: Usa https:// para no enviar datos en texto plano.

### [BAJO] URL sin cifrar (http://)

- Ubicación: `blender/scripts/addons_core/bl_pkg/bl_extension_utils.py:798`
- Categoría: Código inseguro
- Detalle: assert remote_url.startswith(("http://", "https://", "file://"))
- Solución: Usa https:// para no enviar datos en texto plano.

### [BAJO] URL sin cifrar (http://)

- Ubicación: `blender/scripts/addons_core/bl_pkg/cli/blender_ext.py:72`
- Categoría: Código inseguro
- Detalle: URL_KNOWN_PREFIX = ("http://", "https://", "file://")
- Solución: Usa https:// para no enviar datos en texto plano.

### [BAJO] URL sin cifrar (http://)

- Ubicación: `blender/scripts/addons_core/bl_pkg/cli/blender_ext.py:1848`
- Categoría: Código inseguro
- Detalle: if not value.startswith(("http://", "https://")):
- Solución: Usa https:// para no enviar datos en texto plano.

### [BAJO] URL sin cifrar (http://)

- Ubicación: `blender/scripts/addons_core/bl_pkg/cli/blender_ext.py:1849`
- Categoría: Código inseguro
- Detalle: return "expected URL to start with \"http://\" or \"https://\", found {!r}".format(value)
- Solución: Usa https:// para no enviar datos en texto plano.

### [MEDIO] Hash débil (MD5/SHA-1)

- Ubicación: `blender/scripts/addons_core/io_scene_fbx/import_fbx.py:75`
- Categoría: Código inseguro
- Detalle: h = hashlib.sha1(name).hexdigest()
- Solución: Para contraseñas usa argon2/bcrypt/scrypt; para integridad usa SHA-256.

### [BAJO] URL sin cifrar (http://)

- Ubicación: `blender/scripts/addons_core/zinarix_ai/__init__.py:79`
- Categoría: Código inseguro
- Detalle: layout.prop(self, "base_url", placeholder=info["base_url"] or "http://host:port/v1")
- Solución: Usa https:// para no enviar datos en texto plano.

### [ALTO] Deserialización insegura

- Ubicación: `blender/scripts/modules/_bl_i18n_utils/utils_spell_check.py:929`
- Categoría: Código inseguro
- Detalle: self.cache |= set(pickle.load(f))
- Solución: Usa json o yaml.safe_load; nunca pickle con datos externos.

### [BAJO] URL sin cifrar (http://)

- Ubicación: `blender/scripts/modules/_bpy_internal/http/downloader.py:1844`
- Categoría: Código inseguro
- Detalle: session.mount("http://", http_adapter)
- Solución: Usa https:// para no enviar datos en texto plano.

### [BAJO] URL sin cifrar (http://)

- Ubicación: `blender/scripts/modules/_bpy_internal/platform/freedesktop.py:306`
- Categoría: Código inseguro
- Detalle: fh.write("""<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">\n""")
- Solución: Usa https:// para no enviar datos en texto plano.

### [ALTO] Comando con shell=True / os.system

- Ubicación: `blender/scripts/modules/_graphviz_export.py:194`
- Categoría: Código inseguro
- Detalle: os.system("dot -Tpng {:s} > {:s}; eog {:s} &".format(tmppath, tmppath + '.png', tmppath + '.png'))
- Solución: Usa subprocess.run([...]) con lista de argumentos y shell=False.

### [ALTO] Deserialización insegura

- Ubicación: `blender/scripts/modules/addon_utils.py:952`
- Categoría: Código inseguro
- Detalle: data = pickle.load(fh)
- Solución: Usa json o yaml.safe_load; nunca pickle con datos externos.

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
  RUSTSEC-2026-0367: Insecure Preservation of SUID/SGID Bits during ZIP Extraction Leading to Potential Privilege Escalation
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
