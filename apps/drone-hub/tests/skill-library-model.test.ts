import { describe, expect, test } from 'bun:test';

import {
  addSkillPackageFile,
  createEmptyDraft,
  filterSkillSourceCandidates,
  normalizeSkillPackagePath,
  payloadFromDraft,
  removeSkillPackagePath,
  renameSkillPackagePath,
  skillPackageDraftFromDraft,
  skillPackageDraftFromSkill,
} from '../src/droneHub/app/skill-library-model';

describe('skill source candidate filtering', () => {
  test('matches query text against name, plugin, path, and reason', () => {
    const candidates = [
      {
        id: 'a',
        sourceId: 'anthropic-skills',
        path: 'skills/frontend-design',
        slug: 'frontend-design',
        name: 'Frontend Design',
        description: 'Build polished frontend interfaces.',
        importStatus: 'importable' as const,
        pluginName: 'example-skills',
      },
      {
        id: 'b',
        sourceId: 'microsoft-skills',
        path: '.github/plugins/azure-sdk-typescript/skills/azure-storage-blob-ts',
        slug: 'azure-storage-blob-ts',
        name: 'Azure Storage Blob TS',
        description: 'Azure SDK helpers.',
        importStatus: 'not_importable' as const,
        importReason: 'unsupported agent-specific package file',
      },
    ];

    expect(filterSkillSourceCandidates(candidates, 'frontend')).toHaveLength(1);
    expect(filterSkillSourceCandidates(candidates, 'example-skills')).toHaveLength(1);
    expect(filterSkillSourceCandidates(candidates, 'unsupported agent')).toHaveLength(1);
    expect(filterSkillSourceCandidates(candidates, 'azure-storage-blob-ts')).toHaveLength(1);
  });
});

describe('virtual skill package drafts', () => {
  test('renders portable SKILL.md and managed Codex contents from the details draft', () => {
    const draft = {
      ...createEmptyDraft(),
      slug: 'repo-review',
      name: 'Repo Review',
      description: 'Review changes before shipping.',
      markdownBody: '# Workflow\n\nRead the diff.',
      metadataJson: '{"owner":"platform","released":"2026-08-21"}',
      codexOpenaiYaml: 'tools:\n  - bash\n',
      files: [
        {
          localId: 'guide',
          path: 'references/guide.md',
          kind: 'reference' as const,
          content: '# Guide\n',
        },
      ],
    };

    const pkg = skillPackageDraftFromDraft(draft);
    expect(pkg.slug).toBe('repo-review');
    expect(pkg.files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'agents/openai.yaml',
      'references/guide.md',
    ]);
    expect(pkg.files[0]?.content).toContain('name: "Repo Review"');
    expect(pkg.files[0]?.content).toContain('owner: platform');
    expect(pkg.files[0]?.content).toContain('released: "2026-08-21"');
    expect(pkg.files[0]?.content).toContain('Read the diff.');
    expect(pkg.files.find((file) => file.path === 'references/guide.md')?.kind).toBe('reference');
  });

  test('normalizes paths and applies directory rename and delete operations', () => {
    const files = [
      { path: 'SKILL.md', content: 'skill' },
      { path: 'references/one.md', content: 'one' },
      { path: 'references/nested/two.md', content: 'two' },
      { path: 'scripts/run.sh', content: 'run' },
    ];
    expect(normalizeSkillPackagePath('./references//guide.md')).toBe('references/guide.md');
    expect(() => normalizeSkillPackagePath('../outside.md')).toThrow('Invalid file path');
    expect(() => normalizeSkillPackagePath('references/')).toThrow('Invalid file path');
    expect(() => normalizeSkillPackagePath('references/bad\nname.md')).toThrow('Invalid file path');

    const renamed = renameSkillPackagePath(files, 'references', 'docs');
    expect(renamed.map((file) => file.path)).toEqual([
      'SKILL.md',
      'docs/nested/two.md',
      'docs/one.md',
      'scripts/run.sh',
    ]);
    expect(removeSkillPackagePath(renamed, 'docs').map((file) => file.path)).toEqual([
      'SKILL.md',
      'scripts/run.sh',
    ]);
    expect(() => removeSkillPackagePath(files, 'SKILL.md')).toThrow('cannot be deleted');

    expect(() => addSkillPackageFile(files, 'scripts/run.sh/child.txt')).toThrow(
      'conflicts with another file',
    );
    expect(() => renameSkillPackagePath(files, 'references', 'scripts/run.sh/docs')).toThrow(
      'conflicts with another file',
    );
    expect(() =>
      skillPackageDraftFromDraft({
        ...createEmptyDraft(),
        files: [
          { localId: 'one', path: 'docs', content: 'file', kind: 'extra' },
          { localId: 'two', path: 'docs/guide.md', content: 'nested', kind: 'reference' },
        ],
      }),
    ).toThrow('conflicts with another file');
  });

  test('preserves explicit file kinds and validates metadata and empty overlays', () => {
    const pkg = skillPackageDraftFromSkill({
      id: 'skill-1',
      slug: 'custom-script',
      name: 'Custom Script',
      description: 'Preserve an explicitly executable file outside scripts.',
      markdownBody: '',
      files: [{ path: 'tools/run.sh', content: 'run', kind: 'script' }],
      overlays: { opencode: {} },
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
    });
    expect(pkg.files.find((file) => file.path === 'tools/run.sh')?.kind).toBe('script');

    const draft = createEmptyDraft();
    expect(payloadFromDraft(draft).overlays).toEqual({});
    expect(payloadFromDraft({ ...draft, opencodeOverlay: true }).overlays).toEqual({
      opencode: {},
    });
    expect(payloadFromDraft({ ...draft, codexOpenaiYamlPresent: true }).overlays).toEqual({
      codex: { openaiYaml: '' },
    });
    expect(() =>
      payloadFromDraft({ ...draft, metadataJson: '{"nested":{"owner":"platform"}}' }),
    ).toThrow('must be a string, number, or boolean');
    expect(() =>
      payloadFromDraft({ ...draft, metadataJson: '{" owner":"one","owner":"two"}' }),
    ).toThrow('duplicate key');
  });
});
