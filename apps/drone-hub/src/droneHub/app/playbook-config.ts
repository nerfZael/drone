import type { PlaybookDefinition } from '../types';

export const PLAYBOOK_LABEL_MAX_CHARS = 72;
export const PLAYBOOK_ACTION_LABEL_MAX_CHARS = 40;
export const PLAYBOOK_MESSAGE_MAX_CHARS = 8_000;
export const PLAYBOOK_MAX_MESSAGES = 20;
export const PLAYBOOK_MAX_ACTIONS = 12;
export const PLAYBOOK_MAX_ITEMS = 60;

export function normalizePlaybookLabel(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, PLAYBOOK_LABEL_MAX_CHARS);
}

export function normalizePlaybookArtifactPath(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .slice(0, PLAYBOOK_MESSAGE_MAX_CHARS);
}

export function normalizePlaybookMessages(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const item of list) {
    const message = String(item ?? '').slice(0, PLAYBOOK_MESSAGE_MAX_CHARS);
    if (!message.trim()) continue;
    out.push(message);
    if (out.length >= PLAYBOOK_MAX_MESSAGES) break;
  }
  return out;
}

export function createPlaybookDefinition(seed?: Partial<PlaybookDefinition>): PlaybookDefinition {
  return {
    id: String(seed?.id ?? '').trim(),
    label: normalizePlaybookLabel(seed?.label ?? ''),
    messages: normalizePlaybookMessages(seed?.messages),
    artifacts: normalizePlaybookArtifacts(seed?.artifacts),
    actions: normalizePlaybookActions(seed?.actions),
    createdAt: typeof seed?.createdAt === 'string' && seed.createdAt.trim() ? seed.createdAt : new Date().toISOString(),
    updatedAt: typeof seed?.updatedAt === 'string' && seed.updatedAt.trim() ? seed.updatedAt : undefined,
  };
}

export function patchPlaybookDefinition(current: PlaybookDefinition, patch: Partial<PlaybookDefinition>): PlaybookDefinition {
  return {
    ...current,
    ...(Object.prototype.hasOwnProperty.call(patch, 'label') ? { label: normalizePlaybookLabel(patch.label) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'messages') ? { messages: normalizePlaybookMessages(patch.messages) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'artifacts') ? { artifacts: normalizePlaybookArtifacts(patch.artifacts) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'actions') ? { actions: normalizePlaybookActions(patch.actions) } : {}),
  };
}

export function normalizePlaybookArtifacts(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const item of list) {
    const artifact = normalizePlaybookArtifactPath(item);
    if (!artifact) continue;
    out.push(artifact);
    if (out.length >= PLAYBOOK_MAX_ITEMS) break;
  }
  return out;
}

export function normalizePlaybookActions(
  value: unknown,
): Array<{
  id: string;
  label: string;
  message: string;
}> {
  const list = Array.isArray(value) ? value : [];
  const out: Array<{ id: string; label: string; message: string }> = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const id = String((item as any).id ?? '').trim() || crypto.randomUUID();
    const label = String((item as any).label ?? '').replace(/\s+/g, ' ').trim().slice(0, PLAYBOOK_ACTION_LABEL_MAX_CHARS);
    const message = String((item as any).message ?? '').slice(0, PLAYBOOK_MESSAGE_MAX_CHARS);
    if (!label || !message.trim()) continue;
    out.push({ id, label, message });
    if (out.length >= PLAYBOOK_MAX_ACTIONS) break;
  }
  return out;
}
