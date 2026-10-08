import { useEffect, useMemo, useRef, useState } from 'react';
import type { AiRole, ProviderView } from '../../shared/api';
import { t } from '../i18n';
import { api, refreshModels, refreshSettings, setState, toast, useStore } from '../store';
import { ProviderLogo } from './ProviderLogo';
import { fuzzy } from './QuickPick';

interface Row {
  ref: string;
  provider: string;
  providerName: string;
  id: string;
  label: string;
  context: number | null;
  inputPrice: number | null;
  outputPrice: number | null;
  tools: boolean | null;
  vision: boolean | null;
  reasoning: boolean | null;
  connected: boolean;
  local: boolean;
}

type Filter = 'fav' | 'tools' | 'vision' | 'reasoning' | 'local' | 'cheap' | 'long' | 'connected';
type Sort = 'recommended' | 'price' | 'context' | 'name';

const FAV_KEY = 'zs.favorites';
const RECENT_KEY = 'zs.recent';

function load(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function save(key: string, v: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // storage unavailable: preferences are a convenience
  }
}
export function pushRecent(ref: string): void {
  save(RECENT_KEY, [ref, ...load(RECENT_KEY).filter((r) => r !== ref)].slice(0, 8));
}

function fmtCtx(n: number | null): string {
  if (!n) return '—';
  return n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(2)}M` : `${Math.round(n / 1000)}k`;
}

function fmtPrice(n: number | null): string {
  if (n === null) return '—';
  if (n === 0) return t('free');
  return `$${n < 1 ? +n.toFixed(3) : +n.toFixed(2)}`;
}

/** Flagship-first ordering when the user has not chosen a sort. */
function score(r: Row, favs: Set<string>, recent: string[]): number {
  let s = 0;
  if (favs.has(r.ref)) s += 1000;
  const ri = recent.indexOf(r.ref);
  if (ri >= 0) s += 500 - ri * 10;
  if (r.connected) s += 300;
  if (r.tools) s += 20;
  if (r.reasoning) s += 10;
  if (r.context) s += Math.min(30, r.context / 50_000);
  return s;
}

const ROLE_LABEL: Record<AiRole, () => string> = {
  chat: () => t('roleChat'),
  agent: () => t('roleAgent'),
  inline: () => t('roleInline'),
};

export function ModelPicker({ role: initialRole = 'chat' }: { role?: AiRole }) {
  const models = useStore((s) => s.models);
  const errors = useStore((s) => s.modelErrors);
  const settings = useStore((s) => s.settings);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [role, setRole] = useState<AiRole>(initialRole);
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<string | null>(null);
  const [filters, setFilters] = useState<Set<Filter>>(new Set());
  const [sort, setSort] = useState<Sort>('recommended');
  const [favs, setFavs] = useState<Set<string>>(() => new Set(load(FAV_KEY)));
  const [recent] = useState<string[]>(() => load(RECENT_KEY));
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const close = () => setState({ modal: null });

  useEffect(() => {
    void api().ai.providers().then(setProviders);
    setLoading(true);
    void refreshModels()
      .then(() => api().ai.providers().then(setProviders))
      .finally(() => setLoading(false));
  }, []);

  const current = role === 'chat' ? settings.defaultModel : (settings.roles[role] ?? null);
  const effective = current ?? settings.defaultModel;

  const rows = useMemo<Row[]>(() => {
    const byProvider = new Map(providers.map((p) => [p.id, p]));
    const out = new Map<string, Row>();
    for (const m of models) {
      const p = byProvider.get(m.provider);
      out.set(`${m.provider}/${m.id}`, {
        ref: `${m.provider}/${m.id}`,
        provider: m.provider,
        providerName: p?.name ?? m.provider,
        id: m.id,
        label: m.label ?? m.id,
        context: m.context,
        inputPrice: m.inputPrice,
        outputPrice: m.outputPrice,
        tools: m.capabilities.tools,
        vision: m.capabilities.vision,
        reasoning: m.capabilities.reasoning,
        connected: true,
        local: p?.local ?? false,
      });
    }
    for (const p of providers) {
      if (p.status === 'deprecated' || !p.implemented) continue;
      for (const m of p.models) {
        const ref = `${p.id}/${m.id}`;
        if (out.has(ref)) continue;
        out.set(ref, {
          ref,
          provider: p.id,
          providerName: p.name,
          id: m.id,
          label: m.label ?? m.id,
          context: m.context ?? null,
          inputPrice: m.inputPrice ?? null,
          outputPrice: m.outputPrice ?? null,
          tools: m.tools ?? null,
          vision: m.vision ?? null,
          reasoning: m.reasoning ?? null,
          connected: p.connected,
          local: p.local,
        });
      }
    }
    return [...out.values()];
  }, [models, providers]);

  const shown = useMemo(() => {
    const q = query.trim();
    let r = rows.filter(
      (x) =>
        (!filters.has('fav') || favs.has(x.ref)) &&
        (!filters.has('tools') || x.tools === true) &&
        (!filters.has('vision') || x.vision === true) &&
        (!filters.has('reasoning') || x.reasoning === true) &&
        (!filters.has('local') || x.local) &&
        (!filters.has('cheap') || (x.inputPrice !== null && x.inputPrice <= 1) || x.local) &&
        (!filters.has('long') || (x.context ?? 0) >= 200_000) &&
        (!filters.has('connected') || x.connected),
    );
    if (q) {
      r = r
        .map((x) => ({
          x,
          s: Math.max(fuzzy(q, x.label), fuzzy(q, x.id), fuzzy(q, x.providerName) - 100),
        }))
        .filter((y) => y.s >= 0)
        .sort((a, b) => b.s - a.s)
        .map((y) => y.x);
    } else {
      const price = (x: Row) => (x.local ? -1 : (x.inputPrice ?? Number.POSITIVE_INFINITY));
      r = [...r].sort((a, b) => {
        switch (sort) {
          case 'price':
            return price(a) - price(b);
          case 'context':
            return (b.context ?? 0) - (a.context ?? 0);
          case 'name':
            return a.label.localeCompare(b.label);
          default:
            return (
              score(b, favs, recent) - score(a, favs, recent) ||
              a.providerName.localeCompare(b.providerName)
            );
        }
      });
    }
    return r;
  }, [rows, query, provider, filters, favs, sort, recent]);

  /** Providers view: shown until the user opens a provider or types a search. */
  const gridMode = provider === null && !query.trim() && !filters.has('fav');

  const providerCards = useMemo(() => {
    const byProvider = new Map<string, Row[]>();
    for (const x of shown) byProvider.set(x.provider, [...(byProvider.get(x.provider) ?? []), x]);
    return [...byProvider.entries()]
      .map(([id, list]) => {
        const p = providers.find((x) => x.id === id);
        const prices = list.map((x) => x.inputPrice).filter((n): n is number => n !== null);
        return {
          id,
          name: p?.name ?? id,
          connected: p?.connected ?? false,
          local: p?.local ?? false,
          category: p?.category ?? '',
          count: list.length,
          minPrice: prices.length ? Math.min(...prices) : null,
          maxContext: Math.max(0, ...list.map((x) => x.context ?? 0)) || null,
          inUse: list.some((x) => x.ref === effective),
        };
      })
      .sort(
        (a, b) =>
          Number(b.inUse) - Number(a.inUse) ||
          Number(b.connected) - Number(a.connected) ||
          b.count - a.count ||
          a.name.localeCompare(b.name),
      );
  }, [shown, providers, effective]);

  const visible = provider ? shown.filter((x) => x.provider === provider) : shown;
  const openProvider = providers.find((p) => p.id === provider);

  useEffect(() => setIndex(0), [query, provider, filters, sort]);
  useEffect(() => {
    list.current?.querySelector('.mp-row.active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const toggleFilter = (f: Filter) =>
    setFilters((s) => {
      const n = new Set(s);
      if (n.has(f)) n.delete(f);
      else n.add(f);
      return n;
    });

  const toggleFav = (ref: string) =>
    setFavs((s) => {
      const n = new Set(s);
      if (n.has(ref)) n.delete(ref);
      else n.add(ref);
      save(FAV_KEY, [...n]);
      return n;
    });

  const choose = async (r: Row) => {
    if (!r.connected) {
      setState({ modal: { kind: 'providers', focus: r.provider } });
      return;
    }
    if (role === 'chat') await api().ai.setDefaultModel(r.ref);
    else await api().ai.setRole(role, r.ref);
    pushRecent(r.ref);
    await refreshSettings();
    toast(`${ROLE_LABEL[role]()}: ${r.label}`);
    close();
  };

  const refresh = async () => {
    setLoading(true);
    try {
      await refreshModels(true);
      setProviders(await api().ai.providers());
    } finally {
      setLoading(false);
    }
  };

  const chip = (f: Filter, label: string) => (
    <button className={`mp-chip ${filters.has(f) ? 'on' : ''}`} onClick={() => toggleFilter(f)}>
      {label}
    </button>
  );

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="model-picker" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mp-head">
          <div className="mp-title">
            <img src="./logo.svg" alt="" />
            {t('pickModel')}
          </div>
          <div className="mp-roles" role="tablist">
            {(['chat', 'agent', 'inline'] as AiRole[]).map((r) => (
              <button
                key={r}
                role="tab"
                aria-selected={role === r}
                className={`mp-role ${role === r ? 'on' : ''}`}
                onClick={() => setRole(r)}
              >
                {ROLE_LABEL[r]()}
                <span className="mp-role-model">
                  {r === 'chat'
                    ? (settings.defaultModel ?? t('noModel'))
                    : (settings.roles[r] ?? t('sameAsChat'))}
                </span>
              </button>
            ))}
          </div>
          <button className="modal-x" onClick={close} aria-label="Cerrar">
            ×
          </button>
        </div>

        <div className="mp-toolbar">
          <input
            autoFocus
            className="mp-search"
            value={query}
            placeholder={t('searchModels', { n: rows.length })}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              const max = (gridMode ? providerCards.length : visible.length) - 1;
              if (e.key === 'Escape') {
                if (provider) setProvider(null);
                else close();
              } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, max));
              } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                if (gridMode && providerCards[index]) setProvider(providerCards[index]!.id);
                else if (!gridMode && visible[index]) void choose(visible[index]!);
              }
            }}
          />
          <select
            className="mp-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            title={t('sortBy')}
          >
            <option value="recommended">{t('sortRecommended')}</option>
            <option value="price">{t('sortPrice')}</option>
            <option value="context">{t('sortContext')}</option>
            <option value="name">{t('sortName')}</option>
          </select>
          <button onClick={() => void refresh()} disabled={loading} title={t('refreshModels')}>
            {loading ? '…' : '⟳'}
          </button>
        </div>
        <div className="mp-chips">
          {chip('connected', `✓ ${t('fConnected')}`)}
          {chip('fav', `★ ${t('fFavorites')}`)}
          {chip('tools', `🛠 ${t('fTools')}`)}
          {chip('vision', `👁 ${t('fVision')}`)}
          {chip('reasoning', `🧠 ${t('fReasoning')}`)}
          {chip('long', `📚 ≥200k`)}
          {chip('cheap', `💲 ${t('fCheap')}`)}
          {chip('local', `🏠 ${t('fLocal')}`)}
          {role !== 'chat' && settings.roles[role] && (
            <button
              className="mp-chip reset"
              onClick={async () => {
                await api().ai.setRole(role, null);
                await refreshSettings();
              }}
            >
              ↺ {t('sameAsChat')}
            </button>
          )}
        </div>

        <div className="mp-body">
          {gridMode ? (
            <div className="mp-grid" ref={list}>
              {providerCards.map((p, i) => (
                <button
                  key={p.id}
                  className={`mp-card ${i === index ? 'active' : ''} ${p.connected ? 'connected' : ''} ${p.inUse ? 'in-use' : ''}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => setProvider(p.id)}
                >
                  <ProviderLogo id={p.id} name={p.name} size={44} />
                  <span className="mp-card-body">
                    <span className="mp-card-name">{p.name}</span>
                    <span className="mp-card-meta">
                      {t('nModels', { n: p.count })}
                      {p.maxContext ? ` · ${t('upTo')} ${fmtCtx(p.maxContext)}` : ''}
                      {p.local
                        ? ` · ${t('free')}`
                        : p.minPrice !== null
                          ? ` · ${t('from')} ${fmtPrice(p.minPrice)}`
                          : ''}
                    </span>
                    <span className="mp-card-status">
                      {p.inUse && <span className="mp-badge cur">{t('inUse')}</span>}
                      {p.local && <span className="mp-badge local">{t('fLocal')}</span>}
                      {p.connected ? (
                        <span className="mp-ok">● {t('connected')}</span>
                      ) : (
                        <span className="dim">○ {t('notConnected')}</span>
                      )}
                    </span>
                  </span>
                  <span className="mp-card-go">›</span>
                </button>
              ))}
              <button
                className="mp-card add"
                onClick={() => setState({ modal: { kind: 'providers' } })}
              >
                <span className="mp-avatar add">＋</span>
                <span className="mp-card-body">
                  <span className="mp-card-name">{t('connectProvider')}</span>
                  <span className="mp-card-meta">{t('allProvidersHint')}</span>
                </span>
              </button>
              {providerCards.length === 0 && (
                <div className="mp-empty">{loading ? '…' : t('noMatches')}</div>
              )}
            </div>
          ) : (
            <div className="mp-list" ref={list}>
              {provider && (
                <div className="mp-crumb">
                  <button onClick={() => setProvider(null)}>← {t('providersTitle')}</button>
                  <ProviderLogo id={provider} name={openProvider?.name} size={30} />
                  <span className="mp-crumb-name">{openProvider?.name ?? provider}</span>
                  <span className="dim">{t('nModels', { n: visible.length })}</span>
                  <span className="spacer" />
                  {openProvider && !openProvider.connected && (
                    <button
                      className="primary"
                      onClick={() =>
                        setState({ modal: { kind: 'providers', focus: openProvider.id } })
                      }
                    >
                      🔑 {t('connect')} {openProvider.name}
                    </button>
                  )}
                </div>
              )}
              <div className="mp-row mp-header">
                <span />
                <span>{t('model')}</span>
                <span className="num">{t('context')}</span>
                <span className="num">{t('priceIn')}</span>
                <span className="num">{t('priceOut')}</span>
                <span>{t('capabilities')}</span>
                <span />
              </div>
              {visible.map((r, i) => (
                <div
                  key={r.ref}
                  className={`mp-row ${i === index ? 'active' : ''} ${r.ref === effective ? 'current' : ''} ${r.connected ? '' : 'locked'}`}
                  onMouseEnter={() => setIndex(i)}
                  onDoubleClick={() => void choose(r)}
                >
                  <button
                    className={`mp-star ${favs.has(r.ref) ? 'on' : ''}`}
                    onClick={() => toggleFav(r.ref)}
                    title={t('fFavorites')}
                  >
                    {favs.has(r.ref) ? '★' : '☆'}
                  </button>
                  <span className="mp-name-row">
                    <ProviderLogo id={r.provider} name={r.providerName} size={26} />
                    <span className="mp-name">
                      <span className="mp-label">
                        {r.label}
                        {r.ref === effective && <span className="mp-badge cur">{t('inUse')}</span>}
                        {r.local && <span className="mp-badge local">{t('fLocal')}</span>}
                      </span>
                      <span className="mp-id">
                        {r.providerName} · {r.id}
                      </span>
                    </span>
                  </span>
                  <span className="num">{fmtCtx(r.context)}</span>
                  <span className="num">{r.local ? t('free') : fmtPrice(r.inputPrice)}</span>
                  <span className="num">{r.local ? t('free') : fmtPrice(r.outputPrice)}</span>
                  <span className="mp-caps">
                    <span className={r.tools ? '' : 'off'} title={t('fTools')}>
                      🛠
                    </span>
                    <span className={r.vision ? '' : 'off'} title={t('fVision')}>
                      👁
                    </span>
                    <span className={r.reasoning ? '' : 'off'} title={t('fReasoning')}>
                      🧠
                    </span>
                  </span>
                  <button
                    className={r.connected ? 'primary mp-use' : 'mp-use'}
                    onClick={() => void choose(r)}
                  >
                    {r.connected ? t('use') : `🔑 ${t('connect')}`}
                  </button>
                </div>
              ))}
              {visible.length === 0 && (
                <div className="mp-empty">{loading ? '…' : t('noMatches')}</div>
              )}
            </div>
          )}
        </div>

        <div className="mp-foot">
          <span className="dim">
            {t('pricesNote')}
            {errors.length > 0 && ' · '}
          </span>
          {errors.map((e) => (
            <span key={e.provider} className="err" title={e.error}>
              ⚠ {e.provider}
            </span>
          ))}
          <span className="spacer" />
          <span className="dim">↑↓ Enter · {t('doubleClick')}</span>
        </div>
      </div>
    </div>
  );
}
