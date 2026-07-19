import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { DroneRegistry } from '../host/registry';
import { loadRegistry, loadRegistryRawSnapshot, updateRegistry } from '../host/registry';
import { getHubDatabase } from '../host/hub-database';
import { getCatalogStore, type CatalogStore } from '../host/catalog-store';
import { bashQuote } from './hub-format';

const MANAGED_SKILLS_MANIFEST = '.drone-managed-skills.json';

// Host drones project into the same user-level skill roots. Serialize those
// projections so concurrent drone provisioning cannot remove a package while
// another projection is writing it.
let hostSkillProjectionTail: Promise<void> = Promise.resolve();

export type SkillFileKind = 'script' | 'reference' | 'asset' | 'extra';

export type SkillFileEntry = {
  path: string;
  content: string;
  kind: SkillFileKind;
};

export type SkillCodexOverlay = {
  openaiYaml?: string;
};

export type SkillClaudeOverlay = {
  argumentHint?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  allowedTools?: string[] | string;
  model?: string;
  context?: string;
  agent?: string;
  hooks?: Record<string, unknown>;
};

export type SkillCursorOverlay = {
  disableModelInvocation?: boolean;
};

export type SkillOverlaySet = {
  codex?: SkillCodexOverlay;
  claude?: SkillClaudeOverlay;
  cursor?: SkillCursorOverlay;
  opencode?: Record<string, never>;
};

export type SkillRecord = {
  id: string;
  slug: string;
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  markdownBody: string;
  files: SkillFileEntry[];
  overlays?: SkillOverlaySet;
  createdAt: string;
  updatedAt: string;
};

export type SkillProjectionAgent = 'portable' | 'codex' | 'claude' | 'cursor' | 'opencode';

export type SkillProjectionTarget = {
  rootPath: string;
  agent: SkillProjectionAgent;
  cleanupOnly?: boolean;
};

type StoredSkillRecord = SkillRecord;

type ManifestShape = {
  managedSlugs: string[];
};

async function loadDvmHelpers(): Promise<{
  dvmCopyToContainer: (
    container: string,
    srcPath: string,
    destPath: string,
    opts?: { clean?: boolean; timeoutMs?: number },
  ) => Promise<void>;
  dvmExec: (
    container: string,
    cmd: string,
    args?: string[],
    opts?: { timeoutMs?: number },
  ) => Promise<{ stdout?: string; stderr?: string }>;
}> {
  const mod = await import('../host/dvm');
  return {
    dvmCopyToContainer: mod.dvmCopyToContainer,
    dvmExec: mod.dvmExec,
  };
}

function normalizeNonEmptyString(raw: unknown, label: string): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw new Error(`missing ${label}`);
  return text;
}

export function normalizeSkillSlug(raw: unknown): string {
  const text = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!text) throw new Error('missing slug');
  if (!/^[a-z0-9-]+$/.test(text)) throw new Error('invalid slug');
  return text;
}

function normalizeOptionalString(raw: unknown): string | undefined {
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text || undefined;
}

function normalizeStringMap(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const k = String(key ?? '').trim();
    if (!k) continue;
    const v = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
    if (!v) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeSkillFilePath(raw: unknown): string {
  const text = String(raw ?? '')
    .trim()
    .replace(/\\/g, '/');
  if (!text) throw new Error('missing file path');
  if (text.startsWith('/')) throw new Error(`invalid file path: ${text}`);
  const normalized = path.posix.normalize(text);
  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new Error(`invalid file path: ${text}`);
  }
  if (normalized === 'SKILL.md') throw new Error('SKILL.md is managed by the Hub');
  return normalized;
}

function inferSkillFileKindFromPath(filePath: string): SkillFileKind {
  if (filePath.startsWith('scripts/')) return 'script';
  if (filePath.startsWith('references/')) return 'reference';
  if (filePath.startsWith('assets/')) return 'asset';
  return 'extra';
}

