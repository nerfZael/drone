export const DRONE_HUB_SHORTCUT_ACTION_IDS = [
  'openQuickActions',
  'openHome',
  'createDraftDrone',
  'createDraftGroup',
  'createChatGroup',
  'alignFloatingChats',
  'createDraftDroneInCurrentGroup',
  'createDroneChat',
  'cloneDroneChat',
  'createSideChat',
  'toggleSideChatMain',
  'toggleSelectedDronePinned',
  'moveSelectedDroneToTop',
  'toggleSelectedDronesToDo',
  'focusPrimaryChatInput',
  'sendActiveChatComposer',
  'toggleChatComposerEditorMode',
  'toggleChatVoiceRecording',
  'toggleChatVoiceRecordingPause',
  'discardChatVoiceRecording',
  'clearChatComposer',
  'toggleContinuousDictation',
  'toggleFileDictation',
  'toggleCompanion',
  'applyCompanionProposal',
  'toggleVoiceClipboardRecording',
  'markSelectedDronesUnread',
  'toggleSidebarCollapsed',
  'toggleRightPanelWidth',
  'openHoveredGroupMultiChat',
  'openPullRequestsTab',
  'openChangesTab',
  'openCanvasTab',
  'openBrowserTab',
  'openFilesTab',
  'openQuickOpen',
  'openTerminalTab',
] as const;

export type DroneHubShortcutActionId = (typeof DRONE_HUB_SHORTCUT_ACTION_IDS)[number];

export type DroneHubShortcutBinding = {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
};

export type DroneHubGlobalShortcutBindings = Partial<
  Record<DroneHubShortcutActionId, DroneHubShortcutBinding>
>;

export type DroneHubGlobalShortcutActionStatus = {
  active: boolean;
  error: string;
};

export type DroneHubGlobalShortcutStatus = {
  running: boolean;
  error: string;
  warning: string;
  actions: Partial<Record<DroneHubShortcutActionId, DroneHubGlobalShortcutActionStatus>>;
};

export type DroneHubGlobalShortcutSettingsResponse = {
  ok: true;
  bindings: DroneHubGlobalShortcutBindings;
  status: DroneHubGlobalShortcutStatus;
};

const ACTION_ID_SET = new Set<string>(DRONE_HUB_SHORTCUT_ACTION_IDS);
const MODIFIER_ONLY_KEYS = new Set(['shift', 'control', 'ctrl', 'alt', 'meta', 'os']);
const NUMPAD_KEYS = new Set([
  'num0',
  'num1',
  'num2',
  'num3',
  'num4',
  'num5',
  'num6',
  'num7',
  'num8',
  'num9',
  'numdec',
  'numadd',
  'numsub',
  'nummult',
  'numdiv',
  'numenter',
]);

export function isDroneHubShortcutActionId(value: unknown): value is DroneHubShortcutActionId {
  return ACTION_ID_SET.has(String(value ?? ''));
}

export function normalizeDroneHubShortcutKey(raw: unknown): string {
  const key = String(raw ?? '');
  if (!key) return '';
  if (key === ' ') return 'space';
  const lower = key.trim().toLowerCase();
  if (!lower) return '';
  if (lower === 'spacebar') return 'space';
  if (lower === 'esc') return 'escape';
  if (lower === 'return') return 'enter';
  return lower;
}

export function isDroneHubNumpadShortcutKey(key: unknown): boolean {
  return NUMPAD_KEYS.has(normalizeDroneHubShortcutKey(key));
}

export function sanitizeDroneHubShortcutBinding(value: unknown): DroneHubShortcutBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const key = normalizeDroneHubShortcutKey(raw.key);
  if (!key || MODIFIER_ONLY_KEYS.has(key)) return null;
  const mod = raw.mod === true;
  return {
    key,
    mod,
    ctrl: mod ? false : raw.ctrl === true,
    meta: mod ? false : raw.meta === true,
    alt: raw.alt === true,
    shift: raw.shift === true,
  };
}

export function sanitizeDroneHubGlobalShortcutBindings(
  value: unknown,
): DroneHubGlobalShortcutBindings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const bindings: DroneHubGlobalShortcutBindings = {};
  for (const actionId of DRONE_HUB_SHORTCUT_ACTION_IDS) {
    const binding = sanitizeDroneHubShortcutBinding(raw[actionId]);
    if (binding) bindings[actionId] = binding;
  }
  return bindings;
}

export function droneHubShortcutBindingSignature(
  binding: DroneHubShortcutBinding | null | undefined,
): string {
  if (!binding) return '';
  return `${binding.mod ? 1 : 0}:${binding.ctrl ? 1 : 0}:${binding.meta ? 1 : 0}:${binding.alt ? 1 : 0}:${binding.shift ? 1 : 0}:${binding.key}`;
}
