export type SkillFileKind = 'script' | 'reference' | 'asset' | 'extra';

export type SkillFileDraft = {
  localId: string;
  path: string;
  kind: SkillFileKind;
  content: string;
};

export type SkillPackageFileDraft = {
  path: string;
  content: string;
  kind?: SkillFileKind;
};

export type SkillPackageDraft = {
  slug: string;
  files: SkillPackageFileDraft[];
};

export type SkillDraft = {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  license: string;
  compatibility: string;
  metadataJson: string;
  markdownBody: string;
  files: SkillFileDraft[];
  codexOpenaiYaml: string;
  codexOpenaiYamlPresent: boolean;
  claudeArgumentHint: string;
  claudeAllowedTools: string;
  claudeUserInvocable: boolean;
  claudeDisableModelInvocation: boolean;
  claudeModel: string;
  claudeContext: string;
  claudeAgent: string;
  claudeHooksJson: string;
  cursorDisableModelInvocation: boolean;
  opencodeOverlay: boolean;
};

export type SkillDraftScalarKey = Exclude<keyof SkillDraft, 'id' | 'files'>;

export type SkillRecord = {
  id: string;
  slug: string;
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  markdownBody: string;
  files: Array<{
    path: string;
    content: string;
    kind: SkillFileKind;
  }>;
  overlays?: {
    codex?: {
      openaiYaml?: string;
    };
    claude?: {
      argumentHint?: string;
      disableModelInvocation?: boolean;
      userInvocable?: boolean;
      allowedTools?: string[];
      model?: string;
      context?: string;
      agent?: string;
      hooks?: Record<string, unknown>;
    };
    cursor?: {
      disableModelInvocation?: boolean;
    };
    opencode?: Record<string, never>;
  };
  createdAt: string;
  updatedAt: string;
};

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
  kind: SkillFileKind | 'managed';
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
    files: Array<{
      path: string;
      content: string;
      kind: SkillFileKind;
    }>;
    overlays?: SkillRecord['overlays'];
  };
};

export const SKILL_FILE_KIND_OPTIONS: Array<{
  value: SkillFileKind;
  label: string;
  pathHint: string;
}> = [
  { value: 'script', label: 'Script', pathHint: 'scripts/run.sh' },
  { value: 'reference', label: 'Reference', pathHint: 'references/guide.md' },
  { value: 'asset', label: 'Asset', pathHint: 'assets/example.txt' },
  { value: 'extra', label: 'Extra', pathHint: 'notes.txt' },
];

function makeLocalId(): string {
  return `skill-file-${Math.random().toString(36).slice(2, 10)}`;
}

function stringifyJson(value: unknown): string {
  if (
    !value ||
    (typeof value === 'object' && Object.keys(value as Record<string, unknown>).length === 0)
  )
    return '';
  return JSON.stringify(value, null, 2);
}

