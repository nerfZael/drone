import { randomUUID } from 'node:crypto';
import { parseCompanionProposalText, type CompanionMirrorCommand, type CompanionMirrorSession, type CompanionMirrorSnapshot } from '@drone/assistant-chat';
import { getHubSettingsRepository } from '../../host/hub-settings-repository';
import { readCompanionLiveSettings } from './companion-live-settings';
import { readCompanionAutoApproveSettings } from './companion-auto-approve-settings';

type Entry = { view: CompanionMirrorSession; sequence: number };
type Pending = { deviceId: string; sessionId: string; finish(error?: string): void };
type Emit = (event: string, payload: Record<string, unknown>, operation: string, deviceId?: string) => Promise<void>;

/** The phone owns execution; the Hub only retains its latest view and relays controls. */
export class CompanionMirrorService {
  private enabled = false;
  private initialization?: Promise<void>;
  private entries = new Map<string, Entry>();
  private retired = new Map<string, Set<string>>();
  private pending = new Map<string, Pending>();
  private listeners = new Set<(message: unknown) => void>();

  constructor(private readonly emit: Emit) {}

  async settings(): Promise<{ enabled: boolean }> {
    this.initialization ??= (async () => {
      const stored = (await getHubSettingsRepository()).get<{ enabled: boolean }>('companion-mirror');
      this.enabled = stored?.value?.enabled === true;
    })().catch((error) => { this.initialization = undefined; throw error; });
    await this.initialization;
    return { enabled: this.enabled };
  }

  async setEnabled(enabled: unknown): Promise<void> {
    if (typeof enabled !== 'boolean') throw new Error('Mirror preference must be a boolean.');
    await this.settings();
    await (await getHubSettingsRepository()).put('companion-mirror', { enabled });
    this.enabled = enabled;
    if (!enabled) {
      for (const request of this.pending.values()) request.finish('Companion mirroring was disabled.');
      this.entries.clear();
    }
    this.changed();
    await this.emit('mirror.settings.changed', { enabled }, 'run.start');
  }

  async subscribe(listener: (message: unknown) => void): Promise<() => void> {
    await this.settings();
    const [autoApprove, voice] = await Promise.all([readCompanionAutoApproveSettings(), readCompanionLiveSettings()]);
    this.listeners.add(listener);
    listener(this.state());
    listener({ type: 'mirror_auto_approve', ...autoApprove });
    listener({ type: 'mirror_live_settings', enabled: voice.enabled, mode: voice.mode });
    return () => this.listeners.delete(listener);
  }

  async liveSettingsChanged(settings: { enabled: boolean; mode: 'live' }): Promise<void> {
    const preference = { enabled: settings.enabled, mode: settings.mode };
    for (const listener of this.listeners) listener({ type: 'mirror_live_settings', ...preference });
    await this.emit('live.settings.changed', preference, 'live.settings.get');
  }

  async autoApproveChanged(settings: { enabled: boolean }): Promise<void> {
    for (const listener of this.listeners) listener({ type: 'mirror_auto_approve', ...settings });
    await this.emit('auto-approve.settings.changed', settings, 'auto-approve.settings.get');
  }

  async publish(deviceId: string, deviceName: string, payload: Record<string, unknown>): Promise<{ enabled: boolean }> {
    const settings = await this.settings();
    if (!settings.enabled) return settings;
    const sessionId = requiredId(payload.sessionId);
    if (this.retired.get(deviceId)?.has(sessionId)) return settings;
    const sequence = payload.sequence;
    if (!Number.isSafeInteger(sequence) || Number(sequence) < 0) throw new Error('Invalid mirror sequence.');
    const snapshot = validateSnapshot(payload.snapshot);
    const previous = this.entries.get(deviceId);
    if (previous?.view.sessionId === sessionId && previous.sequence >= Number(sequence)) return settings;
    if (previous && previous.view.sessionId !== sessionId) this.remove(deviceId, previous.view.sessionId);
    if (!this.entries.has(deviceId) && this.entries.size >= 16) throw new Error('Too many mirrored sessions.');
    this.entries.set(deviceId, { sequence: Number(sequence), view: {
      ...snapshot, deviceId, deviceName, sessionId, connected: true,
      pending: [...this.pending.values()].some((request) => request.deviceId === deviceId),
    } });
    this.changed();
    return settings;
  }

