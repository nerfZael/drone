import cp from 'node:child_process';

type SocketListenSupport = {
  ok: boolean;
  detail: string;
};

let cachedResult: SocketListenSupport | null = null;

export function getSocketListenSupport(): SocketListenSupport {
  if (cachedResult) return cachedResult;
  const probeScript = `
    const net = require("node:net");
    const server = net.createServer();
    server.once("error", (error) => {
      const detail = error && (error.code || error.message) ? String(error.code || error.message) : String(error);
      console.error(detail);
      process.exit(1);
    });
    server.listen(0, "127.0.0.1", () => {
      server.close(() => process.exit(0));
    });
    setTimeout(() => {
      console.error("listen probe timed out");
      process.exit(1);
    }, 3000).unref();
  `;
  const result = cp.spawnSync(process.execPath, ['-e', probeScript], {
    encoding: 'utf8',
    timeout: 5000,
  });

  if (result.status === 0) {
    cachedResult = { ok: true, detail: '' };
    return cachedResult;
  }

  const detail = [String(result.stdout ?? '').trim(), String(result.stderr ?? '').trim()]
    .filter(Boolean)
    .join(' | ');
  cachedResult = {
    ok: false,
    detail: detail || `listen probe exited with status ${String(result.status ?? 'unknown')}`,
  };
  return cachedResult;
}
