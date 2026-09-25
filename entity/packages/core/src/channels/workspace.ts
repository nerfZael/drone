import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Channel, EffectSpec } from '../channel.js';

export interface WorkspaceWorld {
  root: string;
  commands: boolean;
  writes: { path: string; by: string; t: number }[];
}

export interface WorkspaceChannelOptions {
  /** The folder workers may read and write. Everything is confined to it. */
  root: string;
  /** Allow `run`: shell commands in the workspace. Off by default: it runs LLM-written commands on this machine. */
  allowCommands?: boolean;
  commandTimeoutMs?: number;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.turbo', 'coverage']);
const MAX_READ_BYTES = 200_000;
const MAX_OUTPUT = 20_000;

/** File tools (and optionally commands) confined to one workspace folder. See docs/parallel-conversation.md. */
export function workspaceChannel(options: WorkspaceChannelOptions): Channel<WorkspaceWorld> {
  const root = path.resolve(options.root);
  const commandTimeout = options.commandTimeoutMs ?? 120_000;

  /** Resolves a workspace-relative path, refusing anything outside the root (including via symlinks). */
  async function inside(relative: string, forWrite: boolean): Promise<string> {
    const absolute = path.resolve(root, relative || '.');
    const rel = path.relative(root, absolute);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`"${relative}" is outside the workspace`);
    if (forWrite && rel.split(path.sep).includes('.git')) throw new Error('writing inside .git is not allowed');
    const realRoot = await fs.realpath(root);
    let probe = absolute;
    for (;;) {
      try {
        const real = await fs.realpath(probe);
        const realRel = path.relative(realRoot, real);
        if (realRel.startsWith('..') || path.isAbsolute(realRel)) throw new Error(`"${relative}" resolves outside the workspace`);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const parent = path.dirname(probe);
        if (parent === probe) break;
        probe = parent;
      }
    }
    return absolute;
  }

  const show = (absolute: string) => path.relative(root, absolute) || '.';

