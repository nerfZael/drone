import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type http from 'node:http';
import path from 'node:path';

import {
  managedDroneStateFingerprint,
  type ManagedDroneSyncPayload,
  unsignedManagedDroneState,
} from './managed-drone-state';
import {
  DaemonHttpError,
  readLimitedJson,
} from './daemon-workspace';

const WORKSPACE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const MANAGED_SYNC_MAX_TARGETS = 16;
const MANAGED_SYNC_MAX_PACKAGES = 100;
const MANAGED_SYNC_MAX_FILES = 500;
const MANAGED_SKILLS_MANIFEST = '.drone-managed-skills.json';
const MANAGED_MCP_MANIFEST = '.drone-managed-mcp.json';
const CODEX_MANAGED_START = '# drone-hub-managed-mcp-start';
const CODEX_MANAGED_END = '# drone-hub-managed-mcp-end';

type OutputProbe = {
  path: string;
  kind: 'absent' | 'directory' | 'file';
  size?: number;
  mode?: number;
  mtimeMs?: number;
  digest?: string;
};

type ProbeExpectation = { path: string; kind: OutputProbe['kind'] };

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.drone-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  let mode: number | undefined;
  try {
    mode = (await fs.stat(filePath)).mode;
  } catch (error: any) {
    if (String(error?.code ?? '') !== 'ENOENT') throw error;
  }
  try {
    await fs.writeFile(temporaryPath, content, mode == null ? undefined : { mode });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function normalizedAbsolutePath(raw: unknown, label: string): string {
  const value = String(raw ?? '').trim();
  if (!value || value.includes('\0') || !path.isAbsolute(value)) {
    throw new DaemonHttpError(400, `${label} must be an absolute path`);
  }
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) {
    throw new DaemonHttpError(400, `${label} cannot be a filesystem root`);
  }
  return resolved;
}

function normalizedRelativePath(raw: unknown, label: string): string {
  const value = String(raw ?? '').trim().replace(/\\/g, '/');
  const normalized = path.posix.normalize(value);
  if (
    !value ||
    value.includes('\0') ||
    value.startsWith('/') ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new DaemonHttpError(400, `${label} must be a safe relative path`);
  }
  return normalized;
}

function normalizedName(raw: unknown, label: string): string {
  const value = String(raw ?? '').trim();
  if (value === '.' || value === '..' || !/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new DaemonHttpError(400, `${label} contains unsupported characters`);
  }
  return value;
}

function isManagedSkillRoot(rootPath: string): boolean {
  return [
    '/.agents/skills',
    '/.claude/skills',
    '/.cursor/skills',
    '/.opencode/skills',
    '/.config/opencode/skills',
  ].some((suffix) => rootPath.endsWith(suffix));
}

function isManagedMcpConfigPath(configPath: string): boolean {
  return [
    '/.codex/config.toml',
    '/.cursor/mcp.json',
    '/.claude.json',
    '/.config/opencode/opencode.json',
  ].some((suffix) => configPath.endsWith(suffix));
}

async function readJsonObjectOrEmpty(filePath: string): Promise<Record<string, any>> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error: any) {
    if (String(error?.code ?? '') === 'ENOENT') return {};
    throw error;
  }
}

async function readManagedMetadataOrEmpty(filePath: string): Promise<Record<string, any>> {
  try {
    return await readJsonObjectOrEmpty(filePath);
  } catch (error) {
    if (error instanceof SyntaxError) return {};
    throw error;
  }
}

function requiredArray(raw: unknown, label: string): any[] {
  if (!Array.isArray(raw)) throw new DaemonHttpError(400, `${label} must be an array`);
  return raw;
}

function requiredRecord(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new DaemonHttpError(400, `${label} must be an object`);
  }
  return raw as Record<string, unknown>;
}

function addUniqueValue(seen: Set<string>, value: string, label: string): void {
  if (seen.has(value)) throw new DaemonHttpError(400, `duplicate ${label}: ${value}`);
  seen.add(value);
}