function normalizeSkillFiles(raw: unknown): SkillFileEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillFileEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const filePath = normalizeSkillFilePath((item as any).path);
    if (seen.has(filePath)) throw new Error(`duplicate file path: ${filePath}`);
    const content = typeof (item as any).content === 'string' ? (item as any).content : '';
    const rawKind = String((item as any).kind ?? '')
      .trim()
      .toLowerCase();
    const kind: SkillFileKind =
      rawKind === 'script' || rawKind === 'reference' || rawKind === 'asset' || rawKind === 'extra'
        ? rawKind
        : inferSkillFileKindFromPath(filePath);
    out.push({ path: filePath, content, kind });
    seen.add(filePath);
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function normalizeClaudeOverlay(raw: unknown): SkillClaudeOverlay | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const allowedToolsRaw = (raw as any).allowedTools;
  const allowedTools = Array.isArray(allowedToolsRaw)
    ? allowedToolsRaw.map((value) => String(value ?? '').trim()).filter(Boolean)
    : typeof allowedToolsRaw === 'string'
      ? allowedToolsRaw
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : undefined;
  const hooks =
    (raw as any).hooks &&
    typeof (raw as any).hooks === 'object' &&
    !Array.isArray((raw as any).hooks)
      ? ((raw as any).hooks as Record<string, unknown>)
      : undefined;
  const overlay: SkillClaudeOverlay = {
    argumentHint: normalizeOptionalString((raw as any).argumentHint),
    disableModelInvocation:
      typeof (raw as any).disableModelInvocation === 'boolean'
        ? Boolean((raw as any).disableModelInvocation)
        : undefined,
    userInvocable:
      typeof (raw as any).userInvocable === 'boolean'
        ? Boolean((raw as any).userInvocable)
        : undefined,
    allowedTools,
    model: normalizeOptionalString((raw as any).model),
    context: normalizeOptionalString((raw as any).context),
    agent: normalizeOptionalString((raw as any).agent),
    hooks,
  };
  return Object.values(overlay).some(
    (value) => value != null && (!Array.isArray(value) || value.length > 0),
  )
    ? overlay
    : undefined;
}

function normalizeCursorOverlay(raw: unknown): SkillCursorOverlay | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const disableModelInvocation =
    typeof (raw as any).disableModelInvocation === 'boolean'
      ? Boolean((raw as any).disableModelInvocation)
      : undefined;
  return disableModelInvocation == null ? undefined : { disableModelInvocation };
}

function normalizeCodexOverlay(raw: unknown): SkillCodexOverlay | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const openaiYaml = normalizeOptionalString((raw as any).openaiYaml);
  return openaiYaml ? { openaiYaml } : undefined;
}

function normalizeSkillOverlays(raw: unknown): SkillOverlaySet | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const overlay: SkillOverlaySet = {
    codex: normalizeCodexOverlay((raw as any).codex),
    claude: normalizeClaudeOverlay((raw as any).claude),
    cursor: normalizeCursorOverlay((raw as any).cursor),
    opencode:
      (raw as any).opencode &&
      typeof (raw as any).opencode === 'object' &&
      !Array.isArray((raw as any).opencode)
        ? {}
        : undefined,
  };
  return overlay.codex || overlay.claude || overlay.cursor || overlay.opencode
    ? overlay
    : undefined;
}

function normalizeStoredSkillRecord(raw: unknown, fallbackId?: string): SkillRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as any;
  const id =
    normalizeOptionalString(record.id) ||
    normalizeOptionalString(fallbackId) ||
    crypto.randomUUID();
  const name = normalizeOptionalString(record.name);
  const description = normalizeOptionalString(record.description);
  if (!name || !description) return null;
  const slug = normalizeSkillSlug(record.slug ?? name);
  const markdownBody =
    typeof record.markdownBody === 'string'
      ? record.markdownBody
      : typeof record.content === 'string'
        ? record.content
        : typeof record.body === 'string'
          ? record.body
          : '';
  return {
    id,
    slug,
    name,
    description,
    ...(normalizeOptionalString(record.license)
      ? { license: normalizeOptionalString(record.license) }
      : {}),
    ...(normalizeOptionalString(record.compatibility)
      ? { compatibility: normalizeOptionalString(record.compatibility) }
      : {}),
    ...(normalizeStringMap(record.metadata)
      ? { metadata: normalizeStringMap(record.metadata) }
      : {}),
    markdownBody,
    files: normalizeSkillFiles(record.files),
    ...(normalizeSkillOverlays(record.overlays)
      ? { overlays: normalizeSkillOverlays(record.overlays) }
      : {}),
    createdAt: normalizeOptionalString(record.createdAt) || new Date().toISOString(),
    updatedAt:
      normalizeOptionalString(record.updatedAt) ||
      normalizeOptionalString(record.createdAt) ||
      new Date().toISOString(),
  };
}

