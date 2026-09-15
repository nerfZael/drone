const { spawn } = require('node:child_process');
const path = require('node:path');
const { createInterface } = require('node:readline');

function reserveBackquote(config, onExit, spawnHelper = spawn) {
  const child = spawnHelper('python3', ['-u', path.join(__dirname, 'hub-x11-backquote.py')], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let closing = false;
  let ready = false;
  let details = '';
  const exited = new Promise((resolve) => {
    child.once('exit', resolve);
    child.once('error', resolve);
  });
  child.stderr.on('data', (chunk) => { details = (details + chunk).slice(-2000); });
  const status = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Physical shortcut reservation timed out.')), 5000);
    const lines = createInterface({ input: child.stdout });
    const fail = (error) => { clearTimeout(timer); reject(error); };
    child.once('error', fail);
    child.stdin.on('error', fail);
    child.once('exit', () => {
      clearTimeout(timer);
      if (!ready) reject(new Error(details.trim() || 'Physical shortcut helper stopped.'));
      else if (!closing) onExit(new Error('Physical shortcut helper stopped.'));
    });
    lines.once('line', (line) => {
      clearTimeout(timer);
      try {
        const actions = JSON.parse(line);
        ready = true;
        resolve(actions);
      } catch (error) { reject(error); }
    });
    child.stdin.write(`${JSON.stringify(config)}\n`);
  });
  return {
    status,
    async close() {
      closing = true;
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 1000);
      await exited;
      clearTimeout(timer);
    },
  };
}

module.exports = { reserveBackquote };
