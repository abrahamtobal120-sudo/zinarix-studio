import type { ToolDefinition } from '@omni/shared';
import type { PlatformioService } from './platformio.js';
import type { SystemPreview } from './system.js';
import {
  lineEnding,
  problemPath,
  validBaud,
  validEnvName,
  validPort,
  validProjectDir,
  libName,
  validLibQuery,
  validLibSpec,
  type PioJob,
  type PioProject,
  type PioResult,
} from '../shared/platformio.js';
import { PlotData, seriesStats } from '../shared/serialPlot.js';

/**
 * Fase 5A (plan de funciones): PlatformIO for the agent. Looking (projects, boards, ports,
 * what the serial monitor printed) is free; building runs the project's scripts and asks;
 * uploading writes the board's flash and asks every time unless allowed for that same
 * project / env / port; opening a port or sending to it asks too (it resets most boards).
 */

export const PIO_TOOLS: ToolDefinition[] = [
  {
    name: 'pio_info',
    description:
      'PlatformIO (Arduino, ESP32, STM32, Pico…): what="projects" lists the PlatformIO projects of the open folder with their environments (board, platform, framework, monitor speed); "devices" the serial ports with what is plugged in; "boards" searches the boards PlatformIO knows (query, e.g. "esp32" or "uno"). Also tells whether PlatformIO is installed.',
    parameters: {
      type: 'object',
      properties: {
        what: { type: 'string', enum: ['projects', 'devices', 'boards'] },
        query: { type: 'string', description: 'Search words for what="boards"' },
      },
    },
  },
  {
    name: 'pio_build',
    description:
      'Compile a PlatformIO project (pio run). Returns success, the compiler errors / warnings with file and line, RAM and Flash use, and the end of the output. clean=true removes the build files instead. The user approves it.',
    parameters: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description:
            'Project folder relative to the open folder ("" = the folder itself). Optional when there is one.',
        },
        env: {
          type: 'string',
          description: 'Environment ([env:NAME]); default: default_envs or the first one',
        },
        clean: { type: 'boolean' },
      },
    },
  },
  {
    name: 'pio_upload',
    description:
      'Compile and upload (flash) a PlatformIO project to the connected board (pio run -t upload). port: the serial port (see pio_info what="devices"); PlatformIO finds it when omitted. An open serial monitor on that port is closed during the upload and reopened after. The user approves it.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        env: { type: 'string' },
        port: { type: 'string', description: 'e.g. COM5 or /dev/ttyUSB0' },
      },
    },
  },
  {
    name: 'serial_monitor',
    description:
      'Serial monitor of a board. action "read" returns what the open monitor received (no approval); "values" reads the numbers the board prints (lines like "23.5 40", "temp:23.5,hum:40", the serial plotter format) and returns the last / min / max / average of each series over the last lines (no approval); "open" opens the port at baud (default: monitor_speed of the project, else 115200) and returns what arrives in the next seconds (opening resets most boards); "send" writes text (ending: "nl" default, "cr", "crlf", "none") and returns the answer of the next seconds; "close" closes it. open and send are approved by the user. The Hardware panel shows the same monitor.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['read', 'values', 'open', 'send', 'close'] },
        port: {
          type: 'string',
          description: 'e.g. COM5; default: the open monitor or the only board plugged in',
        },
        baud: { type: 'integer' },
        text: { type: 'string', description: 'What to send (action "send")' },
        ending: { type: 'string', enum: ['nl', 'cr', 'crlf', 'none'] },
        seconds: {
          type: 'number',
          minimum: 0,
          maximum: 30,
          description: 'How long to listen (default 3)',
        },
        lines: {
          type: 'integer',
          minimum: 1,
          maximum: 2000,
          description: 'Last lines to return (action "read", default 200)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'pio_library',
    description:
      'Arduino / PlatformIO libraries. action "list" shows the lib_deps of a project env and the libraries downloaded for it (no approval); "search" looks in the PlatformIO registry (query, e.g. "DHT22" or "neopixel"; needs internet; no approval); "install" adds spec (owner/name or owner/name@^1.2.3, as "search" lists it) to lib_deps in platformio.ini and downloads it with its dependencies; "uninstall" removes it. install and uninstall are approved by the user. Build afterwards to check it compiles.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'search', 'install', 'uninstall'] },
        query: { type: 'string' },
        page: { type: 'integer', minimum: 1, maximum: 100 },
        spec: {
          type: 'string',
          description: 'owner/name[@version], e.g. "adafruit/DHT sensor library@^1.4.7"',
        },
        project: { type: 'string' },
        env: { type: 'string' },
      },
      required: ['action'],
    },
  },
];