function safeJsonParse(value: string, label: string): Record<string, unknown> | undefined {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function metadataFromJson(value: string): Record<string, string> | undefined {
  const parsed = safeJsonParse(value, 'Metadata');
  if (!parsed) return undefined;
  const entries = new Map<string, string>();
  for (const [rawKey, rawValue] of Object.entries(parsed)) {
    const key = rawKey.trim();
    if (!key) throw new Error('Metadata keys must not be empty.');
    if (entries.has(key)) throw new Error(`Metadata contains a duplicate key: ${key}`);
    if (
      typeof rawValue !== 'string' &&
      typeof rawValue !== 'number' &&
      typeof rawValue !== 'boolean'
    ) {
      throw new Error(`Metadata.${key} must be a string, number, or boolean.`);
    }
    const normalizedValue = String(rawValue).trim();
    if (normalizedValue) entries.set(key, normalizedValue);
  }
  return entries.size > 0 ? Object.fromEntries(entries) : undefined;
}

export function draftFromSkill(skill: SkillRecord): SkillDraft {
  return {
    id: skill.id,
    name: skill.name,
    slug: skill.slug,
    description: skill.description,
    license: skill.license ?? '',
    compatibility: skill.compatibility ?? '',
    metadataJson: stringifyJson(skill.metadata),
    markdownBody: skill.markdownBody ?? '',
    files: Array.isArray(skill.files)
      ? skill.files.map((file) => ({
          localId: makeLocalId(),
          path: file.path,
          kind: file.kind,
          content: file.content ?? '',
        }))
      : [],
    codexOpenaiYaml: skill.overlays?.codex?.openaiYaml ?? '',
    codexOpenaiYamlPresent: skill.overlays?.codex?.openaiYaml != null,
    claudeArgumentHint: skill.overlays?.claude?.argumentHint ?? '',
    claudeAllowedTools: Array.isArray(skill.overlays?.claude?.allowedTools)
      ? skill.overlays.claude.allowedTools.join(', ')
      : '',
    claudeUserInvocable: skill.overlays?.claude?.userInvocable === true,
    claudeDisableModelInvocation: skill.overlays?.claude?.disableModelInvocation === true,
    claudeModel: skill.overlays?.claude?.model ?? '',
    claudeContext: skill.overlays?.claude?.context ?? '',
    claudeAgent: skill.overlays?.claude?.agent ?? '',
    claudeHooksJson: stringifyJson(skill.overlays?.claude?.hooks),
    cursorDisableModelInvocation: skill.overlays?.cursor?.disableModelInvocation === true,
    opencodeOverlay: skill.overlays?.opencode != null,
  };
}

export function createEmptyDraft(): SkillDraft {
  return {
    id: null,
    name: '',
    slug: '',
    description: '',
    license: '',
    compatibility: '',
    metadataJson: '',
    markdownBody: '',
    files: [],
    codexOpenaiYaml: '',
    codexOpenaiYamlPresent: false,
    claudeArgumentHint: '',
    claudeAllowedTools: '',
    claudeUserInvocable: false,
    claudeDisableModelInvocation: false,
    claudeModel: '',
    claudeContext: '',
    claudeAgent: '',
    claudeHooksJson: '',
    cursorDisableModelInvocation: false,
    opencodeOverlay: false,
  };
}

export function sortSkills(skills: SkillRecord[]): SkillRecord[] {
  return [...skills].sort((a, b) => a.slug.localeCompare(b.slug));
}

export function filterSkillSourceCandidates(
  candidates: SkillSourceCandidate[],
  query: string,
): SkillSourceCandidate[] {
  const trimmed = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!trimmed) return [...candidates];
  return candidates.filter((candidate) => {
    const haystack = [
      candidate.name,
      candidate.slug,
      candidate.description,
      candidate.path,
      candidate.pluginName ?? '',
      candidate.importReason ?? '',
    ]
      .join('\n')
      .toLowerCase();
    return haystack.includes(trimmed);
  });
}

export function sanitizeDraftForComparison(draft: SkillDraft): string {
  return JSON.stringify({
    ...draft,
    files: draft.files.map((file) => ({
      path: file.path,
      kind: file.kind,
      content: file.content,
    })),
  });
}

function yamlScalar(value: string | number | boolean | null): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  const text = String(value ?? '');
  if (/^[A-Za-z][A-Za-z0-9._/@:-]*$/.test(text) && !/^(true|false|null)$/i.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

function yamlKey(value: string): string {
  return /^[A-Za-z0-9_.-]+$/.test(value) ? value : JSON.stringify(value);
}

function renderPortableSkillMarkdown(input: {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  markdownBody: string;
}): string {
  const lines = [
    '---',
    `name: ${yamlScalar(input.name)}`,
    `description: ${yamlScalar(input.description)}`,
  ];
  if (input.license) lines.push(`license: ${yamlScalar(input.license)}`);
  if (input.compatibility) lines.push(`compatibility: ${yamlScalar(input.compatibility)}`);
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    lines.push('metadata:');
    for (const [key, value] of Object.entries(input.metadata).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      lines.push(`  ${yamlKey(key)}: ${yamlScalar(value)}`);
    }
  }
  lines.push('---');
  const body = String(input.markdownBody ?? '').trim();
  if (body) lines.push('', body);
  return `${lines.join('\n')}\n`;
}

function sortPackageFiles(files: SkillPackageFileDraft[]): SkillPackageFileDraft[] {
  return [...files].sort((left, right) => {
    if (left.path === 'SKILL.md') return -1;
    if (right.path === 'SKILL.md') return 1;
    return left.path.localeCompare(right.path);
  });
}

function inferSkillPackageFileKind(filePath: string): SkillFileKind {
  if (filePath.startsWith('scripts/')) return 'script';
  if (filePath.startsWith('references/')) return 'reference';
  if (filePath.startsWith('assets/')) return 'asset';
  return 'extra';
}

