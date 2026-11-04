// Zinarix Studio landing page: latest-release download links, OS detection, provider grid,
// scroll reveal, install tabs and copy buttons. No dependencies.
const REPO = 'abrahamtobal120-sudo/zinarix-studio';
const RELEASES = `https://github.com/${REPO}/releases`;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- downloads ----------
const MATCHERS = {
  'win-exe': (n) => /setup.*\.exe$/i.test(n) || (/\.exe$/i.test(n) && !/blockmap/i.test(n)),
  'win-zip': (n) => /win.*\.zip$/i.test(n) || /x64-setup\.zip$/i.test(n),
  'mac-arm64': (n) => /arm64.*\.dmg$/i.test(n),
  'mac-x64': (n) => /\.dmg$/i.test(n) && !/arm64/i.test(n),
  deb: (n) => /\.deb$/i.test(n),
  pacman: (n) => /\.pacman$/i.test(n),
  rpm: (n) => /\.rpm$/i.test(n),
  appimage: (n) => /\.AppImage$/i.test(n),
};
const OS_LABEL = {
  windows: 'Descargar para Windows',
  mac: 'Descargar para macOS',
  linux: 'Descargar para Linux',
};
const OS_BEST = { windows: 'win-exe', mac: 'mac-arm64', linux: 'deb' };

function detectOs() {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac';
  if (/Linux|X11|CrOS/i.test(ua) && !/Android/i.test(ua)) return 'linux';
  return null;
}

async function setupDownloads() {
  const os = detectOs();
  const info = document.getElementById('release-info');
  if (os) document.querySelector(`.os[data-os="${os}"]`)?.classList.add('recommended');

  let release = null;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (res.ok) release = await res.json();
  } catch {
    // offline or rate-limited: keep fallback links
  }
  const assets = release?.assets ?? [];
  for (const a of document.querySelectorAll('[data-asset]')) {
    const match = assets.find((x) => MATCHERS[a.dataset.asset]?.(x.name));
    if (match) {
      a.href = match.browser_download_url;
      a.title = `${match.name} · ${(match.size / 1048576).toFixed(0)} MB`;
    } else {
      a.href = RELEASES;
      if (release) a.classList.add('disabled');
    }
  }
  if (release) {
    const date = new Date(release.published_at).toLocaleDateString('es', { dateStyle: 'long' });
    info.textContent = `Versión ${release.tag_name.replace(/^v/, '')} · publicada el ${date} · gratis`;
  } else {
    info.innerHTML = `Instaladores en <a href="${RELEASES}">GitHub Releases</a>.`;
  }
  const best = os && document.querySelector(`[data-asset="${OS_BEST[os]}"]`);
  if (best && !best.classList.contains('disabled')) {
    const primary = document.getElementById('primary-download');
    primary.href = best.href === RELEASES ? '#descargar' : best.href;
    document.getElementById('primary-label').textContent = OS_LABEL[os];
    document.getElementById('primary-glyph').outerHTML =
      `<span class="os-logo ${os}" id="primary-glyph" aria-hidden="true"></span>`;
  }
}

// ---------- providers ----------
// [catalog id, display name]; logos live in assets/providers/<id>.svg (Lobe Icons, MIT).
const PROVIDERS = [
  ['anthropic', 'Anthropic'],
  ['openai', 'OpenAI'],
  ['google-gemini', 'Gemini'],
  ['deepseek', 'DeepSeek'],
  ['xai', 'xAI Grok'],
  ['mistral', 'Mistral'],
  ['openrouter', 'OpenRouter'],
  ['groq', 'Groq'],
  ['meta-llama', 'Meta Llama'],
  ['alibaba-qwen', 'Qwen'],
  ['moonshot', 'Kimi'],
  ['zhipu-zai', 'GLM'],
  ['ollama', 'Ollama'],
  ['lm-studio', 'LM Studio'],
  ['vllm', 'vLLM'],
  ['cerebras', 'Cerebras'],
  ['together', 'Together AI'],
  ['fireworks', 'Fireworks'],
  ['amazon-bedrock', 'Bedrock'],
  ['google-vertex', 'Vertex AI'],
  ['azure-openai', 'Azure OpenAI'],
  ['claude-code', 'Claude Code'],
  ['codex-cli', 'Codex CLI'],
  ['gemini-cli', 'Gemini CLI'],
];
const PROVIDER_TOTAL = 62;
function setupProviders() {
  const list = document.getElementById('providers');
  list.innerHTML = PROVIDERS.map(
    ([id, name]) =>
      `<li><img src="assets/providers/${id}.svg" alt="" loading="lazy" /><span>${name}</span></li>`,
  ).join('');
  document.getElementById('providers-more').textContent =
    `+ ${PROVIDER_TOTAL - PROVIDERS.length} más: Cohere, Hugging Face, NVIDIA NIM, SambaNova, Cloudflare, MiniMax…`;
}