export const PIO_TOOL_NAMES = new Set(PIO_TOOLS.map((t) => t.name));

export const PIO_PROMPT_PART =
  '- pio_info, pio_build, pio_upload, pio_library and serial_monitor: Arduino / ESP32 / STM32 / Pico projects with PlatformIO (platformio.ini). Build after editing the sketch and fix the errors it reports (file:line); add libraries with pio_library (search, then install) instead of editing lib_deps by hand; upload only when the user wants it on the board; read the serial monitor to see what the board prints (action "values" summarises sensor numbers). The Hardware panel shows the same build, upload and monitor.';

const s = (v: unknown) => (typeof v === 'string' ? v : '');

export function pioPreview(
  name: string,
  a: Record<string, unknown>,
): SystemPreview | { error: string } | null {
  const project = s(a.project);
  if (a.project !== undefined && !validProjectDir(project))
    return { error: 'Invalid project folder (relative to the open folder).' };
  if (a.env !== undefined && a.env !== '' && !validEnvName(a.env))
    return { error: 'Invalid env name.' };
  if (a.port !== undefined && a.port !== '' && !validPort(a.port))
    return { error: 'Invalid port (COM5, /dev/ttyUSB0…).' };
  if (a.baud !== undefined && !validBaud(a.baud)) return { error: 'Invalid baud rate.' };
  const where = `${project || '.'}${s(a.env) ? ` [${s(a.env)}]` : ''}`;
  if (name === 'pio_info') return null;
  if (name === 'pio_build')
    return {
      risk: 'medium',
      action: a.clean === true ? `PlatformIO: limpiar ${where}` : `PlatformIO: compilar ${where}`,
      warning:
        'Ejecuta la compilación del proyecto (y sus scripts extra) y descarga lo que falte de la plataforma.',
      command: `pio run${a.clean === true ? ' -t clean' : ''}${s(a.env) ? ` -e ${s(a.env)}` : ''}`,
      allowKey: `pio_build:${project}:${s(a.env)}:${a.clean === true}`,
    };
  if (name === 'pio_upload')
    return {
      risk: 'high',
      action: `PlatformIO: subir ${where} a la placa${s(a.port) ? ` en ${s(a.port)}` : ''}`,
      warning: 'Borra el programa que tiene la placa y graba este. La placa se reinicia.',
      command: `pio run -t upload${s(a.env) ? ` -e ${s(a.env)}` : ''}${s(a.port) ? ` --upload-port ${s(a.port)}` : ''}`,
      allowKey: `pio_upload:${project}:${s(a.env)}:${s(a.port)}`,
    };
  if (name === 'serial_monitor') {
    const act = s(a.action);
    if (act === 'read' || act === 'values' || act === 'close') return null;
    if (act === 'open')
      return {
        risk: 'medium',
        action: `Monitor serie: abrir ${s(a.port) || 'el puerto de la placa'}${a.baud ? ` a ${String(a.baud)} baudios` : ''}`,
        warning: 'Abrir el puerto reinicia la mayoría de las placas Arduino.',
        allowKey: `serial_open:${s(a.port)}`,
      };
    if (act === 'send') {
      if (typeof a.text !== 'string' || !a.text) return { error: 'Missing text to send.' };
      return {
        risk: 'medium',
        action: `Monitor serie: enviar a ${s(a.port) || 'la placa'}`,
        warning: 'La placa recibe este texto y puede actuar (mover un motor, encender algo…).',
        command: JSON.stringify(a.text.slice(0, 500)),
        allowKey: `serial_send:${s(a.port)}`,
      };
    }
    return { error: 'Unknown action.' };
  }
  if (name === 'pio_library') {
    const act = s(a.action);
    if (act === 'list') return null;
    if (act === 'search')
      return validLibQuery(a.query) ? null : { error: 'Missing or invalid query.' };
    if (act === 'install' || act === 'uninstall') {
      if (!validLibSpec(a.spec))
        return {
          error:
            'Invalid spec: use owner/name or owner/name@version (as pio_library search lists it).',
        };
      const spec = a.spec.trim();
      return {
        risk: 'medium',
        action:
          act === 'install'
            ? `PlatformIO: instalar la librería ${spec} en ${where}`
            : `PlatformIO: quitar la librería ${libName(spec)} de ${where}`,
        warning:
          act === 'install'
            ? 'Descarga la librería (y las que necesita) del registro de PlatformIO y la agrega a lib_deps en platformio.ini.'
            : 'La quita de lib_deps en platformio.ini y borra su copia del proyecto.',
        command: `pio pkg ${act} -l "${act === 'install' ? spec : libName(spec)}"${s(a.env) ? ` -e ${s(a.env)}` : ''}`,
        allowKey: `pio_library:${act}:${project}:${spec}`,
      };
    }
    return { error: 'Unknown action.' };
  }
  return null;
}