export function listSkillsFromRegistry(
  reg: DroneRegistry | Record<string, unknown>,
): SkillRecord[] {
  const rawSkills = (reg as any)?.skills;
  if (!rawSkills || typeof rawSkills !== 'object' || Array.isArray(rawSkills)) return [];
  const out: SkillRecord[] = [];
  const seenSlugs = new Set<string>();
  for (const [id, value] of Object.entries(rawSkills)) {
    const skill = normalizeStoredSkillRecord(value, id);
    if (!skill) continue;
    if (seenSlugs.has(skill.slug)) continue;
    seenSlugs.add(skill.slug);
    out.push(skill);
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

async function canonicalSkillStore(): Promise<CatalogStore | null> {
  try {
    return await getCatalogStore();
  } catch (error) {
    if ((globalThis as any).Bun && getHubDatabase() === null) return null;
    throw error;
  }
}

async function backfillLegacySkills(store: CatalogStore): Promise<void> {
  if (store.isBackfillComplete('skills')) return;
  await store.backfillSkills(listSkillsFromRegistry(await loadRegistryRawSnapshot()));
}

export async function listSkills(): Promise<SkillRecord[]> {
  const store = await canonicalSkillStore();
  if (store) {
    await backfillLegacySkills(store);
    return store.listSkills<SkillRecord>();
  }
  const reg = await loadRegistry();
  return listSkillsFromRegistry(reg);
}

export async function getSkillById(idRaw: string): Promise<SkillRecord | null> {
  const id = String(idRaw ?? '').trim();
  if (!id) return null;
  const store = await canonicalSkillStore();
  if (store) {
    await backfillLegacySkills(store);
    return store.getSkill<SkillRecord>(id);
  }
  return listSkillsFromRegistry(await loadRegistry()).find((skill) => skill.id === id) ?? null;
}

function assertSkillSlugAvailable(skills: SkillRecord[], slug: string, selfId?: string): void {
  const conflict = skills.find((skill) => skill.slug === slug && skill.id !== selfId);
  if (conflict) throw new Error(`skill slug already exists: ${slug}`);
}

function normalizeIncomingSkillInput(input: any, existing?: SkillRecord): SkillRecord {
  const name = normalizeNonEmptyString(input?.name ?? existing?.name, 'name');
  const description = normalizeNonEmptyString(
    input?.description ?? existing?.description,
    'description',
  );
  const slug = normalizeSkillSlug(input?.slug ?? existing?.slug ?? name);
  const createdAt = existing?.createdAt ?? new Date().toISOString();
  const files =
    input && Object.prototype.hasOwnProperty.call(input, 'files')
      ? normalizeSkillFiles(input.files)
      : (existing?.files ?? []);
  const metadata =
    input && Object.prototype.hasOwnProperty.call(input, 'metadata')
      ? normalizeStringMap(input.metadata)
      : existing?.metadata;
  const overlays =
    input && Object.prototype.hasOwnProperty.call(input, 'overlays')
      ? normalizeSkillOverlays(input.overlays)
      : existing?.overlays;
  const markdownBody =
    input &&
    typeof input === 'object' &&
    Object.prototype.hasOwnProperty.call(input, 'markdownBody')
      ? typeof input.markdownBody === 'string'
        ? input.markdownBody
        : ''
      : input && typeof input === 'object' && Object.prototype.hasOwnProperty.call(input, 'content')
        ? typeof input.content === 'string'
          ? input.content
          : ''
        : input && typeof input === 'object' && Object.prototype.hasOwnProperty.call(input, 'body')
          ? typeof input.body === 'string'
            ? input.body
            : ''
          : (existing?.markdownBody ?? '');
  const record: SkillRecord = {
    id: existing?.id ?? crypto.randomUUID(),
    slug,
    name,
    description,
    ...(normalizeOptionalString(input?.license ?? existing?.license)
      ? { license: normalizeOptionalString(input?.license ?? existing?.license) }
      : {}),
    ...(normalizeOptionalString(input?.compatibility ?? existing?.compatibility)
      ? { compatibility: normalizeOptionalString(input?.compatibility ?? existing?.compatibility) }
      : {}),
    ...(metadata ? { metadata } : {}),
    markdownBody,
    files,
    ...(overlays ? { overlays } : {}),
    createdAt,
    updatedAt: new Date().toISOString(),
  };
  return record;
}

export async function createSkill(input: any): Promise<SkillRecord> {
  const current = await listSkills();
  const record = normalizeIncomingSkillInput(input);
  assertSkillSlugAvailable(current, record.slug);
  const store = await canonicalSkillStore();
  if (store) return await store.putSkill(record);
  await updateRegistry((reg: any) => {
    reg.skills = reg.skills ?? {};
    reg.skills[record.id] = record;
  });
  return record;
}

export async function updateSkillRecord(idRaw: string, input: any): Promise<SkillRecord> {
  const id = String(idRaw ?? '').trim();
  if (!id) throw new Error('missing skill id');
  const current = await listSkills();
  const existing = current.find((skill) => skill.id === id);
  if (!existing) throw new Error(`unknown skill: ${id}`);
  const record = normalizeIncomingSkillInput(input, existing);
  assertSkillSlugAvailable(current, record.slug, id);
  const store = await canonicalSkillStore();
  if (store) return await store.putSkill(record);
  await updateRegistry((reg: any) => {
    reg.skills = reg.skills ?? {};
    reg.skills[id] = record;
  });
  return record;
}

export async function deleteSkillRecord(idRaw: string): Promise<boolean> {
  const id = String(idRaw ?? '').trim();
  if (!id) return false;
  const store = await canonicalSkillStore();
  if (store) {
    await backfillLegacySkills(store);
    return await store.deleteSkill(id);
  }
  return await updateRegistry((reg: any) => {
    if (!reg?.skills?.[id]) return false;
    delete reg.skills[id];
    if (Object.keys(reg.skills).length === 0) delete reg.skills;
    return true;
  });
}

function yamlScalar(value: string | number | boolean | null): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  const text = String(value ?? '');
  if (/^[A-Za-z0-9._/@:-]+$/.test(text) && !/^(true|false|null)$/i.test(text)) return text;
  return JSON.stringify(text);
}

function yamlLinesForValue(key: string, value: unknown, indent = ''): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    const lines: string[] = [`${indent}${key}:`];
    for (const item of value) {
      if (
        item == null ||
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean'
      ) {
        lines.push(`${indent}  - ${yamlScalar(item as any)}`);
        continue;
      }
      if (typeof item === 'object') {
        lines.push(`${indent}  -`);
        for (const [childKey, childValue] of Object.entries(item)) {
          lines.push(...yamlLinesForValue(childKey, childValue, `${indent}    `));
        }
      }
    }
    return lines;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return [];
    const lines: string[] = [`${indent}${key}:`];
    for (const [childKey, childValue] of entries) {
      lines.push(...yamlLinesForValue(childKey, childValue, `${indent}  `));
    }
    return lines;
  }
  return [`${indent}${key}: ${yamlScalar(value as any)}`];
}

