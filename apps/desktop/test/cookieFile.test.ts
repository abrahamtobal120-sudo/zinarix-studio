import { describe, expect, it } from 'vitest';
import { parseCookieFile } from '../src/shared/cookieFile';

const NOW = Date.UTC(2026, 10, 15);
const future = NOW / 1000 + 86_400;

describe('parseCookieFile', () => {
  it('reads a Cookie-Editor JSON export', () => {
    const r = parseCookieFile(
      JSON.stringify([
        {
          domain: '.github.com',
          name: 'logged_in',
          value: 'yes',
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'lax',
          expirationDate: future,
          hostOnly: false,
        },
        {
          domain: 'github.com',
          name: '__Host-sess',
          value: 'x',
          path: '/a',
          secure: true,
          hostOnly: true,
          session: true,
          sameSite: 'strict',
        },
        { domain: 'old.com', name: 'gone', value: '1', expirationDate: 10 },
        { name: 'nodomain', value: '1' },
      ]),
      NOW,
    );
    expect(r.skipped).toBe(2);
    expect(r.cookies[0]).toEqual({
      url: 'https://github.com/',
      name: 'logged_in',
      value: 'yes',
      domain: '.github.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expirationDate: future,
    });
    expect(r.cookies[1]).toMatchObject({ url: 'https://github.com/', path: '/', secure: true });
    expect(r.cookies[1]!.domain).toBeUndefined();
    expect(r.cookies[1]!.expirationDate).toBeUndefined();
  });

  it('reads a Playwright storage state and fixes SameSite=None without Secure', () => {
    const r = parseCookieFile(
      JSON.stringify({
        cookies: [
          {
            name: 'a',
            value: 'b',
            domain: '.x.com',
            path: '/',
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: 'None',
          },
        ],
      }),
      NOW,
    );
    expect(r.cookies).toHaveLength(1);
    expect(r.cookies[0]).toMatchObject({
      url: 'http://x.com/',
      sameSite: 'unspecified',
      domain: '.x.com',
    });
  });

  it('reads cookies.txt (Netscape) with #HttpOnly_ lines', () => {
    const txt = [
      '# Netscape HTTP Cookie File',
      `.google.com\tTRUE\t/\tTRUE\t${future}\tSID\tabc`,
      `#HttpOnly_mail.example.org\tFALSE\t/inbox\tFALSE\t0\ttok\tv\tw`,
      'garbage',
    ].join('\n');
    const r = parseCookieFile(txt, NOW);
    expect(r.skipped).toBe(1);
    expect(r.cookies[0]).toMatchObject({
      domain: '.google.com',
      secure: true,
      name: 'SID',
      value: 'abc',
    });
    expect(r.cookies[1]).toMatchObject({
      url: 'http://mail.example.org/inbox',
      httpOnly: true,
      value: 'v\tw',
    });
    expect(r.cookies[1]!.domain).toBeUndefined();
  });

  it('refuses files that are not cookie exports', () => {
    expect(() => parseCookieFile('{"hello": 1}', NOW)).toThrow('not-cookies');
    expect(() => parseCookieFile('{bad json', NOW)).toThrow('not-cookies');
    expect(() => parseCookieFile('', NOW)).toThrow('not-cookies');
  });
});
