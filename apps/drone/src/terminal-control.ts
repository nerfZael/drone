import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const REPLAY_BYTES = 2 * 1024 * 1024;
const MAX_COMMAND_BYTES = 1024 * 1024;
type Reply = { data: Buffer; offset: number };
type Pending = {
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
export type TerminalSnapshot = {
  data: Buffer;
  offset: number;
  generation: string;
  geometry?: { cols: number; rows: number; cursorX: number; cursorY: number; alternate: boolean };
};

// Control mode escapes bytes, not Unicode characters. Decode before handing bytes
// to xterm so a UTF-8 character split across output notifications remains intact.
export function decodeTmuxOutput(data: Buffer): Buffer {
  const result = Buffer.allocUnsafe(data.length);
  let used = 0;
  for (let i = 0; i < data.length; i++) {
    if (
      data[i] === 92 &&
      i + 3 < data.length &&
      data[i + 1] >= 48 &&
      data[i + 1] <= 55 &&
      data[i + 2] >= 48 &&
      data[i + 2] <= 55 &&
      data[i + 3] >= 48 &&
      data[i + 3] <= 55
    ) {
      result[used++] = (data[i + 1] - 48) * 64 + (data[i + 2] - 48) * 8 + data[i + 3] - 48;
      i += 3;
    } else result[used++] = data[i];
  }
  return result.subarray(0, used);
}

export class TerminalControl {
  readonly generation = randomUUID();
  readonly ready: Promise<Reply>;
  offset = 0;
  closed = false;
  private child: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private pending: Pending[] = [];
  private block: { id: string; chunks: Buffer[] } | null = null;
  private replay: Array<{ start: number; data: Buffer; used: number }> = [];
  private replayBytes = 0;
  private listeners = new Set<(data: Buffer) => void>();
  private exitListeners = new Set<() => void>();
  private paneId = '';

  constructor(
    readonly session: string,
    tmuxArgs: string[] = [],
  ) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(session)) throw new Error('invalid terminal session');
    this.child = spawn('tmux', [...tmuxArgs, '-C', 'attach-session', '-t', `=${session}`], {
      stdio: 'pipe',
    });
    this.ready = this.expectReply();
    // Consumers may await ready after another asynchronous operation.
    void this.ready.catch(() => {});
    this.child.stdout.on('data', (data: Buffer) => this.read(data));
    this.child.stderr.on('data', () => {});
    this.child.on('error', (error) => this.close(error));
    this.child.on('exit', () =>
      this.close(new Error('terminal session was interrupted or exited')),
    );
    this.child.stdin.on('error', (error) => this.close(error));
  }

  private expectReply(): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error('terminal command timed out')), 10_000);
      timer.unref();
      this.pending.push({ resolve, reject, timer });
    });
  }

  private read(data: Buffer) {
    this.buffer = Buffer.concat([this.buffer, data]);
    if (this.buffer.length > 8 * 1024 * 1024)
      return this.close(new Error('terminal control output limit exceeded'));
    let newline: number;
    while ((newline = this.buffer.indexOf(10)) !== -1) {
      const line = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      this.line(line);
    }
  }

  private line(line: Buffer) {
    const text = line.toString('utf8');
    if (this.block) {
      if (text === `%end ${this.block.id}` || text === `%error ${this.block.id}`) {
        const reply = this.pending.shift();
        if (!reply) return this.close(new Error('unexpected terminal reply'));
        clearTimeout(reply.timer);
        const data = Buffer.concat(this.block.chunks);
        this.block = null;
        if (text.startsWith('%error'))
          reply.reject(new Error(data.toString('utf8').trim() || 'terminal command failed'));
        else reply.resolve({ data, offset: this.offset });
      } else {
        this.block.chunks.push(line, Buffer.from('\n'));
      }
      return;
    }
    if (/^%begin \d+ \d+ \d+$/.test(text)) {
      this.block = { id: text.slice(7), chunks: [] };
      return;
    }
    if (text.startsWith('%exit'))
      return this.close(new Error('terminal session was interrupted or exited'));
    const match = /^%output (%\d+) /.exec(text);
    if (!match || (this.paneId && match[1] !== this.paneId)) return;
    const bytes = decodeTmuxOutput(line.subarray(match[0].length));
    if (!bytes.length) return;
    // Pack tiny notifications into pages. Keeping one entry per keystroke made
    // replay scans and array eviction grow with the number of output events.
    for (let from = 0; from < bytes.length; ) {
      let page = this.replay[this.replay.length - 1];
      if (!page || page.used === page.data.length) {
        page = { start: this.offset + from, data: Buffer.allocUnsafe(32 * 1024), used: 0 };
        this.replay.push(page);
      }
      const count = Math.min(bytes.length - from, page.data.length - page.used);
      bytes.copy(page.data, page.used, from, from + count);
      page.used += count;
      from += count;
    }
    this.offset += bytes.length;
    this.replayBytes += bytes.length;
    while (this.replayBytes > REPLAY_BYTES && this.replay.length > 0) {
      this.replayBytes -= this.replay.shift()!.used;
    }
    for (const listener of this.listeners) listener(bytes);
  }

  async commands(commands: string[]): Promise<Reply[]> {
    await this.ready;
    if (this.closed) throw new Error('terminal session was interrupted or exited');
    const payload = commands.join(' ; ') + '\n';
    if (
      this.pending.length + commands.length > 256 ||
      this.child.stdin.writableLength + Buffer.byteLength(payload) > MAX_COMMAND_BYTES
    ) {
      throw new Error('terminal input queue is full');
    }
    const replies = commands.map(() => this.expectReply());
    this.child.stdin.write(payload);
    return await Promise.all(replies);
  }

  async initialize() {
    const [reply] = await this.commands([`display-message -p -t =${this.session}:^ '#{pane_id}'`]);
    this.paneId = reply.data.toString('utf8').trim();
    if (!/^%\d+$/.test(this.paneId)) throw new Error('terminal pane not found');
  }

  async input(data: Buffer) {
    if (data.length > 128 * 1024) throw new Error('terminal input too large');
    // Serialize chunks of a paste without starting a new process for each one.
    for (let offset = 0; offset < data.length; offset += 4096) {
      const hex = data
        .subarray(offset, offset + 4096)
        .toString('hex')
        .match(/../g)!
        .join(' ');
      await this.commands([`send-keys -H -t ${this.paneId} ${hex}`]);
    }
  }

  async paste(data: Buffer) {
    if (data.length > 1024 * 1024) throw new Error('terminal paste too large');
    if (!data.length) return;
    const name = `drone-paste-${randomUUID()}`;
    try {
      for (let offset = 0; offset < data.length; offset += 4096) {
        // Octal quoting preserves arbitrary bytes and cannot introduce tmux commands.
        const quoted = [...data.subarray(offset, offset + 4096)]
          .map((byte) => `\\${byte.toString(8).padStart(3, '0')}`)
          .join('');
        await this.commands([`set-buffer ${offset ? '-a ' : ''}-b ${name} "${quoted}"`]);
      }
      // tmux knows the pane's actual bracketed-paste mode, including when a
      // viewer first attaches after the shell enabled it. Older tmux versions
      // do not expose that mode as a format variable for screen snapshots.
      await this.commands([`paste-buffer -p -d -b ${name} -t ${this.paneId}`]);
    } finally {
      if (!this.closed) await this.commands([`delete-buffer -b ${name}`]).catch(() => {});
    }
  }

  async resize(cols: number, rows: number) {
    if (
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < 2 ||
      rows < 1 ||
      cols > 1000 ||
      rows > 1000
    ) {
      throw new Error('invalid terminal dimensions');
    }
    await this.commands([`refresh-client -C ${cols},${rows}`]);
  }

  async snapshot(): Promise<TerminalSnapshot> {
    return captureTerminalSnapshot(
      (commands) => this.commands(commands),
      this.paneId,
      this.generation,
    );
  }

  replaySince(offset: number, maxBytes = REPLAY_BYTES): Buffer | null {
    const first = this.replay[0]?.start ?? this.offset;
    if (!Number.isSafeInteger(offset) || offset < first || offset > this.offset) return null;
    const chunks: Buffer[] = [];
    let remaining = maxBytes;
    for (const entry of this.replay) {
      if (entry.start + entry.used <= offset) continue;
      const start = Math.max(0, offset - entry.start);
      const bytes = entry.data.subarray(start, Math.min(entry.used, start + remaining));
      chunks.push(bytes);
      remaining -= bytes.length;
      if (!remaining) break;
    }
    return Buffer.concat(chunks);
  }

  subscribe(output: (data: Buffer) => void, exit: () => void): () => void {
    this.listeners.add(output);
    this.exitListeners.add(exit);
    return () => {
      this.listeners.delete(output);
      this.exitListeners.delete(exit);
    };
  }

  close(error = new Error('terminal connection closed')) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.splice(0)) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.child.kill();
    for (const listener of this.exitListeners) listener();
    this.listeners.clear();
    this.exitListeners.clear();
    this.replay = [];
  }
}