  remove(deviceId: string, sessionId: string): void {
    const ids = this.retired.get(deviceId) ?? new Set<string>();
    ids.add(sessionId);
    if (ids.size > 64) ids.delete(ids.values().next().value!);
    this.retired.set(deviceId, ids);
    if (this.entries.get(deviceId)?.view.sessionId !== sessionId) return;
    this.disconnect(deviceId);
    this.entries.delete(deviceId);
    this.changed();
  }

  disconnect(deviceId: string): void {
    const entry = this.entries.get(deviceId);
    if (entry) { entry.view.connected = false; entry.view.pending = false; }
    for (const request of this.pending.values()) {
      if (request.deviceId === deviceId) request.finish('Phone disconnected. Check the proposal when it reconnects.');
    }
    this.changed();
  }

  async command(input: Record<string, unknown>): Promise<void> {
    const deviceId = requiredId(input.deviceId);
    const sessionId = requiredId(input.sessionId);
    const entry = this.entries.get(deviceId);
    if (!this.enabled || !entry?.view.connected || entry.view.sessionId !== sessionId) throw new Error('The remote Companion is disconnected.');
    const view = entry.view;
    const action = input.action as CompanionMirrorCommand['action'];
    if (!['approve', 'discard', 'select_proposal', 'mute', 'unmute', 'pause', 'resume', 'end_voice', 'stop_turn'].includes(action)) throw new Error('Unknown mirror action.');
    if (view.pending) throw new Error('A remote action is already in progress.');
    if (['approve', 'discard', 'select_proposal'].includes(action)) {
      if (view.proposalExecuting) throw new Error('A proposal action is already in progress.');
      if (input.proposalRevision !== view.proposalRevision) throw new Error('The proposal changed. Review the latest version.');
      if (action === 'select_proposal') {
        if (!view.proposals?.some(item => item.targetId === input.targetId)) throw new Error('The proposal is no longer pending.');
      } else {
        if (!view.proposal) throw new Error('The proposal changed. Review the latest version.');
        if (action === 'approve' && (view.proposalExecution || ['starting', 'recording', 'transcribing', 'working'].includes(view.status))) throw new Error('This proposal is not ready to apply.');
      }
    } else if (!view.voiceControls) throw new Error('Update the phone app to control its voice session.');
    const command: CompanionMirrorCommand = {
      commandId: randomUUID(), sessionId, action,
      ...(action === 'select_proposal' ? { targetId: requiredId(input.targetId) } : {}),
      proposalRevision: view.proposalRevision, expiresAt: Date.now() + 10_000,
    };
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish('The phone did not confirm the action. Check its status before trying again.'), 10_000);
      const finish = (error?: string) => {
        if (!this.pending.delete(command.commandId)) return;
        clearTimeout(timer);
        const current = this.entries.get(deviceId);
        if (current?.view.sessionId === sessionId) current.view.pending = false;
        this.changed();
        if (error) reject(new Error(error)); else resolve();
      };
      this.pending.set(command.commandId, { deviceId, sessionId, finish });
      view.pending = true;
      this.changed();
      void this.emit('mirror.command', command, 'run.start', deviceId).catch((error) => finish(String(error)));
    });
  }

  result(deviceId: string, payload: Record<string, unknown>): void {
    const request = this.pending.get(String(payload.commandId));
    if (!request || request.deviceId !== deviceId || request.sessionId !== payload.sessionId) return;
    request.finish(payload.ok === true ? undefined : String(payload.error || 'The phone could not apply that action.'));
  }

  close(): void {
    for (const request of this.pending.values()) request.finish('Hub shutting down.');
    this.entries.clear(); this.retired.clear(); this.listeners.clear();
  }

  private state() { return { type: 'mirror_state', enabled: this.enabled, sessions: [...this.entries.values()].map((entry) => entry.view) }; }
  private changed() { for (const listener of this.listeners) listener(this.state()); }
}

