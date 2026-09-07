// Read-only Docker media probe. Prints timings and byte counts, never file contents.
// Usage: node apps/drone/scripts/benchmark-filesystem-media.cjs <exact-container-name>
const Docker = require('dockerode');
const { PassThrough } = require('node:stream');
const { buildContainerMediaRangeScript, containerMediaPhases } = require('../dist/hub/filesystem-media-range');

(async () => {
  const name = process.argv[2];
  if (!name) throw new Error('Expected an exact running container name');
  const docker = new Docker();
  const container = docker.getContainer(name);
  const samples = [];
  for (const includeBody of [false, true]) {
    const script = buildContainerMediaRangeScript({ targetPath: '/etc/hostname', maxBytes: 1024,
      requestedRange: { kind: 'full' }, includeRevision: false, includeBody });
    const started = performance.now();
    const exec = await container.exec({ Cmd: ['bash', '-lc', script], AttachStdout: true, AttachStderr: true });
    const stream = await exec.start({ hijack: true, stdin: false });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let bytes = 0;
    let diagnostic = '';
    stdout.on('data', (chunk) => { bytes += chunk.length; });
    stderr.on('data', (chunk) => { diagnostic = (diagnostic + chunk.toString()).slice(-4096); });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { stream.destroy(); reject(new Error('Media probe timed out')); }, 10000);
      stream.once('end', () => { clearTimeout(timer); resolve(); });
      stream.once('error', (error) => { clearTimeout(timer); reject(error); });
      docker.modem.demuxStream(stream, stdout, stderr);
    });
    const result = await exec.inspect();
    if (result.ExitCode !== 0) throw new Error('Media probe failed');
    samples.push({ includeBody, durationMs: performance.now() - started, responseBytes: bytes,
      phases: Object.fromEntries(containerMediaPhases(diagnostic)) });
  }
  console.log(JSON.stringify({ samples }, null, 2));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
