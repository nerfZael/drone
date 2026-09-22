import type { CompanionSessionStore } from '@drone/assistant-chat';

const KEY = 'drone.companion.saved-session.v1';

export function companionSessionStore(slot: number): CompanionSessionStore {
  const key = slot === 1 ? KEY : `${KEY}.${slot}`;
  return {
    read() {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (typeof value?.runId !== 'string' || !value.runId.trim() || value.runId.length > 128 ||
          /[\u0000-\u001f\u007f]/.test(value.runId)) return null;
      return { runId: value.runId, reply: typeof value.reply === 'string' ? value.reply : '',
        transcript: typeof value.transcript === 'string' ? value.transcript : '' };
    },
    write(value) {
      if (value) window.localStorage.setItem(key, JSON.stringify(value));
      else window.localStorage.removeItem(key);
    },
  };
}

export const desktopCompanionSessionStore = companionSessionStore(1);

const SLOTS_KEY = 'drone.companion.slots.v1';
export const COMPANION_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0] as const;
export type CompanionSlots = { active: number; slots: number[] };
export function readCompanionSlots(): CompanionSlots {
  try {
    const value = JSON.parse(window.localStorage.getItem(SLOTS_KEY) || 'null');
    if (value && Array.isArray(value.slots)) {
      const slots = COMPANION_SLOTS.filter(slot => value.slots.includes(slot));
      return { slots, active: slots.includes(value.active) ? value.active : slots[0] ?? 1 };
    }
    if (desktopCompanionSessionStore.read()) return { active: 1, slots: [1] };
  } catch { /* Storage can be unavailable. */ }
  return { active: 1, slots: [] };
}
export function writeCompanionSlots(value: CompanionSlots) {
  try { window.localStorage.setItem(SLOTS_KEY, JSON.stringify(value)); } catch { /* Keep in memory. */ }
}
