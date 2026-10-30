// After a Stripe payment: /gracias?session_id=cs_… → /api/license → the license key.
(async () => {
  const $ = (id) => document.getElementById(id);
  const fail = (title, lead) => {
    $('t-title').textContent = title;
    $('t-lead').textContent = lead;
    $('t-help').hidden = false;
  };
  const session = new URLSearchParams(location.search).get('session_id') ?? '';
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(session)) {
    fail(
      'No encontramos tu compra',
      'Abre esta página con el enlace al que te llevó Stripe después de pagar.',
    );
    return;
  }
  let data;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`/api/license?session_id=${encodeURIComponent(session)}`, {
        cache: 'no-store',
      });
      data = await res.json();
      // The payment can take a few seconds to be confirmed.
      if (res.status !== 402) break;
    } catch {
      data = { error: 'No se pudo conectar. Revisa tu internet y recarga la página.' };
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  if (!data?.key) {
    fail('No pudimos generar tu licencia', data?.error ?? 'Intenta recargar la página.');
    return;
  }
  $('t-title').textContent = '¡Gracias! Esta es tu licencia Pro';
  $('t-lead').textContent = data.email
    ? `Licencia a nombre de ${data.email}.`
    : 'Tu pago quedó confirmado.';
  $('t-keytext').textContent = data.key;
  $('t-key').hidden = false;
  $('t-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(data.key);
      $('t-copy').textContent = 'Copiada ✓';
    } catch {
      getSelection()?.selectAllChildren($('t-keytext'));
    }
  });
})();
