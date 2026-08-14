export type ShortcutActionId =
  | 'openHome'
  | 'createDraftDrone'
  | 'createDraftGroup'
  | 'createChildDraftDrone'
  | 'createDroneChat'
  | 'toggleSelectedDronePinned'
  | 'moveSelectedDroneToTop'
  | 'toggleSelectedDronesToDo'
  | 'focusPrimaryChatInput'
  | 'toggleChatComposerEditorMode'
  | 'toggleContinuousDictation'
  | 'toggleFileDictation'
  | 'toggleVoiceClipboardRecording'
  | 'markSelectedDronesUnread'
  | 'toggleSidebarCollapsed'
  | 'toggleRightPanelWidth'
  | 'openHoveredGroupMultiChat'
  | 'openPullRequestsTab'
  | 'openChangesTab'
  | 'openCanvasTab'
  | 'openBrowserTab'
  | 'openFilesTab'
  | 'openQuickOpen'
  | 'openTerminalTab';

export type ShortcutBinding = {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
};

export type ShortcutBindingMap = Record<ShortcutActionId, ShortcutBinding | null>;

export type ShortcutDefinition = {
  id: ShortcutActionId;
  label: string;
  description: string;
};

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: 'openHome',
    label: 'Open home',
    description: 'Clears the current drone selection and returns to the home screen.',
  },
  {
    id: 'createDraftDrone',
    label: 'Create new drone',
    description: 'Opens the quick single-drone composer.',
  },
  {
    id: 'createDraftGroup',
    label: 'Create new group',
    description: 'Creates a temporary untitled group at the top of the sidebar for inline naming.',
  },
  {
    id: 'createChildDraftDrone',
    label: 'Create child drone',
    description: 'Opens the quick single-drone composer as a child of the selected drone.',
  },
  {
    id: 'createDroneChat',
    label: 'Create new chat',
    description: 'Creates a new chat on the selected drone, opens it immediately, and focuses the composer.',
  },
  {
    id: 'toggleSelectedDronePinned',
    label: 'Pin selected drones',
    description: 'Pins all selected drones, or unpins them when they are already all pinned.',
  },
  {
    id: 'moveSelectedDroneToTop',
    label: 'Move selected drone to top',
    description: 'Moves the selected drone to the top of its current sidebar level.',
  },
  {
    id: 'toggleSelectedDronesToDo',
    label: 'Tag selected drones as to do',
    description: 'Adds or removes the to do label on the selected drones.',
  },
  {
    id: 'focusPrimaryChatInput',
    label: 'Focus chat input',
    description: 'Focuses the primary chat input.',
  },
  {
    id: 'toggleChatComposerEditorMode',
    label: 'Toggle full text editor',
    description: 'Toggles full text editor mode for the chat composer that currently has focus.',
  },
  {
    id: 'toggleContinuousDictation',
    label: 'Toggle continuous dictation',
    description: 'Starts or stops continuous dictation in the active chat composer.',
  },
  {
    id: 'toggleFileDictation',
    label: 'Toggle file dictation',
    description: 'Finishes file dictation, or resumes dictation to the previous file target.',
  },
  {
    id: 'toggleVoiceClipboardRecording',
    label: 'Record voice to clipboard',
    description: 'Starts or stops a microphone recording, transcribes it with GROQ, and copies the result.',
  },
  {
    id: 'markSelectedDronesUnread',
    label: 'Mark selected drones unread',
    description: 'Marks the selected chat(s) unread, or the active chat for each selected drone, so unread indicators are shown.',
  },
  {
    id: 'toggleSidebarCollapsed',
    label: 'Toggle drone sidebar minimized',
    description: 'Toggles the left drone sidebar between minimized and expanded.',
  },
  {
    id: 'toggleRightPanelWidth',
    label: 'Focus workspace pane',
    description: 'Reopens or focuses the active workspace tool pane.',
  },
  {
    id: 'openHoveredGroupMultiChat',
    label: 'Open hovered group multi-chat',
    description: 'Opens multi-chat for the hovered sidebar group, or all visible sidebar drones when hovering sidebar background.',
  },
  {
    id: 'openPullRequestsTab',
    label: 'Open pull requests tab',
    description: 'Opens the pull requests workspace pane.',
  },
  {
    id: 'openChangesTab',
    label: 'Open Changes tab',
    description: 'Opens the Changes workspace pane.',
  },
  {
    id: 'openCanvasTab',
    label: 'Open Canvas tab',
    description: 'Opens the Canvas workspace pane.',
  },
  {
    id: 'openBrowserTab',
    label: 'Open Browser tab',
    description: 'Opens the Browser workspace pane.',
  },
  {
    id: 'openFilesTab',
    label: 'Open Editor',
    description: 'Opens the Editor with its built-in File Explorer.',
  },
  {
    id: 'openQuickOpen',
    label: 'Quick open file',
    description: 'Searches files in the selected drone and opens the chosen result in the Editor.',
  },
  {
    id: 'openTerminalTab',
    label: 'Open Terminal tab',
    description: 'Opens the Terminal workspace pane.',
  },
];