function assertValidSkillPackageFileTree(files: SkillPackageFileDraft[]): void {
  const paths = new Set(files.map((file) => file.path));
  if (paths.size !== files.length) throw new Error('Duplicate file path.');
  for (const filePath of paths) {
    const parts = filePath.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const parentPath = parts.slice(0, index).join('/');
      if (paths.has(parentPath)) {
        throw new Error(`File path conflicts with another file: ${parentPath}`);
      }
    }
  }
}

export function skillPackageDraftFromSkill(skill: SkillRecord): SkillPackageDraft {
  const codexOpenaiYaml =
    skill.overlays?.codex?.openaiYaml ??
    skill.files.find((file) => file.path === 'agents/openai.yaml')?.content;
  return {
    slug: skill.slug,
    files: sortPackageFiles([
      {
        path: 'SKILL.md',
        content: renderPortableSkillMarkdown(skill),
      },
      ...skill.files
        .filter((file) => file.path !== 'SKILL.md' && file.path !== 'agents/openai.yaml')
        .map((file) => ({ path: file.path, content: file.content, kind: file.kind })),
      ...(codexOpenaiYaml != null
        ? [{ path: 'agents/openai.yaml', content: codexOpenaiYaml }]
        : []),
    ]),
  };
}

export function skillPackageDraftFromDraft(draft: SkillDraft): SkillPackageDraft {
  const payload = payloadFromDraft(draft);
  const metadata = payload.metadata as Record<string, string> | undefined;
  const extraCodexFile = draft.files.find((file) => file.path === 'agents/openai.yaml');
  const codexOpenaiYaml =
    draft.codexOpenaiYamlPresent || draft.codexOpenaiYaml.trim()
      ? draft.codexOpenaiYaml
      : extraCodexFile?.content;
  const files = sortPackageFiles([
    {
      path: 'SKILL.md',
      content: renderPortableSkillMarkdown({
        name: draft.name,
        description: draft.description,
        license: draft.license.trim() || undefined,
        compatibility: draft.compatibility.trim() || undefined,
        metadata,
        markdownBody: draft.markdownBody,
      }),
    },
    ...draft.files
      .filter((file) => file.path !== 'SKILL.md' && file.path !== 'agents/openai.yaml')
      .map((file) => ({
        path: normalizeSkillPackagePath(file.path),
        content: file.content,
        kind: file.kind,
      })),
    ...(codexOpenaiYaml != null ? [{ path: 'agents/openai.yaml', content: codexOpenaiYaml }] : []),
  ]);
  assertValidSkillPackageFileTree(files);
  return { slug: draft.slug, files };
}

export function sanitizePackageDraftForComparison(draft: SkillPackageDraft): string {
  return JSON.stringify({
    slug: draft.slug,
    files: sortPackageFiles(draft.files).map((file) => ({
      path: file.path,
      content: file.content,
      kind: file.kind,
    })),
  });
}

export function normalizeSkillPackagePath(raw: string): string {
  const text = String(raw ?? '')
    .trim()
    .replace(/\\/g, '/');
  if (!text || text.startsWith('/') || text.endsWith('/') || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new Error(`Invalid file path: ${text || 'empty path'}`);
  }
  const parts: string[] = [];
  for (const part of text.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') throw new Error(`Invalid file path: ${text}`);
    parts.push(part);
  }
  if (parts.length === 0) throw new Error(`Invalid file path: ${text}`);
  return parts.join('/');
}

export function addSkillPackageFile(
  files: SkillPackageFileDraft[],
  filePathRaw: string,
): SkillPackageFileDraft[] {
  const filePath = normalizeSkillPackagePath(filePathRaw);
  if (filePath === 'SKILL.md') {
    throw new Error('SKILL.md already exists and is managed by the package.');
  }
  const next = [
    ...files,
    { path: filePath, content: '', kind: inferSkillPackageFileKind(filePath) },
  ];
  assertValidSkillPackageFileTree(next);
  return sortPackageFiles(next);
}

export function normalizeSkillPackageSlug(raw: string): string {
  const slug = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) throw new Error('Skill folder name must contain a letter or number.');
  return slug;
}