function skillFrontmatter(
  skill: SkillRecord,
  agent: SkillProjectionAgent,
): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = {
    name: skill.name,
    description: skill.description,
  };
  if (skill.license) frontmatter.license = skill.license;
  if (skill.compatibility) frontmatter.compatibility = skill.compatibility;
  if (skill.metadata && Object.keys(skill.metadata).length > 0)
    frontmatter.metadata = skill.metadata;
  if (agent === 'claude' && skill.overlays?.claude) {
    const claude = skill.overlays.claude;
    if (claude.argumentHint) frontmatter['argument-hint'] = claude.argumentHint;
    if (typeof claude.disableModelInvocation === 'boolean')
      frontmatter['disable-model-invocation'] = claude.disableModelInvocation;
    if (typeof claude.userInvocable === 'boolean')
      frontmatter['user-invocable'] = claude.userInvocable;
    if (
      claude.allowedTools &&
      Array.isArray(claude.allowedTools) &&
      claude.allowedTools.length > 0
    ) {
      frontmatter['allowed-tools'] = claude.allowedTools;
    }
    if (claude.model) frontmatter.model = claude.model;
    if (claude.context) frontmatter.context = claude.context;
    if (claude.agent) frontmatter.agent = claude.agent;
    if (claude.hooks && Object.keys(claude.hooks).length > 0) frontmatter.hooks = claude.hooks;
  }
  if (
    agent === 'cursor' &&
    skill.overlays?.cursor &&
    typeof skill.overlays.cursor.disableModelInvocation === 'boolean'
  ) {
    frontmatter['disable-model-invocation'] = skill.overlays.cursor.disableModelInvocation;
  }
  return frontmatter;
}