const DEFAULT_SHORTCUT_BINDINGS: ShortcutBindingMap = {
  openHome: { key: 'v', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  createDraftDrone: { key: '1', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  createDraftGroup: { key: 'e', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  createChildDraftDrone: { key: '3', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  createDroneChat: { key: '2', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  toggleSelectedDronePinned: { key: 'q', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  moveSelectedDroneToTop: { key: 'w', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  toggleSelectedDronesToDo: null,
  focusPrimaryChatInput: { key: 'enter', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  toggleChatComposerEditorMode: { key: 'e', mod: false, ctrl: true, meta: false, alt: false, shift: false },
  toggleContinuousDictation: { key: 'r', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  toggleFileDictation: { key: 'd', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  toggleVoiceClipboardRecording: { key: '`', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  markSelectedDronesUnread: { key: 'z', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  toggleSidebarCollapsed: { key: 'a', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  toggleRightPanelWidth: { key: 's', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  openHoveredGroupMultiChat: { key: 'g', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  openPullRequestsTab: null,
  openChangesTab: { key: 'c', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  openCanvasTab: { key: 'x', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  openBrowserTab: { key: 'b', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  openFilesTab: { key: 'f', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  openQuickOpen: { key: 'p', mod: true, ctrl: false, meta: false, alt: false, shift: false },
  openTerminalTab: { key: 't', mod: false, ctrl: false, meta: false, alt: false, shift: false },
};

type KeyboardEventLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;
type ShortcutCaptureOptions = {
  preferPortablePrimaryModifier?: boolean;
};

const MODIFIER_ONLY_KEYS = new Set(['shift', 'control', 'ctrl', 'alt', 'meta', 'os']);

function normalizeShortcutKey(raw: string): string {
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

function isModifierOnlyKey(raw: string): boolean {
  return MODIFIER_ONLY_KEYS.has(normalizeShortcutKey(raw));
}

function sanitizeShortcutBinding(value: unknown, fallback: ShortcutBinding | null): ShortcutBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const raw = value as Record<string, unknown>;
  const key = normalizeShortcutKey(String(raw.key ?? ''));
  if (!key || isModifierOnlyKey(key)) return fallback;
  const mod = raw.mod === true;
  const ctrl = mod ? false : raw.ctrl === true;
  const meta = mod ? false : raw.meta === true;
  return {
    key,
    mod,
    ctrl,
    meta,
    alt: raw.alt === true,
    shift: raw.shift === true,
  };
}

export function sanitizeSingleShortcutBinding(value: unknown, fallback: ShortcutBinding | null = null): ShortcutBinding | null {
  return sanitizeShortcutBinding(value, fallback);
}

export function migrateFormerPullRequestsShortcut(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(raw, 'toggleContinuousDictation')) return value;
  const formerBinding = sanitizeShortcutBinding(raw.openPullRequestsTab, null);
  if (
    !formerBinding ||
    formerBinding.key !== 'r' ||
    formerBinding.mod ||
    formerBinding.ctrl ||
    formerBinding.meta ||
    formerBinding.alt ||
    formerBinding.shift
  ) {
    return value;
  }
  return {
    ...raw,
    toggleContinuousDictation: { ...formerBinding },
    openPullRequestsTab: null,
  };
}

function cloneShortcutBinding(binding: ShortcutBinding | null): ShortcutBinding | null {
  return binding ? { ...binding } : null;
}

export function cloneDefaultShortcutBindings(): ShortcutBindingMap {
  return {
    openHome: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.openHome),
    createDraftDrone: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.createDraftDrone),
    createDraftGroup: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.createDraftGroup),
    createChildDraftDrone: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.createChildDraftDrone),
    createDroneChat: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.createDroneChat),
    toggleSelectedDronePinned: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.toggleSelectedDronePinned),
    moveSelectedDroneToTop: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.moveSelectedDroneToTop),
    toggleSelectedDronesToDo: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.toggleSelectedDronesToDo),
    focusPrimaryChatInput: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.focusPrimaryChatInput),
    toggleChatComposerEditorMode: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.toggleChatComposerEditorMode),
    toggleContinuousDictation: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.toggleContinuousDictation),
    toggleFileDictation: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.toggleFileDictation),
    toggleVoiceClipboardRecording: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.toggleVoiceClipboardRecording),
    markSelectedDronesUnread: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.markSelectedDronesUnread),
    toggleSidebarCollapsed: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.toggleSidebarCollapsed),
    toggleRightPanelWidth: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.toggleRightPanelWidth),
    openHoveredGroupMultiChat: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.openHoveredGroupMultiChat),
    openPullRequestsTab: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.openPullRequestsTab),
    openChangesTab: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.openChangesTab),
    openCanvasTab: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.openCanvasTab),
    openBrowserTab: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.openBrowserTab),
    openFilesTab: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.openFilesTab),
    openQuickOpen: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.openQuickOpen),
    openTerminalTab: cloneShortcutBinding(DEFAULT_SHORTCUT_BINDINGS.openTerminalTab),
  };
}

