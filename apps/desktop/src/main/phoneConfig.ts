/**
 * The phone page's "Configuración" screen: Zinarix's own settings (models per task, local
 * only, theme, interface size, editor, AI in the editor, background tasks, spending and
 * budgets). phonePage.ts inlines it; the server side is /api/config in phone.ts and the
 * settings themselves are applied by main.ts exactly as the Settings screen of the PC does.
 *
 * Same rules as phoneTools.ts: String.raw, no backticks and no "dollar + brace" in here, and
 * everything from the computer goes in through textContent / option.text.
 */

export const CONFIG_TEXT = {
  es: {
    appConfig: 'Configuración de Zinarix',
    cfgSummary: 'Resumen',
    cfgVersion: 'Versión',
    cfgToday: 'Gasto de hoy',
    cfgMonth: 'Gasto del mes',
    cfgProviders: 'Proveedores conectados',
    cfgModels: 'Modelos por tarea',
    cfgDefault: 'Predeterminado (todo lo demás)',
    cfgChat: 'Chat',
    cfgAgent: 'Agente',
    cfgInline: 'Edición en línea (Ctrl+K)',
    cfgUseDefault: 'Usar el predeterminado',
    cfgNone: 'Sin elegir',
    cfgPrivacy: 'Privacidad',
    cfgLocal: 'Solo modelos locales (100 % local, nada sale de la PC)',
    cfgLocalOn:
      '¿Usar solo modelos locales? Los modelos de internet dejan de contestar hasta que lo apagues.',
    cfgLook: 'Apariencia',
    cfgTheme: 'Tema',
    cfgZoom: 'Tamaño de la interfaz',
    cfgEffects: 'Efectos de ventana (Mica / transparencia)',
    cfgEditor: 'Editor',
    cfgFont: 'Tamaño de letra',
    cfgTab: 'Espacios por tabulación',
    cfgWrap: 'Ajustar líneas largas',
    cfgMinimap: 'Minimapa',
    cfgLines: 'Números de línea',
    cfgFormat: 'Formatear al guardar',
    cfgAutosave: 'Guardado automático',
    cfgAiEditor: 'IA en el editor',
    cfgInlineC: 'Sugerencias mientras escribes (gasta tokens)',
    cfgNext: 'Predecir la siguiente edición (Tab)',
    cfgImport: 'Agregar imports que falten',
    cfgRules: 'Mandar las reglas del proyecto (AGENTS.md) a la IA',
    cfgLsp: 'Servidores de lenguaje (ir a definición, errores)',
    cfgHelper: 'Botón "Ayuda de Zinarix"',
    cfgTasks: 'Tareas en segundo plano a la vez',
    cfgSpend: 'Gasto y presupuestos',
    cfgNoSpend: 'Todavía no hay gasto este mes.',
    cfgReq: 'peticiones',
    cfgTodayShort: 'hoy',
    cfgDaily: 'Diario $',
    cfgMonthly: 'Mensual $',
    cfgBudgetFor: 'Presupuesto para',
    cfgBudgetHint: 'Zinarix avisa al llegar al 80 %. Deja los dos vacíos para quitarlo.',
    cfgSaveBudget: 'Guardar presupuesto',
    cfgSaved: 'Guardado en la computadora',
    cfgPcOnly: 'Las claves de API, atajos y fuentes solo se cambian en la computadora.',
    cfgReload: 'Actualizar',
  },
  en: {
    appConfig: 'Zinarix settings',
    cfgSummary: 'Summary',
    cfgVersion: 'Version',
    cfgToday: 'Spent today',
    cfgMonth: 'Spent this month',
    cfgProviders: 'Connected providers',
    cfgModels: 'Models per task',
    cfgDefault: 'Default (everything else)',
    cfgChat: 'Chat',
    cfgAgent: 'Agent',
    cfgInline: 'Inline edit (Ctrl+K)',
    cfgUseDefault: 'Use the default',
    cfgNone: 'Not chosen',
    cfgPrivacy: 'Privacy',
    cfgLocal: 'Local models only (100 % local, nothing leaves the PC)',
    cfgLocalOn: 'Use local models only? Internet models stop answering until you turn it off.',
    cfgLook: 'Appearance',
    cfgTheme: 'Theme',
    cfgZoom: 'Interface size',
    cfgEffects: 'Window effects (Mica / transparency)',
    cfgEditor: 'Editor',
    cfgFont: 'Font size',
    cfgTab: 'Spaces per tab',
    cfgWrap: 'Wrap long lines',
    cfgMinimap: 'Minimap',
    cfgLines: 'Line numbers',
    cfgFormat: 'Format on save',
    cfgAutosave: 'Auto save',
    cfgAiEditor: 'AI in the editor',
    cfgInlineC: 'Suggestions while typing (uses tokens)',
    cfgNext: 'Predict the next edit (Tab)',
    cfgImport: 'Add missing imports',
    cfgRules: 'Send the project rules (AGENTS.md) to the AI',
    cfgLsp: 'Language servers (go to definition, errors)',
    cfgHelper: '"Zinarix help" button',
    cfgTasks: 'Background tasks at the same time',
    cfgSpend: 'Spending and budgets',
    cfgNoSpend: 'No spending this month yet.',
    cfgReq: 'requests',
    cfgTodayShort: 'today',
    cfgDaily: 'Daily $',
    cfgMonthly: 'Monthly $',
    cfgBudgetFor: 'Budget for',
    cfgBudgetHint: 'Zinarix warns at 80 %. Leave both empty to remove it.',
    cfgSaveBudget: 'Save budget',
    cfgSaved: 'Saved on the computer',
    cfgPcOnly: 'API keys, shortcuts and fonts are only changed on the computer.',
    cfgReload: 'Refresh',
  },
} as const;

