import { describe, expect, it } from 'vitest';
import {
  answerResult,
  CHAT_MODES,
  isPlanApproval,
  modeFrom,
  nextMode,
  parseQuestion,
  parseTodos,
  planAllows,
  planApprovedPrompt,
  planStates,
  todoProgress,
  todosResult,
  usesAgent,
} from '../src/shared/agentModes';

describe('chat modes', () => {
  it('Shift+Tab cycles ask → plan → agent → auto → ask, and back', () => {
    expect(CHAT_MODES.map((m) => nextMode(m))).toEqual(['plan', 'agent', 'auto', 'ask']);
    expect(nextMode('ask', true)).toBe('auto');
    expect(nextMode('plan', true)).toBe('ask');
  });

  it('reads chats saved before modes existed', () => {
    expect(modeFrom(undefined, false)).toBe('ask');
    expect(modeFrom(undefined, true)).toBe('agent');
    expect(modeFrom(undefined)).toBe('agent');
    expect(modeFrom('plan', false)).toBe('plan');
    expect(modeFrom('bogus', false)).toBe('ask');
  });

  it('only ask mode works without the agent', () => {
    expect(CHAT_MODES.filter(usesAgent)).toEqual(['plan', 'agent', 'auto']);
  });
});

describe('plan mode tools', () => {
  const ro = new Set(['read_file', 'search', 'tree']);
  it('allows reading, the task list, questions and helpers', () => {
    for (const n of ['read_file', 'search', 'todo_write', 'ask_user', 'browser_read', 'task'])
      expect(planAllows(n, ro)).toBe(true);
  });
  it('refuses every tool that changes something', () => {
    for (const n of [
      'edit_file',
      'write_file',
      'run_command',
      'browser_click',
      'browser_type',
      'mail_send',
      'write_system_file',
      'remember',
    ])
      expect(planAllows(n, ro)).toBe(false);
  });
  it('MCP tools pass only when marked read-only', () => {
    expect(planAllows('mcp__db__query', ro)).toBe(false);
    expect(planAllows('mcp__db__query', ro, false)).toBe(false);
    expect(planAllows('mcp__db__list', ro, true)).toBe(true);
  });
  it('the approved plan becomes the message that starts the work', () => {
    expect(planApprovedPrompt('  ## Pasos\n1. x  ')).toMatch(
      /^Apruebo este plan[^\n]*\n\n## Pasos\n1\. x$/,
    );
    expect(planApprovedPrompt('p', 'en')).toMatch(/^I approve this plan/);
  });
});

describe('todo_write', () => {
  it('cleans the list', () => {
    const r = parseTodos([
      { content: '  Leer código ', status: 'completed' },
      { content: 'Editar', status: 'in_progress', activeForm: 'Editando' },
      { content: 'Probar', status: 'raro' },
      { content: 'Editar', status: 'pending' },
    ]);
    expect(r).toEqual({
      todos: [
        { content: 'Leer código', status: 'completed' },
        { content: 'Editar', status: 'in_progress', activeForm: 'Editando' },
        { content: 'Probar', status: 'pending' },
      ],
    });
  });
  it('refuses unusable input', () => {
    expect(parseTodos('x')).toHaveProperty('error');
    expect(parseTodos([{ status: 'pending' }])).toHaveProperty('error');
    expect(parseTodos(Array.from({ length: 51 }, (_, i) => ({ content: `t${i}` })))).toHaveProperty(
      'error',
    );
  });
  it('reports progress back to the model', () => {
    const todos = parseTodos([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'in_progress' },
    ]);
    if ('error' in todos) throw new Error(todos.error);
    expect(todoProgress(todos.todos)).toEqual({ done: 1, total: 3 });
    const text = todosResult(todos.todos);
    expect(text).toContain('(1/3 done)');
    expect(text).toContain('[x] a');
    expect(text).toContain('[~] b');
    expect(text).toContain('only one task in_progress');
    expect(todosResult([])).toBe('Task list cleared.');
  });
});

describe('ask_user', () => {
  it('needs a question and 2 to 6 distinct options', () => {
    expect(parseQuestion({ question: '¿Qué base?', options: ['Postgres', 'SQLite'] })).toEqual({
      question: '¿Qué base?',
      options: ['Postgres', 'SQLite'],
      multiple: false,
    });
    expect(parseQuestion({ options: ['a', 'b'] })).toHaveProperty('error');
    expect(parseQuestion({ question: 'q', options: ['a', 'a', ' '] })).toHaveProperty('error');
    expect(
      parseQuestion({ question: 'q', options: ['1', '2', '3', '4', '5', '6', '7'] }),
    ).toHaveProperty('error');
  });
  it('tells the model what the user chose', () => {
    const q = { question: '¿Qué base?', options: ['Postgres', 'SQLite'], multiple: true };
    expect(answerResult(q, ['SQLite'])).toBe('The user answered "¿Qué base?":\n- SQLite');
    expect(answerResult(q, ['Mongo'])).toContain('Mongo (in their own words)');
    expect(answerResult(q, null)).toMatch(/did not answer/);
    expect(answerResult(q, [])).toMatch(/did not answer/);
  });
});

describe('plan states (also after reopening a conversation)', () => {
  const u = (content: string) => ({ role: 'user' as const, content });
  const plan = (extra: object = {}) => ({
    role: 'assistant' as const,
    content: '## Objetivo: x',
    mode: 'plan' as const,
    ...extra,
  });

  it('knows the approval message in both languages', () => {
    expect(isPlanApproval(planApprovedPrompt('1. a', 'es'))).toBe(true);
    expect(isPlanApproval(planApprovedPrompt('1. a', 'en'))).toBe(true);
    expect(isPlanApproval('apruebo')).toBe(false);
  });

  it('the last plan is open; an approved one stays approved; a plan left behind shows nothing', () => {
    const turns = [
      u('plan a'),
      plan(),
      u('cambia el paso 2'),
      plan(),
      u(planApprovedPrompt('1. b')),
      { role: 'assistant' as const, content: 'hecho', mode: 'agent' as const },
      u('otra cosa'),
      plan(),
    ];
    expect(planStates(turns)).toEqual([null, null, null, 'approved', null, null, null, 'open']);
  });

  it('a verdict given in the session wins; failed or empty answers are not plans', () => {
    expect(planStates([u('a'), plan({ plan: 'rejected' })])).toEqual([null, 'rejected']);
    expect(planStates([u('a'), plan({ error: 'boom' })])).toEqual([null, null]);
    expect(planStates([u('a'), plan({ content: '  ' })])).toEqual([null, null]);
    expect(planStates([u('a'), { role: 'assistant' as const, content: 'x' }])).toEqual([
      null,
      null,
    ]);
  });
});
