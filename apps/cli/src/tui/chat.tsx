import { useCallback, useRef, useState } from 'react';
import { Box, Static, Text, render, useApp, useInput } from 'ink';
import type { OmniCore } from '@omni/core';
import { parseModelRef } from '@omni/core';
import { t } from '@omni/shared';
import type { ChatMessage } from '@omni/shared';
import { redact } from '@omni/security';
import { fmtTokens, fmtUsd } from '../io.js';

interface Line {
  id: number;
  kind: 'user' | 'assistant' | 'info' | 'error';
  text: string;
  meta?: string;
}

export interface ChatAppProps {
  core: OmniCore;
  initialModel: string;
  system?: string;
}

export function ChatApp({ core, initialModel, system }: ChatAppProps) {
  const { exit } = useApp();
  const [model, setModel] = useState(initialModel);
  const [lines, setLines] = useState<Line[]>([
    { id: 0, kind: 'info', text: t('chat.welcome', { model: initialModel }) },
  ]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [spent, setSpent] = useState(0);
  const history = useRef<ChatMessage[]>(system ? [{ role: 'system', content: system }] : []);
  const convId = useRef<string | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  const nextId = useRef(1);

  const push = useCallback(
    (l: Omit<Line, 'id'>) => setLines((prev) => [...prev, { ...l, id: nextId.current++ }]),
    [],
  );

  const send = useCallback(
    async (text: string) => {
      const userMsg: ChatMessage = { role: 'user', content: text };
      history.current.push(userMsg);
      push({ kind: 'user', text });
      if (!convId.current) convId.current = core.history.create(text.split('\n')[0]!, model).id;
      core.history.append(convId.current, userMsg);

      setBusy(true);
      const ctrl = new AbortController();
      abort.current = ctrl;
      let answer = '';
      let meta = '';
      let ref = model;
      try {
        for await (const ev of core.stream({ model, messages: history.current }, ctrl.signal)) {
          if (ev.type === 'start') ref = `${ev.provider}/${ev.model}`;
          else if (ev.type === 'text') {
            answer += ev.delta;
            setStreaming(answer);
          } else if (ev.type === 'notice') {
            push({
              kind: 'info',
              text:
                ev.kind === 'redaction' ? t('redaction.notice', { count: ev.message }) : ev.message,
            });
          } else if (ev.type === 'cost') {
            meta = `${ref} · ${fmtTokens(ev.inputTokens)}→${fmtTokens(ev.outputTokens)} · ${fmtUsd(ev.usd)} · ${(ev.latencyMs / 1000).toFixed(1)}s`;
            setSpent((s) => s + (ev.usd ?? 0));
          }
        }
        const msg: ChatMessage = { role: 'assistant', content: answer };
        history.current.push(msg);
        core.history.append(convId.current, msg, ref);
        push({ kind: 'assistant', text: answer, meta });
      } catch (e) {
        history.current.pop();
        if (answer) push({ kind: 'assistant', text: answer, meta: 'interrumpido' });
        push({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
      } finally {
        setStreaming('');
        setBusy(false);
        abort.current = undefined;
      }
    },
    [core, model, push],
  );

  const command = useCallback(
    (cmd: string) => {
      const [name, ...rest] = cmd.slice(1).split(/\s+/);
      const arg = rest.join(' ');
      switch (name) {
        case 'exit':
        case 'quit':
          exit();
          return;
        case 'clear':
          history.current = system ? [{ role: 'system', content: system }] : [];
          convId.current = undefined;
          push({ kind: 'info', text: '— nueva conversación —' });
          return;
        case 'model':
          try {
            parseModelRef(arg);
            core.provider(arg.split('/')[0]!);
            setModel(arg);
            push({ kind: 'info', text: t('chat.switched', { model: arg }) });
          } catch (e) {
            push({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
          }
          return;
        default:
          push({ kind: 'error', text: `/${name}? → /model <p/m> · /clear · /exit` });
      }
    },
    [core, exit, push, system],
  );

  useInput((ch, key) => {
    if (key.ctrl && ch === 'c') {
      if (abort.current) abort.current.abort();
      else exit();
      return;
    }
    if (busy) return;
    if (key.return) {
      const text = input.trim();
      setInput('');
      if (!text) return;
      if (text.startsWith('/')) command(text);
      else void send(text);
      return;
    }
    if (key.backspace || key.delete) setInput((s) => s.slice(0, -1));
    else if (ch && !key.ctrl && !key.meta) setInput((s) => s + ch);
  });

  return (
    <Box flexDirection="column">
      <Static items={lines}>
        {(l) => (
          <Box key={l.id} flexDirection="column" marginBottom={l.kind === 'assistant' ? 1 : 0}>
            {l.kind === 'user' && <Text color="cyan">› {redact(l.text)}</Text>}
            {l.kind === 'assistant' && <Text>{redact(l.text)}</Text>}
            {l.kind === 'assistant' && l.meta && <Text dimColor>{l.meta}</Text>}
            {l.kind === 'info' && <Text dimColor>{l.text}</Text>}
            {l.kind === 'error' && <Text color="red">✗ {redact(l.text)}</Text>}
          </Box>
        )}
      </Static>
      {busy && (
        <Text>{streaming ? redact(streaming) : <Text dimColor>{t('chat.thinking')}</Text>}</Text>
      )}
      <Box borderStyle="round" borderColor={busy ? 'gray' : 'cyan'} paddingX={1}>
        <Text>{input || <Text dimColor>…</Text>}</Text>
      </Box>
      <Text dimColor>
        ⚡ {model} · {fmtUsd(spent)} esta sesión · Ctrl+C {busy ? 'detiene' : 'sale'}
      </Text>
    </Box>
  );
}

export async function runChat(core: OmniCore, model: string, system?: string): Promise<void> {
  const app = render(<ChatApp core={core} initialModel={model} system={system} />, {
    exitOnCtrlC: false,
  });
  await app.waitUntilExit();
}
