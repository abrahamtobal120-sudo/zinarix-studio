// Zinarix Studio plans page: the Gratis / Pro / AI / Pro + AI switch (copy, app screenshot,
// features, compare column), the screenshot gallery, prices and buy links from app-config.json
// (the same switch the installed apps read) and scroll reveal. No dependencies.
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const PLAN_IDS = ['free', 'pro', 'ai', 'combo'];

const PLANS = {
  free: {
    name: 'Gratis',
    short: 'Gratis',
    badge: 'Plan gratis',
    title: 'Programa con <em>cualquier IA</em>, gratis',
    lead: 'El editor completo con el modo agente, más de 60 proveedores y modelos locales. Usas tus propias llaves y trabajas con <b><span class="free-chats">2</span> chats a la vez</b>.',
    statusPlan: 'Plan gratis',
    finalTitle: 'Empieza gratis hoy',
    shot: 'agent',
    shotCaption: 'El modo agente: edita, corre las pruebas y te muestra el resultado.',
    price: 'US$0',
    period: '',
    note: 'para siempre',
  },
  pro: {
    name: 'Pro',
    short: 'PRO',
    badge: 'Zinarix Studio Pro',
    title: 'Pon a <em>varias IAs</em> a trabajar a la vez',
    lead: 'Sin esperar a que un modelo termine: <b>chats ilimitados en paralelo</b>, <b>dos IAs lado a lado</b> para comparar y <b>varias ventanas</b>, cada una con su proyecto.',
    statusPlan: 'Pro',
    finalTitle: 'Trabaja con todas tus IAs a la vez',
    shot: 'split',
    shotCaption: 'Pro: dos chats a la par, cada uno con su agente.',
  },
  ai: {
    name: 'AI',
    short: 'AI',
    badge: 'Zinarix AI',
    title: 'Las mejores IAs, <em>sin configurar nada</em>',
    lead: 'Instala y empieza: <b>sin cuentas ni API keys</b>. Los créditos de IA vienen incluidos cada mes y Zinarix elige el modelo adecuado para cada tarea.',
    statusPlan: 'Modo AI',
    finalTitle: 'IA lista desde el primer minuto',
    shot: 'models',
    shotCaption: 'Elige entre los modelos de más de 60 proveedores.',
  },
  combo: {
    name: 'Pro + AI',
    short: 'PRO + AI',
    badge: 'Combo Pro + AI',
    title: 'Varios agentes, <em>con la IA incluida</em>',
    lead: 'Todo Pro (chats ilimitados, IAs lado a lado, varias ventanas) <b>más el modo AI</b>: créditos incluidos y sin llaves. El paquete completo, a mejor precio.',
    statusPlan: 'Pro + AI',
    finalTitle: 'Todo Zinarix Studio, en un solo plan',
    shot: 'split',
    shotCaption: 'Varios agentes a la vez, con la IA incluida.',
  },
};

// Filled from app-config.json; defaults match the HTML.
const buy = {
  free: { label: 'Descargar gratis', href: '/#descargar' },
  pro: { label: 'Obtener Pro', href: '#planes' },
  ai: { label: 'AI: muy pronto', href: '/#descargar', soon: true },
  combo: { label: 'Pro + AI: muy pronto', href: '/#descargar', soon: true },
};
const prices = {
  pro: { price: 'US$29', period: '', note: 'pago único · actualizaciones incluidas' },
  ai: { price: 'US$12', period: '/mes', note: 'créditos de IA incluidos · cancela cuando quieras' },
  combo: { price: 'US$35', period: '', note: 'Pro para siempre + 1 mes de AI · ahorras US$6' },
};

let current = 'pro';
const shotSrc = (name) => `assets/app-light-${name}.png`;

function setAll(sel, fn) {
  document.querySelectorAll(sel).forEach(fn);
}

function render(id, animate) {
  current = id;
  const p = PLANS[id];
  const pr = id === 'free' ? p : prices[id];
  const apply = () => {
    document.body.dataset.plan = id;
    setAll('[data-pick]', (b) => b.setAttribute('aria-selected', String(b.dataset.pick === id)));
    setAll('[data-text]', (e) => (e.textContent = p[e.dataset.text] ?? ''));
    setAll('[data-html]', (e) => (e.innerHTML = p[e.dataset.html] ?? ''));
    const img = document.getElementById('hero-img');
    if (!img.src.endsWith(shotSrc(p.shot))) img.src = shotSrc(p.shot);
    setAll('.cur-name', (e) => (e.textContent = p.name));
    setAll('.cur-price', (e) => (e.textContent = pr.price));
    setAll('.cur-period', (e) => (e.textContent = pr.period));
    setAll('.cur-note', (e) => (e.textContent = pr.note));
    setAll('.cta-buy', (a) => {
      const b = buy[id];
      a.href = b.href;
      a.textContent =
        b.soon || id === 'free' || a.closest('.titlebar') ? b.label : `${b.label} · ${pr.price}`;
    });
    setAll('[data-in]', (e) => {
      const on = e.dataset.in.split(' ').includes(id);
      e.classList.toggle('on', on);
      e.classList.toggle('off', !on);
    });
    setAll('[data-card]', (e) => e.classList.toggle('selected', e.dataset.card === id));
    setAll('[data-col]', (e) => e.classList.toggle('sel', e.dataset.col === id));
    if (cfgFree) setAll('.free-chats', (e) => (e.textContent = cfgFree));
    document.body.classList.remove('swapping');
  };
  if (!animate || reduceMotion) return apply();
  document.body.classList.add('swapping');
  setTimeout(apply, 120);
}

