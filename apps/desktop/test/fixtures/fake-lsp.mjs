// A tiny language server for tests (stdio, JSON-RPC): every line of a document that has the
// word BAD is an error. It publishes twice, like real servers do (syntax, then types).
let buf = Buffer.alloc(0);
const send = (msg) => {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...msg }), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
};
const publish = (uri, text) => {
  const diagnostics = text.split('\n').flatMap((line, i) => {
    const at = line.indexOf('BAD');
    return at < 0
      ? []
      : [
          {
            severity: 1,
            code: 'E1',
            message: 'bad name',
            range: { start: { line: i, character: at }, end: { line: i, character: at + 3 } },
          },
        ];
  });
  send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [] } });
  setTimeout(
    () => send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } }),
    60,
  );
};
const handle = (m) => {
  if (m.method === 'initialize') send({ id: m.id, result: { capabilities: {} } });
  else if (m.method === 'shutdown') send({ id: m.id, result: null });
  else if (m.method === 'exit') process.exit(0);
  else if (m.method === 'textDocument/didOpen')
    publish(m.params.textDocument.uri, m.params.textDocument.text);
  else if (m.method === 'textDocument/didChange')
    publish(m.params.textDocument.uri, m.params.contentChanges[0].text);
  else if (m.id !== undefined && m.method) send({ id: m.id, result: null });
};
process.stdin.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const end = buf.indexOf('\r\n\r\n');
    if (end < 0) return;
    const len = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, end).toString())?.[1]);
    if (buf.length < end + 4 + len) return;
    const body = buf.subarray(end + 4, end + 4 + len).toString('utf8');
    buf = buf.subarray(end + 4 + len);
    handle(JSON.parse(body));
  }
});
