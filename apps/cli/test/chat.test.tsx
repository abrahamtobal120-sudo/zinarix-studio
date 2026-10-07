import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { OmniCore } from '@omni/core';
import { ChatApp } from '../src/tui/chat.js';
import { mockServer, openAiStream, sse } from '../../../tests/helpers/mock-server.js';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 10000): Promise<void> {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await wait(20);
  }
}

describe('omni chat TUI', () => {
  it('sends a message, streams the answer, shows cost and saves history', async () => {
    const srv = await mockServer((_req, res) => sse(res, openAiStream('Respuesta del modelo')));
    const home = mkdtempSync(join(tmpdir(), 'omni-tui-'));
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({
        customProviders: [
          {
            id: 'mock',
            name: 'Mock',
            adapter: 'openai-compatible',
            baseUrl: srv.url,
            auth: { type: 'none', optional: true },
            region: 'local',
            category: 'local',
            modelsEndpoint: null,
            supports: {
              listModels: false,
              streaming: true,
              tools: false,
              vision: false,
              jsonMode: false,
              embeddings: false,
              fim: false,
            },
            fallbackModels: [{ id: 'm', inputPrice: 1, outputPrice: 2 }],
            status: 'active',
            verifiedAt: null,
          },
        ],
        providers: { mock: {} },
      }),
    );
    const core = OmniCore.open({ home, env: { OMNI_NO_KEYCHAIN: '1' } });
    const ui = render(<ChatApp core={core} initialModel="mock/m" />);
    cleanup = async () => {
      ui.unmount();
      core.close();
      await srv.close();
    };
    const all = () => ui.frames.join('\n');
    await until(() => (ui.lastFrame() ?? '').includes('mock/m'));
    // useInput subscribes in an effect after the first frame; give it a moment under load.
    await wait(150);
    ui.stdin.write('hola');
    await until(() => (ui.lastFrame() ?? '').includes('hola'));
    ui.stdin.write('\r');
    await until(() => all().includes('Respuesta del modelo') && all().includes('12→5'));
    expect(core.history.list()[0]!.title).toBe('hola');
    ui.stdin.write('/model otro/x');
    await until(() => (ui.lastFrame() ?? '').includes('/model otro/x'));
    ui.stdin.write('\r');
    await until(() => ui.frames.join('\n').includes('unknown provider'));
  });
});
