// Permanent link of the Zinarix Studio phone remote: /p#g=<gist>&k=<key>.
// The computer writes its current tunnel address in a secret gist (the free Cloudflare
// address changes each time it opens); this page reads it and goes on to it. Everything
// travels after the #, so none of it reaches this website's server.
(() => {
  const $ = (id) => document.getElementById(id);
  const hash = new URLSearchParams(location.hash.slice(1));
  const gist = hash.get('g') || '';
  const key = hash.get('k') || '';
  const save = hash.get('save') || '';
  const say = (title, lead, busy) => {
    $('title').textContent = title;
    $('lead').textContent = lead;
    $('spin').hidden = !busy;
  };
  if (!/^[0-9a-f]{20,40}$/.test(gist) || !/^[0-9a-f]{32,}$/.test(key)) {
    say(
      'Enlace incompleto',
      'Copia otra vez el enlace de Zinarix Studio (Configuración → Celular → Desde cualquier lugar).',
      false,
    );
    return;
  }
  // The phone's pairing, for every new address of the computer (each one is a new site).
  const slot = `zx.t.${gist}`;
  if (/^[0-9a-f]{64}$/.test(save)) localStorage.setItem(slot, save);
  // Nothing secret stays in the address bar nor in the history.
  history.replaceState(null, '', location.pathname);
  const go = (url) => {
    const token = localStorage.getItem(slot) || '';
    location.replace(`${url}/#k=${key}&g=${gist}${/^[0-9a-f]{64}$/.test(token) ? `&t=${token}` : ''}`);
  };
  let timer = 0;
  const later = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(check, ms);
  };
  $('retry').onclick = () => {
    $('retry').hidden = true;
    check();
  };
  async function check() {
    say('Buscando tu computadora…', 'Abriendo Zinarix Studio en su dirección actual.', true);
    let url;
    try {
      // The query skips GitHub's cache (the address may have changed seconds ago).
      const res = await fetch(`https://api.github.com/gists/${gist}?n=${Date.now()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (res.status === 404) {
        say('Este enlace ya no existe', 'Abre en la computadora Configuración → Celular y copia el enlace nuevo.', false);
        return;
      }
      if (res.status === 403 || res.status === 429) {
        say('Demasiados intentos', 'GitHub pide esperar un momento. Lo intento solo en un minuto.', true);
        return later(60_000);
      }
      if (!res.ok) throw new Error(String(res.status));
      const file = (await res.json()).files?.['zinarix-remote.json'];
      url = JSON.parse(file?.content || '{}').url;
    } catch {
      say('Sin conexión', 'Revisa el internet del celular. Lo intento otra vez enseguida.', true);
      $('retry').hidden = false;
      return later(8000);
    }
    if (url === null || url === undefined) {
      say(
        'El control a distancia está apagado',
        'Enciéndelo en Zinarix Studio (Configuración → Celular). Esta página entra sola cuando esté listo.',
        true,
      );
      return later(10_000);
    }
    // Only a Cloudflare tunnel address: the gist can never send the phone anywhere else.
    if (typeof url !== 'string' || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(url)) {
      say('Dirección no válida', 'Apaga y enciende el control a distancia en Zinarix Studio.', false);
      return;
    }
    // Only an address that answers: Zinarix closed or reconnecting leaves the old one dead.
    let alive = false;
    try {
      alive = (await fetch(`${url}/api/alive?n=${Date.now()}`, { cache: 'no-store' })).ok;
    } catch {
      alive = false;
    }
    if (!alive) {
      say(
        'Esperando a la computadora…',
        'Zinarix Studio está cerrado, sin internet o reconectando. Esta página entra sola cuando vuelva.',
        true,
      );
      return later(5000);
    }
    go(url);
  }
  check();
})();