// ---------- reveal on scroll (added from JS so the page never hides content without it) ----------
function setupReveal() {
  if (reduceMotion || !('IntersectionObserver' in window)) return;
  const els = document.querySelectorAll('.sec-head, .feature, .more, .plans, .os-grid, .term, .qa');
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    },
    { threshold: 0.08, rootMargin: '0px 0px -40px 0px' },
  );
  els.forEach((e) => {
    e.classList.add('reveal');
    io.observe(e);
  });
}

// ---------- tabs ----------
function setupTabs() {
  document.querySelectorAll('#install-tabs button').forEach((b, _i, all) => {
    b.addEventListener('click', () => {
      all.forEach((x) => {
        x.setAttribute('aria-selected', String(x === b));
        document.getElementById(x.dataset.panel).hidden = x !== b;
      });
    });
  });
  const os = detectOs();
  const preferred = { windows: 'i-win', mac: 'i-mac', linux: 'i-deb' }[os];
  if (preferred) document.querySelector(`#install-tabs [data-panel="${preferred}"]`)?.click();
}

// ---------- terminal install: OS tabs + copy buttons ----------
function setupTerminalInstall() {
  const tabs = [...document.querySelectorAll('#cli-tabs button')];
  const show = (b) =>
    tabs.forEach((x) => {
      x.setAttribute('aria-selected', String(x === b));
      document.getElementById(x.dataset.panel).hidden = x !== b;
    });
  tabs.forEach((b) => b.addEventListener('click', () => show(b)));
  const os = detectOs();
  const preferred = { windows: 'c-win', mac: 'c-mac', linux: 'c-linux' }[os];
  const tab = preferred && tabs.find((b) => b.dataset.panel === preferred);
  if (tab) show(tab);
  if (os === 'windows')
    document.getElementById('hero-cmd').textContent =
      'irm https://zinarix-studio.vercel.app/install.ps1 | iex';
  document.querySelectorAll('.cmd .copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const code = btn.parentElement.querySelector('code');
      try {
        await navigator.clipboard.writeText(code.textContent.replace(/\s+/g, ' ').trim());
      } catch {
        const r = document.createRange();
        r.selectNodeContents(code);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
      }
      btn.textContent = 'Copiado';
      btn.classList.add('done');
      setTimeout(() => {
        btn.textContent = 'Copiar';
        btn.classList.remove('done');
      }, 1600);
    });
  });
}

// ---------- sticky nav border ----------
function setupNav() {
  const nav = document.getElementById('nav');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

setupProviders();
setupReveal();
setupTabs();
setupTerminalInstall();
setupNav();
setupDownloads();

// ---------- pricing (app-config.json: the same switch the installed apps read) ----------
async function setupPricing() {
  let cfg;
  try {
    const res = await fetch('/app-config.json', { cache: 'no-store' });
    if (!res.ok) return;
    cfg = await res.json();
  } catch {
    return;
  }
  const $ = (id) => document.getElementById(id);
  if (cfg.free?.maxChats) $('free-chats').textContent = String(cfg.free.maxChats);
  if (cfg.price) $('pro-price').textContent = cfg.price;
  if (cfg.priceNote) $('pro-note').textContent = cfg.priceNote;
  if (!cfg.billing) return; // free for everyone: the page already says so
  $('pricing-title').textContent = 'Empieza gratis. Pasa a Pro cuando lo necesites.';
  $('pricing-lead').textContent =
    `Cada instalación trae ${cfg.trialDays ?? 14} días de Pro gratis. Después sigues con el plan gratis o compras Pro.`;
  const buy = $('buy-pro');
  if (/^https:\/\//.test(cfg.stripeLink ?? '')) {
    buy.href = cfg.stripeLink;
    buy.textContent = 'Comprar Pro';
    $('buy-note').textContent =
      'Pago seguro con Stripe. Recibes tu clave al instante y la pegas en Zinarix Studio → Plan y licencia.';
  } else {
    buy.textContent = 'Pro: muy pronto';
    $('buy-note').textContent = 'Las compras abren muy pronto.';
  }
}
setupPricing();
