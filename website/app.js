// Zinarix Studio landing page: latest-release download links, OS detection, provider
// marquee, scroll reveal, gallery/install tabs, hero tilt and card glow. No dependencies.
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
const OS_GLYPH = { windows: '⊞', mac: '', linux: '🐧' };
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
    document.getElementById('primary-glyph').textContent = OS_GLYPH[os];
  }
}

// ---------- provider marquee ----------
// [catalog id, display name]; logos live in assets/providers/<id>.svg (Lobe Icons, MIT).
const PROVIDERS = [
  ['openai', 'OpenAI'],
  ['anthropic', 'Anthropic'],
  ['google-gemini', 'Google Gemini'],
  ['deepseek', 'DeepSeek'],
  ['xai', 'xAI Grok'],
  ['mistral', 'Mistral'],
  ['meta-llama', 'Meta'],
  ['cohere', 'Cohere'],
  ['openrouter', 'OpenRouter'],
  ['groq', 'Groq'],
  ['cerebras', 'Cerebras'],
  ['together', 'Together AI'],
  ['fireworks', 'Fireworks'],
  ['deepinfra', 'DeepInfra'],
  ['huggingface-inference-providers', 'Hugging Face'],
  ['nvidia-nim', 'NVIDIA NIM'],
  ['alibaba-qwen', 'Qwen'],
  ['moonshot', 'Kimi'],
  ['zhipu-zai', 'GLM'],
  ['minimax', 'MiniMax'],
  ['siliconflow', 'SiliconFlow'],
  ['chutes', 'Chutes'],
  ['featherless', 'Featherless'],
  ['stepfun', 'StepFun'],
  ['venice', 'Venice'],
  ['byteplus-modelark', 'Doubao'],
  ['azure-openai', 'Azure OpenAI'],
  ['amazon-bedrock', 'Bedrock'],
  ['google-vertex', 'Vertex AI'],
  ['ollama', 'Ollama'],
  ['lm-studio', 'LM Studio'],
  ['vllm', 'vLLM'],
  ['nebius-token-factory', 'Nebius'],
  ['sambanova', 'SambaNova'],
  ['cloudflare-workers-ai', 'Cloudflare'],
  ['upstage', 'Upstage'],
  ['perplexity', 'Perplexity'],
  ['hyperbolic', 'Hyperbolic'],
  ['novita', 'Novita'],
];
const COLORS = [
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#059669',
  '#0891b2',
  '#4f46e5',
  '#b45309',
  '#be123c',
  '#0d9488',
];
function color(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
async function setupMarquee() {
  const track = document.getElementById('marquee');
  let withLogo = new Set();
  try {
    withLogo = new Set(await (await fetch('assets/providers/index.json')).json());
  } catch {
    // no index: initials only
  }
  const chip = ([id, name]) =>
    withLogo.has(id)
      ? `<span class="chip"><i class="logo"><img src="assets/providers/${id}.svg" alt="" loading="lazy" /></i>${name}</span>`
      : `<span class="chip"><i style="background:${color(id)}">${name
          .replace(/[^A-Za-z0-9]/g, '')
          .slice(0, 2)
          .toUpperCase()}</i>${name}</span>`;
  const html = PROVIDERS.map(chip).join('');
  track.innerHTML = html + html; // doubled for a seamless loop
}

// ---------- reveal on scroll + counters ----------
function setupReveal() {
  const els = document.querySelectorAll('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    els.forEach((e) => e.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        e.target.querySelectorAll('[data-count]').forEach(countUp);
        io.unobserve(e.target);
      }
    },
    { threshold: 0.12 },
  );
  els.forEach((e) => io.observe(e));
}
function countUp(el) {
  const end = Number(el.dataset.count);
  const suffix = el.dataset.suffix ?? '';
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / 1200);
    el.textContent = Math.round(end * (1 - Math.pow(1 - t, 3))) + suffix;
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------- tabs ----------
function setupTabs() {
  const img = document.getElementById('gallery-img');
  const caption = document.getElementById('gallery-caption');
  document.querySelectorAll('.gallery .tabs button').forEach((b, _i, all) => {
    b.addEventListener('click', () => {
      all.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      img.style.opacity = '0';
      setTimeout(() => {
        img.src = b.dataset.shot;
        caption.textContent = b.dataset.caption;
        img.onload = () => (img.style.opacity = '1');
      }, 180);
    });
  });
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

// ---------- hero tilt, sticky nav, card glow ----------
function setupMotion() {
  const nav = document.getElementById('nav');
  const win = document.getElementById('hero-window');
  const onScroll = () => {
    nav.classList.toggle('scrolled', window.scrollY > 10);
    if (!reduceMotion && win) {
      const p = Math.min(1, window.scrollY / 500);
      win.style.transform = `rotateX(${14 * (1 - p)}deg) scale(${0.96 + 0.04 * p})`;
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  document.querySelectorAll('.glow-card').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });
}

setupMarquee();
setupReveal();
setupTabs();
setupMotion();
setupDownloads();
