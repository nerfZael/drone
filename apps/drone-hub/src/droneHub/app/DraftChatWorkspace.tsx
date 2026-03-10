import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChatInput, type ChatInputAutomationAction, type ChatSendPayload, EmptyState, PendingTranscriptTurn } from '../chat';
import { draftChatInputResetKey, droneChatQueueKey } from './helpers';
import { IconChat, IconChevron } from './icons';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/menuSelect';
import type { ChatAgentConfig } from '../../domain';
import type { PendingPrompt } from '../types';
import type { DraftChatState } from './app-types';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import {
  AUTOMATION_RUNS_MAX,
  AUTOMATION_RUNS_MIN,
  automationSleepSecondsFromConfig,
  formatAutomationSleepInterval,
} from './automation-config';
import {
  filterSpawnAgentMenuEntriesForRuntime,
  runtimeSupportsCustomAgents,
  type CreateRuntime,
} from './drone-create-runtime';
import type { DraftAutomationStartInput } from './use-drone-creation-actions';
import { SegmentedToolbarToggle } from './SegmentedToolbarToggle';

type DraftChatWorkspaceProps = {
  draftChat: DraftChatState;
  nowMs: number;
  createRuntime: CreateRuntime;
  onCreateRuntimeChange: (value: CreateRuntime) => void;
  draftCreateMode: 'with-chat' | 'without-chat';
  onDraftCreateModeChange: (value: 'with-chat' | 'without-chat') => void;
  spawnAgentMenuEntries: UiMenuSelectEntry[];
  draftCreating: boolean;
  draftAutoRenaming: boolean;
  spawnAgentConfig: ChatAgentConfig;
  createRepoMenuEntries: UiMenuSelectEntry[];
  draftCreateName: string;
  draftCreateGroup: string;
  draftCreateError: string | null;
  queuedPromptsByDroneChat: Record<string, PendingPrompt[]>;
  onCancel: () => void;
  onStartDraftPrompt: (payload: ChatSendPayload) => Promise<boolean>;
  onStartDraftAutomation: (automation: DraftAutomationStartInput) => Promise<boolean>;
  onCreateEmptyDrone: () => Promise<boolean>;
  onEnqueueQueuedPrompt: (droneId: string, chatName: string, prompt: string) => void;
  onDraftCreateNameChange: (value: string) => void;
  onDraftCreateGroupChange: (value: string) => void;
  onSetDraftCreateError: (error: string | null) => void;
};

