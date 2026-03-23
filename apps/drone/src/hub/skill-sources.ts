import path from 'node:path';

import { createSkill, normalizeSkillSlug, type SkillFileEntry, type SkillOverlaySet, type SkillRecord } from './skills';

export type SkillImportStatus = 'importable' | 'importable_with_loss' | 'not_importable';

export type SkillSourceRecord = {
  id: string;
  name: string;
  description: string;
  owner: string;
  repo: string;
  branch: string;
  repoUrl: string;
};

export type SkillSourceCandidate = {
  id: string;
  sourceId: string;
  path: string;
  slug: string;
  name: string;
  description: string;
  license?: string;
  importStatus: SkillImportStatus;
  importReason?: string;
  pluginName?: string;
};

export type SkillSourcePreviewFile = {
  path: string;
  content: string;
  kind: SkillFileEntry['kind'] | 'managed';
};

export type SkillSourceCandidatePreview = {
  candidate: SkillSourceCandidate;
  sourceId: string;
  sourceCommit: string;
  skillMarkdown: string;
  files: SkillSourcePreviewFile[];
  normalized: {
    name: string;
    slug: string;
    description: string;
    license?: string;
    compatibility: string;
    metadata?: Record<string, string>;
    markdownBody: string;
    files: SkillFileEntry[];
    overlays?: SkillOverlaySet;
  };
};

type FetchLike = typeof fetch;

type GitTreeEntry = {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  size?: number;
};

type MarketplacePlugin = {
  name?: string;
  description?: string;
  source?: string;
  skills?: string | string[];
};

type MarketplaceShape = {
  metadata?: {
    pluginRoot?: string;
  };
  plugins?: MarketplacePlugin[];
};

type CandidateAnalysis = {
  candidate: SkillSourceCandidate;
  source: SkillSourceDefinition;
  sourceCommit: string;
  frontmatter: Record<string, unknown>;
  markdownBody: string;
  rawMarkdown: string;
};

type SkillSourceDefinition = SkillSourceRecord & {
  marketplacePath: string;
};

type CachedSourceAnalysis = {
  source: SkillSourceDefinition;
  sourceCommit: string;
  tree: GitTreeEntry[];
  analyses: CandidateAnalysis[];
};

const SUPPORTED_PORTABLE_COMPATIBILITY = 'codex,claude,cursor,opencode,pi';
const CACHE_TTL_MS = 5 * 60 * 1000;

const SKILL_SOURCE_DEFINITIONS: SkillSourceDefinition[] = [
  {
    id: 'anthropic-skills',
    name: 'Anthropic Skills',
    description: 'Official Anthropic example skills repository.',
    owner: 'anthropics',
    repo: 'skills',
    branch: 'main',
    repoUrl: 'https://github.com/anthropics/skills',
    marketplacePath: '.claude-plugin/marketplace.json',
  },
  {
    id: 'microsoft-skills',
    name: 'Microsoft Skills',
    description: 'Official Microsoft skills and plugin repository.',
    owner: 'microsoft',
    repo: 'skills',
    branch: 'main',
    repoUrl: 'https://github.com/microsoft/skills',
    marketplacePath: '.claude-plugin/marketplace.json',
  },
];

const sourceCache = new Map<string, { expiresAt: number; value: CachedSourceAnalysis }>();

function normalizeRepoRelativePath(basePath: string, inputPath: string): string {
  const trimmed = String(inputPath ?? '').trim().replace(/\\/g, '/');
  if (!trimmed || trimmed === '.') return path.posix.normalize(basePath || '.');
  const joined = trimmed.startsWith('./') || trimmed.startsWith('../') ? path.posix.join(basePath || '.', trimmed) : path.posix.join(basePath || '.', trimmed);
  const normalized = path.posix.normalize(joined);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`invalid repo path: ${inputPath}`);
  }
  return normalized.replace(/\/+$/g, '');
}

function getSkillSourceDefinition(sourceIdRaw: string): SkillSourceDefinition {
  const sourceId = String(sourceIdRaw ?? '').trim();
  const source = SKILL_SOURCE_DEFINITIONS.find((entry) => entry.id === sourceId);
  if (!source) throw new Error(`unknown skill source: ${sourceId || 'unknown'}`);
  return source;
}