const cut = (t: string, n = 20_000) => (t.length > n ? `${t.slice(0, n)}\n… (cut)` : t);
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const pct = (u: number, t: number) => (t ? `${((u / t) * 100).toFixed(1)}%` : '?');

/** The project the call means: the given folder, or the only one there is. */
async function pick(
  pio: PlatformioService,
  root: string,
  a: Record<string, unknown>,
): Promise<PioProject> {
  const list = await pio.projects(root);
  if (!list.length) throw new Error('No PlatformIO project (platformio.ini) in the open folder.');
  if (typeof a.project === 'string') {
    const want = a.project;
    const p = list.find((x) => x.dir === want.replace(/\\/g, '/').replace(/\/+$/, ''));
    if (!p)
      throw new Error(
        `No platformio.ini in "${a.project}". Projects: ${list.map((x) => x.dir || '.').join(', ')}`,
      );
    return p;
  }
  if (list.length > 1)
    throw new Error(
      `Several PlatformIO projects; pass project: ${list.map((x) => JSON.stringify(x.dir)).join(', ')}`,
    );
  return list[0]!;
}

function envOf(p: PioProject, env: unknown): string | null {
  if (typeof env === 'string' && env) {
    if (!p.envs.some((e) => e.name === env))
      throw new Error(
        `No [env:${env}] in platformio.ini. Envs: ${p.envs.map((e) => e.name).join(', ')}`,
      );
    return env;
  }
  return p.defaultEnvs[0] ?? p.envs[0]?.name ?? null;
}

export function describeResult(r: PioResult, projectDir: string): string {
  const lines = [r.ok ? `SUCCESS${r.seconds != null ? ` in ${r.seconds}s` : ''}` : 'FAILED'];
  if (r.memory)
    lines.push(
      `RAM ${kb(r.memory.ramUsed)} of ${kb(r.memory.ramTotal)} (${pct(r.memory.ramUsed, r.memory.ramTotal)}), Flash ${kb(r.memory.flashUsed)} of ${kb(r.memory.flashTotal)} (${pct(r.memory.flashUsed, r.memory.flashTotal)})`,
    );
  for (const p of r.problems.slice(0, 60))
    lines.push(
      `${p.severity}: ${problemPath(projectDir, p.file) ?? p.file}:${p.line}:${p.column}: ${p.message}`,
    );
  if (r.problems.length > 60) lines.push(`… ${r.problems.length - 60} more`);
  return lines.join('\n');
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((ok) => {
    const t = setTimeout(ok, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), ok()), { once: true });
  });