export const CONFIG_ICONS = String.raw`
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
`;

export const CONFIG_CSS = String.raw`
/* Zinarix settings */
.cstats{flex:none;display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.cstat{border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:var(--bg-2);display:flex;flex-direction:column;gap:2px}
.cstat small{color:var(--fg-dim);font-size:11.5px}
.cstat b{color:var(--strong);font-size:17px;font-weight:600}
.cfield{flex:none;display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg-2)}
.cfield > span{font-size:13.5px;color:var(--strong)}
.cfield select,.cfield input{width:100%;padding:9px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg);color:var(--fg);outline:0;font-size:14px}
.cfield select:focus,.cfield input:focus{border-color:var(--focus)}
.ctheme{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.ctheme button{padding:9px 4px;font-size:12px;text-transform:capitalize}
.ctheme button.on,.cstep button.on{background:var(--sel-soft);box-shadow:inset 0 0 0 1px var(--brand);color:var(--strong)}
.cstep{display:flex;align-items:center;gap:8px}
.cstep button{min-width:44px;padding:8px 10px}
.cstep b{flex:1;text-align:center;color:var(--strong)}
.cspend{flex:none;display:flex;flex-direction:column;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--bg-2)}
.cspend > div{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--border);font-size:13.5px}
.cspend > div:last-child{border-bottom:0}
.cspend span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cspend small{color:var(--fg-dim)}
.cspend b{color:var(--strong)}
.cbud{display:flex;gap:6px}
.cbud input{flex:1;min-width:0}
`;

