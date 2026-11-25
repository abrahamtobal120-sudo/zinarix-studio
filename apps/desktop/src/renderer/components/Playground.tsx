/* Fase 9 — Playground de modelos (un modelo o 2–4 lado a lado), plantillas versionadas,
   "Obtener código" y Build. Lives in the "::playground" editor tab. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  PlaygroundAttachment,
  PlaygroundParams,
  PlaygroundResult,
  PlaygroundRunRequest,
  PlaygroundTool,
  PromptTemplate,
  Reasoning,
} from '../../shared/playground';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_COMPARE,
  adapterAccepts,
  attachmentKind,
  attachmentType,
  compareBadges,
  fillVariables,
  isStrictCompatible,
  parseSchema,
  templateVariables,
  versionDelta,
} from '../../shared/playground';
import type { CodeLang } from '../../shared/playgroundCode';
import { confirmDialog } from '../confirm';
import { errText } from '../errText';
import { tp, type PgKey } from '../i18nPlayground';
import { api, newRequestId, toast, useStore } from '../store';
import { BuildView } from './PlaygroundBuild';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { ModalShell } from './ModalShell';
import './playground.css';

type Mode = 'single' | 'compare' | 'build';

interface Slot {
  model: string;
  requestId?: string;
  running: boolean;
  text: string;
  reasoning: string;
  result?: PlaygroundResult;
}

const MODE_EVENT = 'zx-playground-mode';
/** Opens the Playground on one of its modes (fired by openPlaygroundTab). */
export function playgroundModeEvent(mode: Mode): CustomEvent<Mode> {
  return new CustomEvent(MODE_EVENT, { detail: mode });
}

const SCHEMA_EXAMPLE = `{
  "type": "object",
  "properties": {
    "titulo": { "type": "string" },
    "prioridad": { "type": "string", "enum": ["baja", "media", "alta"] },
    "etiquetas": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["titulo", "prioridad", "etiquetas"],
  "additionalProperties": false
}`;

const TOOLS_EXAMPLE = `[
  {
    "name": "get_weather",
    "description": "Clima actual de una ciudad",
    "parameters": {
      "type": "object",
      "properties": { "city": { "type": "string" } },
      "required": ["city"]
    }
  }
]`;

function parseTools(text: string): { tools: PlaygroundTool[]; error?: string } {
  if (!text.trim()) return { tools: [] };
  try {
    const v = JSON.parse(text) as unknown;
    if (!Array.isArray(v)) return { tools: [], error: 'debe ser una lista []' };
    const tools: PlaygroundTool[] = [];
    for (const x of v) {
      const o = x as Partial<PlaygroundTool>;
      if (!o || typeof o.name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(o.name))
        return { tools: [], error: `nombre inválido: ${JSON.stringify(o?.name)}` };
      tools.push({
        name: o.name,
        description: typeof o.description === 'string' ? o.description : '',
        parameters:
          o.parameters && typeof o.parameters === 'object'
            ? o.parameters
            : { type: 'object', properties: {} },
      });
    }
    return { tools };
  } catch (e) {
    return { tools: [], error: (e as Error).message };
  }
}

const fmtUsd = (usd: number | null) =>
  usd === null ? tp('pgCostUnknown') : usd < 0.01 ? `$${usd.toFixed(5)}` : `$${usd.toFixed(4)}`;
const fmtMs = (ms: number | undefined) =>
  ms === undefined ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
const fmtSize = (b64: string) => {
  const bytes = Math.floor((b64.length * 3) / 4);
  return bytes > 1024 * 1024
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
};

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