export function renameSkillPackagePath(
  files: SkillPackageFileDraft[],
  sourcePathRaw: string,
  targetPathRaw: string,
): SkillPackageFileDraft[] {
  const sourcePath = normalizeSkillPackagePath(sourcePathRaw);
  const targetPath = normalizeSkillPackagePath(targetPathRaw);
  if (sourcePath === 'SKILL.md') throw new Error('SKILL.md cannot be renamed.');
  const affected = files.filter(
    (file) => file.path === sourcePath || file.path.startsWith(`${sourcePath}/`),
  );
  if (affected.length === 0) throw new Error(`Unknown package path: ${sourcePath}`);
  const affectedPaths = new Set(affected.map((file) => file.path));
  const nextPaths = new Set<string>();
  for (const file of affected) {
    const suffix = file.path.slice(sourcePath.length);
    const nextPath = `${targetPath}${suffix}`;
    if (nextPath === 'SKILL.md') throw new Error('SKILL.md is managed by the skill package.');
    if (nextPaths.has(nextPath)) throw new Error(`Duplicate file path: ${nextPath}`);
    if (
      files.some((candidate) => candidate.path === nextPath && !affectedPaths.has(candidate.path))
    ) {
      throw new Error(`File already exists: ${nextPath}`);
    }
    nextPaths.add(nextPath);
  }
  const next = sortPackageFiles(
    files.map((file) => {
      if (!affectedPaths.has(file.path)) return file;
      return { ...file, path: `${targetPath}${file.path.slice(sourcePath.length)}` };
    }),
  );
  assertValidSkillPackageFileTree(next);
  return next;
}

export function removeSkillPackagePath(
  files: SkillPackageFileDraft[],
  targetPathRaw: string,
): SkillPackageFileDraft[] {
  const targetPath = normalizeSkillPackagePath(targetPathRaw);
  if (targetPath === 'SKILL.md') throw new Error('SKILL.md cannot be deleted.');
  return files.filter(
    (file) => file.path !== targetPath && !file.path.startsWith(`${targetPath}/`),
  );
}

export function payloadFromDraft(draft: SkillDraft): Record<string, unknown> {
  const metadata = metadataFromJson(draft.metadataJson);
  const claudeHooks = safeJsonParse(draft.claudeHooksJson, 'Claude hooks');
  const allowedTools = draft.claudeAllowedTools
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const overlays: Record<string, unknown> = {};
  if (draft.codexOpenaiYamlPresent || draft.codexOpenaiYaml.trim()) {
    overlays.codex = { openaiYaml: draft.codexOpenaiYaml };
  }
  const claudeOverlay: Record<string, unknown> = {};
  if (draft.claudeArgumentHint.trim()) claudeOverlay.argumentHint = draft.claudeArgumentHint.trim();
  if (allowedTools.length > 0) claudeOverlay.allowedTools = allowedTools;
  if (draft.claudeUserInvocable) claudeOverlay.userInvocable = true;
  if (draft.claudeDisableModelInvocation) claudeOverlay.disableModelInvocation = true;
  if (draft.claudeModel.trim()) claudeOverlay.model = draft.claudeModel.trim();
  if (draft.claudeContext.trim()) claudeOverlay.context = draft.claudeContext.trim();
  if (draft.claudeAgent.trim()) claudeOverlay.agent = draft.claudeAgent.trim();
  if (claudeHooks && Object.keys(claudeHooks).length > 0) claudeOverlay.hooks = claudeHooks;
  if (Object.keys(claudeOverlay).length > 0) overlays.claude = claudeOverlay;
  if (draft.cursorDisableModelInvocation) {
    overlays.cursor = { disableModelInvocation: true };
  }
  if (draft.opencodeOverlay) overlays.opencode = {};

  return {
    name: draft.name,
    ...(draft.slug.trim() ? { slug: draft.slug.trim() } : {}),
    description: draft.description,
    ...(draft.license.trim() ? { license: draft.license.trim() } : {}),
    ...(draft.compatibility.trim() ? { compatibility: draft.compatibility.trim() } : {}),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    markdownBody: draft.markdownBody,
    files: draft.files.map((file) => ({
      path: file.path,
      kind: file.kind,
      content: file.content,
    })),
    overlays,
  };
}

export function createDraftFileTemplate(kind: SkillFileKind, index: number): SkillFileDraft {
  const suffix = String(index + 1);
  if (kind === 'script') {
    return {
      localId: makeLocalId(),
      kind,
      path: `scripts/task-${suffix}.sh`,
      content: '#!/usr/bin/env bash\nset -euo pipefail\n',
    };
  }
  if (kind === 'reference') {
    return {
      localId: makeLocalId(),
      kind,
      path: `references/context-${suffix}.md`,
      content: '# Context\n',
    };
  }
  if (kind === 'asset') {
    return {
      localId: makeLocalId(),
      kind,
      path: `assets/example-${suffix}.txt`,
      content: '',
    };
  }
  return {
    localId: makeLocalId(),
    kind,
    path: `extra-${suffix}.txt`,
    content: '',
  };
}
