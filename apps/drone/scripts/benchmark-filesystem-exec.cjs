// Read-only exec overhead probe. Run from the repository with Docker access:
// node apps/drone/scripts/benchmark-filesystem-exec.cjs <exact-container-name> [pairs=10]
// Only stats /etc/hostname; never prints container names, IDs, or file contents.
const Docker = require('dockerode');
const { performance } = require('node:perf_hooks');
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
(async () => {
  const name = process.argv[2];
  const pairs = Number(process.argv[3] ?? 10);
  if (!name || !Number.isInteger(pairs) || pairs < 1 || pairs > 100)
    throw new Error('Usage: benchmark-filesystem-exec.cjs <exact-container-name> [pairs=1..100]');
  const docker = new Docker();
  const listed = await docker.listContainers({ all: true });
  const target = listed.find((item) => item.Id === name || item.Names.includes(`/${name}`));
  if (!target || target.State !== 'running') throw new Error('Expected an exact running container name or full ID');
  const samples = [];
  for (let i = 0; i < pairs; i++) {
    for (const lookup of i % 2 ? [false, true] : [true, false]) {
      const started = performance.now();
      const id = lookup
        ? (await docker.listContainers({ all: true })).find((item) => item.Id === target.Id)?.Id
        : name;
      if (!id) throw new Error('Container disappeared');
      const lookupMs = performance.now() - started;
      const exec = await docker.getContainer(id).exec({
        Cmd: ['bash', '-lc', 'stat -c %s /etc/hostname >/dev/null'],
        AttachStdout: true, AttachStderr: true, Tty: false,
      });
      const stream = await exec.start({ hijack: true, stdin: false });
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { stream.destroy(); reject(new Error('Probe timed out')); }, 10000);
        stream.once('end', () => { clearTimeout(timeout); resolve(); });
        stream.once('error', (error) => { clearTimeout(timeout); reject(error); });
        stream.resume();
      });
      if ((await exec.inspect()).ExitCode !== 0) throw new Error('Read-only probe failed');
      samples.push({ lookup, lookupMs, totalMs: performance.now() - started });
    }
  }
  console.log(JSON.stringify({
    containerCount: listed.length, listResponseBytes: Buffer.byteLength(JSON.stringify(listed)), pairs,
    variants: [true, false].map((lookup) => ({ lookup,
      medianLookupMs: median(samples.filter((sample) => sample.lookup === lookup).map((sample) => sample.lookupMs)),
      medianTotalMs: median(samples.filter((sample) => sample.lookup === lookup).map((sample) => sample.totalMs)),
    })), samples,
  }, null, 2));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
