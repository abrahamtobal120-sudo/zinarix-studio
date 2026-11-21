import { describe, expect, it } from 'vitest';
import { LSP_LANGUAGES, installCommand } from '../src/shared/lsp.js';

describe('installing a language server with a click', () => {
  it('takes the runnable command from the install hint, for this platform', () => {
    expect(installCommand('npm i -g pyright', 'win32')).toBe('npm i -g pyright');
    expect(installCommand('pip install basedpyright', 'linux')).toBe('pip install basedpyright');
    const clangd = 'instala LLVM/clangd (winget install LLVM.LLVM · apt install clangd)';
    expect(installCommand(clangd, 'win32')).toBe('winget install LLVM.LLVM');
    expect(installCommand(clangd, 'linux')).toBe('apt install clangd');
    expect(installCommand(clangd, 'darwin')).toBeNull();
    const lua = 'winget install LuaLS.lua-language-server · brew install lua-language-server';
    expect(installCommand(lua, 'darwin')).toBe('brew install lua-language-server');
  });

  it('leaves descriptions and web pages to the user', () => {
    expect(installCommand('github.com/elixir-lsp/elixir-ls', 'win32')).toBeNull();
    expect(installCommand('viene con el toolchain de Swift', 'darwin')).toBeNull();
    expect(installCommand('OmniSharp', 'win32')).toBeNull();
  });

  it('gives most common languages a one-click install on Windows', () => {
    const one = (id: string) =>
      LSP_LANGUAGES.find((l) => l.ids.includes(id))!.candidates.some((c) => installCommand(c.install, 'win32'));
    for (const id of ['python', 'go', 'rust', 'cpp', 'csharp', 'php', 'ruby', 'lua', 'shell', 'yaml']) expect(one(id), id).toBe(true);
  });
});
