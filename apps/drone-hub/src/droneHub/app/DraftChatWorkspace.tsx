import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChatInput, type ChatSendPayload, EmptyState, PendingTranscriptTurn } from '../chat';
import { droneChatQueueKey } from './helpers';
import { IconChat, IconChevron } from './icons';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/menuSelect';
import type { ChatAgentConfig } from '../../domain';
import type { PendingPrompt } from '../types';
import type { DraftChatState } from './app-types';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';

type DraftChatWorkspaceProps = {
  draftChat: DraftChatState;
  nowMs: number;
  spawnAgentMenuEntries: UiMenuSelectEntry[];
  draftCreating: boolean;
  draftAutoRenaming: boolean;
  spawnAgentConfig: ChatAgentConfig;
  createRepoMenuEntries: UiMenuSelectEntry[];
  draftCreateGroup: string;
  draftCreateError: string | null;
  queuedPromptsByDroneChat: Record<string, PendingPrompt[]>;
  onCancel: () => void;
  onStartDraftPrompt: (payload: ChatSendPayload) => Promise<boolean>;
  onEnqueueQueuedPrompt: (droneId: string, chatName: string, prompt: string) => void;
  onDraftCreateGroupChange: (value: string) => void;
  onSetDraftCreateError: (error: string | null) => void;
};

export function DraftChatWorkspace({
  draftChat,
  nowMs,
  spawnAgentMenuEntries,
  draftCreating,
  draftAutoRenaming,
  spawnAgentConfig,
  createRepoMenuEntries,
  draftCreateGroup,
  draftCreateError,
  queuedPromptsByDroneChat,
  onCancel,
  onStartDraftPrompt,
  onEnqueueQueuedPrompt,
  onDraftCreateGroupChange,
  onSetDraftCreateError,
}: DraftChatWorkspaceProps) {
  const {
    spawnAgentKey,
    spawnModel,
    chatHeaderRepoPath,
    setSpawnAgentKey,
    setSpawnModel,
    setChatHeaderRepoPath,
    setCustomAgentModalOpen,
  } = useDroneHubUiStore(
    useShallow((s) => ({
      spawnAgentKey: s.spawnAgentKey,
      spawnModel: s.spawnModel,
      chatHeaderRepoPath: s.chatHeaderRepoPath,
      setSpawnAgentKey: s.setSpawnAgentKey,
      setSpawnModel: s.setSpawnModel,
      setChatHeaderRepoPath: s.setChatHeaderRepoPath,
      setCustomAgentModalOpen: s.setCustomAgentModalOpen,
    })),
  );

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
                    New chat
                  </span>
                </div>
                <div className="text-[10px] text-[var(--muted)] mt-0.5">
                  {draftChat.prompt
                    ? 'Creating your drone. Any new messages you send will queue and auto-send when it is ready.'
                    : 'Send your first message to create a new drone instantly.'}
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
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                Agent
              </span>
              <UiMenuSelect
                variant="toolbar"
                value={spawnAgentKey}
                onValueChange={setSpawnAgentKey}
                entries={spawnAgentMenuEntries}
                disabled={draftCreating || draftAutoRenaming || Boolean(draftChat.prompt)}
                triggerClassName="min-w-[170px] max-w-[240px]"
                panelClassName="w-[320px]"
                title="Choose agent for this new drone."
                chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
              />
              <button
                type="button"
                onClick={() => setCustomAgentModalOpen(true)}
                disabled={draftCreating || draftAutoRenaming || Boolean(draftChat.prompt)}
                className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
                  draftCreating || draftAutoRenaming || Boolean(draftChat.prompt)
                    ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                    : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title="Manage custom agents"
              >
                Custom
              </button>
            </div>
            {spawnAgentConfig.kind === 'builtin' && (
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
                  disabled={draftCreating || draftAutoRenaming || Boolean(draftChat.prompt)}
                  placeholder="Default model"
                  className={`h-[28px] w-[170px] rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[11px] text-[var(--muted)] placeholder:text-[var(--muted-dim)] focus:outline-none transition-all font-mono ${
                    draftCreating || draftAutoRenaming || Boolean(draftChat.prompt)
                      ? 'opacity-40 cursor-not-allowed'
                      : 'hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
                  }`}
                  title="Set default model for this new drone chat."
                />
                <button
                  type="button"
                  onClick={() => setSpawnModel('')}
                  disabled={draftCreating || draftAutoRenaming || Boolean(draftChat.prompt) || !spawnModel.trim()}
                  className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
                    draftCreating || draftAutoRenaming || Boolean(draftChat.prompt) || !spawnModel.trim()
                      ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                      : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                  title="Clear model override"
                >
                  Clear
                </button>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                Repo
              </span>
              <UiMenuSelect
                variant="toolbar"
                value={chatHeaderRepoPath}
                onValueChange={setChatHeaderRepoPath}
                entries={createRepoMenuEntries}
                disabled={draftCreating || draftAutoRenaming || Boolean(draftChat.prompt)}
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
                disabled={draftCreating || draftAutoRenaming || Boolean(draftChat.prompt)}
                placeholder="Optional group"
                className={`h-[28px] w-[170px] rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[11px] text-[var(--muted)] placeholder:text-[var(--muted-dim)] focus:outline-none transition-all ${
                  draftCreating || draftAutoRenaming || Boolean(draftChat.prompt)
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
                }`}
                title="Set group for this new drone."
              />
              <button
                type="button"
                onClick={() => onDraftCreateGroupChange('')}
                disabled={draftCreating || draftAutoRenaming || Boolean(draftChat.prompt) || !draftCreateGroup.trim()}
                className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
                  draftCreating || draftAutoRenaming || Boolean(draftChat.prompt) || !draftCreateGroup.trim()
                    ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                    : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title="Clear group"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {draftChat.prompt ? (
          <div className="px-5 py-5">
            <div className="mx-auto max-w-[980px] space-y-5">
              <PendingTranscriptTurn item={draftChat.prompt} nowMs={nowMs} />
              {(draftChat.droneId ? queuedPromptsByDroneChat[droneChatQueueKey(draftChat.droneId, 'default')] ?? [] : []).map((p) => (
                <PendingTranscriptTurn key={`draft-queued-${p.id}`} item={p} nowMs={nowMs} />
              ))}
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<IconChat className="w-8 h-8 text-[var(--muted)]" />}
            title="Start with a message"
            description="Sending creates a new untitled drone immediately, then auto-renames it."
          />
        )}
      </div>
      <ChatInput
        // Keep the draft prompt if only the selected agent changes.
        resetKey={`draft:${draftChat.prompt?.id ?? ''}`}
        droneName="new drone"
        promptError={draftCreateError}
        sending={draftCreating || draftAutoRenaming}
        waiting={Boolean(draftChat.prompt)}
        autoFocus={!draftCreating && !draftAutoRenaming && !draftChat.prompt}
        attachmentsEnabled={false}
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
    </div>
  );
}