export async function captureTerminalSnapshot(
  runCommands: (commands: string[]) => Promise<Reply[]>,
  target: string,
  generation = '',
): Promise<TerminalSnapshot> {
  // tmux runs this command list without yielding to pane input. The snapshot,
  // modes, cursor and continuation offset describe the same screen state.
  const [screen, state, savedScreen, pendingEscape] = await runCommands([
    `capture-pane -p -e -S -200 -t ${target}`,
    `display-message -p -t ${target} '#{cursor_x}|#{cursor_y}|#{alternate_on}|#{cursor_flag}|#{insert_flag}|#{keypad_cursor_flag}|#{keypad_flag}|#{mouse_all_flag}|#{mouse_button_flag}|#{mouse_standard_flag}|#{mouse_utf8_flag}|#{mouse_sgr_flag}|#{scroll_region_upper}|#{scroll_region_lower}|#{origin_flag}|#{wrap_flag}|#{pane_height}|#{alternate_saved_x}|#{alternate_saved_y}|#{pane_width}'`,
    `capture-pane -p -e -a -q -t ${target}`,
    `capture-pane -p -P -t ${target}`,
  ]);
  const [
    x,
    y,
    alternate,
    cursor,
    insert,
    applicationCursor,
    keypad,
    mouseAny,
    mouseButton,
    mouse,
    mouseUtf8,
    mouseSgr,
    scrollTop,
    scrollBottom,
    origin,
    wrap,
    height,
    savedX,
    savedY,
    width,
  ] = state.data.toString('utf8').trim().split('|').map(Number);
  const mode = (n: number, on: number) => `\x1b[?${n}${on ? 'h' : 'l'}`;
  const screenLines = screen.data.toString('utf8').replace(/\n$/, '').split('\n');
  // Preserve the shell behind a full-screen application. Resetting directly
  // into the alternate buffer loses that shell when the application exits.
  const history = alternate ? screenLines.slice(0, -height).join('\r\n') : '';
  const savedText = savedScreen.data.toString('utf8').replace(/\n$/, '').replace(/\n/g, '\r\n');
  const prefix =
    '\x1bc' +
    (alternate
      ? (history ? history + '\r\n' : '') +
        savedText +
        `\x1b[${(savedY || 0) + 1};${(savedX || 0) + 1}H` +
        mode(1049, 1) +
        '\x1b[H'
      : '\x1b[H');
  const screenText = (alternate ? screenLines.slice(-height) : screenLines).join('\r\n');
  const suffix =
    `\x1b[${(scrollTop || 0) + 1};${(scrollBottom || 0) + 1}r` +
    mode(6, origin) +
    mode(7, wrap) +
    `\x1b[${(y || 0) + 1 - (origin ? scrollTop || 0 : 0)};${(x || 0) + 1}H` +
    mode(25, cursor) +
    mode(1, applicationCursor) +
    `\x1b[4${insert ? 'h' : 'l'}` +
    (keypad ? '\x1b=' : '\x1b>') +
    mode(1000, mouse) +
    mode(1002, mouseButton) +
    mode(1003, mouseAny) +
    mode(1005, mouseUtf8) +
    mode(1006, mouseSgr) +
    mode(2004, 1);
  return {
    // Complete any escape sequence that was only partly received when the
    // snapshot was captured; subsequent live bytes continue this parser state.
    data: Buffer.concat([
      Buffer.from(prefix + screenText + suffix),
      decodeTmuxOutput(pendingEscape.data.subarray(0, Math.max(0, pendingEscape.data.length - 1))),
    ]),
    geometry: { cols: width, rows: height, cursorX: x, cursorY: y, alternate: Boolean(alternate) },
    offset: screen.offset,
    generation: generation,
  };
}

