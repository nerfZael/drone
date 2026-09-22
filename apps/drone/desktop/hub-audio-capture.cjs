// Small lifetime guard: the desktop owns stdin. Even a desktop crash closes that pipe,
// so capture stops instead of leaving an orphan recording the microphone indefinitely.
const { spawn } = require('node:child_process');
const { captureArgs } = require('./hub-desktop-recordings.cjs');
const child = spawn('ffmpeg', captureArgs(process.argv[2], process.argv[3]), { stdio: ['pipe', 'ignore', 'pipe'] });
child.stderr.pipe(process.stderr);
child.stdin.on('error', () => {});
let killTimer;
let leaseTimer;
function stop() {
  if (killTimer) return;
  clearTimeout(leaseTimer);
  child.stdin.write('q\n');
  killTimer = setTimeout(() => child.kill('SIGKILL'), 8000);
}
function renewLease() {
  if (killTimer) return;
  clearTimeout(leaseTimer);
  // Shorter than the Hub's 60-second expiry, even allowing for a delayed heartbeat
  // response and forced shutdown. A stalled desktop must not leave an active writer
  // in a bundle that the Hub can now retry, move or delete.
  leaseTimer = setTimeout(() => {
    process.stderr.write('Capture stopped because its connection to Drone Hub was lost.\n');
    stop();
  }, 30_000);
}
let input = '';
process.stdin.on('data', chunk => {
  input += chunk.toString();
  let end;
  while ((end = input.indexOf('\n')) >= 0) {
    const command = input.slice(0, end);
    input = input.slice(end + 1);
    if (command === 'heartbeat') renewLease(); else stop();
  }
});
process.stdin.on('end', stop);
// The desktop can disappear while FFmpeg is logging. EPIPE must trigger shutdown,
// rather than crashing this guard before it has stopped the recorder.
process.stderr.on('error', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.stdin.resume();
renewLease();
child.once('error', error => { process.stderr.write(error.message); });
child.once('close', code => { clearTimeout(killTimer); clearTimeout(leaseTimer); process.exit(code ?? 1); });
