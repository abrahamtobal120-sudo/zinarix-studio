import { useEffect, useRef, useState } from 'react';
import type { ChatContext, ChatEventView, ToolDecision, ToolPreview } from '../../shared/api';
import { t } from '../i18n';
import { languageFor, monaco } from '../monaco';
import {
  api,
  getEditor,
  getState,
  newRequestId,
  reloadFromDisk,
  refreshSettings,
  setState,
  toast,
  useStore,
} from '../store';
import { ProviderLogo } from './ProviderLogo';
import { ChatHistory } from './ChatHistory';
import { Markdown } from './Markdown';

interface ToolStep {
  kind: 'tool';
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'approval' | 'ok' | 'error';
  summary?: string;
  output?: string;
  preview?: ToolPreview;
}
type Part = { kind: 'text'; text: string } | ToolStep;

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  parts?: Part[];
  model?: string;
  meta?: string;
  error?: string;
  notices?: string[];
  reasoning?: string;
  context?: string[];
}

/** Lets other parts of the UI (Ctrl+L, palette) push a prompt into the chat. */
export let askInChat: (prompt: string, context?: ChatContext[]) => void = () => {};

const LAST_KEY = 'zs.lastConversation';
function remember(id: string | undefined): void {
  try {
    if (id) localStorage.setItem(LAST_KEY, id);
    else localStorage.removeItem(LAST_KEY);
  } catch {
    // storage unavailable: the conversation is still saved, just not reopened automatically
  }
}

interface SavedDisplay {
  parts?: Part[];
  model?: string;
  reasoning?: string;
  notices?: string[];
  meta?: { usd: number | null; inputTokens: number; outputTokens: number; latencyMs: number };
  error?: string;
  context?: string[];
}

function metaLine(m: {
  usd: number | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}): string {
  return `${m.inputTokens}→${m.outputTokens} tok · ${fmtUsd(m.usd)} · ${(m.latencyMs / 1000).toFixed(1)}s`;
}

