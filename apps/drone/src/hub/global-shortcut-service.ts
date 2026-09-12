import { createRequire } from 'node:module';

import {
  droneHubShortcutBindingSignature,
  sanitizeDroneHubGlobalShortcutBindings,
  type DroneHubGlobalShortcutBindings,
  type DroneHubGlobalShortcutSettingsResponse,
  type DroneHubGlobalShortcutStatus,
  type DroneHubShortcutActionId,
  type DroneHubShortcutBinding,
} from '@drone/hub-model';

import { getHubSettingsRepository } from '../host/hub-settings-repository';

export type KeyboardHookEvent = {
  keycode: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

export type KeyboardHook = {
  on(event: 'keydown' | 'keyup', listener: (event: KeyboardHookEvent) => void): unknown;
  removeListener(
    event: 'keydown' | 'keyup',
    listener: (event: KeyboardHookEvent) => void,
  ): unknown;
  start(): void;
  stop(): void;
};

export type KeyboardHookModule = {
  uIOhook: KeyboardHook;
  UiohookKey: Record<string, number>;
};

type GlobalShortcutClient = {
  id: string;
  connectedAt: number;
  lastActiveAt: number;
  focused: boolean;
  visible: boolean;
  capturing: boolean;
  send: (event: GlobalShortcutDispatchEvent) => void;
};

export type GlobalShortcutDispatchEvent = {
  id: string;
  actionId: DroneHubShortcutActionId;
  at: string;
};

export type DesktopShortcutConfiguration = {
  revision: number;
  bindings: DroneHubGlobalShortcutBindings;
  suspended: boolean;
  observedNumpad: boolean;
  numpadUnavailable: boolean;
};

export type GlobalShortcutServiceDependencies = {
  readBindings: () => Promise<DroneHubGlobalShortcutBindings>;
  writeBindings: (bindings: DroneHubGlobalShortcutBindings) => Promise<void>;
  loadKeyboardHook: () => KeyboardHookModule;
  now: () => number;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
};

type CompiledBinding = {
  actionId: DroneHubShortcutActionId;
  binding: DroneHubShortcutBinding;
  keycodes: number[];
};

const GLOBAL_SHORTCUT_SETTING_KEY = 'global-shortcuts';
const requireFromHere = createRequire(__filename);

export class GlobalShortcutService {
  private bindings: DroneHubGlobalShortcutBindings = {};
  private status: DroneHubGlobalShortcutStatus = emptyStatus();
  private hook: KeyboardHook | null = null;
  private keydownListener: ((event: KeyboardHookEvent) => void) | null = null;
  private keyupListener: ((event: KeyboardHookEvent) => void) | null = null;
  private compiledByKeycode = new Map<number, CompiledBinding[]>();
  private readonly pressedKeycodes = new Set<number>();
  private readonly desktopPressSequences = new Map<DroneHubShortcutActionId, number>();
  private readonly desktopDispatchedSequences = new Map<DroneHubShortcutActionId, number>();
  private readonly clients = new Map<string, GlobalShortcutClient>();
  private dispatchSequence = 0;
  private desktop: { id: string; send: (config: DesktopShortcutConfiguration) => void } | null = null;
  private desktopRevision = 0;
  private desktopPending: Promise<void> | null = null;
  private finishDesktopUpdate: (() => void) | null = null;
  private readonly settingsListeners = new Set<() => void>();

  constructor(private readonly deps: GlobalShortcutServiceDependencies = defaultDependencies()) {}

  async start(): Promise<void> {
    this.bindings = sanitizeDroneHubGlobalShortcutBindings(await this.deps.readBindings());
    this.reconfigureHook();
  }

  async update(value: unknown): Promise<DroneHubGlobalShortcutSettingsResponse> {
    const bindings = sanitizeDroneHubGlobalShortcutBindings(value);
    await this.deps.writeBindings(bindings);
    this.bindings = bindings;
    this.reconfigureHook();
    await this.desktopPending;
    this.notifySettingsChanged();
    return this.snapshot();
  }

  onSettingsChanged(listener: () => void): () => void {
    this.settingsListeners.add(listener);
    return () => this.settingsListeners.delete(listener);
  }

  connectDesktop(id: string, send: (config: DesktopShortcutConfiguration) => void): () => void {
    if (!normalizeClientId(id)) throw new Error('Invalid desktop session');
    if (this.desktop) throw new Error('A desktop shortcut session is already connected');
    const desktop = { id, send };
    this.desktop = desktop;
    try {
      this.reconfigureHook();
    } catch (error) {
      this.desktop = null;
      this.finishDesktopUpdate?.();
      this.reconfigureHook();
      throw error;
    }
    return () => {
      if (this.desktop !== desktop) return;
      this.desktop = null;
      this.finishDesktopUpdate?.();
      this.reconfigureHook();
      this.notifySettingsChanged();
    };
  }

  reportDesktopStatus(id: string, revision: unknown, value: unknown): boolean {
    if (this.desktop?.id !== id || revision !== this.desktopRevision) return false;
    const actions = (value as DroneHubGlobalShortcutStatus | null)?.actions;
    this.status = {
      running: false, error: '', warning: '',
      actions: Object.fromEntries(Object.keys(this.bindings).map((actionId) => {
        const reported = actions?.[actionId as DroneHubShortcutActionId];
        return [actionId, {
          active: reported?.active === true,
          error: reported?.active === true ? '' : String(reported?.error || 'Desktop shortcut registration failed.'),
        }];
      })),
    };
    this.status.running = Object.values(this.status.actions).some((action) => action?.active);
    this.finishDesktopUpdate?.();
    this.notifySettingsChanged();
    return true;
  }

  dispatchDesktop(id: string, revision: unknown, actionId: unknown): boolean {
    if (this.desktop?.id !== id || revision !== this.desktopRevision ||
        typeof actionId !== 'string' || !this.status.actions[actionId as DroneHubShortcutActionId]?.active) return false;
    if (this.captureActive()) return false;
    // X11 reports keypad navigation keys differently with Num Lock off. The
    // observer dispatches those physical keys; Electron still owns their grabs.
    if (!(this.hook && this.bindings[actionId as DroneHubShortcutActionId]?.key.startsWith('num'))) {
      const action = actionId as DroneHubShortcutActionId;
      const sequence = this.desktopPressSequences.get(action);
      if (sequence !== undefined) {
        if (this.desktopDispatchedSequences.get(action) === sequence) return true;
        this.desktopDispatchedSequences.set(action, sequence);
      }
      this.dispatch(action);
    }
    return true;
  }

  private notifySettingsChanged(): void {
    for (const listener of this.settingsListeners) listener();
  }

  private configureDesktop(): void {
    this.finishDesktopUpdate?.();
    const revision = ++this.desktopRevision;
    this.status = {
      running: false, error: '', warning: '',
      actions: Object.fromEntries(Object.keys(this.bindings).map((actionId) => [actionId, {
        active: false, error: 'Waiting for desktop shortcut registration.',
      }])),
    };
    this.desktopPending = new Promise((resolve) => {
      const timer = setTimeout(() => {
        for (const action of Object.values(this.status.actions)) {
          if (action) action.error = 'Desktop shortcut registration timed out. Reopen the desktop app to retry.';
        }
        this.finishDesktopUpdate?.();
        this.notifySettingsChanged();
      }, 5_000);
      timer.unref?.();
      this.finishDesktopUpdate = () => {
        clearTimeout(timer);
        this.finishDesktopUpdate = null;
        resolve();
      };
    });
    this.desktop?.send({
      revision, bindings: cloneBindings(this.bindings), suspended: this.captureActive(),
      observedNumpad: this.hook !== null,
      numpadUnavailable: this.deps.platform === 'linux' && !this.deps.env.WAYLAND_DISPLAY && !this.hook,
    });
  }

  private captureActive(): boolean {
    return [...this.clients.values()].some((client) => client.focused && client.capturing);
  }

  snapshot(): DroneHubGlobalShortcutSettingsResponse {
    return {
      ok: true,
      bindings: cloneBindings(this.bindings),
      status: {
        ...this.status,
        actions: Object.fromEntries(
          Object.entries(this.status.actions).map(([actionId, actionStatus]) => [
            actionId,
            actionStatus ? { ...actionStatus } : actionStatus,
          ]),
        ),
      },
    };
  }

  connectClient(idRaw: unknown, send: GlobalShortcutClient['send']): () => void {
    const id = normalizeClientId(idRaw);
    if (!id) throw new Error('clientId is required');
    const now = this.deps.now();
    this.clients.set(id, {
      id,
      connectedAt: now,
      lastActiveAt: now,
      focused: false,
      visible: false,
      capturing: false,
      send,
    });
    return () => {
      const current = this.clients.get(id);
      if (current?.send === send) {
        const wasCapturing = this.captureActive();
        this.clients.delete(id);
        if (this.desktop && wasCapturing !== this.captureActive()) this.configureDesktop();
      }
    };
  }

  updateClientActivity(idRaw: unknown, value: { focused?: unknown; visible?: unknown; capturing?: unknown }): boolean {
    const id = normalizeClientId(idRaw);
    const client = id ? this.clients.get(id) : null;
    if (!client) return false;
    const wasCapturing = this.captureActive();
    client.focused = value.focused === true;
    client.visible = value.visible === true;
    client.capturing = value.capturing === true;
    if (client.focused || client.visible) client.lastActiveAt = this.deps.now();
    if (this.desktop && wasCapturing !== this.captureActive()) this.configureDesktop();
    return true;
  }

  close(): void {
    this.desktop = null;
    this.finishDesktopUpdate?.();
    this.stopHook();
    this.clients.clear();
    this.settingsListeners.clear();
  }

  private reconfigureHook(): void {
    this.stopHook();
    if (this.desktop) {
      if (this.deps.platform === 'linux' && !this.deps.env.WAYLAND_DISPLAY) {
        this.startHook(this.bindings);
      }
      this.configureDesktop();
      return;
    }
    this.startHook(this.bindings);
  }

  private startHook(observedBindings: DroneHubGlobalShortcutBindings): void {
    const actionStatuses: DroneHubGlobalShortcutStatus['actions'] = {};
    const bindings = Object.entries(observedBindings) as Array<
      [DroneHubShortcutActionId, DroneHubShortcutBinding]
    >;
    if (bindings.length === 0) {
      this.status = { ...emptyStatus(), actions: actionStatuses };
      return;
    }

    const environmentError = keyboardHookEnvironmentError(this.deps.platform, this.deps.env);
    if (environmentError) {
      for (const [actionId] of bindings) {
        actionStatuses[actionId] = { active: false, error: environmentError };
      }
      this.status = {
        running: false,
        error: environmentError,
        warning: '',
        actions: actionStatuses,
      };
      return;
    }

    let hookModule: KeyboardHookModule;
    try {
      hookModule = this.deps.loadKeyboardHook();
    } catch (error) {
      const message = `Global keyboard support could not start: ${errorMessage(error)}`;
      for (const [actionId] of bindings)
        actionStatuses[actionId] = { active: false, error: message };
      this.status = { running: false, error: message, warning: '', actions: actionStatuses };
      return;
    }

    const duplicateSignatures = duplicateBindingSignatures(this.bindings);
    const compiledByKeycode = new Map<number, CompiledBinding[]>();
    for (const [actionId, binding] of bindings) {
      const signature = droneHubShortcutBindingSignature(binding);
      if (duplicateSignatures.has(signature)) {
        actionStatuses[actionId] = {
          active: false,
          error: 'Another global Drone Hub action uses this shortcut.',
        };
        continue;
      }
      const keycodes = keyboardKeycodes(binding.key, hookModule.UiohookKey);
      if (keycodes.length === 0) {
        actionStatuses[actionId] = {
          active: false,
          error: 'This key is not supported by the host keyboard listener.',
        };
        continue;
      }
      const compiled = { actionId, binding, keycodes };
      for (const keycode of keycodes) {
        const entries = compiledByKeycode.get(keycode) ?? [];
        entries.push(compiled);
        compiledByKeycode.set(keycode, entries);
      }
      actionStatuses[actionId] = { active: true, error: '' };
    }

    if (compiledByKeycode.size === 0) {
      this.status = {
        running: false,
        error: 'No configured global shortcuts are supported on this host.',
        warning: '',
        actions: actionStatuses,
      };
      return;
    }

    this.compiledByKeycode = compiledByKeycode;
    this.keydownListener = (event) => this.handleKeyDown(event);
    this.keyupListener = (event) => this.pressedKeycodes.delete(event.keycode);
    try {
      hookModule.uIOhook.on('keydown', this.keydownListener);
      hookModule.uIOhook.on('keyup', this.keyupListener);
      hookModule.uIOhook.start();
      this.hook = hookModule.uIOhook;
      this.status = {
        running: true,
        error: '',
        warning: keyboardHookEnvironmentWarning(this.deps.platform, this.deps.env),
        actions: actionStatuses,
      };
    } catch (error) {
      const message = `Global keyboard support could not start: ${errorMessage(error)}`;
      hookModule.uIOhook.removeListener('keydown', this.keydownListener);
      hookModule.uIOhook.removeListener('keyup', this.keyupListener);
      this.keydownListener = null;
      this.keyupListener = null;
      this.compiledByKeycode.clear();
      for (const actionId of Object.keys(actionStatuses) as DroneHubShortcutActionId[]) {
        actionStatuses[actionId] = { active: false, error: message };
      }
      this.status = { running: false, error: message, warning: '', actions: actionStatuses };
    }
  }

  private stopHook(): void {
    if (this.hook && this.keydownListener)
      this.hook.removeListener('keydown', this.keydownListener);
    if (this.hook && this.keyupListener) this.hook.removeListener('keyup', this.keyupListener);
    try {
      this.hook?.stop();
    } catch {
      // The native hook may already have stopped with the desktop session.
    }
    this.hook = null;
    this.keydownListener = null;
    this.keyupListener = null;
    this.compiledByKeycode.clear();
    this.pressedKeycodes.clear();
    this.desktopPressSequences.clear();
    this.desktopDispatchedSequences.clear();
  }

  private handleKeyDown(event: KeyboardHookEvent): void {
    const candidates = this.compiledByKeycode.get(event.keycode) ?? [];
    if (candidates.length === 0) return;
    if (this.pressedKeycodes.has(event.keycode)) return;
    this.pressedKeycodes.add(event.keycode);
    const matched = candidates.find((candidate) =>
      modifiersMatch(candidate.binding, event, this.deps.platform),
    );
    if (!matched) return;
    if (this.desktop) {
      // Native X11 callbacks repeat while a key is held. Record physical presses
      // to deduplicate callbacks, but let native registration authorize dispatch.
      this.desktopPressSequences.set(matched.actionId, (this.desktopPressSequences.get(matched.actionId) ?? 0) + 1);
      if (!matched.binding.key.startsWith('num') || !this.status.actions[matched.actionId]?.active || this.captureActive()) return;
    }
    this.dispatch(matched.actionId);
  }

  private dispatch(actionId: DroneHubShortcutActionId): void {
    const clients = [...this.clients.values()].sort(compareClients);
    if (clients.length === 0) return;
    const event: GlobalShortcutDispatchEvent = {
      id: `global-shortcut-${this.deps.now()}-${++this.dispatchSequence}`,
      actionId,
      at: new Date(this.deps.now()).toISOString(),
    };
    for (const client of clients) {
      try {
        client.send(event);
        return;
      } catch {
        this.clients.delete(client.id);
      }
    }
  }
}

function defaultDependencies(): GlobalShortcutServiceDependencies {
  return {
    readBindings: readStoredGlobalShortcutBindings,
    writeBindings: writeStoredGlobalShortcutBindings,
    loadKeyboardHook: () => requireFromHere('uiohook-napi') as KeyboardHookModule,
    now: Date.now,
    platform: process.platform,
    env: process.env,
  };
}

async function readStoredGlobalShortcutBindings(): Promise<DroneHubGlobalShortcutBindings> {
  const repository = await getHubSettingsRepository();
  return sanitizeDroneHubGlobalShortcutBindings(
    repository.get<unknown>(GLOBAL_SHORTCUT_SETTING_KEY)?.value,
  );
}

async function writeStoredGlobalShortcutBindings(
  bindings: DroneHubGlobalShortcutBindings,
): Promise<void> {
  const repository = await getHubSettingsRepository();
  await repository.put(GLOBAL_SHORTCUT_SETTING_KEY, bindings);
}

function emptyStatus(): DroneHubGlobalShortcutStatus {
  return { running: false, error: '', warning: '', actions: {} };
}

function cloneBindings(bindings: DroneHubGlobalShortcutBindings): DroneHubGlobalShortcutBindings {
  return Object.fromEntries(
    Object.entries(bindings).map(([actionId, binding]) => [
      actionId,
      binding ? { ...binding } : binding,
    ]),
  );
}

function normalizeClientId(value: unknown): string {
  const id = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{8,100}$/.test(id) ? id : '';
}

function duplicateBindingSignatures(bindings: DroneHubGlobalShortcutBindings): Set<string> {
  const counts = new Map<string, number>();
  for (const binding of Object.values(bindings)) {
    const signature = droneHubShortcutBindingSignature(binding);
    if (signature) counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([signature]) => signature),
  );
}

