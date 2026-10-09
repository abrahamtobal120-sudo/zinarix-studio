import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  isPrivateIp,
  mask,
  parseLockfile,
  parsePorts,
  resolveScanTargets,
  scanCodeInText,
  scanSecretsInText,
} from '../src/main/security.js';

// Fake secrets are assembled at runtime so no real-looking token sits in the repo.
const fake = (...parts: string[]) => parts.join('');

describe('secret scanning', () => {
  it('finds common leaked credentials and masks them', () => {
    const text = [
      `const aws = "${fake('AKIA', 'ABCDEFGHIJKLMNOP')}";`,
      `token: ${fake('ghp_', 'a'.repeat(36))}`,
      `DATABASE_URL=${fake('postgres://admin:', 'sup3rs3cret', '@db.example.com/app')}`,
      `const password = "${fake('hunter2', 'hunter2')}";`,
      `const password = process.env.PASSWORD;`,
      fake('-----BEGIN ', 'OPENSSH PRIVATE KEY-----'),
    ].join('\n');
    const f = scanSecretsInText('src/config.ts', text);
    expect(f.map((x) => x.title)).toEqual([
      'Llave de AWS',
      'Token de GitHub',
      'Contraseña en una URL de conexión',
      'Contraseña o secreto escrito en el código',
      'Llave privada',
    ]);
    expect(f[0]!.where).toBe('src/config.ts:1');
    expect(JSON.stringify(f)).not.toContain('ABCDEFGHIJKLMNOP');
    expect(mask('abcdefghijkl')).toBe('abcd…kl (12 caracteres)');
  });
});

describe('insecure code patterns', () => {
  it('flags injection, eval and disabled TLS but skips tests and comments', () => {
    const code = [
      'db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);',
      'const r = eval(input);',
      'https.request({ rejectUnauthorized: false });',
      '// eval(ok in comment)',
    ].join('\n');
    const titles = scanCodeInText('src/api.ts', code).map((f) => f.title);
    expect(titles).toContain('SQL armado con texto (posible inyección SQL)');
    expect(titles).toContain('eval / new Function');
    expect(titles).toContain('Verificación TLS desactivada');
    expect(titles).toHaveLength(3);
    expect(scanCodeInText('test/api.ts', code)).toEqual([]);
  });
});

describe('dependency lockfiles', () => {
  it('reads npm, pnpm, Python and Cargo lockfiles', () => {
    const npm = parseLockfile(
      'package-lock.json',
      JSON.stringify({
        packages: {
          '': { version: '1.0.0' },
          'node_modules/lodash': { version: '4.17.20' },
          'node_modules/a/node_modules/@scope/b': { version: '2.0.0' },
        },
      }),
    );
    expect(npm.map((d) => `${d.name}@${d.version}`)).toEqual(['lodash@4.17.20', '@scope/b@2.0.0']);
    const pnpm = parseLockfile(
      'pnpm-lock.yaml',
      "packages:\n\n  '@babel/core@7.24.0':\n    resolution: {}\n\n  zod@3.23.8:\n    resolution: {}\n",
    );
    expect(pnpm.map((d) => `${d.name}@${d.version}`)).toEqual(['@babel/core@7.24.0', 'zod@3.23.8']);
    expect(
      parseLockfile('requirements.txt', 'django==3.2.0\nrequests>=2\nflask[async]==2.0.1\n'),
    ).toEqual([
      { ecosystem: 'PyPI', name: 'django', version: '3.2.0', file: 'requirements.txt' },
      { ecosystem: 'PyPI', name: 'flask', version: '2.0.1', file: 'requirements.txt' },
    ]);
    expect(
      parseLockfile('Cargo.lock', '[[package]]\nname = "serde"\nversion = "1.0.100"\n').map(
        (d) => d.ecosystem,
      ),
    ).toEqual(['crates.io']);
  });
});

describe('port scan limits', () => {
  it('only allows the user own devices', async () => {
    expect(isPrivateIp('192.168.1.10')).toBe(true);
    expect(isPrivateIp('10.0.0.5')).toBe(true);
    expect(isPrivateIp('172.20.1.1')).toBe(true);
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
    await expect(resolveScanTargets('8.8.8.8')).rejects.toThrow(/propios equipos/);
    await expect(resolveScanTargets('192.168.0.0/16')).rejects.toThrow(/\/24/);
    await expect(resolveScanTargets('203.0.113.0/24')).rejects.toThrow(/privadas/);
    expect(await resolveScanTargets('192.168.1.0/24')).toHaveLength(254);
    expect(await resolveScanTargets('localhost')).toEqual([
      expect.stringMatching(/^(127\.0\.0\.1|::1)$/),
    ]);
    expect(['4.17.9', '4.17.21', '4.17.16'].sort(compareVersions)).toEqual([
      '4.17.9',
      '4.17.16',
      '4.17.21',
    ]);
    expect(parsePorts('22,80-82')).toEqual([22, 80, 81, 82]);
    expect(parsePorts('1-65535')).toHaveLength(2048);
  });
});