export function renderSkillMarkdown(skill: SkillRecord, agent: SkillProjectionAgent): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(skillFrontmatter(skill, agent))) {
    lines.push(...yamlLinesForValue(key, value));
  }
  lines.push('---');
  const body = String(skill.markdownBody ?? '').trim();
  if (body) lines.push('', body);
  return `${lines.join('\n')}\n`;
}

function buildSkillFileMap(
  skill: SkillRecord,
  agent: SkillProjectionAgent,
): Map<string, { content: string; kind: SkillFileKind | 'managed' }> {
  const out = new Map<string, { content: string; kind: SkillFileKind | 'managed' }>();
  out.set('SKILL.md', { content: renderSkillMarkdown(skill, agent), kind: 'managed' });
  for (const file of skill.files) {
    out.set(file.path, { content: file.content, kind: file.kind });
  }
  if (agent === 'codex' && skill.overlays?.codex?.openaiYaml) {
    out.set('agents/openai.yaml', {
      content: `${String(skill.overlays.codex.openaiYaml).replace(/\s+$/, '')}\n`,
      kind: 'managed',
    });
  }
  return out;
}

type RenderedSkillPackage = {
  slug: string;
  files: Map<string, { content: string; kind: SkillFileKind | 'managed' }>;
};

function renderSkillPackages(
  skills: SkillRecord[],
  agent: SkillProjectionAgent,
): RenderedSkillPackage[] {
  return skills.map((skill) => ({
    slug: skill.slug,
    files: buildSkillFileMap(skill, agent),
  }));
}

function manifestPathForTarget(rootPath: string): string {
  return path.join(rootPath, MANAGED_SKILLS_MANIFEST);
}

function manifestPathForTargetPosix(rootPath: string): string {
  return path.posix.join(rootPath, MANAGED_SKILLS_MANIFEST);
}

async function readManagedManifestFromHost(rootPath: string): Promise<ManifestShape> {
  try {
    const raw = await fs.readFile(manifestPathForTarget(rootPath), 'utf8');
    const parsed = JSON.parse(raw) as ManifestShape;
    const managedSlugs = Array.isArray(parsed?.managedSlugs)
      ? parsed.managedSlugs.map((value) => normalizeSkillSlug(value))
      : [];
    return { managedSlugs };
  } catch {
    return { managedSlugs: [] };
  }
}

