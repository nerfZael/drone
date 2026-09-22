const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const run = promisify(execFile);

function captureArgs(microphone, monitor) {
  const args = ['-hide_banner', '-loglevel', 'warning', '-n', '-copyts', '-start_at_zero'];
  for (const [index, source] of [microphone, monitor].entries()) {
    args.push('-thread_queue_size', '1024', '-f', 'pulse', '-wallclock', '1');
    if (index) args.push('-isync', '0');
    args.push('-i', source);
  }
  for (const [index, source] of ['microphone', 'system'].entries()) {
    args.push('-map', `${index}:a`, '-af', 'aresample=16000:async=1:first_pts=0', '-ac', '1', '-c:a', 'flac',
      '-f', 'segment', '-segment_time', '30', '-reset_timestamps', '1', '-segment_list', `${source}.csv`,
      '-segment_list_type', 'csv', `${source}/%06d.flac`);
  }
  return args;
}

function installDesktopRecordings({ ipcMain, getWindow, getConnection }) {
  let active = null;
  let busy = false;
  let lastError = '';
  let pendingFinish = null;

  async function request(route, body, timeout = 30_000) {
    const connection = getConnection();
    if (!connection) throw new Error('The Hub is still starting.');
    const response = await fetch(`${connection.apiUrl}/api/recordings${route}`, {
      method: 'POST', headers: { authorization: `Bearer ${connection.apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Recording request failed.');
    return result;
  }

  const status = () => ({ supported: process.platform === 'linux', busy, id: active?.id ?? null,
    startedAt: active?.startedAt ?? null, microphone: active?.microphone ?? '', system: active?.system ?? '', error: lastError });

  async function finish(session, error) {
    clearInterval(session.heartbeat);
    if (active === session) active = null;
    pendingFinish = { id: session.id, body: { durationSeconds: (Date.now() - session.startedAt) / 1000, error } };
    await flushFinish();
  }

  async function flushFinish() {
    if (!pendingFinish) return;
    const pending = pendingFinish;
    try {
      await request(`/${pending.id}/finish`, pending.body);
      if (pendingFinish === pending) pendingFinish = null;
    } catch (error) { lastError = `Audio is saved, but processing could not start: ${error.message}. Open Recordings and retry.`; }
  }

  async function start(options = {}) {
    if (process.platform !== 'linux') throw new Error('Desktop audio recording currently requires Linux with PipeWire/PulseAudio.');
    if (busy || active) throw new Error('A recording is already active or starting.');
    busy = true;
    lastError = '';
    let session;
    try {
      await flushFinish();
      if (pendingFinish) throw new Error(lastError);
      await run('ffmpeg', ['-version'], { timeout: 5000 });
      await run('ffprobe', ['-version'], { timeout: 5000 });
      const microphone = (await run('pactl', ['get-default-source'], { timeout: 5000 })).stdout.trim();
      const sink = (await run('pactl', ['get-default-sink'], { timeout: 5000 })).stdout.trim();
      if (!microphone || microphone.endsWith('.monitor')) throw new Error('Choose a microphone, rather than a monitor source, as the system input device.');
      const sources = JSON.parse((await run('pactl', ['--format=json', 'list', 'sources'], { timeout: 5000 })).stdout);
      const mic = sources.find(source => source.name === microphone);
      const monitor = sources.find(source => source.name === `${sink}.monitor`);
      if (!mic || !monitor) throw new Error('Could not find both the default microphone and desktop audio monitor.');
      if (mic.mute) throw new Error('The system microphone is muted. Unmute it in your desktop sound settings first.');
      const created = await request('/create', options);
      session = { id: created.recording.id, startedAt: Date.now(), microphone, system: monitor.name, stopping: false, heartbeat: null };
      active = session;
      await request(`/${session.id}/heartbeat`, {}, 10_000);
      const child = spawn(process.execPath, [path.join(__dirname, 'hub-audio-capture.cjs'), microphone, monitor.name], {
        cwd: created.directory, stdio: ['pipe', 'ignore', 'pipe'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PULSE_PROP: 'application.name=DroneHubRecorder' },
      });
      session.child = child;
      // The lifetime guard stops FFmpeg when the desktop closes its stdin, including on crash.
      child.stdin.on('error', () => {});
      let errors = '';
      child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
      session.closed = new Promise(resolve => {
        child.once('error', error => { errors = error.message; });
        child.once('close', async code => {
          const error = session.stopping && (code === 0 || code === 255) ? undefined : errors || `Audio capture stopped unexpectedly (exit ${code}).`;
          if (error) lastError = error;
          await finish(session, error);
          resolve();
        });
      });
      // Wait for both outputs, rather than showing "Recording" merely because FFmpeg spawned.
      const deadline = Date.now() + 10_000;
      while (active === session) {
        const ready = await Promise.all(['microphone', 'system'].map(source => fs.stat(path.join(created.directory, source, '000000.flac')).then(stat => stat.isFile()).catch(() => false)));
        if (ready.every(Boolean)) break;
        if (Date.now() >= deadline) throw new Error('The microphone or desktop audio did not start within 10 seconds.');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (active !== session) throw new Error(lastError || 'Audio capture could not start.');
      let heartbeatPending = false;
      session.heartbeat = setInterval(() => {
        if (heartbeatPending || active !== session || session.stopping) return;
        heartbeatPending = true;
        void request(`/${session.id}/heartbeat`, {}, 10_000).then(() => {
          if (active === session && !session.stopping) {
            session.child.stdin.write('heartbeat\n');
            if (lastError.startsWith('Recording connection interrupted.')) lastError = '';
          }
        }).catch(error => {
          if (active === session && !session.stopping) lastError = `Recording connection interrupted. Capture will stop if it cannot reconnect. ${error.message}`;
        }).finally(() => { heartbeatPending = false; });
      }, 5000);
      return status();
    } catch (error) {
      if (session?.child && active === session) { session.child.kill('SIGTERM'); await session.closed; }
      else if (session && active === session) await finish(session, error.message);
      lastError = error.code === 'ENOENT' ? 'Install FFmpeg (including ffprobe) and pactl, and start PipeWire/PulseAudio before recording.' : error.message;
      throw new Error(lastError);
    } finally { busy = false; }
  }

  async function stop() {
    if (busy) throw new Error('Wait for the current recording action to finish.');
    if (!active) { await flushFinish(); return status(); }
    busy = true;
    const session = active;
    session.stopping = true;
    clearInterval(session.heartbeat);
    session.child.stdin.write('q\n');
    const terminate = setTimeout(() => session.child.kill('SIGTERM'), 5000);
    const kill = setTimeout(() => session.child.kill('SIGKILL'), 10_000);
    try { await session.closed; return status(); }
    finally { clearTimeout(terminate); clearTimeout(kill); busy = false; }
  }

  ipcMain.handle('drone-hub:desktop-recording', (event, action, options) => {
    const owner = getWindow();
    if (!owner || owner.isDestroyed() || event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame) throw new Error('Recording controls are only available in the main Drone Hub window.');
    if (action === 'status') return status();
    if (action === 'start') return start(options);
    if (action === 'stop') return stop();
    throw new Error('Unknown recording action.');
  });
  return { status, async close() {
    while (busy) await new Promise(resolve => setTimeout(resolve, 100));
    await stop();
  } };
}

module.exports = { installDesktopRecordings, captureArgs };