export function DraftChatWorkspace({
  draftChat,
  nowMs,
  createRuntime,
  onCreateRuntimeChange,
  draftCreateMode,
  onDraftCreateModeChange,
  spawnAgentMenuEntries,
  draftCreating,
  draftAutoRenaming,
  spawnAgentConfig,
  createRepoMenuEntries,
  draftCreateName,
  draftCreateGroup,
  draftCreateError,
  queuedPromptsByDroneChat,
  onCancel,
  onStartDraftPrompt,
  onStartDraftAutomation,
  onCreateEmptyDrone,
  onEnqueueQueuedPrompt,
  onDraftCreateNameChange,
  onDraftCreateGroupChange,
  onSetDraftCreateError,
}: DraftChatWorkspaceProps) {
  const {
    spawnAgentKey,
    spawnModel,
    chatHeaderRepoPath,
    pullHostBranchBeforeCreate,
    automations,
    setSpawnAgentKey,
    setSpawnModel,
    setChatHeaderRepoPath,
    setPullHostBranchBeforeCreate,
    setCustomAgentModalOpen,
  } = useDroneHubUiStore(
    useShallow((s) => ({
      spawnAgentKey: s.spawnAgentKey,
      spawnModel: s.spawnModel,
      chatHeaderRepoPath: s.chatHeaderRepoPath,
      pullHostBranchBeforeCreate: s.pullHostBranchBeforeCreate,
      automations: s.automations,
      setSpawnAgentKey: s.setSpawnAgentKey,
      setSpawnModel: s.setSpawnModel,
      setChatHeaderRepoPath: s.setChatHeaderRepoPath,
      setPullHostBranchBeforeCreate: s.setPullHostBranchBeforeCreate,
      setCustomAgentModalOpen: s.setCustomAgentModalOpen,
    })),
  );

  const controlsLocked = draftCreating || draftAutoRenaming || Boolean(draftChat.prompt);
  const createWithChat = draftCreateMode === 'with-chat' || Boolean(draftChat.prompt);
  const hostCustomAgentsUnsupported = !runtimeSupportsCustomAgents(createRuntime);
  const filteredSpawnAgentMenuEntries = React.useMemo(
    () => filterSpawnAgentMenuEntriesForRuntime(createRuntime, spawnAgentMenuEntries),
    [createRuntime, spawnAgentMenuEntries],
  );
  const modeToggleOptions = React.useMemo(
    () => [
      {
        value: 'with-chat' as const,
        label: 'Start with chat',
        title: 'Create the drone and start with a first chat.',
      },
      {
        value: 'without-chat' as const,
        label: 'Create empty drone',
        title: 'Create the drone without starting a chat yet.',
      },
    ],
    [],
  );
  const runtimeToggleOptions = React.useMemo(
    () => [
      {
        value: 'container' as const,
        label: 'Container',
        title: 'Create the new drone in a managed container.',
      },
      {
        value: 'host' as const,
        label: 'Host',
        title: 'Create the new drone directly on the host machine.',
      },
    ],
    [],
  );
  const draftAutomationActions = React.useMemo<ChatInputAutomationAction[]>(() => {
    const supportsDraftAutomation = spawnAgentConfig.kind === 'builtin';
    const actions: ChatInputAutomationAction[] = [];
    for (const [idx, automation] of (Array.isArray(automations) ? automations : []).entries()) {
      const automationId = String(automation?.id ?? '').trim();
      if (!automationId) continue;
      const automationLabel = String(automation?.label ?? '').trim() || `Automation ${idx + 1}`;
      const prompt = String(automation?.prompt ?? '').trim();
      const onFailurePrompt = String(automation?.onFailurePrompt ?? '').trim();
      const runsRaw = Number(automation?.runs);
      const runs = Number.isFinite(runsRaw)
        ? Math.max(AUTOMATION_RUNS_MIN, Math.min(AUTOMATION_RUNS_MAX, Math.round(runsRaw)))
        : AUTOMATION_RUNS_MIN;
      const sleepBetweenRunsSeconds = automationSleepSecondsFromConfig(automation);
      const sleepBetweenRunsLabel = formatAutomationSleepInterval(automation);
      const stopPhrase = String(automation?.stopPhrase ?? '').trim();
      const stopPhraseCaseSensitive = Boolean(automation?.stopPhraseCaseSensitive);
      const title = !supportsDraftAutomation
        ? 'Automations require a builtin transcript agent.'
        : !prompt
          ? `Set a prompt for "${automationLabel}" in Settings > Automation first.`
          : `Create a new drone and run "${automationLabel}" for ${runs} ${
              runs === 1 ? 'run' : 'runs'
            }${sleepBetweenRunsSeconds > 0 ? ` (${sleepBetweenRunsLabel.toLowerCase()} between runs)` : ''}.`;
      actions.push({
        id: `draft-automation:${automationId}`,
        kind: 'automation',
        label: `Run ${automationLabel}`,
        onSelect: () => {
          void onStartDraftAutomation({
            automationId,
            automationLabel,
            prompt,
            onFailurePrompt,
            runs,
            sleepBetweenRunsSeconds,
            stopPhrase,
            stopPhraseCaseSensitive,
          });
        },
        onSelectWithRuns: (selectedRuns) => {
          const normalizedRuns = Math.max(
            AUTOMATION_RUNS_MIN,
            Math.min(AUTOMATION_RUNS_MAX, Math.round(Number(selectedRuns) || runs)),
          );
          void onStartDraftAutomation({
            automationId,
            automationLabel,
            prompt,
            onFailurePrompt,
            runs: normalizedRuns,
            sleepBetweenRunsSeconds,
            stopPhrase,
            stopPhraseCaseSensitive,
          });
        },
        title,
        disabled: controlsLocked || !supportsDraftAutomation || !prompt || !createWithChat,
        active: false,
        defaultRuns: runs,
        minRuns: AUTOMATION_RUNS_MIN,
        maxRuns: AUTOMATION_RUNS_MAX,
        sleepBetweenRunsLabel,
        statusText: `${runs} ${runs === 1 ? 'run' : 'runs'}`,
      });
    }
    return actions;
  }, [automations, controlsLocked, createWithChat, onStartDraftAutomation, spawnAgentConfig.kind]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      <div className="flex-shrink-0 bg-[var(--panel-alt)] border-b border-[var(--border)] relative">
        <div className="px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 border bg-[var(--yellow-subtle)] border-[rgba(255,178,36,.15)]">
                <IconChat className="text-[var(--yellow)]" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="font-semibold text-sm tracking-tight" style={{ fontFamily: 'var(--display)' }}>
                    New drone
                  </span>
                </div>
                <div className="text-[10px] text-[var(--muted)] mt-0.5">
                  {draftChat.prompt
                    ? 'Creating your drone. Any new messages you send will queue and auto-send when it is ready.'
                    : createWithChat
                      ? 'Send the first message to create the drone and start its first chat.'
                      : 'Create the runtime now. You can add chats later.'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center justify-center h-7 px-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] transition-all text-[10px] font-semibold tracking-wide uppercase"
                style={{ fontFamily: 'var(--display)' }}
              >
                Cancel
              </button>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <SegmentedToolbarToggle
              label="Mode"
              value={draftCreateMode}
              options={modeToggleOptions}
              onChange={onDraftCreateModeChange}
              disabled={controlsLocked}
            />
            <SegmentedToolbarToggle
              label="Runtime"
              value={createRuntime}
              options={runtimeToggleOptions}
              onChange={onCreateRuntimeChange}
              disabled={controlsLocked}
            />
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                Name
              </span>
              <input
                value={draftCreateName}
                onChange={(e) => onDraftCreateNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') e.currentTarget.blur();
                }}
                disabled={controlsLocked}
                placeholder={createWithChat ? 'Optional (auto-renames if blank)' : 'Optional name'}
                className={`h-[28px] w-[220px] rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[11px] text-[var(--muted)] placeholder:text-[var(--muted-dim)] focus:outline-none transition-all font-mono ${
                  controlsLocked ? 'opacity-40 cursor-not-allowed' : 'hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
                }`}
                title="Optionally name this drone now."
              />
              <button
                type="button"
                onClick={() => onDraftCreateNameChange('')}
                disabled={controlsLocked || !draftCreateName.trim()}
                className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
                  controlsLocked || !draftCreateName.trim()
                    ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                    : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title="Clear name"
              >
                Clear
              </button>
            </div>
            {createWithChat ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                  Agent
                </span>
                <UiMenuSelect
                  variant="toolbar"
                  value={spawnAgentKey}
                  onValueChange={setSpawnAgentKey}
                  entries={filteredSpawnAgentMenuEntries}
                  disabled={controlsLocked}
                  triggerClassName="min-w-[170px] max-w-[240px]"
                  panelClassName="w-[320px]"
                  title="Choose agent for this new drone."
                  chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
                />
                <button
                  type="button"
                  onClick={() => setCustomAgentModalOpen(true)}
                  disabled={controlsLocked || hostCustomAgentsUnsupported}
                  className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
                    controlsLocked || hostCustomAgentsUnsupported
                      ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                      : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                  title={hostCustomAgentsUnsupported ? 'Custom agents are not yet supported for host runtime.' : 'Manage custom agents'}
                >
                  Custom
                </button>
              </div>
            ) : null}
            {createWithChat && spawnAgentConfig.kind === 'builtin' ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                  Model
                </span>
                <input
                  value={spawnModel}
                  onChange={(e) => setSpawnModel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') e.currentTarget.blur();
                  }}
                  disabled={controlsLocked}
                  placeholder="Default model"
                  className={`h-[28px] w-[170px] rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[11px] text-[var(--muted)] placeholder:text-[var(--muted-dim)] focus:outline-none transition-all font-mono ${
                    controlsLocked ? 'opacity-40 cursor-not-allowed' : 'hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
                  }`}
                  title="Set default model for this new drone chat."
                />
                <button
                  type="button"
                  onClick={() => setSpawnModel('')}
                  disabled={controlsLocked || !spawnModel.trim()}
                  className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
                    controlsLocked || !spawnModel.trim()
                      ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                      : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                  title="Clear model override"
                >
                  Clear
                </button>
              </div>
            ) : null}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                Repo
              </span>
              <UiMenuSelect
                variant="toolbar"
                value={chatHeaderRepoPath}
                onValueChange={setChatHeaderRepoPath}
                entries={createRepoMenuEntries}
                disabled={controlsLocked}
                triggerClassName="min-w-[220px] max-w-[420px]"
                panelClassName="w-[720px] max-w-[calc(100vw-3rem)]"
                menuClassName="max-h-[240px] overflow-y-auto"
                title={chatHeaderRepoPath || 'No repo'}
                triggerLabel={chatHeaderRepoPath || 'No repo'}
                triggerLabelClassName={chatHeaderRepoPath ? 'font-mono text-[11px]' : undefined}
                chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                Group
              </span>
              <input
                value={draftCreateGroup}
                onChange={(e) => onDraftCreateGroupChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') e.currentTarget.blur();
                }}
                disabled={controlsLocked}
                placeholder="Optional group"
                className={`h-[28px] w-[170px] rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[11px] text-[var(--muted)] placeholder:text-[var(--muted-dim)] focus:outline-none transition-all ${
                  controlsLocked ? 'opacity-40 cursor-not-allowed' : 'hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
                }`}
                title="Set group for this new drone."
              />
              <button
                type="button"
                onClick={() => onDraftCreateGroupChange('')}
                disabled={controlsLocked || !draftCreateGroup.trim()}
                className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
                  controlsLocked || !draftCreateGroup.trim()
                    ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                    : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title="Clear group"
              >
                Clear
              </button>
            </div>
            <label
              className={`inline-flex items-center gap-1.5 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
                controlsLocked
                  ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                  : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] cursor-pointer'
              }`}
              style={{ fontFamily: 'var(--display)' }}
              title="Before creating a repo-attached drone, run a host git pull --ff-only on the current branch."
            >
              <input
                type="checkbox"
                checked={pullHostBranchBeforeCreate}
                onChange={(e) => setPullHostBranchBeforeCreate(e.target.checked)}
                disabled={controlsLocked}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              Pull host branch
            </label>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {draftCreateError && !createWithChat && !draftChat.prompt ? (
          <div className="px-5 pt-4">
            <div className="mx-auto max-w-[1275px] rounded border border-[rgba(255,90,90,.15)] bg-[var(--red-subtle)] px-3 py-2 text-[11px] text-[var(--red)] whitespace-pre-wrap">
              {draftCreateError}
            </div>
          </div>
        ) : null}
        {draftChat.prompt ? (
          <div className="px-5 py-5">
            <div className="mx-auto max-w-[1275px] space-y-5">
              <PendingTranscriptTurn item={draftChat.prompt} nowMs={nowMs} />
              {(draftChat.droneId ? queuedPromptsByDroneChat[droneChatQueueKey(draftChat.droneId, 'default')] ?? [] : []).map((p) => (
                <PendingTranscriptTurn key={`draft-queued-${p.id}`} item={p} nowMs={nowMs} />
              ))}
            </div>
          </div>
        ) : !createWithChat ? (
          <EmptyState
            icon={<IconChat className="w-8 h-8 text-[var(--muted)]" />}
            title="Create without a chat"
            description="This creates the drone runtime now. You can start one or more chats later from the drone workspace."
          />
        ) : (
          <EmptyState
            icon={<IconChat className="w-8 h-8 text-[var(--muted)]" />}
            title="Start with a message"
            description="Sending creates a new untitled drone immediately, then auto-renames it."
          />
        )}
      </div>
      {createWithChat || draftChat.prompt ? (
        <ChatInput
          resetKey={draftChatInputResetKey(draftChat)}
          droneName="new drone"
          promptError={draftCreateError}
          sending={draftCreating || draftAutoRenaming}
          waiting={Boolean(draftChat.prompt)}
          autoFocus={!draftCreating && !draftAutoRenaming && !draftChat.prompt}
          attachmentsEnabled={false}
          automationActions={draftAutomationActions}
          onSend={async (payload: ChatSendPayload) => {
            if (!draftChat.prompt) return await onStartDraftPrompt(payload);
            const droneId = String(draftChat.droneId ?? '').trim();
            if (!droneId) {
              onSetDraftCreateError('Drone is still being created. Please wait a moment.');
              return false;
            }
            const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
            if (attachments.length > 0) {
              onSetDraftCreateError('Image attachments are only supported after the drone is created.');
              return false;
            }
            const prompt = String(payload?.prompt ?? '').trim();
            if (!prompt) return false;
            onEnqueueQueuedPrompt(droneId, 'default', prompt);
            onSetDraftCreateError(null);
            return true;
          }}
        />
      ) : (
        <div className="flex-shrink-0 border-t border-[var(--border)] bg-[var(--panel-alt)] px-5 py-4">
          <div className="mx-auto max-w-[1275px] flex items-center justify-between gap-3">
            <div className="text-[11px] text-[var(--muted-dim)]">
              Create the drone now and add chats later from its workspace.
            </div>
            <button
              type="button"
              onClick={() => {
                void onCreateEmptyDrone();
              }}
              disabled={draftCreating || draftAutoRenaming}
              className={`inline-flex items-center gap-2 h-9 px-4 rounded border text-[11px] font-semibold tracking-wide uppercase transition-all ${
                draftCreating || draftAutoRenaming
                  ? 'opacity-50 cursor-not-allowed bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)]'
                  : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
              }`}
              style={{ fontFamily: 'var(--display)' }}
            >
              {draftCreating ? 'Creating...' : 'Create drone'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
