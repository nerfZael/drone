const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

function shortcutAccelerator(binding, platform = process.platform) {
  const key = String(binding?.key || '').toLowerCase();
  // Electron cannot distinguish keypad Enter from the main Enter key.
  if (key === 'numenter') return null;
  const aliases = {
    arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right',
    enter: 'Return', '+': 'Plus',
  };
  const supported = /^[a-z0-9]$|^f(?:[1-9]|1[0-9]|2[0-4])$|^num(?:[0-9]|dec|add|sub|mult|div)$/.test(key) ||
    ['space', 'tab', 'capslock', 'backspace', 'delete', 'insert', 'enter', 'home', 'end',
      'pageup', 'pagedown', 'escape', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key) ||
    (key.length === 1 && "`~!@#$%^&*()-_=+[{]}\\|;:'\",<.>/?".includes(key));
  if (!supported) return null;
  const modifiers = [];
  if (binding.mod) modifiers.push(platform === 'darwin' ? 'Super' : 'Control');
  else {
    if (binding.ctrl) modifiers.push('Control');
    if (binding.meta) modifiers.push('Super');
  }
  if (binding.alt) modifiers.push('Alt');
  if (binding.shift) modifiers.push('Shift');
  return [...modifiers, aliases[key] || key].join('+');
}

function createShortcutRegistrar(globalShortcut, dispatch, platform = process.platform) {
  const registered = new Set();
  let generation = 0;
  let suspended = false;
  function clear() {
    generation++;
    for (const accelerator of registered) globalShortcut.unregister(accelerator);
    registered.clear();
  }
  return {
    configure({ revision, bindings, suspended: captureActive = false, observedNumpad = false, observedBackquote = false, numpadUnavailable = false }) {
      suspended = captureActive;
      globalShortcut.setSuspended(false);
      clear();
      const currentGeneration = generation;
      const entries = Object.entries(bindings).map(([actionId, binding]) => [actionId, shortcutAccelerator(binding, platform)]);
      const counts = new Map();
      for (const [, accelerator] of entries) counts.set(accelerator, (counts.get(accelerator) || 0) + 1);
      const actions = {};
      for (const [actionId, accelerator] of entries) {
        let error = '';
        let active = false;
        const numpad = bindings[actionId].key.startsWith('num');
        const observed = (numpad && observedNumpad) ||
          (observedBackquote && ['`', '~'].includes(bindings[actionId].key));
        if (numpad && numpadUnavailable) error = 'Numpad shortcuts require the host keyboard listener on this desktop.';
        else if (!accelerator) error = 'This key is not supported as a desktop global shortcut. Choose another key.';
        else if (counts.get(accelerator) > 1) error = 'Another global Drone Hub action uses this shortcut.';
        else {
          try {
            active = globalShortcut.register(accelerator, () => {
              if (!suspended && currentGeneration === generation && !observed) dispatch({ revision, actionId });
            });
            if (active) registered.add(accelerator);
            else error = 'This shortcut is unavailable. It may be reserved by the desktop or another application.';
          } catch (cause) {
            error = `Desktop shortcut registration failed: ${cause.message || cause}`;
          }
        }
        actions[actionId] = { active, error };
      }
      globalShortcut.setSuspended(suspended);
      return { running: registered.size > 0, error: '', warning: '', actions };
    },
    setSuspended(value) {
      suspended = value === true;
      globalShortcut.setSuspended(suspended);
    },
    close() {
      clear();
      suspended = false;
      globalShortcut.setSuspended(false);
    },
  };
}

// This connection gives the Hub an ownership lifetime: only shortcuts reserved
// by Electron can dispatch while connected. X11 observation preserves physical
// keypad handling and filters repeated native callbacks while a key is held.
function connectDesktopGlobalShortcuts({ globalShortcut, apiUrl, apiToken, onError = () => {} }) {
  const lifetime = new AbortController();
  const sessionId = randomUUID();
  let connection = null;
  let statusPosted = Promise.resolve();
  const headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' };
  async function post(kind, body, signal) {
    const response = await fetch(`${apiUrl}/api/global-shortcuts/desktop/${sessionId}/${kind}`, {
      method: 'POST', headers, body: JSON.stringify(body), signal,
    });
    await response.arrayBuffer();
    // Rebinding can supersede a configuration while its acknowledgement is in flight.
    if (response.status === 409) return;
    if (!response.ok) throw new Error(`Desktop shortcuts ${kind} failed (${response.status})`);
  }
  const registrar = createShortcutRegistrar(globalShortcut, (event) => {
    const signal = connection?.signal;
    // A callback can arrive immediately after registration, before the Hub has
    // received the registration result. Preserve that ordering on the wire.
    void statusPosted.then(() => {
      if (signal && !signal.aborted) return post('dispatch', event, signal);
    }).catch((error) => { if (!signal?.aborted) onError(error); });
  });
  const done = (async () => {
    while (!lifetime.signal.aborted) {
      connection = new AbortController();
      const controller = connection;
      const abort = () => controller.abort();
      lifetime.signal.addEventListener('abort', abort, { once: true });
      try {
        const response = await fetch(`${apiUrl}/api/global-shortcuts/desktop/events?sessionId=${sessionId}`, {
          headers, signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`Desktop shortcuts connection failed (${response.status})`);
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, '');
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const message = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (!message.startsWith('event: configure\n')) continue;
            const config = JSON.parse(message.split('\n').find((line) => line.startsWith('data: ')).slice(6));
            const status = registrar.configure(config);
            statusPosted = post('status', { revision: config.revision, status }, controller.signal);
            await statusPosted;
          }
        }
      } catch (error) {
        if (!lifetime.signal.aborted) onError(error);
      } finally {
        registrar.close();
        controller.abort();
        lifetime.signal.removeEventListener('abort', abort);
      }
      if (!lifetime.signal.aborted) await delay(1_000, undefined, { signal: lifetime.signal }).catch(() => {});
    }
  })();
  return {
    setSuspended: (value) => registrar.setSuspended(value),
    close() {
      registrar.close();
      lifetime.abort();
      return done;
    },
  };
}

module.exports = { shortcutAccelerator, createShortcutRegistrar, connectDesktopGlobalShortcuts };
