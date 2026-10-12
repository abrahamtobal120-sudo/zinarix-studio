// Screenshot of a long, varied chat answer (code, tables, long paths, lists) to spot clipping.
import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = process.argv[2] ?? tmpdir();
const width = Number(process.argv[3] ?? 1280);
const answer = [
  '## Resultado del análisis con un título bastante largo para ver si se corta en la cabecera',
  '',
  'Revisé `/home/usuario/proyectos/mi-aplicacion-super-larga/packages/providers/src/adapters/openai-compatible-con-nombre-largo.ts` y encontré esto:',
  '',
  '```ts',
  'export async function procesarPedidoConUnNombreMuyLargo(pedido: Pedido, opciones: OpcionesDeProcesamiento = { reintentos: 3, tiempoDeEspera: 30_000, registrar: true }): Promise<ResultadoDelPedido> {',
  '  return await servicio.enviar(pedido, opciones);',
  '}',
  '```',
  '',
  '| Archivo | Líneas | Estado | Descripción detallada del cambio que se hizo |',
  '|---|---|---|---|',
  '| packages/providers/src/adapters/cli-agent.ts | 650 | modificado | Aviso cuando una herramienta se bloquea por permisos del proveedor |',
  '| apps/desktop/src/renderer/components/Chat.tsx | 1400 | sin cambios | Componente principal del chat con historial, adjuntos y modo agente |',
  '',
  '1. Primer paso con una URL larga: https://github.com/abrahamtobal120-sudo/zinarix-studio/blob/main/packages/providers/src/adapters/cli-agent.ts#L300-L420',
  '2. Segundo paso: unapalabrasinespaciosmuylargaquenodeberiadesbordarelcontenedordelchatniaunqueseamuyanchaaaaaaaaaaaaaaaaaaaa',
  '',
  '⚠ No se permitió usar:',
  '- Bash (echo "DISPLAY=$DISPLAY WAYLAND=$WAYLAND_DISPLAY"; which xdotool wmctrl 2>&1; wmctrl -l 2>&1 | head)',
  '',
  'El modo del proveedor no deja hacer esto y nadie puede aprobarlo desde Zinarix. Para que lo haga sin preguntar, cambia el modo a **full** en Proveedores.',
].join('\n');
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'demo' }] }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    send({ choices: [{ delta: { content: answer }, finish_reason: 'stop' }] });
    send({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 400 } });
    res.end('data: [DONE]\n\n');
  });
}).listen(0);
await new Promise((r) => server.once('listening', r));

const home = mkdtempSync(join(tmpdir(), 'zs-chat-'));
const proj = join(home, 'proyecto');
mkdirSync(proj);
writeFileSync(join(proj, 'a.txt'), 'hola');
writeFileSync(
  join(home, 'config.json'),
  JSON.stringify({
    defaultModel: 'mock/demo',
    providers: { mock: {} },
    customProviders: [
      {
        id: 'mock',
        name: 'Mock',
        adapter: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        auth: { type: 'none', optional: true },
        region: 'local',
        category: 'local',
        modelsEndpoint: '/models',
        supports: {
          listModels: true,
          streaming: true,
          tools: true,
          vision: false,
          jsonMode: false,
          embeddings: false,
          fim: false,
        },
        status: 'active',
        verifiedAt: null,
      },
    ],
  }),
);

const app = await electron.launch({
  executablePath: 'node_modules/electron/dist/electron',
  args: ['.', proj],
  env: { ...process.env, OMNI_HOME: home, OMNI_NO_KEYCHAIN: '1' },
});
const win = await app.firstWindow();
await win.setViewportSize({ width, height: 900 });
await win.waitForSelector('.tree-row');
if (await win.locator('.agent-toggle input').isChecked())
  await win.locator('.agent-toggle').click();
await win
  .locator('.chat-input textarea')
  .fill(
    'Un mensaje del usuario bastante largo para comprobar que la burbuja del usuario tampoco se corta: /home/usuario/proyectos/carpeta/con/una/ruta/muy/larga/archivo.ts',
  );
await win.keyboard.press('Enter');
await win.waitForTimeout(2500);
await win.screenshot({ path: join(out, `chat-${width}.png`) });
const overflow = await win.evaluate(() =>
  [...document.querySelectorAll('.chat *')]
    .filter(
      (e) =>
        e.scrollWidth > e.clientWidth + 1 &&
        getComputedStyle(e).overflowX !== 'auto' &&
        getComputedStyle(e).overflowX !== 'scroll',
    )
    .map(
      (e) =>
        `${e.tagName.toLowerCase()}.${[...e.classList].join('.')} ${e.scrollWidth}>${e.clientWidth}`,
    )
    .slice(0, 20),
);
console.log(JSON.stringify(overflow, null, 1));
await app.close();
server.close();
