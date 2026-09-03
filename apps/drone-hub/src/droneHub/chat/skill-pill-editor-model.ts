import yaml from 'js-yaml';

import { skillPackageDraftFromSkill, type SkillRecord } from '../app/skill-library-model';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

type SkillMutationResponse = {
  ok: true;
  skill: SkillRecord;
};

export const NEW_SKILL_MARKDOWN = `---
name: New Skill
description: Describe when this skill should be used.
---

# Instructions

Write the skill instructions here.
`;

export type SkillRenameConfirmation = {
  oldName: string;
  newName: string;
};

export function findSkillForPill(skills: SkillRecord[], pillNameRaw: string): SkillRecord | null {
  const pillName = String(pillNameRaw ?? '')
    .trim()
    .toLowerCase();
  if (!pillName) return null;
  return (
    skills.find((skill) => skill.slug.trim().toLowerCase() === pillName) ??
    skills.find((skill) => skill.name.trim().toLowerCase() === pillName) ??
    null
  );
}

export function skillNameFromMarkdown(markdownRaw: string): string {
  const source = String(markdownRaw ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
  if (!source.startsWith('---\n')) {
    throw new Error('SKILL.md must start with YAML frontmatter.');
  }
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(source);
  if (!match) throw new Error('SKILL.md has unclosed YAML frontmatter.');

  let frontmatter: unknown;
  try {
    frontmatter = yaml.load(match[1] ?? '');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`SKILL.md has invalid YAML: ${detail}`);
  }
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error('SKILL.md frontmatter must be a YAML object.');
  }
  const name = (frontmatter as Record<string, unknown>).name;
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('SKILL.md frontmatter must include a name.');
  }
  return name.trim();
}

export function skillMarkdownForRecord(skill: SkillRecord): string {
  return (
    skillPackageDraftFromSkill(skill).files.find((file) => file.path === 'SKILL.md')?.content ?? ''
  );
}

function editablePackageFiles(skill: SkillRecord, skillMarkdown: string) {
  return skillPackageDraftFromSkill(skill).files.map((file) => ({
    path: file.path,
    content: file.path === 'SKILL.md' ? skillMarkdown : file.content,
    ...(file.kind ? { kind: file.kind } : {}),
  }));
}

export async function createSkillPillEdit({
  skillMarkdown,
  requestJson,
}: {
  skillMarkdown: string;
  requestJson: RequestJson;
}): Promise<SkillRecord> {
  // Validate enough locally for an immediate editor error. The Hub remains
  // authoritative for the complete portable skill schema.
  skillNameFromMarkdown(skillMarkdown);
  const data = await requestJson<SkillMutationResponse>('/api/skills/package', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files: [{ path: 'SKILL.md', content: skillMarkdown }] }),
  });
  return data.skill;
}

export async function saveSkillPillEdit({
  skill,
  skillMarkdown,
  requestJson,
  confirmRename,
}: {
  skill: SkillRecord;
  skillMarkdown: string;
  requestJson: RequestJson;
  confirmRename: (rename: SkillRenameConfirmation) => Promise<boolean>;
}): Promise<SkillRecord | null> {
  const nextName = skillNameFromMarkdown(skillMarkdown);
  const files = editablePackageFiles(skill, skillMarkdown);

  if (nextName === skill.name) {
    const data = await requestJson<SkillMutationResponse>(
      `/api/skills/${encodeURIComponent(skill.id)}/package`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: skill.slug, files }),
      },
    );
    return data.skill;
  }

  if (!(await confirmRename({ oldName: skill.name, newName: nextName }))) return null;

  const replaced = await requestJson<SkillMutationResponse>(
    `/api/skills/${encodeURIComponent(skill.id)}/replacement-package`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files, overlays: skill.overlays ?? {} }),
    },
  );
  return replaced.skill;
}
