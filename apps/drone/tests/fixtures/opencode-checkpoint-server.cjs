#!/usr/bin/env node
// Protocol fixture: no model calls or access to real provider sessions.
const http = require('node:http');
const fs = require('node:fs');
if (process.argv[2] !== 'serve') process.exit(2);
const source = [
  { info: { id: 'user', role: 'user', sessionID: 'source' }, parts: [] },
  {
    info: { id: 'answer', role: 'assistant', sessionID: 'source', parentID: 'user' },
    parts: [
      {
        id: 'text',
        type: 'text',
        text: 'completed answer',
        sessionID: 'source',
        messageID: 'answer',
      },
    ],
  },
  { info: { id: 'next-user', role: 'user', sessionID: 'source' }, parts: [] },
];
let forked;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const auth = `Basic ${Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`;
  if (req.headers.authorization !== auth || url.searchParams.get('directory') !== process.cwd()) {
    res.writeHead(403).end();
    return;
  }
  res.setHeader('content-type', 'application/json');
  if (req.method === 'POST' && url.pathname === '/session/source/fork') {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (JSON.parse(body).messageID !== 'next-user') {
      res.writeHead(400).end('{}');
      return;
    }
    forked = source.slice(0, 2).map((message) => ({
      info: {
        ...message.info,
        id: `copy-${message.info.id}`,
        sessionID: 'fork',
        ...(message.info.parentID ? { parentID: `copy-${message.info.parentID}` } : {}),
      },
      parts: message.parts.map((part) => ({
        ...part,
        id: `copy-${part.id}`,
        messageID: `copy-${part.messageID}`,
        sessionID: 'fork',
      })),
    }));
    res.end(JSON.stringify({ id: 'fork' }));
    return;
  }
  if (url.pathname === '/session/source/message') {
    res.end(JSON.stringify(source));
    return;
  }
  if (url.pathname === '/session/fork/message' && forked) {
    res.end(JSON.stringify(forked));
    return;
  }
  res.writeHead(404).end('{}');
});
server.listen(0, '127.0.0.1', () => {
  console.log(`opencode server listening on http://127.0.0.1:${server.address().port}`);
});
process.once('SIGTERM', () => {
  fs.writeFileSync(process.env.CHECKPOINT_TEST_EXIT_MARKER, 'stopped');
  server.close();
  server.closeAllConnections();
});
