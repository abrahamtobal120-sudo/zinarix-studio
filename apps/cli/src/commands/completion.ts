import type { Command } from 'commander';
import { OmniError } from '@omni/shared';
import { outln } from '../io.js';

interface Node {
  name: string;
  subs: string[];
  flags: string[];
}

function walk(cmd: Command): Node[] {
  return cmd.commands.map((c) => ({
    name: c.name(),
    subs: c.commands.map((s) => s.name()),
    flags: c.options.map((o) => o.long ?? o.short ?? '').filter(Boolean),
  }));
}

export function completionScript(program: Command, shell: string): string {
  const nodes = walk(program);
  const top = nodes.map((n) => n.name).join(' ');
  switch (shell) {
    case 'bash':
      return `# omni bash completion — add to ~/.bashrc: eval "$(omni completion bash)"
_omni() {
  local cur=\${COMP_WORDS[COMP_CWORD]} cmd=\${COMP_WORDS[1]}
  if [ "$COMP_CWORD" -eq 1 ]; then COMPREPLY=($(compgen -W "${top}" -- "$cur")); return; fi
  case "$cmd" in
${nodes.map((n) => `    ${n.name}) COMPREPLY=($(compgen -W "${[...n.subs, ...n.flags].join(' ')}" -- "$cur"));;`).join('\n')}
  esac
}
complete -F _omni omni`;
    case 'zsh':
      return `#compdef omni
# add to ~/.zshrc: eval "$(omni completion zsh)"
_omni() {
  if (( CURRENT == 2 )); then compadd ${top}; return; fi
  case $words[2] in
${nodes.map((n) => `    ${n.name}) compadd -- ${[...n.subs, ...n.flags].join(' ')};;`).join('\n')}
  esac
}
compdef _omni omni`;
    case 'fish':
      return [
        '# omni fish completion: omni completion fish > ~/.config/fish/completions/omni.fish',
        `complete -c omni -f -n '__fish_use_subcommand' -a '${top}'`,
        ...nodes.map(
          (n) =>
            `complete -c omni -f -n '__fish_seen_subcommand_from ${n.name}' -a '${[...n.subs, ...n.flags].join(' ')}'`,
        ),
      ].join('\n');
    case 'powershell':
      return `# omni PowerShell completion: omni completion powershell | Out-String | Invoke-Expression
$omniTree = @{
${nodes.map((n) => `  '${n.name}' = @(${[...n.subs, ...n.flags].map((s) => `'${s}'`).join(', ')})`).join('\n')}
}
Register-ArgumentCompleter -Native -CommandName omni -ScriptBlock {
  param($wordToComplete, $commandAst)
  $words = $commandAst.CommandElements | ForEach-Object { $_.ToString() }
  $candidates = if ($words.Count -le 2 -and -not ($words.Count -eq 2 -and $wordToComplete -eq '')) { $omniTree.Keys } else { $omniTree[$words[1]] }
  $candidates | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
}`;
    default:
      throw new OmniError('config', `unknown shell "${shell}" (bash | zsh | fish | powershell)`);
  }
}

export function registerCompletion(program: Command): void {
  program
    .command('completion <shell>')
    .description('Script de autocompletado: bash | zsh | fish | powershell')
    .action((shell: string) => outln(completionScript(program, shell)));
}
