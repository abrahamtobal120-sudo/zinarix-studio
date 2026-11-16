/**
 * Zinarix 3D Pro end to end: a real BlenderBridge (fake model behind it) and a real Blender
 * running the "Zinarix" template and its zinarix_ai add-on, launched with the environment
 * openPro gives it. The add-on's agent loop runs for real: it asks the model, runs the returned
 * script in Blender, sends the output back and stops on a final answer. Skipped unless
 * Blender 4.2+ is found (installed, on PATH, or named by ZINARIX_BLENDER).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { BlenderBridge, type BridgeChatRequest } from '../src/main/blenderBridge.js';
import { Scene3DService } from '../src/main/scene3d.js';
import { taskEnv } from '../src/shared/sandbox.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const scripts = join(appRoot, 'blender', 'scripts');
const dir = mkdtempSync(join(tmpdir(), 'z3dpro-e2e-'));
const svc = new Scene3DService(dir, () => null);
const blender = await svc.findBlender();
const [major = 0, minor = 0] = (blender?.version ?? '0.0').split('.').map(Number);
const recent = major > 4 || (major === 4 && minor >= 2);

/** Same environment as Scene3DService.openPro (with a bridge), in a user folder per test. */
function proEnv(userRes: string, bridge: { url: string; token: string }, lang: 'es' | 'en') {
  mkdirSync(userRes, { recursive: true });
  return taskEnv(process.env, {
    BLENDER_SYSTEM_SCRIPTS: scripts,
    BLENDER_USER_RESOURCES: userRes,
    ZINARIX_LANG: lang,
    ZINARIX_BRIDGE_URL: bridge.url,
    ZINARIX_BRIDGE_TOKEN: bridge.token,
    ZINARIX_AI_PROVIDER: 'ZINARIX',
  });
}

/**
 * Sends a prompt with the add-on's operator and pumps its poll function (bpy.app.timers do
 * not fire in background mode) until the loop ends, then prints one ZXE2E JSON line.
 */
const driver = (prompt: string, timeoutS = 60) => String.raw`
import sys, json, time, bpy, addon_utils
p = bpy.context.preferences
if "zinarix_ai" not in p.addons:
    addon_utils.enable("zinarix_ai", default_set=True)
ai = sys.modules["zinarix_ai"]
p.addons["zinarix_ai"].preferences.auto_run = True
wm = bpy.context.window_manager
wm.zinarix_ai_prompt = ${JSON.stringify(prompt)}
sent = bpy.ops.zinarix.ai_send()
deadline = time.time() + ${timeoutS}
while time.time() < deadline:
    ai._poll()
    if not ai._state.active and not ai._state.busy:
        break
    time.sleep(0.05)
ai._poll()
s = ai._state
print("ZXE2E" + json.dumps({
    "sent": sorted(sent),
    "cube": "ZxE2E" in bpy.data.objects,
    "cubeType": getattr(bpy.data.objects.get("ZxE2E"), "type", None),
    "step": s.step,
    "active": s.active,
    "busy": s.busy,
    "status": s.status,
    "kind": s.status_kind,
    "answer": s.last_answer,
    "lastError": s.last_error,
    "notRunning": ai.client.BRIDGE_NOT_RUNNING,
    "history": [m["role"] for m in s.history],
    "timedOut": time.time() >= deadline,
}))
`;

const SCRIPT = [
  'import bpy',
  'bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 1))',
  'bpy.context.active_object.name = "ZxE2E"',
  'print("made", bpy.context.active_object.name, len(bpy.data.objects))',
].join('\n');
const FINAL = 'Listo: añadí el cubo ZxE2E sobre el suelo.';

