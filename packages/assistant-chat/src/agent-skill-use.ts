export type AgentSkillUse = {
  name: string;
  source: 'explicit' | 'skill-file-read';
};

const MAX_AGENT_SKILL_USES = 32;

export function normalizeAgentSkillUses(value: unknown): AgentSkillUse[] {
  if (!Array.isArray(value)) return [];

  const uses: AgentSkillUse[] = [];
  const indexes = new Map<string, number>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.name !== 'string') continue;
    const name = raw.name.trim();
    if (!name || name.length > 160 || /[\r\n\t]/.test(name)) continue;
    if (raw.source !== 'explicit' && raw.source !== 'skill-file-read') continue;
    const source = raw.source;
    const key = name.toLowerCase();
    const existingIndex = indexes.get(key);
    if (existingIndex !== undefined) {
      if (source === 'explicit') uses[existingIndex] = { name, source };
      continue;
    }
    indexes.set(key, uses.length);
    uses.push({ name, source });
    if (uses.length >= MAX_AGENT_SKILL_USES) break;
  }
  return uses;
}