export async function runPioTool(
  pio: PlatformioService | undefined,
  name: string,
  a: Record<string, unknown>,
  root: string | undefined,
  signal?: AbortSignal,
): Promise<{ ok: boolean; content: string; summary: string }> {
  if (!pio)
    return { ok: false, content: 'PlatformIO is not available here.', summary: 'no disponible' };
  try {
    const st = await pio.status();
    if (st.state !== 'ready')
      return {
        ok: false,
        content:
          'PlatformIO Core is not installed. Tell the user: pip install platformio (or install the PlatformIO extension), then reopen the Hardware panel.',
        summary: 'sin PlatformIO',
      };
    if (name === 'pio_library') {
      const act = s(a.action);
      if (act === 'search') {
        if (!validLibQuery(a.query))
          return { ok: false, content: 'Missing or invalid query.', summary: 'sin búsqueda' };
        const r = await pio.searchLibraries(a.query, typeof a.page === 'number' ? a.page : 1);
        return {
          ok: true,
          content:
            (r.libraries
              .map(
                (l) =>
                  `${l.id}@^${l.version}  (${l.published})\n    ${l.description.slice(0, 200)}`,
              )
              .join('\n') || 'No libraries found.') +
            (r.pages > 1
              ? `\n(page ${typeof a.page === 'number' ? a.page : 1} of ${r.pages}, ${r.total} results)`
              : ''),
          summary: `${r.libraries.length} librerías`,
        };
      }
      if (!root) return { ok: false, content: 'No folder is open.', summary: 'sin carpeta' };
      const p = await pick(pio, root, a);
      const env = envOf(p, a.env);
      if (act === 'list') {
        const r = await pio.libraries(root, p.dir, env);
        return {
          ok: true,
          content: [
            `Project "${p.dir || '.'}" env ${r.env ?? '?'}`,
            `lib_deps: ${r.deps.length ? r.deps.join(', ') : '(none)'}`,
            `downloaded: ${r.installed.length ? r.installed.map((l) => `${l.name}${l.version ? ` ${l.version}` : ''}`).join(', ') : '(none yet; they download on the next build)'}`,
          ].join('\n'),
          summary: `${r.deps.length} librerías`,
        };
      }
      if (act === 'install' || act === 'uninstall') {
        if (!validLibSpec(a.spec))
          return { ok: false, content: 'Invalid spec.', summary: 'no válida' };
        const out = await pio.changeLibrary(root, p.dir, env, a.spec, act === 'uninstall');
        const r = await pio.libraries(root, p.dir, env);
        return {
          ok: true,
          content: `${
            out
              .split(/\r?\n/)
              .filter((l) => /Library Manager|installed|removed|uninstall|Error/i.test(l))
              .slice(-12)
              .join('\n') || 'Done.'
          }\nlib_deps now: ${r.deps.join(', ') || '(none)'}`,
          summary: act === 'install' ? 'instalada' : 'quitada',
        };
      }
      return { ok: false, content: 'Unknown action.', summary: 'no aplica' };
    }
    if (name === 'pio_info') {
      const what = s(a.what) || 'projects';
      if (what === 'devices') {
        const list = await pio.devices();
        const open = pio.openPorts();
        return {
          ok: true,
          content:
            list
              .map(
                (d) =>
                  `${d.port}  ${d.description}${d.board ? '  (board)' : ''}${open.some((o) => o.port === d.port) ? '  [monitor open]' : ''}`,
              )
              .join('\n') ||
            'No serial ports. Is the board plugged in (and its USB driver installed, e.g. CH340 / CP210x)?',
          summary: `${list.length} puertos`,
        };
      }
      if (what === 'boards') {
        const list = await pio.boards(s(a.query));
        return {
          ok: true,
          content:
            list
              .slice(0, 80)
              .map(
                (b) => `${b.id}  ${b.name}  (${b.platform}, ${b.mcu}; ${b.frameworks.join('/')})`,
              )
              .join('\n') || 'No boards match.',
          summary: `${list.length} placas`,
        };
      }
      if (!root) return { ok: false, content: 'No folder is open.', summary: 'sin carpeta' };
      const list = await pio.projects(root);
      return {
        ok: true,
        content:
          `PlatformIO ${st.version}\n` +
          (list
            .map(
              (p) =>
                `project "${p.dir || '.'}"${p.defaultEnvs.length ? ` default_envs=${p.defaultEnvs.join(',')}` : ''}${p.compileDb ? ' (compile_commands.json)' : ''}\n` +
                p.envs
                  .map(
                    (e) =>
                      `  [env:${e.name}] board=${e.board || '?'} platform=${e.platform || '?'} framework=${e.framework || '-'}${e.monitorSpeed ? ` monitor_speed=${e.monitorSpeed}` : ''}${e.uploadPort ? ` upload_port=${e.uploadPort}` : ''}`,
                  )
                  .join('\n'),
            )
            .join('\n') || 'No platformio.ini in the open folder.'),
        summary: `${list.length} proyectos`,
      };
    }
    if (name === 'pio_build' || name === 'pio_upload') {
      if (!root) return { ok: false, content: 'No folder is open.', summary: 'sin carpeta' };
      const p = await pick(pio, root, a);
      const env = envOf(p, a.env);
      const job: PioJob = {
        dir: p.dir,
        env,
        target: name === 'pio_upload' ? 'upload' : a.clean === true ? 'clean' : 'build',
        port: typeof a.port === 'string' && a.port ? a.port : null,
      };
      const r = await pio.runJob(root, job, signal);
      const head = describeResult(r, p.dir);
      return {
        ok: r.ok,
        content: cut(`${head}\n\n--- output (end) ---\n${r.tail}`),
        summary: r.ok
          ? job.target === 'upload'
            ? 'subido a la placa'
            : job.target === 'clean'
              ? 'limpio'
              : 'compilado'
          : `${r.problems.filter((x) => x.severity === 'error').length} errores`,
      };
    }
    if (name === 'serial_monitor') {
      const act = s(a.action);
      const open = pio.openPorts();
      let port = s(a.port);
      if (!port) {
        if (open.length === 1) port = open[0]!.port;
        else if (act === 'open') {
          const boards = (await pio.devices()).filter((d) => d.board);
          if (boards.length !== 1)
            return {
              ok: false,
              content: boards.length
                ? `Several boards: pass port (${boards.map((b) => b.port).join(', ')}).`
                : 'No board found on the serial ports. Pass port, or ask the user to plug it in.',
              summary: 'sin puerto',
            };
          port = boards[0]!.port;
        } else
          return {
            ok: false,
            content: open.length
              ? `Several monitors open: pass port (${open.map((o) => o.port).join(', ')}).`
              : 'No serial monitor is open. Use action "open".',
            summary: 'sin monitor',
          };
      }
      if (!validPort(port))
        return { ok: false, content: 'Invalid port.', summary: 'puerto no válido' };
      const secs = Math.max(0, Math.min(30, typeof a.seconds === 'number' ? a.seconds : 3));
      if (act === 'read') {
        const text = pio.serialText(port);
        if (text == null)
          return {
            ok: false,
            content: `The monitor of ${port} is not open. Use action "open".`,
            summary: 'cerrado',
          };
        const n = typeof a.lines === 'number' ? Math.max(1, Math.min(2000, a.lines)) : 200;
        const lines = text.split(/\r?\n/);
        return {
          ok: true,
          content: cut(lines.slice(-n).join('\n') || '(nothing received yet)'),
          summary: `${Math.min(n, lines.length)} líneas`,
        };
      }
      if (act === 'values') {
        const text = pio.serialText(port);
        if (text == null)
          return {
            ok: false,
            content: `The monitor of ${port} is not open. Use action "open".`,
            summary: 'cerrado',
          };
        const n = typeof a.lines === 'number' ? Math.max(1, Math.min(2000, a.lines)) : 500;
        const plot = new PlotData(n);
        for (const l of text.split(/\r?\n/).slice(-n - 1, -1)) plot.pushLine(l);
        if (!plot.samples.length)
          return {
            ok: true,
            content: 'No lines of numbers in the last lines (the board prints text only).',
            summary: 'sin números',
          };
        const f = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(6))) : '?');
        const rows = seriesStats(plot.samples, plot.series).map(
          (st) =>
            `${st.name}: last ${f(st.last)}, min ${f(st.min)}, max ${f(st.max)}, avg ${f(st.avg)} (${st.count} samples)`,
        );
        const tail = plot.samples
          .slice(-10)
          .map((x) =>
            plot.series.map((k) => (x.values[k] === undefined ? '-' : f(x.values[k]!))).join(' '),
          )
          .join('\n');
        return {
          ok: true,
          content: `${plot.samples.length} samples of ${plot.series.join(', ')}\n${rows.join('\n')}\nLast samples (${plot.series.join(' ')}):\n${tail}`,
          summary: `${plot.series.length} series`,
        };
      }
      if (act === 'close') {
        pio.closeSerial(port);
        return { ok: true, content: `Closed ${port}.`, summary: 'cerrado' };
      }
      if (act === 'open') {
        let baud = typeof a.baud === 'number' ? a.baud : 0;
        if (!baud && root) {
          const projects = await pio.projects(root).catch(() => []);
          baud = projects.flatMap((p) => p.envs).find((e) => e.monitorSpeed)?.monitorSpeed ?? 0;
        }
        baud ||= 115200;
        const before = pio.serialText(port)?.length ?? 0;
        await pio.openSerial(port, baud);
        await wait(secs * 1000, signal);
        const got = (pio.serialText(port) ?? '').slice(before);
        return {
          ok: true,
          content: `Opened ${port} at ${baud} baud.\n${cut(got) || '(nothing received yet)'}`,
          summary: `${port} abierto`,
        };
      }
      if (act === 'send') {
        const ending = (['nl', 'cr', 'crlf', 'none'] as const).find((e) => e === a.ending) ?? 'nl';
        const before = pio.serialText(port)?.length ?? 0;
        await pio.writeSerial(port, lineEnding(String(a.text ?? ''), ending));
        await wait(secs * 1000, signal);
        const got = (pio.serialText(port) ?? '').slice(before);
        return { ok: true, content: `Sent.\n${cut(got) || '(no answer)'}`, summary: 'enviado' };
      }
      return { ok: false, content: 'Unknown action.', summary: 'no aplica' };
    }
    return { ok: false, content: `Unknown tool ${name}.`, summary: 'desconocida' };
  } catch (e) {
    return { ok: false, content: (e as Error).message, summary: 'error' };
  }
}
