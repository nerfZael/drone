import React from 'react';
import type { ChatAgentConfig } from '../../domain';
import { isValidDroneNameDashCase } from '../../domain';
import type { DroneSummary } from '../types';
import { droneNameHasWhitespace } from './name-helpers';
import { IconChevron, IconSpinner, IconTrash } from './icons';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/menuSelect';

type CreateDronesModalProps = {
  open: boolean;
  creating: boolean;
  createMode: 'create' | 'clone';
  cloneSourceId: string | null;
  createNameEntries: string[];
  drones: DroneSummary[];
  createError: string | null;
  createGroup: string;
  onCreateGroupChange: (value: string) => void;
  onClearCreateGroup: () => void;
  createRepoPath: string;
  onCreateRepoPathChange: (value: string) => void;
  onClearCreateRepoPath: () => void;
  createRepoMenuEntries: UiMenuSelectEntry[];
  createRepoMenuOpen: boolean;
  onCreateRepoMenuOpenChange: (open: boolean) => void;
  registeredRepoPaths: string[];
  activeRepoPath: string;
  cloneIncludeChats: boolean;
  onCloneIncludeChatsChange: (checked: boolean) => void;
  spawnAgentKey: string;
  onSpawnAgentKeyChange: (value: string) => void;
  spawnAgentMenuEntries: UiMenuSelectEntry[];
  onOpenCustomAgentModal: () => void;
  spawnModel: string;
  onSpawnModelChange: (value: string) => void;
  onClearSpawnModel: () => void;
  spawnAgentConfig: ChatAgentConfig;
  createInitialMessage: string;
  onCreateInitialMessageChange: (value: string) => void;
  onClearCreateInitialMessage: () => void;
  createNameRows: string[];
  createMessageSuffixRows: string[];
  createNameCounts: Map<string, number>;
  onAppendCreateNameRow: () => void;
  onUpdateCreateNameRow: (index: number, value: string) => void;
  onUpdateCreateMessageSuffixRow: (index: number, value: string) => void;
  onRemoveCreateNameRow: (index: number) => void;
  createNameRef: React.Ref<HTMLInputElement>;
  onSubmitCreate: () => void;
  onRequestClose: () => void;
};

