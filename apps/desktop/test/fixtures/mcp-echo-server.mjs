// Minimal stdio MCP server for tests: one "echo" tool and one destructive "wipe.all" tool.
import { createInterface } from 'node:readline';

const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
console.error('echo server starting'); // stderr logs must be ignored
process.stdout.write('not json log line\n'); // so must non-JSON stdout lines

createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  if (m.method === 'initialize')
    return out({
      jsonrpc: '2.0',
      id: m.id,
      result: {
        protocolVersion: m.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'echo' },
      },
    });
  if (m.method === 'tools/list')
    return out({
      jsonrpc: '2.0',
      id: m.id,
      result: {
        tools: [
          {
            name: 'echo',
            description: 'Echoes text',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
          },
          {
            name: 'wipe.all',
            description: 'Deletes',
            inputSchema: { type: 'object' },
            annotations: { destructiveHint: true },
          },
        ],
      },
    });
  if (m.method === 'tools/call')
    return out({
      jsonrpc: '2.0',
      id: m.id,
      result: {
        content: [
          { type: 'text', text: `echo: ${m.params.arguments.text ?? ''}` },
          { type: 'image', data: 'AAAA', mimeType: 'image/png' },
        ],
      },
    });
  out({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'nope' } });
});
