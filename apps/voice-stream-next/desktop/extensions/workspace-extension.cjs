const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DEFAULT_MAX_READ_BYTES = 128 * 1024;
const MAX_READ_BYTES = 512 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;
const MAX_PATCH_BYTES = 256 * 1024;
const MAX_LIST_ENTRIES = 500;
const MAX_SEARCH_RESULTS = 100;
const MAX_SEARCH_FILE_BYTES = 256 * 1024;
const SKIPPED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.turbo', 'coverage', '.cache']);

function cleanString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function cleanPositiveInt(value, fallback, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), max);
}

function uniquePaths(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = cleanString(value);
    if (!text) continue;
    const resolved = path.resolve(text);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

function workspaceRoots(config) {
  const configured = [
    ...(Array.isArray(config.workspaceRoots) ? config.workspaceRoots : []),
    config.workspaceRoot,
    process.env.VOICE_STREAM_WORKSPACE_ROOT,
  ];
  const roots = uniquePaths(configured).filter((root) => {
    try {
      return fs.statSync(root).isDirectory();
    } catch {
      return false;
    }
  });
  return roots.length > 0 ? roots : [process.cwd()];
}

function rootForName(roots, name) {
  const cleanName = cleanString(name);
  if (!cleanName) return roots[0];
  const exact = roots.find((root) => root === cleanName || path.basename(root) === cleanName);
  if (!exact) throw new Error(`unknown workspace root: ${cleanName}`);
  return exact;
}

function resolveWorkspacePath(roots, rootName, relativePath) {
  const root = rootForName(roots, rootName);
  const cleanPath = String(relativePath ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (cleanPath.includes('\0')) throw new Error('path contains invalid characters');
  const resolved = path.resolve(root, cleanPath || '.');
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('path must stay inside the selected workspace root');
  }
  return { root, absolutePath: resolved, relativePath: relative === '' ? '.' : relative.split(path.sep).join('/') };
}

function isProbablyText(buffer) {
  if (buffer.includes(0)) return false;
  return true;
}

function readLimitedFile(filePath, maxBytes) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('path is not a file');
  const limit = cleanPositiveInt(maxBytes, DEFAULT_MAX_READ_BYTES, MAX_READ_BYTES);
  const bytesToRead = Math.min(stat.size, limit);
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytesToRead);
    fs.readSync(fd, buffer, 0, bytesToRead, 0);
    if (!isProbablyText(buffer)) throw new Error('file appears to be binary');
    return {
      content: buffer.toString('utf8'),
      size: stat.size,
      truncated: stat.size > bytesToRead,
      bytesRead: bytesToRead,
      mtimeMs: stat.mtimeMs,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function listEntries(roots, args) {
  const { root, absolutePath, relativePath } = resolveWorkspacePath(roots, args.root, args.path);
  const recursive = args.recursive === true;
  const maxEntries = cleanPositiveInt(args.maxEntries, 120, MAX_LIST_ENTRIES);
  const entries = [];

  function visit(currentPath, depth) {
    if (entries.length >= maxEntries) return;
    const names = fs.readdirSync(currentPath).sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      if (entries.length >= maxEntries) return;
      const fullPath = path.join(currentPath, name);
      const stat = fs.statSync(fullPath);
      const rel = path.relative(root, fullPath).split(path.sep).join('/');
      const isDir = stat.isDirectory();
      entries.push({
        path: rel,
        type: isDir ? 'directory' : 'file',
        size: isDir ? null : stat.size,
        mtimeMs: stat.mtimeMs,
      });
      if (recursive && isDir && !SKIPPED_DIRS.has(name) && depth < 20) visit(fullPath, depth + 1);
    }
  }

  const stat = fs.statSync(absolutePath);
  if (stat.isDirectory()) visit(absolutePath, 0);
  else entries.push({ path: relativePath, type: 'file', size: stat.size, mtimeMs: stat.mtimeMs });
  return { ok: true, root, path: relativePath, entries, truncated: entries.length >= maxEntries };
}