export const CONFIG_JS = String.raw`
// ---------------- Zinarix settings (Configuración) ----------------
function money(n) { return '$' + (n || 0).toFixed(n && n < 1 ? 3 : 2); }
async function openConfig() {
  mview = 'config';
  const box = openM(L.appConfig);
  const wait = el('p', 'hint', L.loading);
  box.append(wait);
  let c, ms;
  try {
    [c, ms] = await Promise.all([
      apiGet('/api/config'),
      apiGet('/api/models').catch(() => ({ models: [] })),
    ]);
  } catch (x) { wait.className = 'errmsg'; wait.textContent = x.message; return; }
  if (mview !== 'config') return;
  wait.remove();
  const scrollY = box.scrollTop;
  const status = el('div', 'hint');
  async function save(patch, then) {
    status.className = 'hint';
    status.textContent = L.loading;
    try {
      c = await apiPost('/api/config', patch);
      status.className = 'okmsg';
      status.textContent = L.cfgSaved;
      setTimeout(() => { if (status.className === 'okmsg') status.textContent = ''; }, 2000);
      if (then) then(c);
    } catch (x) { status.className = 'errmsg'; status.textContent = x.message; }
  }
  function toggle(label, on, onChange) {
    const r = el('div', 'row');
    const k = el('input');
    k.type = 'checkbox';
    k.id = 'c-' + Math.random().toString(36).slice(2);
    k.checked = !!on;
    const l = el('label', '', label);
    l.htmlFor = k.id;
    k.onchange = () => { if (onChange(k.checked) === false) k.checked = !k.checked; };
    r.append(k, l);
    return r;
  }
  function pref(label, key) {
    return toggle(label, c.prefs[key], (on) => { const p = {}; p[key] = on; save({ prefs: p }); });
  }
  function stepper(label, value, list, onPick, fmt) {
    const f = el('div', 'cfield');
    f.append(el('span', '', label));
    const row = el('div', 'cstep');
    let i = Math.max(0, list.indexOf(value));
    const show = el('b', '', fmt ? fmt(list[i]) : String(list[i]));
    const go = (d) => {
      const n = Math.min(list.length - 1, Math.max(0, i + d));
      if (n === i) return;
      i = n;
      show.textContent = fmt ? fmt(list[i]) : String(list[i]);
      onPick(list[i]);
    };
    row.append(btn('−', '', () => go(-1)), show, btn('+', '', () => go(1)));
    f.append(row);
    return f;
  }
  function modelSelect(label, value, emptyText, onPick) {
    const f = el('div', 'cfield');
    f.append(el('span', '', label));
    const s = el('select');
    const none = el('option', '', emptyText);
    none.value = '';
    s.append(none);
    const groups = {};
    for (const m of ms.models || []) {
      let g = groups[m.provider];
      if (!g) { g = groups[m.provider] = el('optgroup'); g.label = m.provider; s.append(g); }
      const o = el('option', '', (m.label || m.ref) + (m.local ? ' · local' : ''));
      o.value = m.ref;
      g.append(o);
    }
    if (value && !(ms.models || []).some((m) => m.ref === value)) {
      const o = el('option', '', value);
      o.value = value;
      s.append(o);
    }
    s.value = value || '';
    s.onchange = () => onPick(s.value || null);
    f.append(s);
    return f;
  }

  // Summary
  box.append(el('div', 'stitle', L.cfgSummary));
  const st = el('div', 'cstats');
  const stat = (k, v) => { const d = el('div', 'cstat'); d.append(el('small', '', k), el('b', '', v)); st.append(d); };
  stat(L.cfgToday, money(c.usage.todayUsd));
  stat(L.cfgMonth, money(c.usage.monthUsd));
  stat(L.cfgProviders, String(c.providers.length));
  stat(L.cfgVersion, c.version);
  box.append(st);

  // Models per task
  box.append(el('div', 'stitle', L.cfgModels));
  box.append(modelSelect(L.cfgDefault, c.defaultModel, L.cfgNone, (ref) => {
    if (ref) save({ defaultModel: ref });
  }));
  for (const [role, label] of [['chat', L.cfgChat], ['agent', L.cfgAgent], ['inline', L.cfgInline]]) {
    box.append(modelSelect(label, c.roles[role], L.cfgUseDefault, (ref) => save({ role: { role, ref } })));
  }

  // Privacy
  box.append(el('div', 'stitle', L.cfgPrivacy));
  box.append(toggle(L.cfgLocal, c.localOnly, (on) => {
    if (on && !confirm(L.cfgLocalOn)) return false;
    save({ localOnly: on });
  }));

  // Appearance
  box.append(el('div', 'stitle', L.cfgLook));
  const tf = el('div', 'cfield');
  tf.append(el('span', '', L.cfgTheme));
  const tg = el('div', 'ctheme');
  for (const id of c.themes) {
    const b = btn(id.replace('-', ' '), id === c.theme ? 'on' : '', () => {
      for (const x of tg.children) x.classList.toggle('on', x === b);
      save({ theme: id });
    });
    tg.append(b);
  }
  tf.append(tg);
  box.append(tf);
  box.append(stepper(L.cfgZoom, c.prefs.uiZoom, c.zoomSteps, (v) => save({ prefs: { uiZoom: v } }), (v) => v + ' %'));
  box.append(pref(L.cfgEffects, 'windowEffects'));

  // Editor
  box.append(el('div', 'stitle', L.cfgEditor));
  const sizes = [];
  for (let n = 8; n <= 40; n++) sizes.push(n);
  box.append(stepper(L.cfgFont, c.prefs.fontSize, sizes, (v) => save({ prefs: { fontSize: v } }), (v) => v + ' px'));
  box.append(stepper(L.cfgTab, c.prefs.tabSize, [1, 2, 3, 4, 6, 8], (v) => save({ prefs: { tabSize: v } })));
  box.append(pref(L.cfgWrap, 'wordWrap'));
  box.append(pref(L.cfgMinimap, 'minimap'));
  box.append(pref(L.cfgLines, 'lineNumbers'));
  box.append(pref(L.cfgFormat, 'formatOnSave'));
  box.append(pref(L.cfgAutosave, 'autoSave'));

  // AI in the editor
  box.append(el('div', 'stitle', L.cfgAiEditor));
  box.append(pref(L.cfgInlineC, 'inlineCompletions'));
  box.append(pref(L.cfgNext, 'nextEdit'));
  box.append(pref(L.cfgImport, 'autoImport'));
  box.append(pref(L.cfgRules, 'projectRules'));
  box.append(pref(L.cfgLsp, 'lsp'));
  box.append(pref(L.cfgHelper, 'helperBubble'));
  box.append(stepper(L.cfgTasks, c.prefs.taskParallel, [1, 2, 3, 4, 5, 6, 7, 8], (v) => save({ prefs: { taskParallel: v } })));

  // Spending and budgets
  box.append(el('div', 'stitle', L.cfgSpend));
  const rows = c.usage.month.filter((r) => r.costUsd > 0 || r.requests > 0);
  if (!rows.length) box.append(el('p', 'hint', L.cfgNoSpend));
  else {
    const list = el('div', 'cspend');
    for (const r of rows.sort((a, b) => b.costUsd - a.costUsd)) {
      const t = c.usage.today.find((x) => x.provider === r.provider);
      const d = el('div');
      d.append(el('span', '', r.name), el('small', '', r.requests + ' ' + L.cfgReq + (t ? ' · ' + money(t.costUsd) + ' ' + L.cfgTodayShort : '')), el('b', '', money(r.costUsd)));
      list.append(d);
    }
    box.append(list);
  }
  const bf = el('div', 'cfield');
  bf.append(el('span', '', L.cfgBudgetFor));
  const ps = el('select');
  const ids = [];
  for (const p of c.providers) ids.push([p.id, p.name]);
  for (const r of c.usage.month) if (!ids.some((x) => x[0] === r.provider)) ids.push([r.provider, r.name]);
  for (const [id, name] of ids) { const o = el('option', '', name); o.value = id; ps.append(o); }
  const bd = el('div', 'cbud');
  const day = el('input');
  const mon = el('input');
  for (const [i, ph] of [[day, L.cfgDaily], [mon, L.cfgMonthly]]) { i.type = 'number'; i.min = '0'; i.step = '0.5'; i.inputMode = 'decimal'; i.placeholder = ph; }
  const fill = () => {
    const b = c.usage.budgets[ps.value] || {};
    day.value = b.daily != null ? String(b.daily) : '';
    mon.value = b.monthly != null ? String(b.monthly) : '';
  };
  ps.onchange = fill;
  fill();
  bd.append(day, mon);
  const num = (i) => { const n = parseFloat(i.value); return isFinite(n) && n > 0 ? n : undefined; };
  bf.append(ps, bd, el('small', 'hint', L.cfgBudgetHint), btn(L.cfgSaveBudget, 'primary', () => {
    if (!ps.value) return;
    save({ budget: { provider: ps.value, daily: num(day), monthly: num(mon) } });
  }));
  if (ids.length) box.append(bf);

  box.append(el('p', 'hint', L.cfgPcOnly));
  box.append(btn(L.cfgReload, '', () => openConfig()));
  // The result of each change stays in view at the bottom of the screen.
  status.style.position = 'sticky';
  status.style.bottom = '0';
  status.style.background = 'var(--bg)';
  status.style.padding = '4px 0';
  box.append(status);
  box.scrollTop = scrollY;
}
`;
