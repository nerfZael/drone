import type { CompanionSessionStore } from '@drone/assistant-chat';

const KEY = 'drone.companion.saved-session.v1';

export const desktopCompanionSessionStore: CompanionSessionStore = {
  read() {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (typeof value?.runId !== 'string' || !value.runId.trim() || value.runId.length > 128 ||
        /[\u0000-\u001f\u007f]/.test(value.runId)) return null;
    return { runId: value.runId, reply: typeof value.reply === 'string' ? value.reply : '',
      transcript: typeof value.transcript === 'string' ? value.transcript : '' };
  },
  write(value) {
    if (value) window.localStorage.setItem(KEY, JSON.stringify(value));
    else window.localStorage.removeItem(KEY);
  },
};