function walkFiles(root, startPath, maxFiles = 5000) {
  const files = [];
  function visit(currentPath, depth) {
    if (files.length >= maxFiles || depth > 30) return;
    const names = fs.readdirSync(currentPath).sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      if (files.length >= maxFiles) return;
      if (SKIPPED_DIRS.has(name)) continue;
      const fullPath = path.join(currentPath, name);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) visit(fullPath, depth + 1);
      else if (stat.isFile()) files.push({ fullPath, stat });
    }
  }
  const stat = fs.statSync(startPath);
  if (stat.isFile()) return [{ fullPath: startPath, stat }];
  visit(startPath, 0);
  return files;
}

function searchFiles(roots, args) {
  const query = cleanString(args.query);
  if (!query) throw new Error('query is required');
  const { root, absolutePath, relativePath } = resolveWorkspacePath(roots, args.root, args.path);
  const maxResults = cleanPositiveInt(args.maxResults, 40, MAX_SEARCH_RESULTS);
  const lowerQuery = query.toLowerCase();
  const results = [];
  for (const file of walkFiles(root, absolutePath)) {
    if (results.length >= maxResults) break;
    const rel = path.relative(root, file.fullPath).split(path.sep).join('/');
    const pathMatches = rel.toLowerCase().includes(lowerQuery);
    if (file.stat.size > MAX_SEARCH_FILE_BYTES) {
      if (pathMatches) results.push({ path: rel, line: null, preview: '', match: 'path' });
      continue;
    }
    let text = '';
    try {
      const buffer = fs.readFileSync(file.fullPath);
      if (!isProbablyText(buffer)) continue;
      text = buffer.toString('utf8');
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/g);
    let matchedContent = false;
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].toLowerCase().includes(lowerQuery)) continue;
      results.push({ path: rel, line: index + 1, preview: lines[index].trim().slice(0, 500), match: 'content' });
      matchedContent = true;
      break;
    }
    if (!matchedContent && pathMatches) results.push({ path: rel, line: null, preview: '', match: 'path' });
  }
  return { ok: true, root, path: relativePath, query, results, truncated: results.length >= maxResults };
}

function writeFile(roots, args) {
  const { root, absolutePath, relativePath } = resolveWorkspacePath(roots, args.root, args.path);
  const content = String(args.content ?? '');
  if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) throw new Error('content is too large');
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, 'utf8');
  return { ok: true, root, path: relativePath, size: Buffer.byteLength(content, 'utf8') };
}

function deleteFile(roots, args) {
  const { root, absolutePath, relativePath } = resolveWorkspacePath(roots, args.root, args.path);
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) throw new Error('path is not a file');
  if (args.dryRun === true) return { ok: true, root, path: relativePath, dryRun: true, deleted: false };
  fs.unlinkSync(absolutePath);
  return { ok: true, root, path: relativePath, dryRun: false, deleted: true };
}

function createDirectory(roots, args) {
  const { root, absolutePath, relativePath } = resolveWorkspacePath(roots, args.root, args.path);
  const exists = fs.existsSync(absolutePath);
  if (exists && !fs.statSync(absolutePath).isDirectory()) throw new Error('path exists and is not a directory');
  if (args.dryRun === true) return { ok: true, root, path: relativePath, dryRun: true, created: !exists };
  fs.mkdirSync(absolutePath, { recursive: args.recursive === true });
  return { ok: true, root, path: relativePath, dryRun: false, created: !exists };
}

function deleteDirectory(roots, args) {
  const { root, absolutePath, relativePath } = resolveWorkspacePath(roots, args.root, args.path);
  if (relativePath === '.') throw new Error('cannot delete a workspace root');
  const stat = fs.statSync(absolutePath);
  if (!stat.isDirectory()) throw new Error('path is not a directory');
  const recursive = args.recursive === true;
  if (args.dryRun === true) return { ok: true, root, path: relativePath, dryRun: true, recursive, deleted: false };
  fs.rmSync(absolutePath, { recursive, force: false });
  return { ok: true, root, path: relativePath, dryRun: false, recursive, deleted: true };
}