describe.skipIf(!blender || !recent)('Zinarix 3D Pro end to end (bridge + Blender add-on)', () => {
  const seen: BridgeChatRequest[] = [];
  const auth: string[] = [];
  const bridge = new BlenderBridge({
    models: async () => [{ id: 'fake/agent', ownedBy: 'fake' }],
    complete: async (req) => {
      seen.push(req);
      const text =
        seen.length === 1
          ? `Primero creo el cubo.\n\n\`\`\`python\n${SCRIPT}\n\`\`\`\n`
          : `${FINAL}\nNo hace falta más código.`;
      return { text, model: 'fake/agent' };
    },
  });
  afterAll(async () => {
    await bridge.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs the agent loop: model -> script in Blender -> output back -> final answer', async () => {
    const info = await bridge.start();
    // Record what the add-on sends, before the bridge checks it.
    const server = (bridge as unknown as { server: Server }).server;
    server.prependListener('request', (req: IncomingMessage) => {
      if (req.url?.includes('/chat/completions')) auth.push(req.headers.authorization ?? '');
    });

    const { r, out } = await runAsync(
      proEnv(join(dir, 'res'), info, 'es'),
      driver('Crea un cubo llamado ZxE2E'),
    );
    expect(r.stderr, r.stdout + r.stderr).not.toMatch(/Traceback/);
    expect(out).toMatchObject({
      sent: ['FINISHED'],
      cube: true,
      cubeType: 'MESH',
      step: 2,
      active: false,
      busy: false,
      kind: 'DONE',
      timedOut: false,
      history: ['user', 'assistant', 'user', 'assistant'],
    });
    expect(out.answer).toContain(FINAL);

    expect(seen).toHaveLength(2);
    expect(auth).toEqual([`Bearer ${info.token}`, `Bearer ${info.token}`]);
    // 1st call: the user's request and a description of the scene.
    const first = seen[0]!.messages.at(-1)!;
    expect(first.role).toBe('user');
    expect(first.content).toContain('Crea un cubo llamado ZxE2E');
    expect(seen[0]!.messages[0]!.role).toBe('system');
    // 2nd call: the run's output comes back as the last user message, after the script.
    const second = seen[1]!.messages;
    expect(second.at(-2)).toMatchObject({ role: 'assistant' });
    expect(second.at(-2)!.content).toContain('ZxE2E');
    const feedback = second.at(-1)!;
    expect(feedback.role).toBe('user');
    expect(feedback.content).toMatch(/correctamente|ran successfully/);
    expect(feedback.content).toMatch(/made ZxE2E \d+/);
    // The fresh scene description already lists the new cube.
    expect(feedback.content).toContain('ZxE2E');
  }, 180_000);

  it('reports cleanly that Zinarix Studio is not running when the bridge is closed', async () => {
    const port = await new Promise<number>((resolve) => {
      const s = createServer();
      s.listen(0, '127.0.0.1', () => {
        const { port } = s.address() as AddressInfo;
        s.close(() => resolve(port));
      });
    });
    const before = seen.length;
    const { r, out } = await runAsync(
      proEnv(join(dir, 'res-closed'), { url: `http://127.0.0.1:${port}/v1`, token: 'x' }, 'en'),
      driver('Make a cube', 30),
    );
    expect(r.stderr, r.stdout + r.stderr).not.toMatch(/Traceback/);
    expect(out).toMatchObject({
      sent: ['FINISHED'],
      cube: false,
      step: 0,
      active: false,
      busy: false,
      kind: 'ERROR',
      timedOut: false,
      history: [],
    });
    expect(out.lastError).toBe(out.notRunning);
    expect(out.status).toContain(out.notRunning);
    expect(seen.length).toBe(before);
  }, 180_000);
});

interface E2EResult {
  r: { stdout: string; stderr: string };
  out: Record<string, unknown> & {
    answer: string;
    lastError: string;
    status: string;
    notRunning: string;
  };
}

/** Runs Blender asynchronously: spawnSync would block the bridge, which lives in this process. */
function runAsync(env: Record<string, string>, expr: string): Promise<E2EResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      blender!.path,
      ['--app-template', 'Zinarix', '-b', '--python-exit-code', '1', '--python-expr', expr],
      { env, windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => p.kill(), 150_000);
    p.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    p.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    p.on('error', reject);
    p.on('close', () => {
      clearTimeout(timer);
      const line = stdout.split(/\r?\n/).find((l) => l.startsWith('ZXE2E'));
      if (!line) return reject(new Error(`no ZXE2E line\n${stdout}\n${stderr}`));
      resolve({ r: { stdout, stderr }, out: JSON.parse(line.slice(5)) });
    });
  });
}