function fmtUsd(n: number | null): string {
  if (n === null) return '–';
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

const TOOL_ICON: Record<string, string> = {
  list_dir: '📂',
  read_file: '📖',
  search: '🔍',
  edit_file: '✏️',
  write_file: '📝',
  run_command: '⌨️',
};

function toolTitle(step: ToolStep): string {
  const a = step.args;
  switch (step.name) {
    case 'run_command':
      return String(a.command ?? '');
    case 'search':
      return `"${String(a.query ?? '')}"`;
    default:
      return String(a.path ?? '.');
  }
}

function DiffView({ before, after, path }: { before: string; after: string; path: string }) {
  const host = useRef<HTMLDivElement>(null);
  const theme = useStore((s) => s.settings.theme);
  useEffect(() => {
    if (!host.current) return;
    const lang = languageFor(path);
    const a = monaco.editor.createModel(before, lang);
    const b = monaco.editor.createModel(after, lang);
    const diff = monaco.editor.createDiffEditor(host.current, {
      readOnly: true,
      renderSideBySide: false,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      theme: theme === 'dark' ? 'vs-dark' : 'vs',
      hideUnchangedRegions: { enabled: true },
      fontSize: 12,
    });
    diff.setModel({ original: a, modified: b });
    return () => {
      diff.dispose();
      a.dispose();
      b.dispose();
    };
  }, [before, after, path, theme]);
  return <div className="tool-diff" ref={host} />;
}

function ToolCard({ step, onDecide }: { step: ToolStep; onDecide: (d: ToolDecision) => void }) {
  const [open, setOpen] = useState(step.status === 'approval');
  useEffect(() => {
    if (step.status === 'approval') setOpen(true);
  }, [step.status]);
  const icon = TOOL_ICON[step.name] ?? '🛠';
  const statusIcon = { running: '⏳', approval: '⏸', ok: '✓', error: '✗' }[step.status];
  const p = step.preview;
  return (
    <div className={`tool-card ${step.status}`}>
      <div className="tool-head" onClick={() => setOpen(!open)}>
        <span>{icon}</span>
        <span className="tool-name">{step.name}</span>
        <span className="tool-arg" title={toolTitle(step)}>
          {toolTitle(step)}
        </span>
        <span className="tool-status">
          {step.summary ? `${step.summary} ` : ''}
          {statusIcon}
        </span>
      </div>
      {open && (
        <div className="tool-body">
          {p?.command !== undefined && <pre className="tool-cmd">$ {p.command}</pre>}
          {p?.path !== undefined && p.before !== undefined && p.after !== undefined && (
            <DiffView before={p.before} after={p.after} path={p.path} />
          )}
          {step.output && <pre className="tool-output">{step.output.slice(-20000)}</pre>}
        </div>
      )}
      {step.status === 'approval' && (
        <div className="tool-actions">
          <button className="primary" onClick={() => onDecide('approve')}>
            ✓ {t('approve')}
          </button>
          <button onClick={() => onDecide('always')}>{t('approveAlways')}</button>
          <button className="danger" onClick={() => onDecide('deny')}>
            ✗ {t('reject')}
          </button>
        </div>
      )}
    </div>
  );
}

export function ChatPanel() {
  const settings = useStore((s) => s.settings);
  const active = useStore((s) => s.active);
  const models = useStore((s) => s.models);
  const workspace = useStore((s) => s.workspace);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [includeFile, setIncludeFile] = useState(true);
  const [agentMode, setAgentMode] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [changed, setChanged] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const loadConversation = async (id: string) => {
    const data = await api().ai.conversation(id);
    if (!data) {
      remember(undefined);
      return;
    }
    if (busy) void api().ai.abort(busy);
    setTurns(
      data.messages.map((m): Turn => {
        const d = (m.display ?? {}) as SavedDisplay;
        if (m.role === 'user') return { role: 'user', content: m.content, context: d.context };
        return {
          role: 'assistant',
          content: m.content,
          parts: d.parts?.length ? d.parts : m.content ? [{ kind: 'text', text: m.content }] : [],
          model: d.model ?? m.model ?? undefined,
          meta: d.meta ? metaLine(d.meta) : undefined,
          error: d.error,
          notices: d.notices,
          reasoning: d.reasoning,
        };
      }),
    );
    setConversationId(data.conversation.id);
    setChanged([]);
    setShowHistory(false);
    remember(data.conversation.id);
    stick.current = true;
  };

  // Reopen the last conversation when the app starts.
  useEffect(() => {
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_KEY);
    } catch {
      last = null;
    }
    if (last) void loadConversation(last);
  }, []);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (stick.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [turns]);

  const currentFileContext = (): ChatContext[] => {
    const ed = getEditor();
    const model = ed?.getModel();
    const path = getState().active;
    if (!ed || !model || !path) return [];
    const sel = ed.getSelection();
    const selected = sel && !sel.isEmpty() ? model.getValueInRange(sel) : '';
    const out: ChatContext[] = [];
    if (selected)
      out.push({
        source: `selection:${path}:${sel!.startLineNumber}-${sel!.endLineNumber}`,
        content: selected,
      });
    const value = model.getValue();
    if (value.length < 200_000) out.push({ source: `file:${path}`, content: value });
    return out;
  };

  const send = async (prompt: string, extra: ChatContext[] = []) => {
    if (!prompt.trim() || busy) return;
    setShowHistory(false);
    const context = [...extra, ...(includeFile ? currentFileContext() : [])];
    const history = turns
      .filter((x) => !x.error)
      .map((x) => ({ role: x.role, content: x.content }));
    const requestId = newRequestId();
    const useAgent = agentMode && Boolean(getState().workspace);
    stick.current = true;
    setTurns((x) => [
      ...x,
      { role: 'user', content: prompt, context: context.map((c) => c.source) },
      { role: 'assistant', content: '', parts: [] },
    ]);
    setInput('');
    setBusy(requestId);

    const update = (fn: (turn: Turn) => Turn) =>
      setTurns((x) => [...x.slice(0, -1), fn(x[x.length - 1]!)]);
    const updateStep = (id: string, fn: (s: ToolStep) => ToolStep) =>
      update((turn) => ({
        ...turn,
        parts: (turn.parts ?? []).map((p) => (p.kind === 'tool' && p.id === id ? fn(p) : p)),
      }));
    const appendText = (delta: string) =>
      update((turn) => {
        const parts = [...(turn.parts ?? [])];
        const last = parts[parts.length - 1];
        if (last?.kind === 'text')
          parts[parts.length - 1] = { kind: 'text', text: last.text + delta };
        else parts.push({ kind: 'text', text: delta });
        return { ...turn, content: turn.content + delta, parts };
      });

    const finish = () => {
      off();
      setBusy(null);
      void refreshSettings();
      textarea.current?.focus();
    };
    const off = api().on((ev) => {
      if (ev.type !== 'chat' || ev.requestId !== requestId) return;
      const e: ChatEventView = ev.event;
      switch (e.type) {
        case 'conversation':
          setConversationId(e.id);
          remember(e.id);
          break;
        case 'start':
          if (e.conversationId) setConversationId(e.conversationId);
          update((turn) => ({ ...turn, model: `${e.provider}/${e.model}` }));
          break;
        case 'text':
          appendText(e.delta);
          break;
        case 'reasoning':
          update((turn) => ({ ...turn, reasoning: (turn.reasoning ?? '') + e.delta }));
          break;
        case 'notice':
          update((turn) => ({ ...turn, notices: [...(turn.notices ?? []), e.message] }));
          break;
        case 'tool_call':
          update((turn) => ({
            ...turn,
            parts: [
              ...(turn.parts ?? []),
              { kind: 'tool', id: e.id, name: e.name, args: e.args, status: 'running' },
            ],
          }));
          break;
        case 'tool_approval':
          updateStep(e.id, (s) => ({ ...s, status: 'approval', preview: e.preview }));
          break;
        case 'tool_output':
          updateStep(e.id, (s) => ({ ...s, output: (s.output ?? '') + e.chunk }));
          break;
        case 'tool_result':
          updateStep(e.id, (s) => ({ ...s, status: e.ok ? 'ok' : 'error', summary: e.summary }));
          break;
        case 'file_changed':
          void reloadFromDisk(e.path);
          setChanged((c) => (c.includes(e.path) ? c : [...c, e.path]));
          break;
        case 'cost':
          update((turn) => ({
            ...turn,
            meta: metaLine(e),
          }));
          finish();
          break;
        case 'error':
          update((turn) => ({ ...turn, error: e.message }));
          finish();
          break;
        case 'done':
          break;
      }
    });
    await api().ai.chat(requestId, {
      agent: useAgent,
      // Main resolves the model for the role (agent / chat), falling back to the default.
      model: undefined,
      history,
      prompt,
      context,
      conversationId,
    });
  };

  askInChat = (prompt, context) => {
    setState({ chatOpen: true });
    if (prompt) void send(prompt, context);
    else setTimeout(() => textarea.current?.focus(), 50);
  };

  const decide = (toolCallId: string, d: ToolDecision) => {
    if (busy) void api().ai.toolDecision(busy, toolCallId, d);
  };

  const revert = async () => {
    if (!conversationId) return;
    if (!confirm(t('revertConfirm', { n: changed.length }))) return;
    const restored = await api().ai.revert(conversationId);
    for (const p of restored) await reloadFromDisk(p);
    setChanged([]);
    toast(t('reverted', { n: restored.length }));
  };

  const noProviders = models.length === 0 && !settings.defaultModel;

  return (
    <div className="chat">
      <div className="panel-header">
        <span className="panel-title">{t('chat').toUpperCase()}</span>
        <span className="sidebar-actions">
          <button
            title={t('histTitle')}
            className={showHistory ? 'on' : ''}
            onClick={() => setShowHistory((v) => !v)}
          >
            🕘
          </button>
          <button
            title={t('newChat')}
            onClick={() => {
              if (busy) void api().ai.abort(busy);
              setTurns([]);
              setConversationId(undefined);
              setChanged([]);
              setShowHistory(false);
              remember(undefined);
            }}
          >
            ＋
          </button>
          <button title="Cerrar" onClick={() => setState({ chatOpen: false })}>
            ×
          </button>
        </span>
      </div>
      {showHistory && (
        <ChatHistory
          current={conversationId}
          onOpen={(id) => void loadConversation(id)}
          onClose={() => setShowHistory(false)}
          onDeleted={(id) => {
            if (id === conversationId) {
              setTurns([]);
              setConversationId(undefined);
              remember(undefined);
            }
          }}
        />
      )}
      <div
        style={{ display: showHistory ? 'none' : undefined }}
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {turns.length === 0 && (
          <div className="chat-empty">
            <img className="chat-logo" src="./logo.svg" alt="" />
            {noProviders ? (
              <>
                <p>{t('noProviders')}</p>
                <button
                  className="primary"
                  onClick={() => setState({ modal: { kind: 'providers' } })}
                >
                  {t('connectProvider')}
                </button>
              </>
            ) : (
              <div className="dim chat-hints">
                <p>{agentMode ? t('agentHint') : t('chatHint')}</p>
                <p>
                  Ctrl+L · {t('includeFile')}
                  <br />
                  Ctrl+K · {t('aiEdit')}
                </p>
              </div>
            )}
          </div>
        )}
        {turns.map((turn, i) => {
          const last = i === turns.length - 1;
          return (
            <div key={i} className={`turn ${turn.role}`}>
              {turn.role === 'user' ? (
                <>
                  <div className="turn-user">{turn.content}</div>
                  {turn.context && turn.context.length > 0 && (
                    <div className="turn-context">
                      {turn.context
                        .map((c) => `📎 ${c.replace(/^(file|selection):/, '')}`)
                        .join('  ')}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="turn-model">
                    {(turn.model ?? settings.defaultModel) && (
                      <ProviderLogo
                        id={(turn.model ?? settings.defaultModel ?? '').split('/')[0]!}
                        size={16}
                      />
                    )}
                    {turn.model ?? settings.defaultModel ?? ''}
                  </div>
                  {turn.notices?.map((n, j) => (
                    <div key={j} className="turn-notice">
                      ⚠ {n}
                    </div>
                  ))}
                  {turn.reasoning && (
                    <details className="turn-reasoning">
                      <summary>💭</summary>
                      {turn.reasoning}
                    </details>
                  )}
                  {(turn.parts ?? []).map((p, j) =>
                    p.kind === 'text' ? (
                      <Markdown
                        key={j}
                        text={p.text}
                        streaming={busy !== null && last && j === (turn.parts?.length ?? 0) - 1}
                      />
                    ) : (
                      <ToolCard key={p.id} step={p} onDecide={(d) => decide(p.id, d)} />
                    ),
                  )}
                  {busy !== null && last && !turn.content && !turn.parts?.length && !turn.error && (
                    <div className="typing">●●●</div>
                  )}
                  {turn.error && (
                    <div className="turn-error">
                      ✗ {turn.error}
                      {/key|llave|401/i.test(turn.error) && (
                        <button onClick={() => setState({ modal: { kind: 'providers' } })}>
                          {t('providers')}
                        </button>
                      )}
                      {/tool|function/i.test(turn.error) && agentMode && (
                        <button onClick={() => setAgentMode(false)}>{t('agentOff')}</button>
                      )}
                    </div>
                  )}
                  {turn.meta && <div className="turn-meta">{turn.meta}</div>}
                </>
              )}
            </div>
          );
        })}
      </div>
      {changed.length > 0 && !busy && (
        <div className="agent-changes">
          ✏️ {t('agentChanged', { n: changed.length })}
          <button onClick={() => void revert()}>↶ {t('revert')}</button>
        </div>
      )}
      <div className="chat-input">
        <textarea
          ref={textarea}
          value={input}
          rows={3}
          placeholder={agentMode && workspace ? t('agentPlaceholder') : t('askPlaceholder')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <div className="chat-input-bar">
          <label className="check agent-toggle" title={t('agentTitle')}>
            <input
              type="checkbox"
              checked={agentMode}
              onChange={(e) => setAgentMode(e.target.checked)}
            />
            🤖 {t('agent')}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={includeFile}
              onChange={(e) => setIncludeFile(e.target.checked)}
            />
            📎 {active ? active.split('/').pop() : t('includeFile')}
          </label>
          <button
            className="model-chip"
            onClick={() =>
              setState({ modal: { kind: 'models', role: agentMode ? 'agent' : 'chat' } })
            }
            title={t('pickModel')}
          >
            {(agentMode ? settings.roles.agent : undefined) ??
              settings.defaultModel ??
              t('noModel')}{' '}
            ▾
          </button>
          {busy ? (
            <button className="danger" onClick={() => void api().ai.abort(busy)}>
              ■ {t('stop')}
            </button>
          ) : (
            <button className="primary" disabled={!input.trim()} onClick={() => void send(input)}>
              {t('send')} ⏎
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