function movePath(roots, args) {
  const source = resolveWorkspacePath(roots, args.root, args.sourcePath);
  const destination = resolveWorkspacePath(roots, args.root, args.destinationPath);
  const stat = fs.statSync(source.absolutePath);
  if (fs.existsSync(destination.absolutePath)) throw new Error('destination already exists');
  if (args.dryRun === true) {
    return {
      ok: true,
      root: source.root,
      sourcePath: source.relativePath,
      destinationPath: destination.relativePath,
      type: stat.isDirectory() ? 'directory' : 'file',
      dryRun: true,
      moved: false,
    };
  }
  fs.mkdirSync(path.dirname(destination.absolutePath), { recursive: true });
  fs.renameSync(source.absolutePath, destination.absolutePath);
  return {
    ok: true,
    root: source.root,
    sourcePath: source.relativePath,
    destinationPath: destination.relativePath,
    type: stat.isDirectory() ? 'directory' : 'file',
    dryRun: false,
    moved: true,
  };
}

function applyPatch(roots, args) {
  const patch = String(args.patch ?? '');
  if (!patch.trim()) throw new Error('patch is required');
  return applyHunkPatch(roots, args, patch);
}

function applyHunkPatch(roots, args, patch) {
  if (Buffer.byteLength(patch, 'utf8') > MAX_PATCH_BYTES) throw new Error('patch is too large');
  const operations = parsePatchOperations(patch, args.path);
  if (operations.length === 0) throw new Error('patch must include at least one update hunk');
  const dryRun = args.dryRun === true;
  const results = [];
  for (const operation of operations) {
    const { root, absolutePath, relativePath } = resolveWorkspacePath(roots, args.root, operation.path);
    if (operation.type === 'add') {
      if (fs.existsSync(absolutePath)) throw new Error(`target file already exists: ${relativePath}`);
      if (Buffer.byteLength(operation.content, 'utf8') > MAX_WRITE_BYTES) throw new Error('added content is too large');
      if (!dryRun) {
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, operation.content, 'utf8');
      }
      results.push({ root, path: relativePath, type: 'add', changed: true });
      continue;
    }
    if (operation.type === 'delete') {
      const stat = fs.statSync(absolutePath);
      if (!stat.isFile()) throw new Error(`target is not a file: ${relativePath}`);
      if (!dryRun) fs.unlinkSync(absolutePath);
      results.push({ root, path: relativePath, type: 'delete', changed: true });
      continue;
    }

    const original = fs.readFileSync(absolutePath, 'utf8');
    const lineEnding = original.includes('\r\n') ? '\r\n' : '\n';
    let next = normalizeNewlines(original);
    let cursor = 0;
    const applied = [];
    for (const hunk of operation.hunks) {
      const result = applyParsedHunk(next, hunk, cursor);
      next = result.content;
      cursor = result.cursor;
      applied.push(result.summary);
    }
    if (Buffer.byteLength(next, 'utf8') > MAX_WRITE_BYTES) throw new Error('patched content is too large');
    const finalContent = lineEnding === '\n' ? next : next.replace(/\n/g, lineEnding);
    if (operation.movePath) {
      const destination = resolveWorkspacePath(roots, args.root, operation.movePath);
      if (fs.existsSync(destination.absolutePath)) throw new Error(`move destination already exists: ${destination.relativePath}`);
      if (!dryRun) {
        fs.mkdirSync(path.dirname(destination.absolutePath), { recursive: true });
        fs.writeFileSync(destination.absolutePath, finalContent, 'utf8');
        fs.unlinkSync(absolutePath);
      }
      results.push({
        root,
        path: relativePath,
        destinationPath: destination.relativePath,
        type: 'move',
        hunks: applied.length,
        changed: true,
      });
      continue;
    }
    if (!dryRun) fs.writeFileSync(absolutePath, finalContent, 'utf8');
    results.push({ root, path: relativePath, type: 'update', hunks: applied.length, changed: normalizeNewlines(original) !== next });
  }
  return { ok: true, dryRun, files: results, changed: results.some((result) => result.changed) };
}

