import { spawn } from 'node:child_process';

const children = [
  spawn('bun', ['run', 'dev:server'], { stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn('bun', ['run', 'dev:web'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      child.kill(signal);
    } catch {
      // ignore
    }
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

for (const child of children) {
  child.on('exit', (code) => {
    if (!shuttingDown && code && code !== 0) {
      shutdown('SIGTERM');
      process.exitCode = code;
    }
  });
}
