import { useEffect, useMemo, useState } from 'react';
import { formatEstimate, genErrorKind, genErrorText } from '../../../shared/mediaGen';
import type {
  GenAspect,
  GenEstimate,
  GenKind,
  GenModelView,
  GenQuality,
  GenRequest,
} from '../../../shared/mediaGen';
import { api, setState } from '../../store';
import { Icon } from '../Icon';
import { genLang, tg } from './generateStrings';
import { addToTimeline, importPaths, minimizeStudio } from './videoStore';
import './generate.css';

/**
 * Fase 10: the Generate panel of the Media Library. Builds a request, shows the estimated
 * cost before spending anything, and imports what comes back into the library (optionally
 * straight onto the timeline).
 */
const KINDS: { kind: GenKind; icon: 'image' | 'film' | 'volume' }[] = [
  { kind: 'image', icon: 'image' },
  { kind: 'video', icon: 'film' },
  { kind: 'speech', icon: 'volume' },
];

const keyOf = (m: GenModelView) => `${m.provider}/${m.id}`;

export function GeneratePanel({ onClose }: { onClose: () => void }) {
  const [models, setModels] = useState<GenModelView[]>([]);
  const [kind, setKind] = useState<GenKind>('image');
  const [modelKey, setModelKey] = useState('');
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('');
  const [aspect, setAspect] = useState<GenAspect>('16:9');
  const [duration, setDuration] = useState(5);
  const [count, setCount] = useState(1);
  const [quality, setQuality] = useState<GenQuality>('medium');
  const [voice, setVoice] = useState('');
  const [seed, setSeed] = useState('');
  const [transparent, setTransparent] = useState(false);
  const [toTimeline, setToTimeline] = useState(true);
  const [estimate, setEstimate] = useState<GenEstimate | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [stage, setStage] = useState<'sending' | 'waiting' | 'downloading' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [outDir, setOutDir] = useState('');

  useEffect(() => {
    void api()
      .media.models()
      .then(setModels)
      .catch(() => setModels([]));
    void api()
      .media.outDir()
      .then(setOutDir)
      .catch(() => undefined);
  }, []);

  const ofKind = useMemo(() => models.filter((m) => m.kind === kind), [models, kind]);
  // Keep a valid model selected: connected and priced first.
  useEffect(() => {
    if (ofKind.some((m) => keyOf(m) === modelKey)) return;
    const pick =
      ofKind.find((m) => m.connected && m.priced) ?? ofKind.find((m) => m.connected) ?? ofKind[0];
    setModelKey(pick ? keyOf(pick) : '');
  }, [ofKind, modelKey]);
  const model = ofKind.find((m) => keyOf(m) === modelKey);

  // Options the chosen model does not have are reset to something it accepts.
  useEffect(() => {
    if (!model) return;
    if (model.aspects && !model.aspects.includes(aspect)) setAspect(model.aspects[0]!);
    if (model.duration && (duration < model.duration.min || duration > model.duration.max))
      setDuration(model.duration.default);
    if (model.voices && voice && !model.voices.includes(voice)) setVoice('');
    if (count > (model.maxCount ?? 1)) setCount(model.maxCount ?? 1);
  }, [model, aspect, duration, voice, count]);

  const req: GenRequest | null = model
    ? {
        kind,
        provider: model.provider,
        model: model.id,
        prompt,
        ...(style.trim() ? { style: style.trim() } : {}),
        ...(kind !== 'speech' && model.aspects ? { aspect } : {}),
        ...(kind === 'video' ? { durationSec: duration } : {}),
        ...(kind === 'image' ? { count } : {}),
        ...(kind === 'image' && model.qualities ? { quality } : {}),
        ...(kind === 'speech' && voice ? { voice } : {}),
        ...(seed.trim() && /^\d+$/.test(seed.trim()) ? { seed: Number(seed.trim()) } : {}),
        ...(kind === 'image' && transparent && model.transparent ? { transparent: true } : {}),
      }
    : null;
  const reqJson = req ? JSON.stringify(req) : '';

  useEffect(() => {
    if (!reqJson) return setEstimate(null);
    const t = setTimeout(() => {
      void api()
        .media.estimate(JSON.parse(reqJson) as GenRequest)
        .then(setEstimate)
        .catch(() => setEstimate(null));
    }, 150);
    return () => clearTimeout(t);
  }, [reqJson]);

  useEffect(
    () =>
      api().on((ev) => {
        if (ev.type !== 'media' || ev.requestId !== requestId) return;
        if (ev.event.type === 'progress') setStage(ev.event.stage);
      }),
    [requestId],
  );

  const missing = [...new Set(ofKind.filter((m) => !m.connected).map((m) => m.providerName))];
  const canRun = !!req && !!model?.connected && !!prompt.trim() && !requestId;

  async function run() {
    if (!req || !canRun) return;
    const id = `gen-${Date.now().toString(36)}`;
    setRequestId(id);
    setStage('sending');
    setMessage(null);
    setWarnings([]);
    try {
      const r = await api().media.generate(id, req);
      setWarnings(r.warnings);
      const items = await importPaths(r.paths);
      if (toTimeline) for (const item of items) addToTimeline(item);
      setMessage({ ok: true, text: tg('done', { n: r.paths.length }) });
    } catch (e) {
      const err = (e as Error).message.replace(
        /^Error invoking remote method '[^']+': (Error: )?/,
        '',
      );
      setMessage({ ok: false, text: tg('failed', { err: genErrorText(err, genLang) }) });
      // No balance or quota: say that the free voice of this computer works without it.
      if (genErrorKind(err) === 'quota') setWarnings([tg('freeVoiceHint')]);
    } finally {
      setRequestId(null);
      setStage(null);
    }
  }

  const cost = estimate ? formatEstimate(estimate, genLang) : '';

  return (
    <div className="vs-gen" role="dialog" aria-label={tg('title')}>
      <div className="vs-gen-head">
        <strong>
          <Icon name="sparkle" size={14} /> {tg('title')}
        </strong>
        <button className="ghost" title={tg('close')} aria-label={tg('close')} onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>

      <div className="vs-seg vs-gen-kinds" role="tablist">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            role="tab"
            aria-selected={kind === k.kind}
            className={kind === k.kind ? 'on' : ''}
            onClick={() => setKind(k.kind)}
            disabled={!!requestId}
          >
            <Icon name={k.icon} size={13} /> {tg(k.kind as 'image' | 'video' | 'speech')}
          </button>
        ))}
      </div>

      {!ofKind.length ? (
        <p className="vs-dim">{tg('noModels')}</p>
      ) : (
        <>
          <label className="vs-gen-field">
            <span>{tg('model')}</span>
            <select
              value={modelKey}
              onChange={(e) => setModelKey(e.target.value)}
              disabled={!!requestId}
            >
              {ofKind.map((m) => (
                <option key={keyOf(m)} value={keyOf(m)}>
                  {m.providerName} · {m.label} {m.connected ? '' : tg('notConnected')}
                </option>
              ))}
            </select>
          </label>
          {model?.note && <p className="vs-gen-note">{model.note}</p>}
          {!model?.connected && missing.length > 0 && (
            <div className="vs-gen-warn">
              <p>{tg('connectHint', { providers: missing.join(', ') })}</p>
              <button
                onClick={() => {
                  // The app's modals sit below the studio: step out of it first.
                  minimizeStudio();
                  setState({ modal: { kind: 'providers' } });
                }}
              >
                {tg('connectBtn')}
              </button>
              {kind !== 'speech' && <p className="vs-gen-note">{tg('freeVoiceHint')}</p>}
            </div>
          )}

          <label className="vs-gen-field">
            <span>{kind === 'speech' ? tg('textToRead') : tg('prompt')}</span>
            <textarea
              rows={kind === 'speech' ? 5 : 3}
              value={prompt}
              placeholder={kind === 'speech' ? tg('textPh') : tg('promptPh')}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void run();
              }}
            />
          </label>
          <label className="vs-gen-field">
            <span>{tg('style')}</span>
            <input
              value={style}
              placeholder={kind === 'speech' ? tg('voiceStylePh') : tg('stylePh')}
              onChange={(e) => setStyle(e.target.value)}
            />
          </label>

          <div className="vs-gen-row">
            {kind !== 'speech' && model?.aspects && (
              <label className="vs-gen-field">
                <span>{tg('aspect')}</span>
                <select value={aspect} onChange={(e) => setAspect(e.target.value as GenAspect)}>
                  {model.aspects.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </label>
            )}
            {kind === 'video' && model?.duration && (
              <label className="vs-gen-field">
                <span>{tg('duration')}</span>
                <input
                  type="number"
                  min={model.duration.min}
                  max={model.duration.max}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value) || model.duration!.default)}
                />
              </label>
            )}
            {kind === 'image' && (model?.maxCount ?? 1) > 1 && (
              <label className="vs-gen-field">
                <span>{tg('count')}</span>
                <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {Array.from({ length: model!.maxCount! }, (_, i) => i + 1).map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            )}
            {kind === 'image' && model?.qualities && (
              <label className="vs-gen-field">
                <span>{tg('quality')}</span>
                <select value={quality} onChange={(e) => setQuality(e.target.value as GenQuality)}>
                  {model.qualities.map((q) => (
                    <option key={q} value={q}>
                      {tg(q)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {kind === 'speech' && model?.voices && (
              <label className="vs-gen-field">
                <span>{tg('voice')}</span>
                <select value={voice || model.voices[0]} onChange={(e) => setVoice(e.target.value)}>
                  {model.voices.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            )}
            {kind !== 'speech' && (
              <label className="vs-gen-field">
                <span>{tg('seed')}</span>
                <input
                  inputMode="numeric"
                  value={seed}
                  placeholder={tg('seedPh')}
                  onChange={(e) => setSeed(e.target.value.replace(/\D/g, '').slice(0, 10))}
                />
              </label>
            )}
          </div>
          {kind === 'image' && model?.transparent && (
            <label className="vs-gen-check">
              <input
                type="checkbox"
                checked={transparent}
                onChange={(e) => setTransparent(e.target.checked)}
              />
              {tg('transparent')}
            </label>
          )}
          <label className="vs-gen-check">
            <input
              type="checkbox"
              checked={toTimeline}
              onChange={(e) => setToTimeline(e.target.checked)}
            />
            {tg('addToTimeline')}
          </label>

          <p
            className="vs-gen-cost"
            title={
              model
                ? `${tg('priceSource', { date: model.verifiedAt })} · ${model.source}`
                : undefined
            }
          >
            {estimate && estimate.usd !== null
              ? `${tg('cost', { cost })} · ${estimate.detail}`
              : model
                ? tg('costUnknown', { provider: model.providerName })
                : ''}
          </p>

          <div className="vs-gen-actions">
            {requestId ? (
              <>
                <span className="vs-importing">
                  <span className="vs-spinner" /> {stage ? tg(stage) : tg('sending')}
                </span>
                <button onClick={() => void api().media.abort(requestId)}>{tg('cancel')}</button>
              </>
            ) : (
              <button className="primary" disabled={!canRun} onClick={() => void run()}>
                {estimate && estimate.usd !== null
                  ? tg('generate', { cost })
                  : tg('generateNoPrice')}
              </button>
            )}
          </div>
          {message && <p className={message.ok ? 'vs-gen-ok' : 'vs-gen-warn'}>{message.text}</p>}
          {warnings.map((w) => (
            <p key={w} className="vs-gen-note">
              {w}
            </p>
          ))}
          {outDir && <p className="vs-gen-note vs-dim">{tg('savedIn', { dir: outDir })}</p>}
        </>
      )}
    </div>
  );
}
