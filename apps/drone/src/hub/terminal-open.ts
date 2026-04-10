export type HubWebTerminalMode = 'shell' | 'agent';

export function shouldAwaitTerminalSkillSync(mode: HubWebTerminalMode): boolean {
  return mode === 'agent';
}

const HUB_SHELL_SESSION_PREFIX = 'drone-hub-shell';
const HUB_CHAT_SESSION_PREFIX = 'drone-hub-chat-';

function sanitizeHubTerminalSessionToken(raw: string): string {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!cleaned) return 'default';
  return cleaned.slice(0, 48);
}

function randomShellSessionToken(): string {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return sanitizeHubTerminalSessionToken(`${now}-${rand}`);
}

export function hubChatSessionName(chatName: string): string {
  return `${HUB_CHAT_SESSION_PREFIX}${sanitizeHubTerminalSessionToken(chatName || 'default')}`;
}

export function hubShellSessionName(token?: string | null): string {
  const normalized = String(token ?? '').trim();
  if (!normalized) return HUB_SHELL_SESSION_PREFIX;
  return `${HUB_SHELL_SESSION_PREFIX}-${sanitizeHubTerminalSessionToken(normalized)}`;
}

export function createHubShellSessionName(): string {
  return hubShellSessionName(randomShellSessionToken());
}

export function isHubShellSessionName(raw: string): boolean {
  const sessionName = String(raw ?? '').trim();
  return sessionName === HUB_SHELL_SESSION_PREFIX || sessionName.startsWith(`${HUB_SHELL_SESSION_PREFIX}-`);
}

export function isHubWebTerminalSessionName(raw: string): boolean {
  const sessionName = String(raw ?? '').trim();
  if (!sessionName || sessionName.length > 64) return false;
  if (!/^[A-Za-z0-9._-]+$/.test(sessionName)) return false;
  if (isHubShellSessionName(sessionName)) return true;
  return sessionName.startsWith(HUB_CHAT_SESSION_PREFIX) && sessionName.length > HUB_CHAT_SESSION_PREFIX.length;
}