async function readManagedManifestFromContainer(
  containerName: string,
  rootPath: string,
): Promise<ManifestShape> {
  try {
    const { dvmExec } = await loadDvmHelpers();
    const read = await dvmExec(containerName, 'bash', [
      '-lc',
      `cat ${bashQuote(manifestPathForTargetPosix(rootPath))} 2>/dev/null || true`,
    ]);
    const raw = String(read.stdout ?? '').trim();
    if (!raw) return { managedSlugs: [] };
    const parsed = JSON.parse(raw) as ManifestShape;
    const managedSlugs = Array.isArray(parsed?.managedSlugs)
      ? parsed.managedSlugs.map((value) => normalizeSkillSlug(value))
      : [];
    return { managedSlugs };
  } catch {
    return { managedSlugs: [] };
  }
}

function manifestForPackages(packages: RenderedSkillPackage[]): ManifestShape {
  return { managedSlugs: packages.map((entry) => entry.slug).sort((a, b) => a.localeCompare(b)) };
}

async function writeRenderedPackagesToHost(
  rootPath: string,
  packages: RenderedSkillPackage[],
): Promise<void> {
  const targetRoot = path.resolve(rootPath);
  const previous = await readManagedManifestFromHost(targetRoot);
  const next = manifestForPackages(packages);
  await fs.mkdir(targetRoot, { recursive: true });
  const nextSet = new Set(next.managedSlugs);
  for (const slug of previous.managedSlugs) {
    if (nextSet.has(slug)) continue;
    await fs.rm(path.join(targetRoot, slug), { recursive: true, force: true });
  }
  for (const pkg of packages) {
    const skillRoot = path.join(targetRoot, pkg.slug);
    await fs.rm(skillRoot, { recursive: true, force: true });
    await fs.mkdir(skillRoot, { recursive: true });
    for (const [relativePath, file] of pkg.files) {
      const absPath = path.join(skillRoot, relativePath);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, file.content, 'utf8');
      if (relativePath.startsWith('scripts/')) {
        await fs.chmod(absPath, 0o755).catch(() => {});
      }
    }
  }
  await fs.writeFile(
    manifestPathForTarget(targetRoot),
    `${JSON.stringify(next, null, 2)}\n`,
    'utf8',
  );
}

async function removeManagedPackagesFromHost(rootPath: string): Promise<void> {
  const targetRoot = path.resolve(rootPath);
  const previous = await readManagedManifestFromHost(targetRoot);
  for (const slug of previous.managedSlugs) {
    await fs.rm(path.join(targetRoot, slug), { recursive: true, force: true });
  }
  await fs.rm(manifestPathForTarget(targetRoot), { force: true }).catch(() => {});
}

