import type { ChatAgentConfig } from '../../domain';
import type { PlaybookDefinition, PlaybookMessageDefinition } from '../types';

export const PLAYBOOK_LABEL_MAX_CHARS = 72;
export const PLAYBOOK_ACTION_LABEL_MAX_CHARS = 40;
export const PLAYBOOK_MESSAGE_MAX_CHARS = 8_000;
export const PLAYBOOK_MESSAGE_NAME_MAX_CHARS = 80;
export const PLAYBOOK_MODEL_MAX_CHARS = 160;
export const PLAYBOOK_MAX_MESSAGES = 20;
export const PLAYBOOK_MAX_ACTIONS = 12;
export const PLAYBOOK_MAX_ITEMS = 60;

function normalizePlaybookMessagePrompt(value: unknown): string {
  return String(value ?? '').slice(0, PLAYBOOK_MESSAGE_MAX_CHARS);
}

function normalizePlaybookMessageId(value: unknown, fallbackIndex: number): string {
  const id = String(value ?? '').trim();
  return id || `message-${fallbackIndex + 1}`;
}

function normalizePlaybookMessageName(value: unknown): string | null {
  const name = String(value ?? '').trim().slice(0, PLAYBOOK_MESSAGE_NAME_MAX_CHARS);
  return name || null;
}

export function normalizePlaybookLabel(value: unknown): string {
  return String(value ?? '').trim().slice(0, PLAYBOOK_LABEL_MAX_CHARS);
}

export function normalizePlaybookActionLabel(value: unknown): string {
  return String(value ?? '').trim().slice(0, PLAYBOOK_ACTION_LABEL_MAX_CHARS);
}

export function normalizePlaybookArtifactPath(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .slice(0, PLAYBOOK_MESSAGE_MAX_CHARS);
}

export function normalizePlaybookAgent(value: unknown): ChatAgentConfig {
  if (value && typeof value === 'object') {
    if ((value as any).kind === 'builtin') {
      const id = String((value as any).id ?? '')
        .trim()
        .toLowerCase();
      if (id === 'cursor' || id === 'codex' || id === 'claude' || id === 'opencode' || id === 'pi' || id === 'blip') {
        return { kind: 'builtin', id };
      }
    }
    if ((value as any).kind === 'custom') {
      const id = String((value as any).id ?? '').trim();
      const label = String((value as any).label ?? '').trim();
      const command = String((value as any).command ?? '').trim();
      if (id && label && command) return { kind: 'custom', id, label, command };
    }
  }
  return { kind: 'builtin', id: 'cursor' };
}

export function normalizePlaybookModel(value: unknown, agentRaw?: unknown): string | null {
  const agent = normalizePlaybookAgent(agentRaw);
  if (agent.kind !== 'builtin') return null;
  const model = String(value ?? '').trim();
  if (!model) return null;
  if (model.length > PLAYBOOK_MODEL_MAX_CHARS) return null;
  if (/[\r\n\t]/.test(model)) return null;
  return model;
}

export function normalizePlaybookMessages(value: unknown): PlaybookMessageDefinition[] {
  const list = Array.isArray(value) ? value : [];
  const out: PlaybookMessageDefinition[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    const rawPrompt =
      item && typeof item === 'object' && !Array.isArray(item)
        ? normalizePlaybookMessagePrompt((item as any).prompt ?? '')
        : normalizePlaybookMessagePrompt(item);
    if (!rawPrompt.trim()) continue;
    out.push({
      id:
        item && typeof item === 'object' && !Array.isArray(item)
          ? normalizePlaybookMessageId((item as any).id, index)
          : normalizePlaybookMessageId('', index),
      name:
        item && typeof item === 'object' && !Array.isArray(item)
          ? normalizePlaybookMessageName((item as any).name ?? '')
          : null,
      prompt: rawPrompt,
    });
    if (out.length >= PLAYBOOK_MAX_MESSAGES) break;
  }
  return out;
}

function normalizePlaybookActionMessages(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const item of list) {
    const message =
      item && typeof item === 'object' && !Array.isArray(item)
        ? normalizePlaybookMessagePrompt((item as any).prompt ?? (item as any).message ?? '')
        : normalizePlaybookMessagePrompt(item);
    if (!message.trim()) continue;
    out.push(message);
    if (out.length >= PLAYBOOK_MAX_MESSAGES) break;
  }
  return out;
}

export function createPlaybookDefinition(seed?: Partial<PlaybookDefinition>): PlaybookDefinition {
  const agent = normalizePlaybookAgent(seed?.agent);
  return {
    id: String(seed?.id ?? '').trim(),
    label: normalizePlaybookLabel(seed?.label ?? ''),
    agent,
    model: normalizePlaybookModel(seed?.model, agent),
    messages: normalizePlaybookMessages(seed?.messages),
    artifacts: normalizePlaybookArtifacts(seed?.artifacts),
    actions: normalizePlaybookActions(seed?.actions),
    createdAt: typeof seed?.createdAt === 'string' && seed.createdAt.trim() ? seed.createdAt : new Date().toISOString(),
    updatedAt: typeof seed?.updatedAt === 'string' && seed.updatedAt.trim() ? seed.updatedAt : undefined,
  };
}

export function patchPlaybookDefinition(current: PlaybookDefinition, patch: Partial<PlaybookDefinition>): PlaybookDefinition {
  const nextAgent = Object.prototype.hasOwnProperty.call(patch, 'agent') ? normalizePlaybookAgent(patch.agent) : normalizePlaybookAgent(current.agent);
  const nextModelSource = Object.prototype.hasOwnProperty.call(patch, 'model') ? patch.model : current.model;
  return {
    ...current,
    ...(Object.prototype.hasOwnProperty.call(patch, 'label') ? { label: normalizePlaybookLabel(patch.label) } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'agent') ? { agent: nextAgent } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'agent') || Object.prototype.hasOwnProperty.call(patch, 'model')
      ? { model: normalizePlaybookModel(nextModelSource, nextAgent) }
      : {}),
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
  messages: string[];
}> {
  const list = Array.isArray(value) ? value : [];
  const out: Array<{ id: string; label: string; messages: string[] }> = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const id = String((item as any).id ?? '').trim() || crypto.randomUUID();
    const label = normalizePlaybookActionLabel((item as any).label ?? '');
    const messages = normalizePlaybookActionMessages((item as any).messages);
    if (!label || messages.length === 0) continue;
    out.push({ id, label, messages });
    if (out.length >= PLAYBOOK_MAX_ACTIONS) break;
  }
  return out;
}