function assertNoFileDirectoryCollisions(paths: string[], label: string): void {
  const sorted = paths.slice().sort();
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (current.startsWith(`${previous}/`)) {
      throw new DaemonHttpError(400, `${label} contains a file/directory collision: ${previous}`);
    }
  }
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripManagedCodexMcpTables(raw: string, managedNames: string[]): string {
  const lines = String(raw ?? '').split(/\r?\n/);
  const withoutBlock: string[] = [];
  let insideManagedBlock = false;
  for (const line of lines) {
    if (line.trim() === CODEX_MANAGED_START) {
      insideManagedBlock = true;
      continue;
    }
    if (line.trim() === CODEX_MANAGED_END) {
      insideManagedBlock = false;
      continue;
    }
    if (!insideManagedBlock) withoutBlock.push(line);
  }

  const patterns = Array.from(new Set(managedNames)).map((name) => {
    const escaped = regexEscape(name);
    return new RegExp(
      `^(?:mcp_servers|"mcp_servers"|'mcp_servers')\\s*\\.\\s*(?:${escaped}|"${escaped}"|'${escaped}')(?:\\s*\\.|$)`,
    );
  });
  const output: string[] = [];
  let skipTable = false;
  for (const line of withoutBlock) {
    const trimmed = line.trim();
    const tableHeader =
      trimmed.match(/^\[([^\[\]]+)\](?:\s*#.*)?$/) ??
      trimmed.match(/^\[\[([^\[\]]+)\]\](?:\s*#.*)?$/);
    if (tableHeader) {
      const tablePath = String(tableHeader[1] ?? '').trim();
      skipTable = patterns.some((pattern) => pattern.test(tablePath));
    }
    if (!skipTable) output.push(line);
  }
  return output.join('\n').replace(/\s+$/g, '');
}

function addDirectoryExpectations(
  expectations: Map<string, ProbeExpectation>,
  rootPath: string,
  relativeFilePath: string,
): void {
  expectations.set(rootPath, { path: rootPath, kind: 'directory' });
  let current = path.dirname(relativeFilePath);
  while (current !== '.') {
    const directoryPath = path.join(rootPath, current);
    expectations.set(directoryPath, { path: directoryPath, kind: 'directory' });
    current = path.dirname(current);
  }
}

async function captureProbe(expectation: ProbeExpectation): Promise<OutputProbe> {
  try {
    const stat = await fs.lstat(expectation.path);
    const kind = stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : null;
    if (kind !== expectation.kind) return { path: expectation.path, kind: 'absent' };
    const digestSource =
      kind === 'file'
        ? await fs.readFile(expectation.path)
        : Buffer.from(
            JSON.stringify(
              (await fs.readdir(expectation.path, { withFileTypes: true }))
                .map((entry) => [
                  entry.name,
                  entry.isDirectory()
                    ? 'directory'
                    : entry.isFile()
                      ? 'file'
                      : entry.isSymbolicLink()
                        ? 'symlink'
                        : 'other',
                ])
                .sort(([left], [right]) => left.localeCompare(right)),
            ),
          );
    return {
      path: expectation.path,
      kind,
      size: stat.size,
      mode: stat.mode,
      mtimeMs: stat.mtimeMs,
      digest: crypto.createHash('sha256').update(digestSource).digest('hex'),
    };
  } catch (error: any) {
    const code = String(error?.code ?? '');
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { path: expectation.path, kind: 'absent' };
    }
    throw error;
  }
}

async function captureOutputProbes(expectations: Iterable<ProbeExpectation>): Promise<OutputProbe[]> {
  return await Promise.all(Array.from(expectations, captureProbe));
}

async function managedOutputsMatch(raw: unknown): Promise<boolean> {
  if (!Array.isArray(raw) || raw.length === 0) return false;
  const expected = raw.filter(
    (probe): probe is OutputProbe =>
      probe &&
      typeof probe.path === 'string' &&
      (probe.kind === 'absent' || probe.kind === 'directory' || probe.kind === 'file'),
  );
  if (expected.length !== raw.length) return false;
  const actual = await captureOutputProbes(expected);
  return expected.every((probe, index) => {
    const next = actual[index];
    return (
      probe.path === next.path &&
      probe.kind === next.kind &&
      (probe.kind === 'absent' ||
        (probe.size === next.size &&
          probe.mode === next.mode &&
          probe.mtimeMs === next.mtimeMs &&
          probe.digest === next.digest))
    );
  });
}

async function replaceManagedSkillPackage(
  rootPath: string,
  pkg: { slug: string; files: Array<{ path: string; content: string; executable: boolean }> },
): Promise<number> {
  await fs.mkdir(rootPath, { recursive: true });
  const targetPath = path.join(rootPath, pkg.slug);
  const temporaryPath = path.join(
    rootPath,
    `.${pkg.slug}.drone-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  await fs.rm(temporaryPath, { recursive: true, force: true });
  await fs.mkdir(temporaryPath, { recursive: true });
  try {
    for (const file of pkg.files) {
      const filePath = path.join(temporaryPath, file.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.content, 'utf8');
      if (file.executable) await fs.chmod(filePath, 0o755);
    }
    await fs.rm(targetPath, { recursive: true, force: true });
    await fs.rename(temporaryPath, targetPath);
  } finally {
    await fs.rm(temporaryPath, { recursive: true, force: true }).catch(() => {});
  }
  return pkg.files.length;
}

async function applyManagedDroneState(body: ManagedDroneSyncPayload, dataDir: string) {
  const startedAt = performance.now();
  requiredRecord(body, 'managed state');
  if (body?.version !== 1) throw new DaemonHttpError(400, 'unsupported managed state version');
  const fingerprint = String(body?.fingerprint ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
    throw new DaemonHttpError(400, 'fingerprint must be a SHA-256 hash');
  }
  if (fingerprint !== managedDroneStateFingerprint(unsignedManagedDroneState(body))) {
    throw new DaemonHttpError(400, 'managed state fingerprint mismatch');
  }

  const rawSkillTargets = requiredArray(body?.skillTargets, 'skillTargets');
  const rawMcpTargets = requiredArray(body?.mcpTargets, 'mcpTargets');
  if (rawSkillTargets.length + rawMcpTargets.length > MANAGED_SYNC_MAX_TARGETS) {
    throw new DaemonHttpError(413, `too many managed targets (max ${MANAGED_SYNC_MAX_TARGETS})`);
  }

  let packageCount = 0;
  let fileCount = 0;
  const seenSkillRoots = new Set<string>();
  const skillTargets = rawSkillTargets.map((target: any, targetIndex: number) => {
    requiredRecord(target, `skillTargets[${targetIndex}]`);
    const rootPath = normalizedAbsolutePath(target?.rootPath, `skillTargets[${targetIndex}].rootPath`);
    if (!isManagedSkillRoot(rootPath)) {
      throw new DaemonHttpError(400, `unsupported managed skill root: ${rootPath}`);
    }
    addUniqueValue(seenSkillRoots, rootPath, 'managed skill root');
    const seenSlugs = new Set<string>();
    const packages = requiredArray(target?.packages, `skillTargets[${targetIndex}].packages`).map(
      (pkg: any, packageIndex: number) => {
        requiredRecord(pkg, `skillTargets[${targetIndex}].packages[${packageIndex}]`);
        packageCount += 1;
        const slug = normalizedName(pkg?.slug, `skillTargets[${targetIndex}].packages[${packageIndex}].slug`);
        addUniqueValue(seenSlugs, slug, `managed skill package in ${rootPath}`);
        const seenFilePaths = new Set<string>();
        const files = requiredArray(
          pkg?.files,
          `skillTargets[${targetIndex}].packages[${packageIndex}].files`,
        ).map(
          (file: any, fileIndex: number) => {
            requiredRecord(
              file,
              `skillTargets[${targetIndex}].packages[${packageIndex}].files[${fileIndex}]`,
            );
            fileCount += 1;
            if (typeof file?.content !== 'string') {
              throw new DaemonHttpError(400, `managed skill content must be a string: ${slug}`);
            }
            if (Buffer.byteLength(file.content, 'utf8') > WORKSPACE_FILE_MAX_BYTES) {
              throw new DaemonHttpError(413, `managed skill file too large: ${slug}`);
            }
            const filePath = normalizedRelativePath(
              file?.path,
              `skillTargets[${targetIndex}].packages[${packageIndex}].files[${fileIndex}].path`,
            );
            addUniqueValue(seenFilePaths, filePath, `managed skill file in ${slug}`);
            return {
              path: filePath,
              content: file.content,
              executable: file?.executable === true,
            };
          },
        );
        assertNoFileDirectoryCollisions(
          files.map((file) => file.path),
          `managed skill package ${slug}`,
        );
        return { slug, files };
      },
    );
    if (target?.cleanupOnly === true && packages.length > 0) {
      throw new DaemonHttpError(400, `cleanup-only skill target cannot contain packages: ${rootPath}`);
    }
    return { rootPath, cleanupOnly: target?.cleanupOnly === true, packages };
  });
  if (packageCount > MANAGED_SYNC_MAX_PACKAGES || fileCount > MANAGED_SYNC_MAX_FILES) {
    throw new DaemonHttpError(413, 'managed skill payload exceeds package or file limits');
  }

  const seenMcpConfigPaths = new Set<string>();
  const mcpTargets = rawMcpTargets.map((target: any, targetIndex: number) => {
    requiredRecord(target, `mcpTargets[${targetIndex}]`);
    const configPath = normalizedAbsolutePath(target?.configPath, `mcpTargets[${targetIndex}].configPath`);
    if (!isManagedMcpConfigPath(configPath)) {
      throw new DaemonHttpError(400, `unsupported managed MCP config path: ${configPath}`);
    }
    addUniqueValue(seenMcpConfigPaths, configPath, 'managed MCP config path');
    const projection = requiredRecord(target?.projection, `mcpTargets[${targetIndex}].projection`);
    if (projection?.format !== 'toml' && projection?.format !== 'json') {
      throw new DaemonHttpError(400, `unsupported MCP projection format: ${projection?.format ?? ''}`);
    }
    const managedNames = requiredArray(
      projection.managedNames,
      `mcpTargets[${targetIndex}].projection.managedNames`,
    ).map((name: unknown) => normalizedName(name, 'managed MCP name'));
    const uniqueManagedNames = new Set(managedNames);
    if (uniqueManagedNames.size !== managedNames.length) {
      throw new DaemonHttpError(400, `duplicate managed MCP name for ${configPath}`);
    }
    if (projection.format === 'toml') {
      if (typeof projection.managedBlock !== 'string') {
        throw new DaemonHttpError(400, 'managed MCP TOML block must be a string');
      }
      return { configPath, projection: { format: 'toml' as const, managedNames, managedBlock: projection.managedBlock } };
    }
    if (projection.rootKey !== 'mcp' && projection.rootKey !== 'mcpServers') {
      throw new DaemonHttpError(400, `unsupported MCP JSON root key: ${projection.rootKey ?? ''}`);
    }
    const rootKey = projection.rootKey;
    const entries = requiredRecord(
      projection.entries,
      `mcpTargets[${targetIndex}].projection.entries`,
    );
    const entryNames = Object.keys(entries).sort();
    const expectedNames = managedNames.slice().sort();
    if (
      entryNames.length !== expectedNames.length ||
      entryNames.some((name, index) => name !== expectedNames[index])
    ) {
      throw new DaemonHttpError(400, `managed MCP entries must exactly match managedNames: ${configPath}`);
    }
    return {
      configPath,
      projection: {
        format: 'json' as const,
        managedNames,
        rootKey,
        entries,
        ...(typeof projection.schema === 'string' ? { schema: projection.schema } : {}),
      },
    };
  });

  let agentsFile: { path: string; content: string } | null = null;
  if (body?.agentsFile != null) {
    requiredRecord(body.agentsFile, 'agentsFile');
    const agentsPath = normalizedAbsolutePath(body.agentsFile.path, 'agentsFile.path');
    if (path.basename(agentsPath) !== 'AGENTS.md' || typeof body.agentsFile.content !== 'string') {
      throw new DaemonHttpError(400, 'agentsFile must target AGENTS.md with string content');
    }
    if (Buffer.byteLength(body.agentsFile.content, 'utf8') > WORKSPACE_FILE_MAX_BYTES) {
      throw new DaemonHttpError(413, 'agentsFile content exceeds the managed file limit');
    }
    agentsFile = { path: agentsPath, content: body.agentsFile.content };
  }

  const statePath = path.join(path.resolve(dataDir), 'managed-state.json');
  const previousState = await readManagedMetadataOrEmpty(statePath);
  if (
    previousState.fingerprint === fingerprint &&
    (await managedOutputsMatch(previousState.outputs))
  ) {
    return {
      changed: false,
      fingerprint,
      filesWritten: 0,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    };
  }

  const expectations = new Map<string, ProbeExpectation>();
  let filesWritten = 0;
  for (const target of skillTargets) {
    const manifestPath = path.join(target.rootPath, MANAGED_SKILLS_MANIFEST);
    const previousManifest = await readManagedMetadataOrEmpty(manifestPath);
    const previousSlugsRaw = Array.isArray(previousManifest.managedSlugs)
      ? previousManifest.managedSlugs
      : previousState?.ownership?.skillSlugsByRoot?.[target.rootPath];
    const previousSlugs = Array.isArray(previousSlugsRaw)
      ? previousSlugsRaw
          .map((slug: unknown) => String(slug ?? '').trim())
          .filter((slug: string) => slug !== '.' && slug !== '..' && /^[A-Za-z0-9_.-]+$/.test(slug))
      : [];
    if (target.cleanupOnly) {
      await Promise.all(previousSlugs.map((slug: string) => fs.rm(path.join(target.rootPath, slug), { recursive: true, force: true })));
      await fs.rm(manifestPath, { force: true });
      expectations.set(manifestPath, { path: manifestPath, kind: 'absent' });
      for (const slug of previousSlugs) {
        const removedPath = path.join(target.rootPath, slug);
        expectations.set(removedPath, { path: removedPath, kind: 'absent' });
      }
      continue;
    }
    const nextSlugs = new Set(target.packages.map((pkg: any) => pkg.slug));
    const removedSlugs = previousSlugs.filter((slug: string) => !nextSlugs.has(slug));
    await Promise.all(removedSlugs.map((slug: string) => fs.rm(path.join(target.rootPath, slug), { recursive: true, force: true })));
    const writes = await Promise.all(target.packages.map((pkg: any) => replaceManagedSkillPackage(target.rootPath, pkg)));
    filesWritten += writes.reduce((total: number, count: number) => total + count, 0);
    await writeFileAtomic(manifestPath, `${JSON.stringify({ managedSlugs: Array.from(nextSlugs).sort() }, null, 2)}\n`);
    filesWritten += 1;
    expectations.set(manifestPath, { path: manifestPath, kind: 'file' });
    for (const slug of removedSlugs) {
      const removedPath = path.join(target.rootPath, slug);
      expectations.set(removedPath, { path: removedPath, kind: 'absent' });
    }
    for (const pkg of target.packages) {
      const packagePath = path.join(target.rootPath, pkg.slug);
      expectations.set(packagePath, { path: packagePath, kind: 'directory' });
      for (const file of pkg.files) {
        addDirectoryExpectations(expectations, packagePath, file.path);
        const filePath = path.join(packagePath, file.path);
        expectations.set(filePath, { path: filePath, kind: 'file' });
      }
    }
  }

  for (const target of mcpTargets) {
    const manifestPath = path.join(path.dirname(target.configPath), MANAGED_MCP_MANIFEST);
    const previousManifest = await readManagedMetadataOrEmpty(manifestPath);
    const previousNamesRaw = Array.isArray(previousManifest.managedNames)
      ? previousManifest.managedNames
      : previousState?.ownership?.mcpNamesByConfigPath?.[target.configPath];
    const previousNames = Array.isArray(previousNamesRaw)
      ? previousNamesRaw.map((name: unknown) => String(name ?? '').trim()).filter(Boolean)
      : [];
    const allManagedNames = Array.from(new Set([...previousNames, ...target.projection.managedNames]));
    if (target.projection.format === 'toml') {
      let existing = '';
      try {
        existing = await fs.readFile(target.configPath, 'utf8');
      } catch (error: any) {
        if (String(error?.code ?? '') !== 'ENOENT') throw error;
      }
      const base = stripManagedCodexMcpTables(existing, allManagedNames);
      await writeFileAtomic(target.configPath, `${[base, target.projection.managedBlock].filter(Boolean).join('\n\n')}\n`);
    } else {
      const existing = await readJsonObjectOrEmpty(target.configPath);
      if (target.projection.schema && !existing.$schema) existing.$schema = target.projection.schema;
      const currentRoot =
        existing[target.projection.rootKey] &&
        typeof existing[target.projection.rootKey] === 'object' &&
        !Array.isArray(existing[target.projection.rootKey])
          ? Object.fromEntries(Object.entries(existing[target.projection.rootKey]))
          : {};
      for (const name of previousNames) delete currentRoot[name];
      existing[target.projection.rootKey] = Object.fromEntries([
        ...Object.entries(currentRoot),
        ...Object.entries(target.projection.entries),
      ]);
      await writeFileAtomic(target.configPath, `${JSON.stringify(existing, null, 2)}\n`);
    }
    await writeFileAtomic(manifestPath, `${JSON.stringify({ managedNames: target.projection.managedNames.slice().sort() }, null, 2)}\n`);
    filesWritten += 2;
    expectations.set(target.configPath, { path: target.configPath, kind: 'file' });
    expectations.set(manifestPath, { path: manifestPath, kind: 'file' });
  }

  if (agentsFile) {
    await writeFileAtomic(agentsFile.path, agentsFile.content);
    filesWritten += 1;
    expectations.set(agentsFile.path, { path: agentsFile.path, kind: 'file' });
  }
  const outputs = await captureOutputProbes(expectations.values());
  const ownership = {
    skillSlugsByRoot: Object.fromEntries(
      skillTargets.map((target) => [
        target.rootPath,
        target.cleanupOnly ? [] : target.packages.map((pkg) => pkg.slug).sort(),
      ]),
    ),
    mcpNamesByConfigPath: Object.fromEntries(
      mcpTargets.map((target) => [
        target.configPath,
        target.projection.managedNames.slice().sort(),
      ]),
    ),
  };
  await writeFileAtomic(
    statePath,
    `${JSON.stringify({ version: 1, fingerprint, ownership, outputs, appliedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  return {
    changed: true,
    fingerprint,
    filesWritten,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
  };
}

export async function handleDaemonManagedStateRequest(input: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  pathname: string;
  dataDir: string;
}): Promise<boolean> {
  if (input.pathname !== '/v1/managed-state' || input.method !== 'PUT') return false;
  const body = (await readLimitedJson(input.req)) as ManagedDroneSyncPayload;
  sendJson(input.res, 200, { ok: true, ...(await applyManagedDroneState(body, input.dataDir)) });
  return true;
}