function parsePatchOperations(patch, fallbackPath) {
  const lines = normalizeNewlines(patch).split('\n');
  const operations = [];
  let current = null;

  function startOperation(type, filePath) {
    const cleanPath = cleanString(filePath || fallbackPath);
    if (!cleanPath) throw new Error('patch path is required');
    current = { type, path: cleanPath, hunks: [], content: '', movePath: '' };
    operations.push(current);
    return current;
  }

  function ensureUpdateOperation(filePath) {
    const cleanPath = cleanString(filePath || fallbackPath);
    if (!cleanPath) throw new Error('patch path is required');
    if (!current || current.type !== 'update' || current.path !== cleanPath) return startOperation('update', cleanPath);
    return current;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === '*** Begin Patch' || line === '*** End Patch') continue;
    if (line.startsWith('*** Add File:')) {
      const operation = startOperation('add', line.slice('*** Add File:'.length).trim());
      const contentLines = [];
      index += 1;
      for (; index < lines.length; index += 1) {
        const addLine = lines[index];
        if (isPatchBoundary(addLine, lines[index + 1])) {
          index -= 1;
          break;
        }
        if (!addLine.startsWith('+')) throw new Error(`invalid add file line: ${addLine.slice(0, 80)}`);
        contentLines.push(addLine.slice(1));
      }
      operation.content = contentLines.length > 0 ? `${contentLines.join('\n')}\n` : '';
      continue;
    }
    if (line.startsWith('*** Delete File:')) {
      startOperation('delete', line.slice('*** Delete File:'.length).trim());
      continue;
    }
    if (line.startsWith('*** Update File:')) {
      ensureUpdateOperation(line.slice('*** Update File:'.length).trim());
      continue;
    }
    if (line.startsWith('*** Move to:')) {
      if (!current || current.type !== 'update') throw new Error('move target must follow an update file marker');
      current.movePath = line.slice('*** Move to:'.length).trim();
      if (!current.movePath) throw new Error('move target path is required');
      continue;
    }
    if (line.startsWith('--- ') && lines[index + 1]?.startsWith('+++ ')) {
      ensureUpdateOperation(cleanDiffPath(lines[index + 1].slice(4).trim()));
      index += 1;
      continue;
    }
    if (!line.startsWith('@@')) continue;
    const operation = ensureUpdateOperation(current?.path || fallbackPath);
    const hunkLines = [];
    index += 1;
    for (; index < lines.length; index += 1) {
      const hunkLine = lines[index];
      if (hunkLine.startsWith('@@') || isPatchBoundary(hunkLine, lines[index + 1])) {
        index -= 1;
        break;
      }
      if (hunkLine === '\\ No newline at end of file') continue;
      if (!hunkLine || ![' ', '-', '+'].includes(hunkLine[0])) {
        throw new Error(`invalid patch hunk line: ${hunkLine.slice(0, 80)}`);
      }
      hunkLines.push(hunkLine);
    }
    if (hunkLines.length === 0) throw new Error('empty patch hunk');
    operation.hunks.push(hunkLines);
  }

  return operations.filter((operation) => operation.type !== 'update' || operation.hunks.length > 0 || operation.movePath);
}

function isPatchBoundary(line, nextLine) {
  return line === '*** End Patch' ||
    line.startsWith('*** Add File:') ||
    line.startsWith('*** Delete File:') ||
    line.startsWith('*** Update File:') ||
    line.startsWith('*** Move to:') ||
    (line.startsWith('--- ') && nextLine?.startsWith('+++ '));
}

