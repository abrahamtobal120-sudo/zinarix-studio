import { createServer } from 'node:http';
import { createServer as net } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runScan } from '../src/main/security.js';

let webPort = 0;
let bannerPort = 0;
const web = createServer((_q, r) => {
  r.writeHead(200, { server: 'nginx/1.25.3' });
  r.end('ok');
});
const banner = net((s) => {
  s.on('error', () => {});
  s.write('SSH-2.0-OpenSSH_9.6\r\n');
});

beforeAll(async () => {
  await new Promise<void>((r) => web.listen(0, () => r()));
  await new Promise<void>((r) => banner.listen(0, () => r()));
  webPort = (web.address() as { port: number }).port;
  bannerPort = (banner.address() as { port: number }).port;
});
afterAll(() => {
  web.close();
  banner.close();
});

describe('port scanner', () => {
  it('finds open ports and detects the service/version on localhost', async () => {
    const closed = webPort === 1 ? 2 : 1;
    const r = await runScan(
      { target: '127.0.0.1', ports: `${webPort},${bannerPort},${closed}`, serviceDetection: true },
      new AbortController().signal,
    );
    expect(r.public).toBe(false);
    const ports = r.hosts.flatMap((h) => h.openPorts);
    const web = ports.find((p) => p.port === webPort);
    const ssh = ports.find((p) => p.port === bannerPort);
    expect(web?.banner).toMatch(/nginx\/1\.25\.3/);
    expect(ssh?.banner).toMatch(/OpenSSH_9\.6/);
    expect(ports.find((p) => p.port === closed)).toBeUndefined();
  }, 30_000);

  it('refuses a public target unless the user authorized it', async () => {
    await expect(
      runScan({ target: '8.8.8.8', ports: '53' }, new AbortController().signal),
    ).rejects.toThrow(/autoriz|tus equipos/i);
    // With authorization the public path is allowed (we do not actually probe here).
    const r = await runScan(
      { target: '8.8.8.8', ports: '53', serviceDetection: false, authorized: true },
      new AbortController().signal,
    );
    expect(r.public).toBe(true);
  }, 30_000);
});
