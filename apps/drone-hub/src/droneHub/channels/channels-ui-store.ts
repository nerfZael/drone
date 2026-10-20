import { create } from 'zustand';
import { profileStorageKey } from '../../profile-storage';
import { useDesktopToolWindows } from '../app/desktop-tool-windows';

const SELECTED_CHANNEL_KEY = profileStorageKey('droneHub.channels.selected');
const MEMBERS_OPEN_KEY = profileStorageKey('droneHub.channels.membersOpen');

/** Asks the selected drone's workspace to show the Channels window. */
export const OPEN_CHANNELS_PANE_EVENT = 'droneHub:channels:open';

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage can be unavailable; the choice then lasts for this session.
  }
}

/** Which channel the Channels windows show; shared, so a docked and a desktop window agree. */
export const useChannelsUiStore = create<{
  selectedChannelId: string | null;
  membersOpen: boolean;
  select(channelId: string | null): void;
  setMembersOpen(open: boolean): void;
}>((set) => ({
  selectedChannelId: read(SELECTED_CHANNEL_KEY),
  membersOpen: read(MEMBERS_OPEN_KEY) !== 'false',
  select(channelId) {
    write(SELECTED_CHANNEL_KEY, channelId);
    set({ selectedChannelId: channelId });
  },
  setMembersOpen(open) {
    write(MEMBERS_OPEN_KEY, open ? 'true' : 'false');
    set({ membersOpen: open });
  },
}));

/**
 * Shows a channel: selects it and brings up a Channels window. A Channels desktop window
 * that is already open comes to the front; otherwise the selected drone's workspace opens
 * the pane, or, with no drone open, a desktop window does.
 */
export function openChannel(channelId: string): void {
  useChannelsUiStore.getState().select(channelId);
  if (typeof window === 'undefined') return;
  const desktopWindows = useDesktopToolWindows.getState();
  if (Object.values(desktopWindows.windows).some((item) => item.tab === 'channels')) {
    desktopWindows.open('channels');
    return;
  }
  const event = new Event(OPEN_CHANNELS_PANE_EVENT, { cancelable: true });
  if (window.dispatchEvent(event)) desktopWindows.open('channels');
}

/** Channels on screen in a focused window right now, from any Channels window (docked or desktop). */
const channelsBeingRead = new Map<string, number>();

export function markChannelBeingRead(channelId: string): () => void {
  channelsBeingRead.set(channelId, (channelsBeingRead.get(channelId) ?? 0) + 1);
  return () => {
    const count = (channelsBeingRead.get(channelId) ?? 1) - 1;
    if (count > 0) channelsBeingRead.set(channelId, count);
    else channelsBeingRead.delete(channelId);
  };
}

export function isChannelBeingRead(channelId: unknown): boolean {
  return typeof channelId === 'string' && channelsBeingRead.has(channelId);
}