async function writeRenderedPackagesToContainer(
  containerName: string,
  rootPath: string,
  packages: RenderedSkillPackage[],
): Promise<void> {
  const { dvmCopyToContainer, dvmExec } = await loadDvmHelpers();
  const targetRoot = path.posix.normalize(rootPath);
  const previous = await readManagedManifestFromContainer(containerName, targetRoot);
  const next = manifestForPackages(packages);
  const nextSet = new Set(next.managedSlugs);
  const cleanupScript = [
    'set -euo pipefail',
    `root=${bashQuote(targetRoot)}`,
    'mkdir -p "$root"',
    ...previous.managedSlugs
      .filter((slug) => !nextSet.has(slug))
      .map((slug) => `rm -rf "$root/${slug}"`),
  ].join('\n');
  await dvmExec(containerName, 'bash', ['-lc', cleanupScript]);

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-skill-sync-'));
  try {
    for (const pkg of packages) {
      const localSkillRoot = path.join(tempRoot, pkg.slug);
      await fs.mkdir(localSkillRoot, { recursive: true });
      for (const [relativePath, file] of pkg.files) {
        const absPath = path.join(localSkillRoot, relativePath);
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, file.content, 'utf8');
        if (relativePath.startsWith('scripts/')) {
          await fs.chmod(absPath, 0o755).catch(() => {});
        }
      }
      await dvmCopyToContainer(
        containerName,
        localSkillRoot,
        path.posix.join(targetRoot, pkg.slug),
        { clean: true },
      );
    }
    const localManifestPath = path.join(tempRoot, MANAGED_SKILLS_MANIFEST);
    await fs.writeFile(localManifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await dvmCopyToContainer(
      containerName,
      localManifestPath,
      manifestPathForTargetPosix(targetRoot),
      { clean: false },
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function removeManagedPackagesFromContainer(
  containerName: string,
  rootPath: string,
): Promise<void> {
  const { dvmExec } = await loadDvmHelpers();
  const targetRoot = path.posix.normalize(rootPath);
  const previous = await readManagedManifestFromContainer(containerName, targetRoot);
  const cleanupScript = [
    'set -euo pipefail',
    `root=${bashQuote(targetRoot)}`,
    ...previous.managedSlugs.map((slug) => `rm -rf "$root/${slug}"`),
    `rm -f ${bashQuote(manifestPathForTargetPosix(targetRoot))}`,
  ].join('\n');
  await dvmExec(containerName, 'bash', ['-lc', cleanupScript]);
}

async function withHostSkillProjectionLock<T>(run: () => Promise<T>): Promise<T> {
  const result = hostSkillProjectionTail.then(run, run);
  hostSkillProjectionTail = result.then(
    () => undefined,
    () => undefined,
  );
  return await result;
}

function isMissingProjectionPathError(error: unknown): boolean {
  const code = String((error as any)?.code ?? '').trim();
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function syncSkillLibraryToHostTarget(
  target: SkillProjectionTarget,
  skills: SkillRecord[],
): Promise<void> {
  const rootPath = String(target.rootPath ?? '').trim();
  if (!rootPath) return;
  if (target.cleanupOnly) {
    await removeManagedPackagesFromHost(rootPath);
    return;
  }
  const packages = renderSkillPackages(skills, target.agent);
  await writeRenderedPackagesToHost(rootPath, packages);
}

export async function syncSkillLibraryToHostTargets(opts: {
  targets: SkillProjectionTarget[];
  skills?: SkillRecord[];
}): Promise<void> {
  await withHostSkillProjectionLock(async () => {
    // Read the implicit library snapshot after acquiring the lock. Otherwise a
    // slower, earlier call can queue behind a later call and overwrite it with
    // stale skill data once its pre-lock read eventually completes.
    const skills = Array.isArray(opts.skills) ? opts.skills : await listSkills();
    const failures: Error[] = [];
    for (const target of opts.targets) {
      let completed = false;
      for (let attempt = 0; attempt < 2 && !completed; attempt++) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await syncSkillLibraryToHostTarget(target, skills);
          completed = true;
        } catch (error: any) {
          if (attempt === 0 && isMissingProjectionPathError(error)) continue;
          const cause = error instanceof Error ? error : new Error(String(error));
          const rootPath = String(target.rootPath ?? '').trim() || '<empty>';
          const failure = new Error(
            `host skill projection failed for ${target.agent} target ${rootPath}: ${cause.message}`,
            { cause },
          );
          failures.push(failure);
        }
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      const combined = new Error(
        `${failures.length} host skill projection targets failed: ${failures
          .map((error) => error.message)
          .join(' | ')}`,
      );
      (combined as any).errors = failures;
      throw combined;
    }
  });
}

export async function syncSkillLibraryToContainerTargets(opts: {
  containerName: string;
  targets: SkillProjectionTarget[];
  skills?: SkillRecord[];
}): Promise<void> {
  const containerName = String(opts.containerName ?? '').trim();
  if (!containerName) throw new Error('missing container name');
  const skills = Array.isArray(opts.skills) ? opts.skills : await listSkills();
  for (const target of opts.targets) {
    const rootPath = String(target.rootPath ?? '').trim();
    if (!rootPath) continue;
    if (target.cleanupOnly) {
      await removeManagedPackagesFromContainer(containerName, rootPath);
      continue;
    }
    const packages = renderSkillPackages(skills, target.agent);
    await writeRenderedPackagesToContainer(containerName, rootPath, packages);
  }
}
