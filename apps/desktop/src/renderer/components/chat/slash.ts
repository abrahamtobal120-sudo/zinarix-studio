import type { AgentKitView } from '../../../shared/api';
import { expandCommand, skillPrompt } from '../../../shared/agentKit';
import type { ChatMode } from '../../../shared/agentModes';
import { runCommand } from '../../commands';
import { errText } from '../../errText';
import { t } from '../../i18n';
import { api, newChat, setState, toast } from '../../store';
import { findSlash } from './helpers';

/** What a "/" command needs from the chat it was typed in. */
export interface SlashHost {
  /** The project's own "/" commands and skills (.zinarix), and the user's. */
  commands: AgentKitView['commands'];
  skills: AgentKitView['skills'];
  /** Files of the folder, for "/fases <file.md>". */
  files: string[];
  busy: boolean;
  /** Folder the chat works in (undefined: none). */
  root: string | undefined;
  /** Set when that folder is the chat's own, not the window's. */
  ownFolder: string | undefined;
  /** Empties the box and closes the "/" menu. */
  clearInput: () => void;
  send: (prompt: string, agent: boolean) => void;
  resetChat: () => void;
  setAgentMode: (on: boolean) => void;
  setChatMode: (mode: ChatMode, announce?: boolean) => void;
  openPhases: (path: string) => void;
  pickPhases: () => void;
  compact: () => void;
}

/** Runs a "/" command; resolves true when it was handled without sending the text as typed. */
export async function runSlashCommand(text: string, host: SlashHost): Promise<boolean> {
  const m = /^\/(\S+)\s*([\s\S]*)$/.exec(text.trim());
  if (!m) return false;
  const cmd = findSlash(m[1]!);
  if (!cmd) {
    // A "/" command of the project (or the user): its file is the prompt.
    const name = m[1]!.toLowerCase();
    const own = host.commands.find((c) => c.name === name);
    if (own) {
      host.clearInput();
      host.send(expandCommand(own.body, m[2]!), own.agent === true);
      return true;
    }
    // /<skill>: the agent loads that skill and applies it (skills need agent mode).
    const skill = host.skills.find((k) => k.name === name);
    if (!skill) return false;
    host.clearInput();
    host.send(skillPrompt(skill.name, m[2]!), true);
    return true;
  }
  const rest = m[2]!.trim();
  host.clearInput();
  switch (cmd.action) {
    case 'new':
      if (host.busy) newChat();
      else host.resetChat();
      return true;
    case 'agent':
      host.setAgentMode(true);
      toast(t('agentOnToast'));
      return true;
    case 'chat':
      host.setAgentMode(false);
      toast(t('agentOffToast'));
      return true;
    case 'plan':
      host.setChatMode('plan', true);
      return true;
    case 'phases': {
      // /fases <file.md> analyses that file; /fases alone opens the picker.
      const path = rest.replace(/^@/, '');
      if (path && host.files.includes(path)) host.openPhases(path);
      else host.pickPhases();
      return true;
    }
    case 'rules':
      void runCommand('ai.rules');
      return true;
    case 'compact':
      host.compact();
      return true;
    case 'docs': {
      // /indexar <name> <url> · /indexar <url> · /indexar (list what is indexed)
      const parts = rest.split(/\s+/).filter(Boolean);
      const url = parts.find((p) => /^https?:\/\//i.test(p));
      if (!url) {
        const docs = await api()
          .knowledge.docs()
          .catch(() => []);
        toast(
          docs.length
            ? `${docs.map((d) => `@docs:${d.name} · ${d.status}`).join(' · ')} — ${t('docsUsage')}`
            : t('docsListEmpty'),
        );
        return true;
      }
      const name = parts.filter((p) => p !== url).join('-');
      try {
        const d = await api().knowledge.addDocs(name, url);
        toast(t('docsAdded', { name: d.name }));
      } catch (e) {
        toast(errText(e));
      }
      return true;
    }
    case 'commit':
      if (!host.root) {
        toast(t('noFolder'));
        return true;
      }
      if (!host.ownFolder) setState({ sidebar: 'git' });
      host.send(t('slashCommitPrompt'), true);
      return true;
  }
  if (cmd.name === 'init' && !host.root) {
    toast(t('noFolder'));
    return true;
  }
  host.send(rest ? `${cmd.prompt}\n\n${rest}` : cmd.prompt!, Boolean(cmd.agent));
  return true;
}
