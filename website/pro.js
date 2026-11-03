// Zinarix Studio Pro sales page: price, trial and buy link from app-config.json (the same
// switch the installed apps read), scroll reveal, sticky nav and card glow. No dependencies.
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

function setupMotion() {
  const nav = document.getElementById('nav');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 10);
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

async function setupPricing() {
  let cfg;
  try {
    const res = await fetch('/app-config.json', { cache: 'no-store' });
    if (!res.ok) return;
    cfg = await res.json();
  } catch {
    return;
  }
  const setAll = (sel, text) =>
    document.querySelectorAll(sel).forEach((e) => (e.textContent = text));
  if (cfg.free?.maxChats) setAll('.free-chats', String(cfg.free.maxChats));
  if (cfg.price) setAll('.pro-price', cfg.price);
  if (cfg.priceNote) setAll('.pro-note', cfg.priceNote);
  if (cfg.trialDays) setAll('.trial-days', String(cfg.trialDays));
  if (!cfg.billing) {
    // free for everyone: no price on the hero button, send people to the download
    const hero = document.getElementById('buy-hero');
    hero.textContent = 'Descargar con Pro gratis';
    hero.href = '/#descargar';
    return;
  }
  const buy = document.getElementById('buy-main');
  const note = document.getElementById('buy-note');
  if (/^https:\/\//.test(cfg.stripeLink ?? '')) {
    buy.href = cfg.stripeLink;
    buy.textContent = `Comprar Pro · ${cfg.price ?? ''}`.trim();
    note.textContent =
      'Pago seguro con Stripe. Recibes tu clave al instante y la pegas en Zinarix Studio → Plan y licencia.';
  } else {
    buy.textContent = 'Pro: muy pronto';
    buy.href = '/#descargar';
    note.textContent = 'Las compras abren muy pronto. Mientras, descarga y prueba Pro gratis.';
  }
}

setupReveal();
setupMotion();
setupPricing();
