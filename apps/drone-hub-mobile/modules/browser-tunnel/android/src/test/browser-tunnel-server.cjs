// Real OkHttp/WebSocket compatibility fixture; never connects to a running Hub.
const http = require('node:http');
const net = require('node:net');
const { WebSocketServer, createWebSocketStream } = require('ws');
const app = http.createServer(async (req, res) => {
  let bytes = 0;
  for await (const chunk of req) bytes += chunk.length;
  const body = Buffer.from(req.method === 'POST' ? String(bytes) : 'browser-asset-'.repeat(50000));
  res.writeHead(200, { 'content-length': body.length, 'content-type': 'text/plain' });
  res.end(body);
});
app.listen(0, '127.0.0.1', () => {
  const server = http.createServer();
  const wss = new WebSocketServer({
    server,
    maxPayload: 64 * 1024,
    perMessageDeflate: {
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
      threshold: 1024,
      concurrencyLimit: 4,
      zlibDeflateOptions: { level: 1 },
    },
  });
  wss.on('connection', (ws) => {
    const stream = createWebSocketStream(ws);
    const upstream = net.connect(app.address().port, '127.0.0.1');
    stream.on('error', () => upstream.destroy());
    upstream.on('error', () => stream.destroy());
    ws.on('close', () => {
      stream.destroy();
      upstream.destroy();
    });
    stream.pipe(upstream).pipe(stream);
  });
  server.listen(0, '127.0.0.1', () => console.log(server.address().port));
});
