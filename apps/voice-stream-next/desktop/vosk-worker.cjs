const { createRequire } = require('node:module');

let vosk = null;
let model = null;
let recognizer = null;
let lastText = '';
let lastTextAt = 0;

function cleanup() {
  try {
    recognizer?.free();
  } catch {
    // Ignore native cleanup errors.
  }
  try {
    model?.free();
  } catch {
    // Ignore native cleanup errors.
  }
  recognizer = null;
  model = null;
  lastText = '';
  lastTextAt = 0;
}

function send(message) {
  if (process.send) process.send(message);
}

function textFromResult(result) {
  if (!result || typeof result !== 'object') return '';
  return String(result.partial || result.text || '').trim();
}

function start(message) {
  cleanup();
  try {
    const requireFromCwd = createRequire(`${process.cwd()}/package.json`);
    vosk = vosk || requireFromCwd('vosk');
    vosk.setLogLevel?.(-1);
    model = new vosk.Model(message.modelPath);
    recognizer = new vosk.Recognizer({
      model,
      sampleRate: message.sampleRate,
      grammar: message.grammar,
    });
    send({ type: 'status', available: true, modelPath: message.modelPath, error: '' });
  } catch (error) {
    cleanup();
    send({
      type: 'status',
      available: false,
      modelPath: message.modelPath || '',
      error: error?.message || String(error),
    });
  }
}

function acceptFrame(frame) {
  if (!recognizer || !frame) return;
  const buffer = Buffer.isBuffer(frame) ? frame : Buffer.from(frame);
  if (!buffer.length) return;
  try {
    const accepted = recognizer.acceptWaveform(buffer);
    const text = textFromResult(accepted ? recognizer.result() : recognizer.partialResult());
    if (!text) return;
    const now = Date.now();
    if (text === lastText && now - lastTextAt < 900) return;
    lastText = text;
    lastTextAt = now;
    send({ type: 'text', text, final: Boolean(accepted) });
    if (accepted) {
      recognizer.reset();
      lastText = '';
    }
  } catch (error) {
    const message = error?.message || String(error);
    cleanup();
    send({ type: 'status', available: false, error: message });
  }
}

process.on('message', (message) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'start') start(message);
  if (message.type === 'frame') acceptFrame(message.frame);
  if (message.type === 'reset') {
    try {
      recognizer?.reset();
    } catch {
      cleanup();
    }
    lastText = '';
    lastTextAt = 0;
  }
  if (message.type === 'stop') cleanup();
});

process.on('disconnect', cleanup);
process.on('exit', cleanup);