async function githubApiJson<T>(source: SkillSourceDefinition, apiPath: string, fetchImpl: FetchLike): Promise<T> {
  const response = await fetchImpl(`https://api.github.com${apiPath}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'drone-hub-skills-importer',
    },
  });
  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const message =
      typeof data?.message === 'string' && data.message.trim()
        ? data.message.trim()
        : `GitHub API request failed for ${source.owner}/${source.repo}: ${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return data as T;
}

async function fetchRawGithubText(source: SkillSourceDefinition, repoPath: string, ref: string, fetchImpl: FetchLike): Promise<string> {
  const response = await fetchImpl(
    `https://raw.githubusercontent.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/${encodeURIComponent(ref)}/${repoPath}`,
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `failed to fetch ${source.owner}/${source.repo}:${repoPath} (${response.status} ${response.statusText || 'error'})`,
    );
  }
  return text;
}

function parseYamlScalar(raw: string): string | number | boolean | null {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function parseYamlObjectLines(lines: string[], startIndex: number): { value: Record<string, unknown>; nextIndex: number; error?: string } {
  const value: Record<string, unknown> = {};
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.startsWith('  ')) break;
    if (line.startsWith('    ')) {
      return {
        value,
        nextIndex: index,
        error: `unsupported nested yaml object near "${line.trim()}"`,
      };
    }
    const trimmed = line.trim();
    const match = /^([A-Za-z0-9_-]+):(.*)$/.exec(trimmed);
    if (!match) {
      return { value, nextIndex: index, error: `unsupported yaml object entry: ${trimmed}` };
    }
    const key = match[1];
    const rest = match[2]?.trim() ?? '';
    if (!rest) {
      value[key] = '';
      index += 1;
      continue;
    }
    value[key] = parseYamlScalar(rest);
    index += 1;
  }
  return { value, nextIndex: index };
}

function parseYamlArrayLines(lines: string[], startIndex: number): { value: unknown[]; nextIndex: number; error?: string } {
  const value: unknown[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.startsWith('  - ')) break;
    const item = line.slice(4).trim();
    if (!item) {
      return { value, nextIndex: index, error: 'unsupported empty yaml list item' };
    }
    value.push(parseYamlScalar(item));
    index += 1;
  }
  return { value, nextIndex: index };
}

function parseYamlBlockString(lines: string[], startIndex: number): { value: string; nextIndex: number } {
  const out: string[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.startsWith('  ')) break;
    out.push(line.slice(2));
    index += 1;
  }
  return { value: out.join('\n').replace(/\s+$/g, ''), nextIndex: index };
}

