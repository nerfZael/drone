import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { profileStorageKey } from '../../profile-storage';

import type { DesktopNotificationPreferences as Preferences } from './desktop-notification-presentation';

type State = Preferences & {
  error: string | null;
  update: (patch: Partial<Preferences>) => void;
  setError: (error: string | null) => void;
};

export const useDesktopNotificationSettings = create<State>()(persist((set) => ({
  enabled: true,
  finished: true,
  failed: true,
  messages: false,
  eventNames: 'chat_message',
  sound: false,
  error: null,
  update: (patch) => set(patch),
  setError: (error) => set({ error }),
}), {
  name: profileStorageKey('droneHub.desktopNotifications'),
  partialize: ({ enabled, finished, failed, messages, eventNames, sound }) =>
    ({ enabled, finished, failed, messages, eventNames, sound }),
}));