function cleanDiffPath(value) {
  const text = cleanString(value).split(/\s+/g)[0] || '';
  if (text === '/dev/null') return '';
  return text.replace(/^[ab]\//, '');
}

function applyParsedHunk(content, hunkLines, cursor) {
  const oldBlockWithNewline = hunkBlock(hunkLines, new Set([' ', '-']), true);
  const newBlockWithNewline = hunkBlock(hunkLines, new Set([' ', '+']), true);
  let oldBlock = oldBlockWithNewline;
  let newBlock = newBlockWithNewline;
  let index = content.indexOf(oldBlock, cursor);
  if (index < 0 && oldBlock.endsWith('\n')) {
    const oldWithoutFinalNewline = oldBlock.slice(0, -1);
    const fallbackIndex = content.indexOf(oldWithoutFinalNewline, cursor);
    if (fallbackIndex >= 0) {
      index = fallbackIndex;
      oldBlock = oldWithoutFinalNewline;
      newBlock = newBlock.endsWith('\n') ? newBlock.slice(0, -1) : newBlock;
    }
  }
  if (index < 0) throw new Error('patch context was not found');
  const next = `${content.slice(0, index)}${newBlock}${content.slice(index + oldBlock.length)}`;
  return {
    content: next,
    cursor: index + newBlock.length,
    summary: {
      oldLines: hunkLines.filter((line) => line[0] === ' ' || line[0] === '-').length,
      newLines: hunkLines.filter((line) => line[0] === ' ' || line[0] === '+').length,
    },
  };
}

function hunkBlock(hunkLines, prefixes, trailingNewline) {
  const lines = hunkLines
    .filter((line) => prefixes.has(line[0]))
    .map((line) => line.slice(1));
  if (lines.length === 0) return '';
  return `${lines.join('\n')}${trailingNewline ? '\n' : ''}`;
}

function normalizeNewlines(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function toolSchema(properties, required) {
  return { type: 'object', properties, required, additionalProperties: false };
}

exports.activate = async function activate(api) {
  const roots = workspaceRoots(api.config);

  api.registerTool({
    name: 'list_roots',
    label: 'List workspace roots',
    description: 'List configured workspace roots available on this device.',
    approval: 'never',
    targetSlot: 'workspace',
    inputSchema: toolSchema({}, []),
    async execute() {
      return {
        ok: true,
        deviceHome: os.homedir(),
        roots: roots.map((root) => ({ name: path.basename(root), path: root })),
      };
    },
  });

  api.registerTool({
    name: 'list_files',
    label: 'List workspace files',
    description: 'List files under a workspace root. Uses a bounded result set and skips common generated directories during recursive listing.',
    approval: 'never',
    targetSlot: 'workspace',
    inputSchema: toolSchema({
      root: { type: 'string' },
      path: { type: 'string' },
      recursive: { type: 'boolean' },
      maxEntries: { type: 'number' },
    }, ['root', 'path', 'recursive', 'maxEntries']),
    async execute(args) {
      return listEntries(roots, args || {});
    },
  });

  api.registerTool({
    name: 'search_files',
    label: 'Search workspace files',
    description: 'Search file paths and text content under a workspace root without running shell commands.',
    approval: 'never',
    targetSlot: 'workspace',
    inputSchema: toolSchema({
      root: { type: 'string' },
      path: { type: 'string' },
      query: { type: 'string' },
      maxResults: { type: 'number' },
    }, ['root', 'path', 'query', 'maxResults']),
    async execute(args) {
      return searchFiles(roots, args || {});
    },
  });

  api.registerTool({
    name: 'read_file',
    label: 'Read workspace file',
    description: 'Read a text file from a workspace root with a byte limit.',
    approval: 'never',
    targetSlot: 'workspace',
    inputSchema: toolSchema({
      root: { type: 'string' },
      path: { type: 'string' },
      maxBytes: { type: 'number' },
    }, ['root', 'path', 'maxBytes']),
    async execute(args) {
      const { root, absolutePath, relativePath } = resolveWorkspacePath(roots, args?.root, args?.path);
      return { ok: true, root, path: relativePath, ...readLimitedFile(absolutePath, args?.maxBytes) };
    },
  });

  api.registerTool({
    name: 'write_file',
    label: 'Write workspace file',
    description: 'Create or overwrite a text file in a workspace root.',
    approval: 'always',
    targetSlot: 'workspace',
    inputSchema: toolSchema({
      root: { type: 'string' },
      path: { type: 'string' },
      content: { type: 'string' },
    }, ['root', 'path', 'content']),
    async execute(args) {
      return writeFile(roots, args || {});
    },
  });

  api.registerTool({
    name: 'delete_file',
    label: 'Delete workspace file',
    description: 'Delete one file from a workspace root.',
    approval: 'always',
    targetSlot: 'workspace',
    inputSchema: toolSchema({
      root: { type: 'string' },
      path: { type: 'string' },
      dryRun: { type: 'boolean' },
    }, ['root', 'path', 'dryRun']),
    async execute(args) {
      return deleteFile(roots, args || {});
    },
  });

  api.registerTool({
    name: 'create_directory',
    label: 'Create workspace directory',
    description: 'Create a directory inside a workspace root.',
    approval: 'always',
    targetSlot: 'workspace',
    inputSchema: toolSchema({
      root: { type: 'string' },
      path: { type: 'string' },
      recursive: { type: 'boolean' },
      dryRun: { type: 'boolean' },
    }, ['root', 'path', 'recursive', 'dryRun']),
    async execute(args) {
      return createDirectory(roots, args || {});
    },
  });

  api.registerTool({
    name: 'delete_directory',
    label: 'Delete workspace directory',
    description: 'Delete a directory inside a workspace root. Non-empty directories require recursive true.',
    approval: 'always',
    targetSlot: 'workspace',
    inputSchema: toolSchema({
      root: { type: 'string' },
      path: { type: 'string' },
      recursive: { type: 'boolean' },
      dryRun: { type: 'boolean' },
    }, ['root', 'path', 'recursive', 'dryRun']),
    async execute(args) {
      return deleteDirectory(roots, args || {});
    },
  });

  api.registerTool({
    name: 'move_path',
    label: 'Move workspace path',
    description: 'Rename or move one file or directory inside a workspace root. The destination must not already exist.',
    approval: 'always',
    targetSlot: 'workspace',
    inputSchema: toolSchema({
      root: { type: 'string' },
      sourcePath: { type: 'string' },
      destinationPath: { type: 'string' },
      dryRun: { type: 'boolean' },
    }, ['root', 'sourcePath', 'destinationPath', 'dryRun']),
    async execute(args) {
      return movePath(roots, args || {});
    },
  });

  api.registerTool({
    name: 'apply_patch',
    label: 'Apply workspace patch',
    description: 'Apply one Codex-style or unified patch containing add, update, and delete file operations.',
    approval: 'always',
    targetSlot: 'workspace',
    inputSchema: toolSchema({
      root: { type: 'string' },
      path: { type: 'string' },
      patch: { type: 'string' },
      dryRun: { type: 'boolean' },
    }, ['root', 'path', 'patch', 'dryRun']),
    async execute(args) {
      return applyPatch(roots, args || {});
    },
  });

  api.registerSkill({
    slug: 'workspace',
    name: 'Workspace',
    description: 'Inspect and edit files on the selected user device inside configured workspace roots.',
    toolNames: [
      'list_roots',
      'list_files',
      'search_files',
      'read_file',
      'write_file',
      'delete_file',
      'create_directory',
      'delete_directory',
      'move_path',
      'apply_patch',
    ],
    markdownBody: [
      '# Workspace',
      '',
      'Use this skill when the user asks you to inspect or edit files on one of their devices.',
      '',
      'Before using workspace file tools, call list_execution_targets with slot "workspace" and extensionId "workspace" if the active target is unclear. If the user named a device, call set_execution_target with slot "workspace", extensionId "workspace", and that device id before file operations.',
      '',
      'Prefer search_files and read_file for inspection. Prefer apply_patch with a *** Begin Patch hunk patch for file add/update/delete/move edits. Use write_file only for new files or full rewrites the user clearly wants. Use create_directory, delete_directory, delete_file, and move_path only when the user clearly asks for those filesystem changes.',
      '',
      'Stay inside the configured workspace roots and ask the user which root or device to use when the available choices are ambiguous.',
    ].join('\n'),
  });
};
