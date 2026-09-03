import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import type { SkillRecord } from '../src/droneHub/app/skill-library-model';
import {
  createSkillPillEdit,
  findSkillForPill,
  NEW_SKILL_MARKDOWN,
  saveSkillPillEdit,
  skillNameFromMarkdown,
} from '../src/droneHub/chat/skill-pill-editor-model';

const skill: SkillRecord = {
  id: 'skill-old',
  slug: 'repo-review',
  name: 'Repo Review',
  description: 'Review a repository.',
  markdownBody: '# Instructions\n\nRead the diff.',
  files: [{ path: 'references/checklist.md', content: '# Checklist\n', kind: 'reference' }],
  overlays: { codex: { openaiYaml: 'tools:\n  - shell\n' } },
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('skill pill editor model', () => {
  test('matches transcript folder names and display names case-insensitively', () => {
    expect(findSkillForPill([skill], 'REPO-REVIEW')?.id).toBe(skill.id);
    expect(findSkillForPill([skill], 'repo review')?.id).toBe(skill.id);
    expect(findSkillForPill([skill], 'missing')).toBeNull();
  });

  test('reads quoted and block-style YAML names from SKILL.md', () => {
    expect(skillNameFromMarkdown('---\nname: "Repo Review"\ndescription: Test\n---\n')).toBe(
      'Repo Review',
    );
    expect(skillNameFromMarkdown('---\nname: >-\n  Repo Review\ndescription: Test\n---\n')).toBe(
      'Repo Review',
    );
  });

  test('creates a new skill from the starter SKILL.md draft', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const created = { ...skill, id: 'skill-new', slug: 'new-skill', name: 'New Skill' };
    const result = await createSkillPillEdit({
      skillMarkdown: NEW_SKILL_MARKDOWN,
      requestJson: async <T>(url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, skill: created } as T;
      },
    });

    expect(result).toEqual(created);
    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      ['/api/skills/package', 'POST'],
    ]);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      files: [{ path: 'SKILL.md', content: NEW_SKILL_MARKDOWN }],
    });
  });

  test('rejects an invalid new SKILL.md before making a request', async () => {
    let requested = false;
    await expect(
      createSkillPillEdit({
        skillMarkdown: '---\ndescription: Missing a name.\n---\n',
        requestJson: async <T>() => {
          requested = true;
          return {} as T;
        },
      }),
    ).rejects.toThrow('SKILL.md frontmatter must include a name.');
    expect(requested).toBe(false);
  });

  test('updates the existing package when the name is unchanged', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const saved = { ...skill, markdownBody: '# Updated' };
    const result = await saveSkillPillEdit({
      skill,
      skillMarkdown:
        '---\nname: Repo Review\ndescription: Review a repository.\n---\n\n# Updated\n',
      requestJson: async <T>(url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, skill: saved } as T;
      },
      confirmRename: async () => {
        throw new Error('rename confirmation should not run');
      },
    });

    expect(result).toEqual(saved);
    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      ['/api/skills/skill-old/package', 'PUT'],
    ]);
    const payload = JSON.parse(String(calls[0]?.init?.body));
    expect(payload.slug).toBe('repo-review');
    expect(payload.files.map((file: { path: string }) => file.path)).toEqual([
      'SKILL.md',
      'agents/openai.yaml',
      'references/checklist.md',
    ]);
  });

  test('uses the atomic replacement endpoint for a renamed skill', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const replacement = { ...skill, id: 'skill-new', slug: 'deep-review', name: 'Deep Review' };
    const result = await saveSkillPillEdit({
      skill,
      skillMarkdown: '---\nname: Deep Review\ndescription: Review deeply.\n---\n\n# Instructions\n',
      requestJson: async <T>(url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return { ok: true, skill: replacement } as T;
      },
      confirmRename: async (rename) => {
        expect(rename).toEqual({ oldName: 'Repo Review', newName: 'Deep Review' });
        return true;
      },
    });

    expect(result).toEqual(replacement);
    expect(calls.map((call) => [call.url, call.init?.method])).toEqual([
      ['/api/skills/skill-old/replacement-package', 'POST'],
    ]);
    const createPayload = JSON.parse(String(calls[0]?.init?.body));
    expect(createPayload.slug).toBeUndefined();
    expect(createPayload.overlays).toEqual(skill.overlays);
  });

  test('keeps the old skill when rename confirmation is cancelled', async () => {
    let requested = false;
    const result = await saveSkillPillEdit({
      skill,
      skillMarkdown: '---\nname: Deep Review\ndescription: Review deeply.\n---\n',
      requestJson: async <T>() => {
        requested = true;
        return {} as T;
      },
      confirmRename: async () => false,
    });

    expect(result).toBeNull();
    expect(requested).toBe(false);
  });

  test('only dismisses the app dialog implicitly when the draft is clean', () => {
    const dialogSource = readFileSync(
      new URL('../src/droneHub/chat/SkillPillEditorDialog.tsx', import.meta.url),
      'utf8',
    );
    const extrasSource = readFileSync(
      new URL('../src/droneHub/chat/AgentMessageExtras.tsx', import.meta.url),
      'utf8',
    );
    expect(dialogSource).toContain('dismissible={!dirty && !saving}');
    expect(dialogSource).toContain('showCloseButton={false}');
    expect(dialogSource).toContain('bodyClassName="flex min-h-0 flex-1 !p-0"');
    expect(dialogSource).not.toContain(
      'Create or edit a complete SKILL.md file without leaving the chat.',
    );
    expect(dialogSource).toContain('prefetchSkillPillEditorData');
    expect(dialogSource).toContain('.fetchQuery({');
    expect(extrasSource).not.toContain('React.lazy');
    expect(extrasSource).not.toContain('<React.Suspense fallback={null}>');
    expect(extrasSource).toContain('onPointerEnter={() => void prefetchSkillPillEditorData()}');
    expect(dialogSource).toContain('Cancel');
    expect(dialogSource).toContain('Save');
    expect(dialogSource).toContain('Add new skill');
    expect(dialogSource).toContain('aria-label="DroneHub skills"');
    expect(dialogSource).toContain("title: 'Discard unsaved changes?'");
    expect(dialogSource).toContain('useAppConfirmDialog()');
  });
});