export function sanitizeShortcutBindings(value: unknown): ShortcutBindingMap {
  const defaults = cloneDefaultShortcutBindings();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const raw = value as Record<string, unknown>;
  const out: ShortcutBindingMap = { ...defaults };
  for (const def of SHORTCUT_DEFINITIONS) {
    const candidate = raw[def.id];
    if (candidate === undefined) {
      out[def.id] = defaults[def.id];
      continue;
    }
    out[def.id] = candidate === null ? null : sanitizeShortcutBinding(candidate, defaults[def.id]);
  }
  return out;
}

export function shortcutBindingFromKeyboardEvent(
  event: KeyboardEventLike,
  opts: ShortcutCaptureOptions = {},
): ShortcutBinding | null {
  const key = normalizeShortcutKey(event.key);
  if (!key || isModifierOnlyKey(key)) return null;
  const preferPortablePrimaryModifier = opts.preferPortablePrimaryModifier === true;
  const hasSinglePrimaryModifier = event.ctrlKey !== event.metaKey;
  const usePortablePrimaryModifier = preferPortablePrimaryModifier && hasSinglePrimaryModifier;
  return {
    key,
    mod: usePortablePrimaryModifier,
    ctrl: usePortablePrimaryModifier ? false : event.ctrlKey,
    meta: usePortablePrimaryModifier ? false : event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey,
  };
}

export function isShortcutMatch(binding: ShortcutBinding | null | undefined, event: KeyboardEventLike): boolean {
  if (!binding) return false;
  const eventKey = normalizeShortcutKey(event.key);
  if (!eventKey || eventKey !== binding.key) return false;

  if (binding.mod) {
    if (!(event.ctrlKey || event.metaKey)) return false;
  } else {
    if (event.ctrlKey !== binding.ctrl) return false;
    if (event.metaKey !== binding.meta) return false;
  }

  if (event.altKey !== binding.alt) return false;
  if (event.shiftKey !== binding.shift) return false;
  return true;
}

function formatShortcutKeyLabel(key: string): string {
  if (key === 'space') return 'Space';
  if (key === 'escape') return 'Esc';
  if (key === 'arrowup') return 'Up';
  if (key === 'arrowdown') return 'Down';
  if (key === 'arrowleft') return 'Left';
  if (key === 'arrowright') return 'Right';
  if (key === 'pageup') return 'Page Up';
  if (key === 'pagedown') return 'Page Down';
  if (key === 'capslock') return 'Caps Lock';
  if (key === 'backspace') return 'Backspace';
  if (key === 'delete') return 'Delete';
  if (key === 'insert') return 'Insert';
  if (key === 'home') return 'Home';
  if (key === 'end') return 'End';
  if (key === 'tab') return 'Tab';
  if (key === 'enter') return 'Enter';
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function formatShortcutBinding(binding: ShortcutBinding | null | undefined): string {
  if (!binding) return 'Not set';
  const parts: string[] = [];
  if (binding.mod) parts.push('Ctrl/Cmd');
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.meta) parts.push('Meta');
  if (binding.alt) parts.push('Alt');
  if (binding.shift) parts.push('Shift');
  parts.push(formatShortcutKeyLabel(binding.key));
  return parts.join('+');
}

export function shortcutBindingSignature(binding: ShortcutBinding | null | undefined): string {
  if (!binding) return '';
  return `${binding.mod ? 1 : 0}:${binding.ctrl ? 1 : 0}:${binding.meta ? 1 : 0}:${binding.alt ? 1 : 0}:${binding.shift ? 1 : 0}:${binding.key}`;
}