export function CreateDronesModal({
  open,
  creating,
  createMode,
  cloneSourceId,
  createNameEntries,
  drones,
  createError,
  createGroup,
  onCreateGroupChange,
  onClearCreateGroup,
  createRepoPath,
  onCreateRepoPathChange,
  onClearCreateRepoPath,
  createRepoMenuEntries,
  createRepoMenuOpen,
  onCreateRepoMenuOpenChange,
  registeredRepoPaths,
  activeRepoPath,
  cloneIncludeChats,
  onCloneIncludeChatsChange,
  spawnAgentKey,
  onSpawnAgentKeyChange,
  spawnAgentMenuEntries,
  onOpenCustomAgentModal,
  spawnModel,
  onSpawnModelChange,
  onClearSpawnModel,
  spawnAgentConfig,
  createInitialMessage,
  onCreateInitialMessageChange,
  onClearCreateInitialMessage,
  createNameRows,
  createMessageSuffixRows,
  createNameCounts,
  onAppendCreateNameRow,
  onUpdateCreateNameRow,
  onUpdateCreateMessageSuffixRow,
  onRemoveCreateNameRow,
  createNameRef,
  onSubmitCreate,
  onRequestClose,
}: CreateDronesModalProps) {
  if (!open) return null;

  const cloneSourceName =
    createMode === 'clone' && cloneSourceId
      ? String(drones.find((d) => d.id === cloneSourceId)?.name ?? cloneSourceId)
      : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,.55)] backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-[760px] rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.35)] overflow-hidden animate-slide-up relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[var(--accent)] via-[var(--accent-muted)] to-transparent opacity-40" />
        <form
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              e.stopPropagation();
              if (creating) return;
              onSubmitCreate();
              return;
            }
            const t = e.target as unknown;
            if (t instanceof HTMLTextAreaElement) return;
            if (t instanceof HTMLSelectElement) return;
            e.preventDefault();
            e.stopPropagation();
          }}
          onSubmit={(e) => {
            e.preventDefault();
            if (creating) return;
            onSubmitCreate();
          }}
        >
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-sm text-[var(--fg)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
                {createMode === 'clone' ? 'Clone drones' : 'Create drones'}
              </div>
              <div className="text-[10px] text-[var(--muted)] mt-0.5 font-mono">
                {createNameEntries.length} drone{createNameEntries.length === 1 ? '' : 's'} ready
              </div>
              {cloneSourceName && (
                <div className="text-[10px] text-[var(--muted)] mt-1 truncate font-mono" title={`Source: ${cloneSourceName}`}>
                  source: {cloneSourceName}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={creating || createNameEntries.length === 0}
                className={`h-8 px-4 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                  creating || createNameEntries.length === 0
                    ? 'opacity-70 cursor-wait bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)]'
                    : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title={createMode === 'clone' ? 'Clone all drones in this list' : 'Create all drones in this list'}
              >
                {creating ? (
                  <span className="inline-flex items-center gap-2">
                    <IconSpinner className="w-3.5 h-3.5" />
                    {createMode === 'clone' ? 'Cloning…' : 'Creating…'}
                  </span>
                ) : (
                  createMode === 'clone' ? 'Clone all' : 'Create all'
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (creating) return;
                  onRequestClose();
                }}
                className="inline-flex items-center justify-center w-7 h-7 rounded border border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] transition-colors"
                title="Close"
                aria-label="Close"
              >
                ×
              </button>
            </div>
          </div>
          <div className="px-5 py-4 max-h-[70vh] overflow-auto">
            {createError && (
              <div className="mb-4 p-3 rounded border border-[rgba(255,90,90,.15)] bg-[var(--red-subtle)] text-xs text-[var(--red)] whitespace-pre-wrap">
                {createError}
              </div>
            )}
            <div className="mb-4">
              <div className="text-[10px] font-semibold text-[var(--muted-dim)] mb-1.5 tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                Group for created drones
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={createGroup}
                  onChange={(e) => onCreateGroupChange(e.target.value)}
                  className="flex-1 h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors"
                  placeholder="e.g. auth, billing, frontend"
                  disabled={creating}
                />
                <button
                  type="button"
                  onClick={onClearCreateGroup}
                  className="h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--muted)]"
                  style={{ fontFamily: 'var(--display)' }}
                  title="Clear group"
                  disabled={creating}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="mb-4">
              <div className="text-[10px] font-semibold text-[var(--muted-dim)] mb-1.5 tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                Repo path for created drones (optional)
              </div>
              <div className="flex items-center gap-2">
                <UiMenuSelect
                  variant="form"
                  value={createRepoPath}
                  onValueChange={onCreateRepoPathChange}
                  entries={createRepoMenuEntries}
                  open={createRepoMenuOpen}
                  onOpenChange={onCreateRepoMenuOpenChange}
                  disabled={creating}
                  triggerClassName="flex-1"
                  panelClassName="right-auto w-[720px] max-w-[calc(100vw-3rem)]"
                  title={createRepoPath || 'No repo'}
                  triggerLabel={createRepoPath || 'No repo'}
                  triggerLabelClassName={createRepoPath ? 'font-mono text-[12px]' : undefined}
                  chevron={(menuOpen) => <IconChevron down={!menuOpen} className="text-[var(--muted-dim)] opacity-70 flex-shrink-0" />}
                  menuClassName="max-h-[220px] overflow-y-auto"
                />
                <button
                  type="button"
                  onClick={onClearCreateRepoPath}
                  className="h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--muted)]"
                  style={{ fontFamily: 'var(--display)' }}
                  title="Clear repo path"
                  disabled={creating}
                >
                  Clear
                </button>
              </div>
              {registeredRepoPaths.length === 0 ? (
                <span className="text-[10px] text-[var(--muted-dim)] block mt-1">
                  No repos registered yet. Add one from the Repos menu in the sidebar.
                </span>
              ) : (
                <span className="text-[10px] text-[var(--muted-dim)] block mt-1">
                  Choose a registered repo, or leave this set to No repo.
                </span>
              )}
              {createMode === 'create' && String(activeRepoPath ?? '').trim() && !String(createRepoPath ?? '').trim() && (
                <span className="text-[10px] text-[var(--muted-dim)] block mt-1">
                  Tip: you have an active repo selected in the sidebar. Click it again to unselect.
                </span>
              )}
            </div>

            {createMode === 'clone' && (
              <div className="mb-4">
                <label className="flex items-center gap-2 select-none">
                  <input
                    type="checkbox"
                    className="accent-[var(--accent)]"
                    checked={cloneIncludeChats}
                    onChange={(e) => onCloneIncludeChatsChange(e.target.checked)}
                    disabled={creating}
                  />
                  <span className="text-[11px] text-[var(--muted)]">Include chats (copy transcript history)</span>
                </label>
              </div>
            )}

            <div className="mb-4">
              <div className="text-[10px] font-semibold text-[var(--muted-dim)] mb-1.5 tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                Agent for created drones
              </div>
              <div className="flex items-center gap-2">
                <UiMenuSelect
                  variant="form"
                  value={spawnAgentKey}
                  onValueChange={onSpawnAgentKeyChange}
                  entries={spawnAgentMenuEntries}
                  disabled={creating || (createMode === 'clone' && cloneIncludeChats)}
                  triggerClassName="flex-1"
                  panelClassName="right-auto w-[460px] max-w-[calc(100vw-3rem)]"
                  title="Choose which agent implementation to use for the default chat in all created drones."
                  chevron={(menuOpen) => <IconChevron down={!menuOpen} className="text-[var(--muted-dim)] opacity-70 flex-shrink-0" />}
                />
                <button
                  type="button"
                  onClick={onOpenCustomAgentModal}
                  disabled={creating || (createMode === 'clone' && cloneIncludeChats)}
                  className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                    creating || (createMode === 'clone' && cloneIncludeChats)
                      ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                      : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                  title="Manage saved custom agents"
                >
                  Custom…
                </button>
              </div>
              <span className="text-[10px] text-[var(--muted-dim)] block mt-1">
                {createMode === 'clone' && cloneIncludeChats
                  ? 'When cloning chats, agents are copied from the source chats.'
                  : 'Used for the default chat. You can change per-chat later.'}
              </span>
            </div>

            <div className="mb-4">
              <div className="text-[10px] font-semibold text-[var(--muted-dim)] mb-1.5 tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                Model for created drones (optional)
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={spawnModel}
                  onChange={(e) => onSpawnModelChange(e.target.value)}
                  className={`h-9 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 text-[13px] font-mono text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none ${
                    creating || (createMode === 'clone' && cloneIncludeChats) || spawnAgentConfig.kind !== 'builtin'
                      ? 'opacity-50 cursor-not-allowed'
                      : ''
                  }`}
                  placeholder="Default model"
                  disabled={creating || (createMode === 'clone' && cloneIncludeChats) || spawnAgentConfig.kind !== 'builtin'}
                />
                <button
                  type="button"
                  onClick={onClearSpawnModel}
                  disabled={creating || (createMode === 'clone' && cloneIncludeChats) || spawnAgentConfig.kind !== 'builtin' || !spawnModel.trim()}
                  className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                    creating || (createMode === 'clone' && cloneIncludeChats) || spawnAgentConfig.kind !== 'builtin' || !spawnModel.trim()
                      ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                      : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                >
                  Clear
                </button>
              </div>
              <span className="text-[10px] text-[var(--muted-dim)] block mt-1">
                {createMode === 'clone' && cloneIncludeChats
                  ? 'When cloning chats, model settings are copied from the source chats.'
                  : spawnAgentConfig.kind === 'builtin'
                    ? 'Leave empty to use each agent’s default model.'
                    : 'Custom agents manage model selection in their own CLI.'}
              </span>
            </div>

            <div className="mb-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold text-[var(--muted)]">
                  Initial message (sent to every created drone before any per-drone suffix)
                </div>
                <button
                  type="button"
                  onClick={onClearCreateInitialMessage}
                  className="text-[11px] font-semibold text-[var(--accent)] hover:text-[var(--fg)] hover:underline underline-offset-2 transition-colors disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                  title="Clear initial message"
                  disabled={creating}
                >
                  Clear
                </button>
              </div>
              <textarea
                value={createInitialMessage}
                onChange={(e) => onCreateInitialMessageChange(e.target.value)}
                rows={2}
                className="w-full min-h-[56px] resize-y rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 py-2 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none"
                placeholder="If provided, it will be sent once each drone is ready."
                disabled={creating}
              />
            </div>

            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                Drones to create
              </div>
              <button
                type="button"
                onClick={onAppendCreateNameRow}
                disabled={creating}
                className="h-8 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--muted)]"
                style={{ fontFamily: 'var(--display)' }}
                title="Add another drone"
              >
                Add drone
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {createNameRows.map((nameRaw, idx) => {
                const rawName = String(nameRaw ?? '');
                const name = rawName.trim();
                const messageSuffix = String(createMessageSuffixRows[idx] ?? '');
                const invalidName = Boolean(rawName) && (droneNameHasWhitespace(rawName) || !isValidDroneNameDashCase(name));
                const dupName = Boolean(name) && (createNameCounts.get(name) ?? 0) > 1;
                return (
                  <div key={`create-row-${idx}`} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] font-semibold text-[var(--muted-dim)]">Drone name (dash-case)</span>
                          <input
                            ref={idx === 0 ? createNameRef : null}
                            autoFocus={idx === 0}
                            value={nameRaw}
                            onChange={(e) => onUpdateCreateNameRow(idx, e.target.value)}
                            className={`w-full h-9 rounded-lg border bg-[var(--panel-raised)] px-3 text-[13px] font-mono text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none ${
                              invalidName || dupName ? 'border-[rgba(248,81,73,.35)]' : 'border-[var(--border-subtle)]'
                            }`}
                            placeholder="e.g. split-server-app"
                            disabled={creating}
                          />
                          {(invalidName || dupName) && (
                            <span className="text-[10px] text-[var(--red)]">
                              {dupName ? 'Duplicate name in list.' : 'Invalid name. Use dash-case with no spaces, max 48 chars.'}
                            </span>
                          )}
                        </label>
                        <label className="flex flex-col gap-1 mt-2">
                          <span className="text-[10px] font-semibold text-[var(--muted-dim)]">
                            Per-drone message suffix (optional)
                          </span>
                          <textarea
                            value={messageSuffix}
                            onChange={(e) => onUpdateCreateMessageSuffixRow(idx, e.target.value)}
                            rows={2}
                            className="w-full min-h-[56px] resize-y rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 py-2 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none"
                            placeholder="Appended after the initial message for this drone."
                            disabled={creating}
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveCreateNameRow(idx)}
                        disabled={creating || createNameRows.length <= 1}
                        className={`flex-shrink-0 h-8 px-3 rounded-lg text-[12px] font-semibold border transition-colors ${
                          creating || createNameRows.length <= 1
                            ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                            : 'bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                        }`}
                        title={createNameRows.length <= 1 ? 'At least one row is required' : 'Remove row'}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <IconTrash className="w-3.5 h-3.5 opacity-90" />
                          Remove
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {createNameEntries.length === 0 && (
              <div className="mt-2 text-[11px] text-[var(--muted-dim)]">Add at least one valid drone name.</div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