export class TerminalControls {
  private entries = new Map<
    string,
    { promise: Promise<TerminalControl>; users: number; timer?: ReturnType<typeof setTimeout> }
  >();
  constructor(private readonly tmuxArgs: string[] = []) {}

  async acquire(session: string): Promise<{ control: TerminalControl; release: () => void }> {
    let entry = this.entries.get(session);
    if (!entry) {
      const control = new TerminalControl(session, this.tmuxArgs);
      const promise = control
        .initialize()
        .then(() => control)
        .catch((error) => {
          control.close();
          throw error;
        });
      entry = { promise, users: 0 };
      this.entries.set(session, entry);
      control.subscribe(
        () => {},
        () => {
          if (this.entries.get(session) === entry) this.entries.delete(session);
        },
      );
    }
    clearTimeout(entry.timer);
    entry.users++;
    const current = entry;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      current.users--;
      if (!current.users) {
        current.timer = setTimeout(() => {
          if (this.entries.get(session) === current) this.entries.delete(session);
          void current.promise.then((control) => control.close()).catch(() => {});
        }, 60_000);
        current.timer.unref();
        const idle = [...this.entries.entries()].filter(([, item]) => item.users === 0);
        for (const [name, item] of idle.slice(0, Math.max(0, idle.length - 8))) {
          clearTimeout(item.timer);
          this.entries.delete(name);
          void item.promise.then((control) => control.close()).catch(() => {});
        }
      }
    };
    try {
      return { control: await current.promise, release };
    } catch (error) {
      release();
      throw error;
    }
  }

  close() {
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer);
      void entry.promise.then((control) => control.close()).catch(() => {});
    }
    this.entries.clear();
  }
}