function pick(id) {
  if (!PLAN_IDS.includes(id) || id === current) return;
  history.replaceState(null, '', `?plan=${id}${location.hash}`);
  render(id, true);
}

function setupSwitch() {
  setAll('[data-pick]', (b) => b.addEventListener('click', () => pick(b.dataset.pick)));
  setAll('[data-card]', (card) =>
    card.addEventListener('click', (e) => {
      if (!e.target.closest('a')) pick(card.dataset.card);
    }),
  );
  // arrow keys move along the switch, like tabs
  document.querySelector('.switch').addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    const next = PLAN_IDS[(PLAN_IDS.indexOf(current) + d + PLAN_IDS.length) % PLAN_IDS.length];
    pick(next);
    document.querySelector(`[data-pick="${next}"]`).focus();
  });
}

const GALLERY = {
  split: 'Dos chats trabajando a la vez: uno espera tu aprobación y el otro ya terminó.',
  approval: 'Cada cambio y cada comando pasa por ti antes de ejecutarse.',
  models: 'Más de 60 proveedores y modelos locales en un solo selector.',
  usage: 'Cuánto gastas por proveedor y por día, con presupuestos.',
  plan: 'Tu plan y tu licencia, dentro de la app.',
};

function setupGallery() {
  const img = document.getElementById('gallery-img');
  const caption = document.getElementById('gallery-caption');
  const tabs = document.querySelectorAll('[data-shot]');
  const show = (name) => {
    img.src = shotSrc(name);
    caption.textContent = GALLERY[name];
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.shot === name)));
  };
  tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.shot)));
  caption.textContent = GALLERY.split;
}

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
        io.unobserve(e.target);
      }
    },
    { threshold: 0.12 },
  );
  els.forEach((e) => io.observe(e));
}

let cfgFree = '';

async function loadConfig() {
  let cfg;
  try {
    const res = await fetch('/app-config.json', { cache: 'no-store' });
    if (!res.ok) return;
    cfg = await res.json();
  } catch {
    return;
  }
  const isLink = (s) => /^https:\/\//.test(s ?? '');
  if (cfg.free?.maxChats) cfgFree = String(cfg.free.maxChats);
  if (cfg.trialDays) setAll('.trial-days', (e) => (e.textContent = String(cfg.trialDays)));

  prices.pro = {
    price: cfg.price ?? prices.pro.price,
    period: '',
    note: cfg.priceNote ?? prices.pro.note,
  };
  for (const id of ['ai', 'combo']) {
    const c = cfg[id];
    if (c) prices[id] = { price: c.price ?? '', period: c.period ?? '', note: c.priceNote ?? '' };
  }
  for (const id of ['pro', 'ai', 'combo']) {
    setAll(`.${id}-price`, (e) => (e.textContent = prices[id].price));
    setAll(`.${id}-period`, (e) => (e.textContent = prices[id].period));
    setAll(`.${id}-note`, (e) => (e.textContent = prices[id].note));
  }

  // Pro: free for everyone while billing is off; for sale with a Stripe link; else "soon"
  const note = document.getElementById('buy-note');
  if (!cfg.billing) {
    buy.pro = { label: 'Descargar con Pro gratis', href: '/#descargar', soon: true };
    note.textContent = 'Hoy Pro está incluido gratis para todos.';
  } else if (isLink(cfg.stripeLink)) {
    buy.pro = { label: 'Comprar Pro', href: cfg.stripeLink };
    note.textContent =
      'Pago seguro con Stripe. Recibes tu clave al instante y la pegas en Zinarix Studio → Plan y licencia.';
  } else {
    buy.pro = { label: 'Pro: muy pronto', href: '/#descargar', soon: true };
  }
  if (isLink(cfg.ai?.stripeLink)) buy.ai = { label: 'Obtener AI', href: cfg.ai.stripeLink };
  if (isLink(cfg.combo?.stripeLink))
    buy.combo = { label: 'Obtener Pro + AI', href: cfg.combo.stripeLink };

  setAll('[data-buy]', (a) => {
    const b = buy[a.dataset.buy];
    a.href = b.href;
    a.textContent = b.label;
  });
  render(current, false);
}

function setupNav() {
  setAll('[data-buy]', (a) => {
    const b = buy[a.dataset.buy];
    a.href = b.href;
    a.textContent = b.label;
  });
}

const fromUrl = new URLSearchParams(location.search).get('plan') ?? location.hash.slice(1);
render(PLAN_IDS.includes(fromUrl) ? fromUrl : 'pro', false);
setupNav();
setupSwitch();
setupGallery();
setupReveal();
loadConfig();