function requiredId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('Invalid mirror identifier.');
  return value;
}

function validateSnapshot(value: unknown): CompanionMirrorSnapshot {
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 512_000) throw new Error('Invalid mirror snapshot.');
  const snapshot = value as CompanionMirrorSnapshot;
  if (!['idle', 'starting', 'recording', 'transcribing', 'working', 'completed', 'cancelled', 'error'].includes(snapshot.status) ||
    !['idle', 'connecting', 'listening', 'paused', 'error'].includes(snapshot.liveStatus) ||
    !Number.isSafeInteger(snapshot.proposalRevision) || snapshot.proposalRevision < 0 ||
    typeof snapshot.proposalExecuting !== 'boolean' ||
    ![snapshot.captions, snapshot.reply, snapshot.error, snapshot.proposalDefaultRepoPath].every((text) => typeof text === 'string')) {
    throw new Error('Invalid mirror snapshot.');
  }
  if (snapshot.history !== undefined && !Array.isArray(snapshot.history)) throw new Error('Invalid mirror history.');
  if (snapshot.proposal) parseCompanionProposalText(JSON.stringify(snapshot.proposal));
  for (const execution of [snapshot.proposalExecution, snapshot.lastExecution?.execution, ...(snapshot.history ?? []).map(item => item.execution)]) {
    if (execution && (typeof execution.ok !== 'boolean' || !Array.isArray(execution.operations) ||
      execution.operations.some((operation) => !operation || typeof operation.id !== 'string' ||
        !['completed', 'failed', 'skipped'].includes(operation.status)))) throw new Error('Invalid mirror execution.');
  }
  if (snapshot.voiceControls !== undefined && typeof snapshot.voiceControls !== 'boolean' ||
      snapshot.muted !== undefined && typeof snapshot.muted !== 'boolean' ||
      snapshot.recordingPaused !== undefined && typeof snapshot.recordingPaused !== 'boolean' ||
      snapshot.screenMarkdown !== undefined && typeof snapshot.screenMarkdown !== 'string' ||
      snapshot.reviewNotice !== undefined && typeof snapshot.reviewNotice !== 'string' ||
      snapshot.selectedProposalId != null && typeof snapshot.selectedProposalId !== 'string') throw new Error('Invalid mirror review.');
  if (snapshot.proposals && (!Array.isArray(snapshot.proposals) || snapshot.proposals.some(item =>
    !item || typeof item.targetId !== 'string' || typeof item.title !== 'string' || typeof item.status !== 'string'))) throw new Error('Invalid mirror proposals.');
  if (snapshot.subscriptions && (!Array.isArray(snapshot.subscriptions) || snapshot.subscriptions.some(item =>
    !item || ![item.id, item.label, item.intent, item.status].every(value => typeof value === 'string')))) throw new Error('Invalid mirror subscriptions.');
  if (snapshot.activity && (!Array.isArray(snapshot.activity) || snapshot.activity.some(item =>
    !item || typeof item.callId !== 'string' || typeof item.label !== 'string' || typeof item.status !== 'string' ||
    item.error !== undefined && typeof item.error !== 'string'))) throw new Error('Invalid mirror activity.');
  for (const item of snapshot.history ?? []) {
    parseCompanionProposalText(JSON.stringify(item.proposal));
    if (!item.execution || typeof item.defaultRepoPath !== 'string') throw new Error('Invalid mirror history.');
  }
  if (snapshot.lastExecution) {
    parseCompanionProposalText(JSON.stringify(snapshot.lastExecution.proposal));
    if (!snapshot.lastExecution.execution || typeof snapshot.lastExecution.defaultRepoPath !== 'string') throw new Error('Invalid mirror execution.');
  }
  return snapshot;
}