  async function* walk(dir: string, depth: number): AsyncGenerator<{ path: string; dir: boolean }> {
    let entries: import('node:fs').Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        yield { path: full, dir: true };
        if (depth > 1) yield* walk(full, depth - 1);
      } else if (entry.isFile()) yield { path: full, dir: false };
    }
  }

  const effects: EffectSpec<any, WorkspaceWorld>[] = [
    {
      name: 'list_files', description: 'List files and folders in the workspace (skips .git, node_modules, dist).', risk: 'reflex', readonly: true,
      parameters: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, depth: { type: 'integer', minimum: 1, maximum: 6 } } },
      async apply(args: { path?: string; depth?: number }) {
        const start = await inside(args.path ?? '.', false);
        const lines: string[] = [];
        for await (const entry of walk(start, args.depth ?? 2)) {
          lines.push(`${show(entry.path)}${entry.dir ? '/' : ''}`);
          if (lines.length >= 400) { lines.push('... (truncated; list a subfolder)'); break; }
        }
        return lines.join('\n') || '(empty)';
      },
    },
    {
      name: 'read_file', description: 'Read a file, with line numbers. Use start_line / end_line for large files.', risk: 'reflex', readonly: true,
      parameters: { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string' }, start_line: { type: 'integer', minimum: 1 }, end_line: { type: 'integer', minimum: 1 } } },
      async apply(args: { path: string; start_line?: number; end_line?: number }) {
        const file = await inside(args.path, false);
        const text = await fs.readFile(file, 'utf8');
        const lines = text.split('\n');
        const start = (args.start_line ?? 1) - 1;
        const end = Math.min(lines.length, args.end_line ?? start + 2000);
        let out = lines.slice(start, end).map((line, i) => `${String(start + i + 1).padStart(5)}  ${line}`).join('\n');
        if (out.length > MAX_READ_BYTES) out = `${out.slice(0, MAX_READ_BYTES)}\n... (truncated; read a smaller range)`;
        return `${show(file)} (${lines.length} lines)\n${out}${end < lines.length ? `\n... (${lines.length - end} more lines)` : ''}`;
      },
    },
    {
      name: 'search', description: 'Search file contents for text (or a regex). Returns path:line: text.', risk: 'reflex', readonly: true,
      parameters: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', maxLength: 500 }, path: { type: 'string' }, regex: { type: 'boolean' } } },
      async apply(args: { query: string; path?: string; regex?: boolean }) {
        const start = await inside(args.path ?? '.', false);
        const pattern = args.regex ? new RegExp(args.query) : null;
        const hits: string[] = [];
        for await (const entry of walk(start, 20)) {
          if (entry.dir) continue;
          let text: string;
          try {
            const stat = await fs.stat(entry.path);
            if (stat.size > 1_000_000) continue;
            text = await fs.readFile(entry.path, 'utf8');
          } catch { continue; }
          if (text.includes('\u0000')) continue;
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (pattern ? pattern.test(lines[i]) : lines[i].includes(args.query)) {
              hits.push(`${show(entry.path)}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
              if (hits.length >= 100) return `${hits.join('\n')}\n... (more matches; narrow the search)`;
            }
          }
        }
        return hits.join('\n') || 'no matches';
      },
    },
    {
      name: 'write_file', description: 'Create or overwrite a file. Claims it for you.', risk: 'limb', output: false,
      parameters: { type: 'object', additionalProperties: false, required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string', maxLength: 1_000_000 } } },
      paths: (args: { path: string }) => [args.path],
      async apply(args: { path: string; content: string }, ctx) {
        const file = await inside(args.path, true);
        let existed = true;
        try { await fs.access(file); } catch { existed = false; }
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, args.content, 'utf8');
        ctx.emit('file_written', { path: show(file), bytes: Buffer.byteLength(args.content), created: !existed });
        return `${existed ? 'wrote' : 'created'} ${show(file)}`;
      },
    },
    {
      name: 'edit_file', description: 'Replace exact text in a file. old_text must match exactly once unless replace_all is set. Claims the file for you.', risk: 'limb', output: false,
      parameters: {
        type: 'object', additionalProperties: false, required: ['path', 'old_text', 'new_text'],
        properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' }, replace_all: { type: 'boolean' } },
      },
      paths: (args: { path: string }) => [args.path],
      async apply(args: { path: string; old_text: string; new_text: string; replace_all?: boolean }, ctx) {
        const file = await inside(args.path, true);
        const text = await fs.readFile(file, 'utf8');
        const count = args.old_text ? text.split(args.old_text).length - 1 : 0;
        if (count === 0) return `error: old_text not found in ${show(file)}. Read the file and copy the text exactly.`;
        if (count > 1 && !args.replace_all) return `error: old_text matches ${count} times in ${show(file)}; add more context or set replace_all.`;
        const next = args.replace_all ? text.split(args.old_text).join(args.new_text) : text.replace(args.old_text, () => args.new_text);
        await fs.writeFile(file, next, 'utf8');
        ctx.emit('file_written', { path: show(file), bytes: Buffer.byteLength(next), edits: count });
        return `edited ${show(file)} (${args.replace_all ? count : 1} replacement${count > 1 && args.replace_all ? 's' : ''})`;
      },
    },
  ];

  if (options.allowCommands) {
    effects.push({
      name: 'run', description: `Run a shell command in the workspace (bash -lc), e.g. tests or a build. Times out after ${Math.round(commandTimeout / 1000)} s by default.`, risk: 'limb', output: false,
      parameters: { type: 'object', additionalProperties: false, required: ['command'], properties: { command: { type: 'string', maxLength: 4000 }, timeout_ms: { type: 'integer', minimum: 1000, maximum: 600_000 } } },
      apply(args: { command: string; timeout_ms?: number }, ctx) {
        const started = Date.now();
        return new Promise<string>(resolve => {
          const child = spawn('bash', ['-lc', args.command], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
          let out = '';
          const append = (chunk: Buffer) => { if (out.length < MAX_OUTPUT * 2) out += chunk.toString('utf8'); };
          child.stdout.on('data', append);
          child.stderr.on('data', append);
          const timer = setTimeout(() => child.kill('SIGKILL'), args.timeout_ms ?? commandTimeout);
          child.on('close', (code, signal) => {
            clearTimeout(timer);
            const ms = Date.now() - started;
            ctx.emit('command_ran', { command: args.command.slice(0, 500), exit: code ?? null, signal: signal ?? null, ms });
            const trimmed = out.length > MAX_OUTPUT ? `${out.slice(0, MAX_OUTPUT / 2)}\n... (${out.length - MAX_OUTPUT} chars cut) ...\n${out.slice(-MAX_OUTPUT / 2)}` : out;
            resolve(`exit ${code ?? signal} in ${ms} ms\n${trimmed}`);
          });
          child.on('error', error => { clearTimeout(timer); resolve(`error: ${error.message}`); });
        });
      },
    });
  }

  return {
    name: 'workspace',
    describe: `A code workspace at ${root}. Read, search, and edit files${options.allowCommands ? ', and run shell commands (tests, builds)' : ''}. Paths are relative to the workspace. Writes claim files for the writer.${options.allowCommands ? '' : ' Running commands is disabled in this session.'}`,
    inputs: [],
    init: () => ({ root, commands: !!options.allowCommands, writes: [] }),
    reduce(world, event) {
      if (event.type !== 'file_written') return;
      world.writes.push({ path: String(event.data.path), by: event.by, t: event.t });
      if (world.writes.length > 30) world.writes.shift();
    },
    effects,
    render(world, { ago }) {
      return {
        stable: { root: world.root, commands: world.commands },
        volatile: world.writes.length ? { recent_writes: world.writes.slice(-10).map(w => `${w.by} wrote ${w.path} (${ago(w.t)})`) } : undefined,
      };
    },
  };
}
