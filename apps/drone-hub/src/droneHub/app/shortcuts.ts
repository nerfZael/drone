export type ShortcutActionId =
  | 'createDraftDrone'
  | 'openCreateModal'
  | 'openCreateModalAlt'
  | 'toggleTldr'
  | 'openHoveredGroupMultiChat'
  | 'openChangesTab'
  | 'openBrowserTab'
  | 'openFilesTab'
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
    id: 'createDraftDrone',
    label: 'Create new drone',
    description: 'Opens the quick single-drone composer.',
  },
  {
    id: 'openCreateModal',
    label: 'Create multiple drones',
    description: 'Opens the create drones modal.',
  },
  {
    id: 'openCreateModalAlt',
    label: 'Create multiple drones (alternate)',
    description: 'Secondary shortcut for opening the create drones modal.',
  },
  {
    id: 'toggleTldr',
    label: 'Toggle TLDR',
    description: 'Shows or hides TLDR cards in transcript view.',
  },
  {
    id: 'openHoveredGroupMultiChat',
    label: 'Open hovered group multi-chat',
    description: 'Opens multi-chat for the group currently under your mouse in the sidebar.',
  },
  {
    id: 'openChangesTab',
    label: 'Open Changes tab',
    description: 'Opens the right-panel Changes tab (top pane by default, hovered bottom pane in split mode).',
  },
  {
    id: 'openBrowserTab',
    label: 'Open Browser tab',
    description: 'Opens the right-panel Browser tab (top pane by default, hovered bottom pane in split mode).',
  },
  {
    id: 'openFilesTab',
    label: 'Open Files tab',
    description: 'Opens the right-panel Files tab (top pane by default, hovered bottom pane in split mode).',
  },
  {
    id: 'openTerminalTab',
    label: 'Open Terminal tab',
    description: 'Opens the right-panel Terminal tab (top pane by default, hovered bottom pane in split mode).',
  },
];

const DEFAULT_SHORTCUT_BINDINGS: ShortcutBindingMap = {
  createDraftDrone: { key: 'a', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  openCreateModal: { key: 's', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  openCreateModalAlt: { key: 'n', mod: true, ctrl: false, meta: false, alt: false, shift: true },
  toggleTldr: { key: 'w', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  openHoveredGroupMultiChat: { key: 'm', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  openChangesTab: { key: 'c', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  openBrowserTab: { key: 'b', mod: false, ctrl: false, meta: false, alt: false, shift: false },
  openFilesTab: { key: 'f', mod: false, ctrl: false, meta: false, alt: false, shift: false },
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

export function cloneDefaultShortcutBindings(): ShortcutBindingMap {
  return {
    createDraftDrone: { ...DEFAULT_SHORTCUT_BINDINGS.createDraftDrone! },
    openCreateModal: { ...DEFAULT_SHORTCUT_BINDINGS.openCreateModal! },
    openCreateModalAlt: { ...DEFAULT_SHORTCUT_BINDINGS.openCreateModalAlt! },
    toggleTldr: { ...DEFAULT_SHORTCUT_BINDINGS.toggleTldr! },
    openHoveredGroupMultiChat: { ...DEFAULT_SHORTCUT_BINDINGS.openHoveredGroupMultiChat! },
    openChangesTab: { ...DEFAULT_SHORTCUT_BINDINGS.openChangesTab! },
    openBrowserTab: { ...DEFAULT_SHORTCUT_BINDINGS.openBrowserTab! },
    openFilesTab: { ...DEFAULT_SHORTCUT_BINDINGS.openFilesTab! },
    openTerminalTab: { ...DEFAULT_SHORTCUT_BINDINGS.openTerminalTab! },
  };
}

export function sanitizeShortcutBindings(value: unknown): ShortcutBindingMap {
  const defaults = cloneDefaultShortcutBindings();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const raw = value as Record<string, unknown>;
  const out: ShortcutBindingMap = { ...defaults };
  for (const def of SHORTCUT_DEFINITIONS) {
    const candidate = raw[def.id];
    out[def.id] = candidate == null ? null : sanitizeShortcutBinding(candidate, defaults[def.id]);
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