function parseSkillMarkdown(markdown: string): {
  frontmatter: Record<string, unknown>;
  body: string;
  unsupported: string[];
} {
  const source = String(markdown ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
  if (!source.startsWith('---\n')) {
    return { frontmatter: {}, body: source.trim(), unsupported: [] };
  }
  const frontmatterMatch = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(source);
  if (!frontmatterMatch) {
    return { frontmatter: {}, body: source.trim(), unsupported: ['unclosed yaml frontmatter'] };
  }
  const header = frontmatterMatch[1] ?? '';
  const body = source.slice(frontmatterMatch[0].length).trim();
  const lines = header.split('\n');
  const frontmatter: Record<string, unknown> = {};
  const unsupported: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (/^\s/.test(line)) {
      unsupported.push(`unexpected indentation near "${line.trim()}"`);
      index += 1;
      continue;
    }
    const match = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (!match) {
      unsupported.push(`unsupported yaml line "${line.trim()}"`);
      index += 1;
      continue;
    }
    const key = match[1];
    const rest = match[2]?.trim() ?? '';
    if (rest === '|') {
      const parsed = parseYamlBlockString(lines, index + 1);
      frontmatter[key] = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    if (!rest) {
      const nextLine = lines[index + 1] ?? '';
      if (!nextLine.startsWith('  ')) {
        frontmatter[key] = '';
        index += 1;
        continue;
      }
      if (nextLine.startsWith('  - ')) {
        const parsed = parseYamlArrayLines(lines, index + 1);
        if (parsed.error) unsupported.push(parsed.error);
        frontmatter[key] = parsed.value;
        index = parsed.nextIndex;
        continue;
      }
      const parsed = parseYamlObjectLines(lines, index + 1);
      if (parsed.error) unsupported.push(parsed.error);
      frontmatter[key] = parsed.value;
      index = parsed.nextIndex;
      continue;
    }
    frontmatter[key] = parseYamlScalar(rest);
    index += 1;
  }
  return { frontmatter, body, unsupported };
}

function toMetadataValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function toStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    const text = toMetadataValue(item);
    if (!text) continue;
    out[key] = text;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function classifyCandidate(opts: {
  source: SkillSourceDefinition;
  rootPath: string;
  name: string;
  description: string;
  unsupported: string[];
  tree: GitTreeEntry[];
}): { status: SkillImportStatus; reason?: string } {
  if (!opts.name.trim()) return { status: 'not_importable', reason: 'missing skill name' };
  if (!opts.description.trim()) return { status: 'not_importable', reason: 'missing skill description' };
  if (opts.unsupported.length > 0) {
    return { status: 'not_importable', reason: opts.unsupported[0] };
  }
  const prefix = `${opts.rootPath}/`;
  for (const entry of opts.tree) {
    if (!entry.path.startsWith(prefix)) continue;
    if (entry.mode === '120000') {
      return { status: 'not_importable', reason: 'package uses symlinked files' };
    }
    const relativePath = entry.path.slice(prefix.length);
    if (!relativePath || relativePath === 'SKILL.md') continue;
    if (relativePath.startsWith('agents/') && relativePath !== 'agents/openai.yaml') {
      return { status: 'not_importable', reason: `unsupported managed file: ${relativePath}` };
    }
    if (relativePath.startsWith('.claude/') || relativePath.startsWith('.cursor/') || relativePath.startsWith('.opencode/')) {
      return { status: 'not_importable', reason: `unsupported agent-specific package file: ${relativePath}` };
    }
  }
  return { status: 'importable' };
}

function inferSkillFileKind(filePath: string): SkillFileEntry['kind'] {
  if (filePath.startsWith('scripts/')) return 'script';
  if (filePath.startsWith('references/')) return 'reference';
  if (filePath.startsWith('assets/')) return 'asset';
  return 'extra';
}

function buildSkillOverlays(frontmatter: Record<string, unknown>, codexOpenaiYaml?: string): SkillOverlaySet | undefined {
  const claudeAllowedToolsRaw = frontmatter['allowed-tools'];
  const claudeAllowedTools = Array.isArray(claudeAllowedToolsRaw)
    ? claudeAllowedToolsRaw.map((value) => String(value ?? '').trim()).filter(Boolean)
    : typeof claudeAllowedToolsRaw === 'string'
      ? claudeAllowedToolsRaw
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : undefined;
  const hooksValue = frontmatter.hooks;
  const hooks =
    hooksValue && typeof hooksValue === 'object' && !Array.isArray(hooksValue) ? (hooksValue as Record<string, unknown>) : undefined;

  const claudeOverlay =
    frontmatter['argument-hint'] != null ||
    frontmatter['disable-model-invocation'] != null ||
    frontmatter['user-invocable'] != null ||
    claudeAllowedTools != null ||
    frontmatter.model != null ||
    frontmatter.context != null ||
    frontmatter.agent != null ||
    hooks != null
      ? {
          ...(frontmatter['argument-hint'] != null ? { argumentHint: String(frontmatter['argument-hint']) } : {}),
          ...(typeof frontmatter['disable-model-invocation'] === 'boolean'
            ? { disableModelInvocation: frontmatter['disable-model-invocation'] }
            : {}),
          ...(typeof frontmatter['user-invocable'] === 'boolean' ? { userInvocable: frontmatter['user-invocable'] } : {}),
          ...(claudeAllowedTools && claudeAllowedTools.length > 0 ? { allowedTools: claudeAllowedTools } : {}),
          ...(frontmatter.model != null ? { model: String(frontmatter.model) } : {}),
          ...(frontmatter.context != null ? { context: String(frontmatter.context) } : {}),
          ...(frontmatter.agent != null ? { agent: String(frontmatter.agent) } : {}),
          ...(hooks ? { hooks } : {}),
        }
      : undefined;

  const cursorOverlay =
    typeof frontmatter['disable-model-invocation'] === 'boolean'
      ? { disableModelInvocation: frontmatter['disable-model-invocation'] }
      : undefined;

  const codexOverlay = codexOpenaiYaml?.trim() ? { openaiYaml: codexOpenaiYaml.trimEnd() } : undefined;
  if (!claudeOverlay && !cursorOverlay && !codexOverlay) return undefined;
  return {
    ...(codexOverlay ? { codex: codexOverlay } : {}),
    ...(claudeOverlay ? { claude: claudeOverlay } : {}),
    ...(cursorOverlay ? { cursor: cursorOverlay } : {}),
  };
}

function buildSkillMetadata(opts: {
  source: SkillSourceDefinition;
  sourceCommit: string;
  path: string;
  pluginName?: string;
  frontmatter: Record<string, unknown>;
}): Record<string, string> | undefined {
  const metadata: Record<string, string> = {
    'source.repo': `${opts.source.owner}/${opts.source.repo}`,
    'source.path': opts.path,
    'source.ref': opts.sourceCommit,
    'source.url': `${opts.source.repoUrl}/tree/${opts.sourceCommit}/${opts.path}`,
  };
  if (opts.pluginName) metadata['source.plugin'] = opts.pluginName;
  const frontmatterMetadata = toStringMap(opts.frontmatter.metadata);
  if (frontmatterMetadata) {
    for (const [key, value] of Object.entries(frontmatterMetadata)) {
      metadata[key] = value;
    }
  }
  const reservedKeys = new Set([
    'name',
    'description',
    'license',
    'compatibility',
    'metadata',
    'argument-hint',
    'disable-model-invocation',
    'user-invocable',
    'allowed-tools',
    'model',
    'context',
    'agent',
    'hooks',
  ]);
  for (const [key, value] of Object.entries(opts.frontmatter)) {
    if (reservedKeys.has(key)) continue;
    const text = toMetadataValue(value);
    if (!text) continue;
    metadata[`source.frontmatter.${key}`] = text;
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function buildSourceSkillId(sourceId: string, skillPath: string): string {
  return `${sourceId}:${skillPath}`;
}

function buildCandidateFromAnalysis(analysis: CandidateAnalysis): SkillSourceCandidate {
  return analysis.candidate;
}

async function getCachedSourceAnalysis(sourceIdRaw: string, fetchImpl: FetchLike = fetch): Promise<CachedSourceAnalysis> {
  const source = getSkillSourceDefinition(sourceIdRaw);
  const now = Date.now();
  const cached = sourceCache.get(source.id);
  if (cached && cached.expiresAt > now) return cached.value;

  const marketplace = await fetchRawGithubText(source, source.marketplacePath, source.branch, fetchImpl);
  let marketplaceJson: MarketplaceShape;
  try {
    marketplaceJson = JSON.parse(marketplace) as MarketplaceShape;
  } catch {
    throw new Error(`invalid marketplace manifest in ${source.owner}/${source.repo}`);
  }

  const treeResponse = await githubApiJson<{ sha?: string; tree?: GitTreeEntry[] }>(
    source,
    `/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/git/trees/${encodeURIComponent(source.branch)}?recursive=1`,
    fetchImpl,
  );
  const tree = Array.isArray(treeResponse?.tree)
    ? treeResponse.tree.filter((entry): entry is GitTreeEntry => Boolean(entry?.path) && entry.type === 'blob')
    : [];
  const treePaths = new Set(tree.map((entry) => entry.path));
  const sourceCommit = String(treeResponse?.sha ?? source.branch).trim() || source.branch;

  const pluginRoot = normalizeRepoRelativePath('.', String(marketplaceJson?.metadata?.pluginRoot ?? '.'));
  const skillRoots = new Map<string, { pluginName?: string; description?: string }>();
  const plugins = Array.isArray(marketplaceJson?.plugins) ? marketplaceJson.plugins : [];
  for (const plugin of plugins) {
    const pluginSourceBase = normalizeRepoRelativePath(pluginRoot, String(plugin?.source ?? '.'));
    const pluginSkillEntry = plugin?.skills;
    if (Array.isArray(pluginSkillEntry)) {
      for (const skillPath of pluginSkillEntry) {
        const resolvedPath = normalizeRepoRelativePath(pluginSourceBase, String(skillPath ?? ''));
        skillRoots.set(resolvedPath, { pluginName: plugin?.name, description: plugin?.description });
      }
      continue;
    }
    if (typeof pluginSkillEntry === 'string' && pluginSkillEntry.trim()) {
      const skillsRoot = normalizeRepoRelativePath(pluginSourceBase, pluginSkillEntry);
      for (const entry of tree) {
        if (!entry.path.startsWith(`${skillsRoot}/`) || !entry.path.endsWith('/SKILL.md')) continue;
        const rootPath = entry.path.slice(0, -'/SKILL.md'.length);
        skillRoots.set(rootPath, { pluginName: plugin?.name, description: plugin?.description });
      }
    }
  }

  const analyses: CandidateAnalysis[] = [];
  const sortedRoots = Array.from(skillRoots.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [rootPath, pluginMeta] of sortedRoots) {
    const skillMarkdownPath = `${rootPath}/SKILL.md`;
    if (!treePaths.has(skillMarkdownPath)) continue;
    const skillMarkdown = await fetchRawGithubText(source, skillMarkdownPath, sourceCommit, fetchImpl);
    const parsed = parseSkillMarkdown(skillMarkdown);
    const frontmatterName = typeof parsed.frontmatter.name === 'string' ? parsed.frontmatter.name.trim() : '';
    const fallbackName = path.posix.basename(rootPath);
    const name = frontmatterName || fallbackName;
    const description =
      typeof parsed.frontmatter.description === 'string' && parsed.frontmatter.description.trim()
        ? parsed.frontmatter.description.trim()
        : String(pluginMeta.description ?? '').trim();
    const rootFiles = tree.filter((entry) => entry.path.startsWith(`${rootPath}/`));
    const classification = classifyCandidate({
      source,
      rootPath,
      name,
      description,
      unsupported: parsed.unsupported,
      tree: rootFiles,
    });
    analyses.push({
      source,
      sourceCommit,
      frontmatter: parsed.frontmatter,
      markdownBody: parsed.body,
      rawMarkdown: skillMarkdown,
      candidate: {
        id: buildSourceSkillId(source.id, rootPath),
        sourceId: source.id,
        path: rootPath,
        slug: normalizeSkillSlug(fallbackName),
        name,
        description,
        ...(typeof parsed.frontmatter.license === 'string' && parsed.frontmatter.license.trim()
          ? { license: parsed.frontmatter.license.trim() }
          : {}),
        importStatus: classification.status,
        ...(classification.reason ? { importReason: classification.reason } : {}),
        ...(pluginMeta.pluginName ? { pluginName: pluginMeta.pluginName } : {}),
      },
    });
  }

  const value: CachedSourceAnalysis = {
    source,
    sourceCommit,
    tree,
    analyses,
  };
  sourceCache.set(source.id, { expiresAt: now + CACHE_TTL_MS, value });
  return value;
}

type SkillSourceQueryOptions = {
  forceRefresh?: boolean;
};

async function getSourceAnalysis(
  sourceIdRaw: string,
  fetchImpl: FetchLike = fetch,
  opts?: SkillSourceQueryOptions,
): Promise<CachedSourceAnalysis> {
  if (opts?.forceRefresh) {
    sourceCache.delete(String(sourceIdRaw ?? '').trim());
  }
  return await getCachedSourceAnalysis(sourceIdRaw, fetchImpl);
}

function findCandidateAnalysis(index: CachedSourceAnalysis, skillPathRaw: string): CandidateAnalysis {
  const skillPath = String(skillPathRaw ?? '').trim().replace(/\\/g, '/').replace(/\/+$/g, '');
  const match = index.analyses.find((entry) => entry.candidate.path === skillPath);
  if (!match) throw new Error(`unknown source skill path: ${skillPath || 'unknown'}`);
  return match;
}

export function listSkillSources(): SkillSourceRecord[] {
  return SKILL_SOURCE_DEFINITIONS.map(({ marketplacePath: _marketplacePath, ...source }) => source).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export async function listSkillSourceCandidates(
  sourceIdRaw: string,
  fetchImpl: FetchLike = fetch,
  opts?: SkillSourceQueryOptions,
): Promise<SkillSourceCandidate[]> {
  const index = await getSourceAnalysis(sourceIdRaw, fetchImpl, opts);
  return index.analyses.map(buildCandidateFromAnalysis).sort((a, b) => a.name.localeCompare(b.name));
}

async function buildSourcePreview(
  analysis: CandidateAnalysis,
  index: CachedSourceAnalysis,
  fetchImpl: FetchLike,
): Promise<SkillSourceCandidatePreview> {
  const rootPrefix = `${analysis.candidate.path}/`;
  const packageFiles = index.tree
    .filter((entry) => entry.path.startsWith(rootPrefix) && entry.path !== `${analysis.candidate.path}/SKILL.md`)
    .sort((a, b) => a.path.localeCompare(b.path));

  let codexOpenaiYaml: string | undefined;
  const files: SkillFileEntry[] = [];
  const previewFiles: SkillSourcePreviewFile[] = [
    {
      path: 'SKILL.md',
      content: analysis.rawMarkdown,
      kind: 'managed',
    },
  ];
  for (const entry of packageFiles) {
    const relativePath = entry.path.slice(rootPrefix.length);
    if (!relativePath) continue;
    const text = await fetchRawGithubText(analysis.source, entry.path, analysis.sourceCommit, fetchImpl);
    if (relativePath === 'agents/openai.yaml') {
      codexOpenaiYaml = text;
      previewFiles.push({
        path: relativePath,
        content: text,
        kind: 'managed',
      });
      continue;
    }
    const kind = inferSkillFileKind(relativePath);
    const file = {
      path: relativePath,
      content: text,
      kind,
    } satisfies SkillFileEntry;
    files.push(file);
    previewFiles.push(file);
  }

  const name = analysis.candidate.name.trim() || path.posix.basename(analysis.candidate.path);
  const description = analysis.candidate.description.trim();
  const overlays = buildSkillOverlays(analysis.frontmatter, codexOpenaiYaml);
  const metadata = buildSkillMetadata({
    source: analysis.source,
    sourceCommit: analysis.sourceCommit,
    path: analysis.candidate.path,
    pluginName: analysis.candidate.pluginName,
    frontmatter: analysis.frontmatter,
  });

  return {
    candidate: analysis.candidate,
    sourceId: analysis.source.id,
    sourceCommit: analysis.sourceCommit,
    skillMarkdown: analysis.rawMarkdown,
    files: previewFiles,
    normalized: {
      name,
      slug: analysis.candidate.slug,
      description,
      compatibility: SUPPORTED_PORTABLE_COMPATIBILITY,
      ...(analysis.candidate.license ? { license: analysis.candidate.license } : {}),
      ...(metadata ? { metadata } : {}),
      markdownBody: analysis.markdownBody,
      files,
      ...(overlays ? { overlays } : {}),
    },
  };
}

export async function previewSkillFromSource(
  input: {
    sourceId?: string;
    path?: string;
  },
  fetchImpl: FetchLike = fetch,
  opts?: SkillSourceQueryOptions,
): Promise<SkillSourceCandidatePreview> {
  const sourceId = String(input?.sourceId ?? '').trim();
  const skillPath = String(input?.path ?? '').trim();
  if (!sourceId) throw new Error('missing source id');
  if (!skillPath) throw new Error('missing source skill path');
  const index = await getSourceAnalysis(sourceId, fetchImpl, opts);
  const analysis = findCandidateAnalysis(index, skillPath);
  return await buildSourcePreview(analysis, index, fetchImpl);
}

export async function importSkillFromSource(
  input: {
    sourceId?: string;
    path?: string;
  },
  fetchImpl: FetchLike = fetch,
): Promise<SkillRecord> {
  const preview = await previewSkillFromSource(input, fetchImpl);
  if (preview.candidate.importStatus !== 'importable') {
    throw new Error(preview.candidate.importReason || 'source skill is not importable');
  }

  return await createSkill({
    name: preview.normalized.name,
    slug: preview.normalized.slug,
    description: preview.normalized.description,
    compatibility: preview.normalized.compatibility,
    ...(preview.normalized.license ? { license: preview.normalized.license } : {}),
    ...(preview.normalized.metadata ? { metadata: preview.normalized.metadata } : {}),
    markdownBody: preview.normalized.markdownBody,
    files: preview.normalized.files,
    ...(preview.normalized.overlays ? { overlays: preview.normalized.overlays } : {}),
  });
}

export function resetSkillSourceCacheForTests(): void {
  sourceCache.clear();
}