function keyboardHookEnvironmentError(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (platform !== 'linux') return '';
  if (String(env.DISPLAY ?? '').trim()) return '';
  if (String(env.WAYLAND_DISPLAY ?? '').trim()) {
    return 'Global shortcuts are not available in this Wayland session without X11 compatibility.';
  }
  return 'Global shortcuts need a graphical desktop session.';
}

function keyboardHookEnvironmentWarning(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (platform === 'darwin') {
    return 'macOS may require Input Monitoring permission before global shortcuts receive keys.';
  }
  if (platform !== 'linux') return '';
  if (String(env.WAYLAND_DISPLAY ?? '').trim()) {
    return 'This Wayland session is using X11 compatibility; shortcuts may not see keys in native Wayland apps.';
  }
  return '';
}

function keyboardKeycodes(keyRaw: string, keys: Record<string, number>): number[] {
  const key = String(keyRaw ?? '').toLowerCase();
  const digit = /^num([0-9])$/.exec(key);
  if (digit) {
    const number = Number(digit[1]);
    const numLockOffNames = [
      'NumpadInsert',
      'NumpadEnd',
      'NumpadArrowDown',
      'NumpadPageDown',
      'NumpadArrowLeft',
      '',
      'NumpadArrowRight',
      'NumpadHome',
      'NumpadArrowUp',
      'NumpadPageUp',
    ];
    return uniqueNumbers([keys[`Numpad${number}`], keys[numLockOffNames[number] ?? '']]);
  }
  if (key === 'numdec') return uniqueNumbers([keys.NumpadDecimal, keys.NumpadDelete]);
  const keyNameByKey: Record<string, string> = {
    numadd: 'NumpadAdd',
    numsub: 'NumpadSubtract',
    nummult: 'NumpadMultiply',
    numdiv: 'NumpadDivide',
    numenter: 'NumpadEnter',
    space: 'Space',
    tab: 'Tab',
    enter: 'Enter',
    escape: 'Escape',
    capslock: 'CapsLock',
    backspace: 'Backspace',
    delete: 'Delete',
    insert: 'Insert',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    arrowup: 'ArrowUp',
    arrowdown: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
    ';': 'Semicolon',
    ':': 'Semicolon',
    '=': 'Equal',
    '+': 'Equal',
    ',': 'Comma',
    '<': 'Comma',
    '-': 'Minus',
    _: 'Minus',
    '.': 'Period',
    '>': 'Period',
    '/': 'Slash',
    '?': 'Slash',
    '`': 'Backquote',
    '~': 'Backquote',
    '[': 'BracketLeft',
    '{': 'BracketLeft',
    '\\': 'Backslash',
    '|': 'Backslash',
    ']': 'BracketRight',
    '}': 'BracketRight',
    "'": 'Quote',
    '"': 'Quote',
  };
  const shiftedDigit = '!@#$%^&*()'.indexOf(key);
  if (shiftedDigit >= 0) return uniqueNumbers([keys[String((shiftedDigit + 1) % 10)]]);
  if (/^[a-z]$/.test(key)) return uniqueNumbers([keys[key.toUpperCase()]]);
  if (/^[0-9]$/.test(key)) return uniqueNumbers([keys[key]]);
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) return uniqueNumbers([keys[key.toUpperCase()]]);
  return uniqueNumbers([keys[keyNameByKey[key] ?? '']]);
}

function uniqueNumbers(values: Array<number | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => Number.isFinite(value)))];
}

function modifiersMatch(
  binding: DroneHubShortcutBinding,
  event: KeyboardHookEvent,
  platform: NodeJS.Platform,
): boolean {
  if (binding.mod) {
    const primaryDown = platform === 'darwin' ? event.metaKey : event.ctrlKey;
    if (!primaryDown) return false;
    if (platform === 'darwin' ? event.ctrlKey : event.metaKey) return false;
  } else if (event.ctrlKey !== binding.ctrl || event.metaKey !== binding.meta) {
    return false;
  }
  return event.altKey === binding.alt && event.shiftKey === binding.shift;
}

function compareClients(left: GlobalShortcutClient, right: GlobalShortcutClient): number {
  const leftActivity = left.focused && left.visible ? 2 : left.focused || left.visible ? 1 : 0;
  const rightActivity = right.focused && right.visible ? 2 : right.focused || right.visible ? 1 : 0;
  if (leftActivity !== rightActivity) return rightActivity - leftActivity;
  if (left.lastActiveAt !== right.lastActiveAt) return right.lastActiveAt - left.lastActiveAt;
  return right.connectedAt - left.connectedAt;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'unknown error');
}