export function PlaygroundPane({ visible }: { visible: boolean }) {
  const models = useStore((s) => s.models);
  const defaultModel = useStore((s) => s.settings.defaultModel);
  const chatModels = useMemo(
    () => models.filter((m) => m.kind === 'chat').map((m) => `${m.provider}/${m.id}`),
    [models],
  );
  const [mode, setMode] = useState<Mode>('single');
  const [system, setSystem] = useState('');
  const [prompt, setPrompt] = useState('');
  const [temperature, setTemperature] = useState<number | undefined>(undefined);
  const [topP, setTopP] = useState<number | undefined>(undefined);
  const [maxTokens, setMaxTokens] = useState<number | undefined>(undefined);
  const [reasoning, setReasoning] = useState<Reasoning | ''>('');
  const [toolsText, setToolsText] = useState('');
  const [schema, setSchema] = useState('');
  const [strict, setStrict] = useState(false);
  const [attachments, setAttachments] = useState<PlaygroundAttachment[]>([]);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [slots, setSlots] = useState<Slot[]>([]);
  const [adapters, setAdapters] = useState<Record<string, string | null>>({});
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [tplId, setTplId] = useState<string>('');
  const [loadedV, setLoadedV] = useState<number | null>(null);
  const [saveAs, setSaveAs] = useState<{ name: string; note: string } | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [code, setCode] = useState<{ model: string; lang: CodeLang; text: string | null } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  // One slot per model; single mode uses the first.
  useEffect(() => {
    if (slots.length || !chatModels.length) return;
    const first = defaultModel && chatModels.includes(defaultModel) ? defaultModel : chatModels[0]!;
    const second = chatModels.find((m) => m !== first) ?? first;
    setSlots([blank(first), blank(second)]);
  }, [chatModels, defaultModel, slots.length]);

  useEffect(() => {
    const onMode = (e: Event) => setMode((e as CustomEvent<Mode>).detail);
    window.addEventListener(MODE_EVENT, onMode);
    void api()
      .playground.templates()
      .then(setTemplates)
      .catch(() => undefined);
    return () => window.removeEventListener(MODE_EVENT, onMode);
  }, []);

  // Streamed events of every running slot.
  useEffect(
    () =>
      api().on((ev) => {
        if (ev.type !== 'playground') return;
        setSlots((list) =>
          list.map((s) => {
            if (s.requestId !== ev.requestId) return s;
            const e = ev.event;
            if (e.type === 'text') return { ...s, text: s.text + e.delta };
            if (e.type === 'reasoning') return { ...s, reasoning: s.reasoning + e.delta };
            if (e.type === 'done') return { ...s, running: false, result: e.result };
            return s;
          }),
        );
      }),
    [],
  );

  const activeModels = useMemo(
    () => (mode === 'compare' ? slots : slots.slice(0, 1)).map((s) => s.model),
    [mode, slots],
  );
  useEffect(() => {
    for (const m of activeModels)
      if (!(m in adapters))
        void api()
          .playground.adapter(m)
          .then((a) => setAdapters((x) => ({ ...x, [m]: a })))
          .catch(() => undefined);
  }, [activeModels, adapters]);

  const tools = parseTools(toolsText);
  const parsedSchema = parseSchema(schema);
  const strictOk = parsedSchema.schema ? isStrictCompatible(parsedSchema.schema) : false;
  const params: PlaygroundParams = {
    system,
    prompt,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { topP } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(reasoning ? { reasoning } : {}),
    tools: tools.tools,
    schema,
    ...(strict && strictOk ? { strict: true } : {}),
  };
  const variables = templateVariables(params);
  const running = slots.some((s) => s.running);
  const tpl = templates.find((t) => t.id === tplId);

  const request = (model: string): PlaygroundRunRequest => ({
    ...params,
    system: fillVariables(system, vars),
    prompt: fillVariables(prompt, vars),
    model,
    attachments,
  });

  const run = () => {
    if (running || !prompt.trim()) return;
    if (tools.error) return toast(tp('pgToolsInvalid', { error: tools.error }));
    if (parsedSchema.error) return toast(parsedSchema.error);
    const targets = mode === 'compare' ? slots : slots.slice(0, 1);
    if (mode === 'compare' && new Set(targets.map((s) => s.model)).size < 2)
      return toast(tp('pgCompareNeedTwo'));
    const ids = targets.map(() => newRequestId());
    setSlots((list) =>
      list.map((s, i) =>
        i < targets.length
          ? { ...s, requestId: ids[i], running: true, text: '', reasoning: '', result: undefined }
          : s,
      ),
    );
    targets.forEach((s, i) => {
      void api()
        .playground.run(ids[i]!, request(s.model))
        .catch((e: unknown) =>
          setSlots((list) =>
            list.map((x) =>
              x.requestId === ids[i]
                ? { ...x, running: false, result: failed(x.model, errText(e)) }
                : x,
            ),
          ),
        );
    });
  };

  const stop = () => {
    for (const s of slotsRef.current)
      if (s.running && s.requestId) void api().playground.abort(s.requestId);
  };

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const next = [...attachments];
    for (const f of Array.from(files)) {
      if (next.length >= 10) break;
      const type = attachmentType(f.name, f.type);
      if (!type) {
        toast(tp('pgAttachType', { name: f.name }));
        continue;
      }
      if (f.size > MAX_ATTACHMENT_BYTES) {
        toast(tp('pgAttachTooBig', { name: f.name }));
        continue;
      }
      next.push({ name: f.name, mediaType: type, data: await readAsBase64(f) });
    }
    setAttachments(next);
  };

  const loadVersion = (t: PromptTemplate, v: number) => {
    const ver = t.versions.find((x) => x.v === v);
    if (!ver) return;
    const p = ver.params;
    setSystem(p.system);
    setPrompt(p.prompt);
    setTemperature(p.temperature);
    setTopP(p.topP);
    setMaxTokens(p.maxTokens);
    setReasoning(p.reasoning ?? '');
    setToolsText(p.tools.length ? JSON.stringify(p.tools, null, 2) : '');
    setSchema(p.schema);
    setStrict(p.strict === true);
    setLoadedV(v);
    setVersionsOpen(false);
  };

  const save = async (opts: { id?: string; name?: string; note?: string }) => {
    if (tools.error) return toast(tp('pgToolsInvalid', { error: tools.error }));
    try {
      const before = opts.id ? templates.find((x) => x.id === opts.id) : undefined;
      const saved = await api().playground.saveTemplate(params, {
        ...opts,
        model: slots[0]?.model,
      });
      setTemplates((list) => [...list.filter((x) => x.id !== saved.id), saved]);
      setTplId(saved.id);
      const last = saved.versions[saved.versions.length - 1]!;
      setLoadedV(last.v);
      toast(
        before && before.versions.length === saved.versions.length
          ? tp('pgTemplateUnchanged', { v: last.v })
          : tp('pgTemplateSaved', { v: last.v, name: saved.name }),
      );
    } catch (e) {
      toast(errText(e));
    }
  };

  const remove = async () => {
    if (!tpl) return;
    const ok = await confirmDialog(
      tp('pgTemplateDeleteAsk', { name: tpl.name, n: tpl.versions.length }),
      { danger: true },
    );
    if (!ok) return;
    await api().playground.deleteTemplate(tpl.id);
    setTemplates((l) => l.filter((x) => x.id !== tpl.id));
    setTplId('');
    setLoadedV(null);
  };

  const openCode = async (model: string, lang: CodeLang = 'ts') => {
    setCode({ model, lang, text: null });
    try {
      const text = await api().playground.code(lang, request(model));
      setCode({ model, lang, text });
    } catch (e) {
      setCode({ model, lang, text: `// ${errText(e)}` });
    }
  };

  const setSlotModel = (i: number, model: string) =>
    setSlots((l) => l.map((s, j) => (j === i ? { ...blank(model) } : s)));

  const unsupported = activeModels.flatMap((m) => {
    const a = adapters[m];
    if (a === undefined || a === null) return [];
    const ok = adapterAccepts(a);
    const kinds = [...new Set(attachments.map((x) => attachmentKind(x.mediaType)))].filter(
      (k) => !ok.includes(k),
    );
    return kinds.map((k) =>
      tp('pgAttachUnsupported', { model: m, kind: tp(`pgKind_${k}` as PgKey) }),
    );
  });

  const results = (mode === 'compare' ? slots : slots.slice(0, 1)).map((s) => s.result);
  const badges =
    mode === 'compare' && results.every(Boolean)
      ? compareBadges(results as PlaygroundResult[])
      : new Map<number, string[]>();

  return (
    <div className="pg" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="pg-top">
        <div className="pg-modes" role="tablist" aria-label={tp('pgTab')}>
          {(['single', 'compare', 'build'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'on' : ''}
              onClick={() => setMode(m)}
            >
              <Icon
                name={m === 'single' ? 'message' : m === 'compare' ? 'columns' : 'package'}
                size={13}
              />
              {tp(
                m === 'single' ? 'pgModeSingle' : m === 'compare' ? 'pgModeCompare' : 'pgModeBuild',
              )}
            </button>
          ))}
        </div>
        {mode !== 'build' && (
          <div className="pg-templates">
            <label>
              {tp('pgTemplates')}
              <select
                value={tplId}
                onChange={(e) => {
                  setTplId(e.target.value);
                  const t = templates.find((x) => x.id === e.target.value);
                  if (t?.versions.length) loadVersion(t, t.versions[t.versions.length - 1]!.v);
                  else setLoadedV(null);
                }}
              >
                <option value="">{tp('pgTemplateNone')}</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (v{t.versions[t.versions.length - 1]?.v ?? 0})
                  </option>
                ))}
              </select>
            </label>
            {tpl && (
              <>
                <button onClick={() => setVersionsOpen((o) => !o)} aria-expanded={versionsOpen}>
                  <Icon name="history" size={13} /> {tp('pgVersions')}
                  {loadedV !== null && ` · v${loadedV}`}
                </button>
                <button onClick={() => void save({ id: tpl.id })}>
                  <Icon name="check" size={13} /> {tp('pgTemplateSave')}
                </button>
              </>
            )}
            <button onClick={() => setSaveAs({ name: '', note: '' })}>
              <Icon name="plus" size={13} /> {tp('pgTemplateSaveAs')}
            </button>
            {tpl && (
              <button
                className="danger"
                title={tp('pgTemplateDelete')}
                aria-label={tp('pgTemplateDelete')}
                onClick={() => void remove()}
              >
                <Icon name="trash" size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {versionsOpen && tpl && (
        <ol className="pg-versions">
          {[...tpl.versions].reverse().map((v, i, arr) => {
            const prev = arr[i + 1];
            const d = prev ? versionDelta(prev.params, v.params) : null;
            return (
              <li key={v.v}>
                <strong>v{v.v}</strong>
                <span>{new Date(v.savedAt).toLocaleString()}</span>
                {v.model && <code>{v.model}</code>}
                {d && <span className="pg-delta">{tp('pgVersionDelta', d)}</span>}
                {v.note && <em>{v.note}</em>}
                {loadedV === v.v ? (
                  <span className="pg-tag">{tp('pgVersionCurrent')}</span>
                ) : (
                  <button onClick={() => loadVersion(tpl, v.v)}>{tp('pgVersionLoad')}</button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {mode === 'build' ? (
        <BuildView models={chatModels} />
      ) : !chatModels.length ? (
        <div className="pg-empty">{tp('pgNoModels')}</div>
      ) : (
        <div className="pg-body">
          <aside className="pg-side" aria-label={tp('pgParams')}>
            <label className="pg-field">
              <span>{tp('pgSystem')}</span>
              <textarea
                rows={4}
                value={system}
                placeholder={tp('pgSystemPh')}
                onChange={(e) => setSystem(e.target.value)}
              />
            </label>
            <fieldset className="pg-params">
              <legend>{tp('pgParams')}</legend>
              <NumberKnob
                label={tp('pgTemperature')}
                value={temperature}
                onChange={setTemperature}
                min={0}
                max={2}
                step={0.05}
                initial={1}
              />
              <NumberKnob
                label={tp('pgTopP')}
                value={topP}
                onChange={setTopP}
                min={0}
                max={1}
                step={0.01}
                initial={0.95}
              />
              {(temperature !== undefined || topP !== undefined) && (
                <p className="pg-hint">{tp('pgSamplingWarn')}</p>
              )}
              <label className="pg-row">
                <span>{tp('pgMaxTokens')}</span>
                <input
                  type="number"
                  min={1}
                  max={1000000}
                  placeholder={tp('pgDefault')}
                  value={maxTokens ?? ''}
                  onChange={(e) =>
                    setMaxTokens(
                      e.target.value ? Math.max(1, Math.trunc(+e.target.value)) : undefined,
                    )
                  }
                />
              </label>
              <label className="pg-row">
                <span>{tp('pgThinking')}</span>
                <select
                  value={reasoning}
                  onChange={(e) => setReasoning(e.target.value as Reasoning | '')}
                >
                  <option value="">{tp('pgThinkingOff')}</option>
                  <option value="low">{tp('pgThinkingLow')}</option>
                  <option value="medium">{tp('pgThinkingMedium')}</option>
                  <option value="high">{tp('pgThinkingHigh')}</option>
                </select>
              </label>
            </fieldset>
            <div className="pg-field">
              <div className="pg-label-row">
                <span>{tp('pgSchema')}</span>
                {schema ? (
                  <button className="link" onClick={() => setSchema('')}>
                    {tp('pgSchemaClear')}
                  </button>
                ) : (
                  <button className="link" onClick={() => setSchema(SCHEMA_EXAMPLE)}>
                    {tp('pgSchemaExample')}
                  </button>
                )}
              </div>
              <textarea
                rows={schema ? 8 : 2}
                className="mono"
                aria-label={tp('pgSchema')}
                spellCheck={false}
                value={schema}
                aria-invalid={Boolean(parsedSchema.error)}
                onChange={(e) => setSchema(e.target.value)}
              />
              <p className={parsedSchema.error ? 'pg-hint err' : 'pg-hint'}>
                {parsedSchema.error ?? tp('pgSchemaHint')}
              </p>
              {parsedSchema.schema && (
                <label className="pg-check" title={strictOk ? undefined : tp('pgStrictOff')}>
                  <input
                    type="checkbox"
                    checked={strict && strictOk}
                    disabled={!strictOk}
                    onChange={(e) => setStrict(e.target.checked)}
                  />
                  {tp('pgStrict')}
                </label>
              )}
            </div>
            <div className="pg-field">
              <div className="pg-label-row">
                <span>{tp('pgTools')}</span>
                {!toolsText && (
                  <button className="link" onClick={() => setToolsText(TOOLS_EXAMPLE)}>
                    {tp('pgToolsExample')}
                  </button>
                )}
              </div>
              <textarea
                rows={toolsText ? 8 : 2}
                className="mono"
                aria-label={tp('pgTools')}
                spellCheck={false}
                value={toolsText}
                aria-invalid={Boolean(tools.error)}
                onChange={(e) => setToolsText(e.target.value)}
              />
              <p className={tools.error ? 'pg-hint err' : 'pg-hint'}>
                {tools.error ? tp('pgToolsInvalid', { error: tools.error }) : tp('pgToolsHint')}
              </p>
            </div>
          </aside>

          <section className="pg-main">
            <div className="pg-models">
              {(mode === 'compare' ? slots : slots.slice(0, 1)).map((s, i) => (
                <div key={i} className="pg-model">
                  <select
                    aria-label={mode === 'compare' ? tp('pgModelN', { n: i + 1 }) : tp('pgModel')}
                    value={s.model}
                    disabled={running}
                    onChange={(e) => setSlotModel(i, e.target.value)}
                  >
                    {!chatModels.includes(s.model) && <option value={s.model}>{s.model}</option>}
                    {chatModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  {mode === 'compare' && slots.length > 2 && (
                    <button
                      className="icon"
                      title={tp('pgRemoveModel')}
                      aria-label={tp('pgRemoveModel')}
                      disabled={running}
                      onClick={() => setSlots((l) => l.filter((_, j) => j !== i))}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  )}
                </div>
              ))}
              {mode === 'compare' && slots.length < MAX_COMPARE && (
                <button
                  disabled={running}
                  onClick={() =>
                    setSlots((l) => [
                      ...l,
                      blank(
                        chatModels.find((m) => !l.some((s) => s.model === m)) ?? chatModels[0]!,
                      ),
                    ])
                  }
                >
                  <Icon name="plus" size={13} /> {tp('pgAddModel')}
                </button>
              )}
            </div>
            {mode === 'compare' && <p className="pg-hint">{tp('pgCompareHint')}</p>}

            <label className="pg-field">
              <span>{tp('pgPrompt')}</span>
              <textarea
                rows={5}
                value={prompt}
                placeholder={tp('pgPromptPh')}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    run();
                  }
                }}
              />
            </label>
            {variables.length > 0 && (
              <fieldset className="pg-vars">
                <legend>{tp('pgVariables')}</legend>
                {variables.map((v) => (
                  <label key={v} className="pg-row">
                    <code>{`{{${v}}}`}</code>
                    <input
                      value={vars[v] ?? ''}
                      onChange={(e) => setVars((x) => ({ ...x, [v]: e.target.value }))}
                    />
                  </label>
                ))}
              </fieldset>
            )}
            <div className="pg-attach">
              <button onClick={() => fileInput.current?.click()} title={tp('pgAttachHint')}>
                <Icon name="paperclip" size={13} /> {tp('pgAttach')}
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                accept="image/*,application/pdf,audio/*,video/*,.txt,.md,.csv,.json"
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              {attachments.map((a, i) => (
                <span key={i} className="pg-chip">
                  <Icon
                    name={
                      attachmentKind(a.mediaType) === 'image'
                        ? 'image'
                        : attachmentKind(a.mediaType) === 'audio'
                          ? 'music'
                          : attachmentKind(a.mediaType) === 'video'
                            ? 'film'
                            : 'file'
                    }
                    size={12}
                  />
                  {a.name} <small>{fmtSize(a.data)}</small>
                  <button
                    className="icon"
                    aria-label={tp('pgRemoveFile', { name: a.name })}
                    onClick={() => setAttachments((l) => l.filter((_, j) => j !== i))}
                  >
                    <Icon name="x" size={11} />
                  </button>
                </span>
              ))}
              <div className="spacer" />
              {running ? (
                <button className="danger" onClick={stop}>
                  <Icon name="stop" size={13} /> {tp('pgStop')}
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={!prompt.trim()}
                  title={tp('pgRunHint')}
                  onClick={run}
                >
                  <Icon name="play" size={13} />{' '}
                  {mode === 'compare' ? tp('pgRunAll', { n: slots.length }) : tp('pgRun')}
                </button>
              )}
            </div>
            {unsupported.map((w) => (
              <p key={w} className="pg-hint warn">
                <Icon name="warning" size={12} /> {w}
              </p>
            ))}

            <div className={`pg-results n${mode === 'compare' ? slots.length : 1}`}>
              {(mode === 'compare' ? slots : slots.slice(0, 1)).map((s, i) => (
                <ResultCard
                  key={i}
                  slot={s}
                  badges={badges.get(i) ?? []}
                  showModel={mode === 'compare'}
                  onCode={() => void openCode(s.model)}
                />
              ))}
            </div>
          </section>
        </div>
      )}

      {saveAs && (
        <ModalShell onClose={() => setSaveAs(null)} className="pg-dialog" labelledBy="pg-saveas">
          <h3 id="pg-saveas">{tp('pgTemplateSaveAs')}</h3>
          <label className="pg-field">
            <span>{tp('pgTemplateName')}</span>
            <input
              autoFocus
              maxLength={80}
              value={saveAs.name}
              onChange={(e) => setSaveAs({ ...saveAs, name: e.target.value })}
            />
          </label>
          <label className="pg-field">
            <span>{tp('pgTemplateNote')}</span>
            <input
              maxLength={200}
              value={saveAs.note}
              onChange={(e) => setSaveAs({ ...saveAs, note: e.target.value })}
            />
          </label>
          <div className="pg-dialog-actions">
            <button onClick={() => setSaveAs(null)}>{tp('pgCancel')}</button>
            <button
              className="primary"
              disabled={!saveAs.name.trim()}
              onClick={() => {
                const { name, note } = saveAs;
                setSaveAs(null);
                void save({ name, ...(note.trim() ? { note } : {}) });
              }}
            >
              {tp('pgSave')}
            </button>
          </div>
        </ModalShell>
      )}

      {code && (
        <ModalShell onClose={() => setCode(null)} className="pg-dialog wide" labelledBy="pg-code">
          <h3 id="pg-code">{tp('pgCodeTitle', { model: code.model })}</h3>
          <div className="pg-modes" role="tablist">
            {(['ts', 'python', 'curl'] as const).map((l) => (
              <button
                key={l}
                role="tab"
                aria-selected={code.lang === l}
                className={code.lang === l ? 'on' : ''}
                onClick={() => void openCode(code.model, l)}
              >
                {l === 'ts' ? 'TypeScript' : l === 'python' ? 'Python' : 'curl'}
              </button>
            ))}
          </div>
          <p className="pg-hint">{tp('pgCodeHint')}</p>
          <pre className="pg-code">{code.text ?? tp('pgCodeLoading')}</pre>
          <div className="pg-dialog-actions">
            <button
              disabled={!code.text}
              onClick={() => {
                void navigator.clipboard.writeText(code.text ?? '');
                toast(tp('pgCopied'));
              }}
            >
              <Icon name="copy" size={13} /> {tp('pgCopy')}
            </button>
            <button className="primary" onClick={() => setCode(null)}>
              {tp('pgClose')}
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

function blank(model: string): Slot {
  return { model, running: false, text: '', reasoning: '' };
}

function failed(model: string, error: string): PlaygroundResult {
  return {
    model,
    text: '',
    reasoning: '',
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    usd: null,
    latencyMs: 0,
    notices: [],
    error,
  };
}

/** A number setting that can be left on the model's default. */
function NumberKnob({
  label,
  value,
  onChange,
  min,
  max,
  step,
  initial,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min: number;
  max: number;
  step: number;
  initial: number;
}) {
  const on = value !== undefined;
  return (
    <div className="pg-knob">
      <label className="pg-check">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onChange(e.target.checked ? initial : undefined)}
        />
        {label}
      </label>
      {on ? (
        <>
          <input
            type="range"
            aria-label={label}
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(+e.target.value)}
          />
          <output>{value}</output>
        </>
      ) : (
        <span className="pg-muted">{tp('pgDefault')}</span>
      )}
    </div>
  );
}

function ResultCard({
  slot,
  badges,
  showModel,
  onCode,
}: {
  slot: Slot;
  badges: string[];
  showModel: boolean;
  onCode: () => void;
}) {
  const [raw, setRaw] = useState(false);
  const r = slot.result;
  const text = r ? r.text : slot.text;
  const reasoning = r ? r.reasoning : slot.reasoning;
  const json = r?.json;
  return (
    <article className="pg-card" aria-busy={slot.running}>
      <header>
        {showModel && <code className="pg-card-model">{slot.model}</code>}
        {badges.includes('cheapest') && <span className="pg-badge good">{tp('pgCheapest')}</span>}
        {badges.includes('fastest') && <span className="pg-badge good">{tp('pgFastest')}</span>}
        {json && (
          <span className={`pg-badge ${json.ok ? 'good' : 'bad'}`}>
            <Icon name={json.ok ? 'check' : 'warning'} size={11} />{' '}
            {json.ok ? tp('pgJsonOk') : json.parsed ? tp('pgJsonBad') : tp('pgJsonNotJson')}
          </span>
        )}
        <div className="spacer" />
        <button className="link" onClick={() => setRaw((x) => !x)} disabled={!text}>
          {raw ? tp('pgFormatted') : tp('pgRaw')}
        </button>
        <button
          className="link"
          disabled={!text}
          onClick={() => {
            void navigator.clipboard.writeText(text);
            toast(tp('pgCopied'));
          }}
        >
          <Icon name="copy" size={12} /> {tp('pgCopy')}
        </button>
        <button className="link" onClick={onCode}>
          <Icon name="code" size={12} /> {tp('pgGetCode')}
        </button>
      </header>
      {reasoning && (
        <details className="pg-reasoning">
          <summary>{tp('pgReasoning')}</summary>
          <pre>{reasoning}</pre>
        </details>
      )}
      <div className="pg-output" aria-live="polite">
        {r?.error ? (
          <p className="pg-hint err">{tp('pgError', { error: r.error })}</p>
        ) : text ? (
          raw || json ? (
            <pre>{json?.parsed ? prettyJson(text) : text}</pre>
          ) : (
            <Markdown text={text} streaming={slot.running} />
          )
        ) : (
          <p className="pg-muted">{slot.running ? tp('pgWaiting') : tp('pgEmpty')}</p>
        )}
      </div>
      {json && !json.ok && (
        <ul className="pg-errors">
          {json.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {r && r.toolCalls.length > 0 && (
        <div className="pg-tools">
          <strong>{tp('pgToolCalls')}</strong>
          {r.toolCalls.map((c, i) => (
            <pre key={i}>
              {c.name}({c.arguments || '{}'})
            </pre>
          ))}
        </div>
      )}
      {r && !r.error && (
        <footer className="pg-stats">
          <span>
            {tp('pgTokens', {
              input: r.inputTokens.toLocaleString(),
              output: r.outputTokens.toLocaleString(),
            })}
          </span>
          <span>
            {tp('pgCost')}: {fmtUsd(r.usd)}
          </span>
          <span>
            {tp('pgLatency')}: {fmtMs(r.latencyMs)}
          </span>
          <span>
            {tp('pgFirstToken')}: {fmtMs(r.firstTokenMs)}
          </span>
          {r.stopReason && r.stopReason !== 'end_turn' && (
            <span>{tp('pgStopReason', { reason: r.stopReason })}</span>
          )}
        </footer>
      )}
      {r?.notices.map((n) => (
        <p key={n} className="pg-hint warn">
          {n}
        </p>
      ))}
    </article>
  );
}

function prettyJson(text: string): string {
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i.exec(text.trim());
  try {
    return JSON.stringify(JSON.parse(fence ? fence[1]! : text), null, 2);
  } catch {
    return text;
  }
}
