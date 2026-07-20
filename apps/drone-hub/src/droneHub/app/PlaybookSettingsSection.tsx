import React from 'react';
import type { ChatAgentConfig } from '../../domain';
import { UiMenuSelect } from '../../ui/menuSelect';
import { requestJson } from '../http';
import type { CustomAgentProfile, PlaybookDefinition } from '../types';
import { BUILTIN_AGENT_OPTIONS } from './app-config';
import { makeId } from './helpers';
import { PlaybookActionListEditor, PlaybookMessageListEditor, PlaybookTextListEditor } from './PlaybookSettingsEditors';
import {
  createPlaybookDefinition,
  normalizePlaybookActionLabel,
  normalizePlaybookAgent,
  normalizePlaybookArtifactPath,
  normalizePlaybookLabel,
  normalizePlaybookModel,
  PLAYBOOK_ACTION_LABEL_MAX_CHARS,
  PLAYBOOK_MAX_ITEMS,
  PLAYBOOK_MAX_ACTIONS,
  PLAYBOOK_MAX_MESSAGES,
  PLAYBOOK_LABEL_MAX_CHARS,
  PLAYBOOK_MODEL_MAX_CHARS,
  PLAYBOOK_MESSAGE_MAX_CHARS,
} from './playbook-config';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';

type EditablePlaybook = PlaybookDefinition & {
  clientId: string;
};

type PlaybookSettingsSectionProps = {
  focusedPlaybookId?: string | null;
  onFocusedPlaybookHandled?: () => void;
};

function playbookAgentKey(agent: ChatAgentConfig | null | undefined): string {
  if (agent?.kind === 'native') return 'native';
  if (agent?.kind === 'builtin') return `builtin:${agent.id}`;
  if (agent?.kind === 'custom') return `custom:${agent.id}`;
  return 'builtin:cursor';
}

function playbookAgentLabel(agent: ChatAgentConfig | null | undefined, customAgents: CustomAgentProfile[]): string {
  if (agent?.kind === 'native') return 'Built-in';
  if (agent?.kind === 'builtin') {
    return BUILTIN_AGENT_OPTIONS.find((option) => option.agent.kind === 'builtin' && option.agent.id === agent.id)?.label ?? `Builtin: ${agent.id}`;
  }
  if (agent?.kind === 'custom') {
    const local = customAgents.find((item) => item.id === agent.id) ?? null;
    return local ? `Custom: ${local.label}` : `Custom: ${agent.label}`;
  }
  return 'Cursor Agent';
}

function resolvePlaybookAgentFromKey(keyRaw: string, customAgents: CustomAgentProfile[]): ChatAgentConfig {
  const key = String(keyRaw ?? '').trim();
  const builtin = BUILTIN_AGENT_OPTIONS.find((option) => option.key === key);
  if (builtin) return builtin.agent;
  if (key.startsWith('custom:')) {
    const id = key.slice('custom:'.length);
    const custom = customAgents.find((item) => item.id === id) ?? null;
    if (custom) return { kind: 'custom', id: custom.id, label: custom.label, command: custom.command };
  }
  return { kind: 'builtin', id: 'cursor' };
}

function createEditablePlaybook(seed?: Partial<PlaybookDefinition>): EditablePlaybook {
  const playbook = createPlaybookDefinition(seed);
  return {
    ...playbook,
    clientId: `playbook-${playbook.id || makeId()}`,
    id: playbook.id || `local-${makeId()}`,
    agent: normalizePlaybookAgent(playbook.agent),
    model: playbook.model ?? null,
    messages: playbook.messages.length > 0 ? playbook.messages : [{ id: `message-${makeId()}`, name: null, prompt: '' }],
    artifacts: playbook.artifacts ?? [],
    actions: playbook.actions ?? [],
  };
}

function normalizeDraftForSave(playbook: EditablePlaybook): PlaybookDefinition {
  return createPlaybookDefinition({
    ...playbook,
    agent: playbook.agent,
    model: playbook.model,
    messages: playbook.messages,
    artifacts: playbook.artifacts,
    actions: playbook.actions,
  });
}

function patchEditablePlaybook(current: EditablePlaybook, patch: Partial<PlaybookDefinition>): EditablePlaybook {
  const nextAgent = Object.prototype.hasOwnProperty.call(patch, 'agent') ? normalizePlaybookAgent(patch.agent) : normalizePlaybookAgent(current.agent);
  return {
    ...current,
    ...(Object.prototype.hasOwnProperty.call(patch, 'label')
      ? { label: String(patch.label ?? '').slice(0, PLAYBOOK_LABEL_MAX_CHARS) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'agent') ? { agent: nextAgent } : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'agent') || Object.prototype.hasOwnProperty.call(patch, 'model')
      ? {
          model: normalizePlaybookModel(
            Object.prototype.hasOwnProperty.call(patch, 'model') ? patch.model : current.model,
            nextAgent,
          ),
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'messages')
      ? {
          messages: (Array.isArray(patch.messages) ? patch.messages : [])
            .slice(0, PLAYBOOK_MAX_MESSAGES)
            .map((item, index) => ({
              id: String(item?.id ?? '').trim() || `message-${index + 1}`,
              name: typeof item?.name === 'string' && String(item.name).trim() ? String(item.name).trim() : null,
              prompt: String(item?.prompt ?? '').slice(0, PLAYBOOK_MESSAGE_MAX_CHARS),
            })),
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'artifacts')
      ? {
          artifacts: (Array.isArray(patch.artifacts) ? patch.artifacts : [])
            .slice(0, PLAYBOOK_MAX_ITEMS)
            .map((item) => {
              const raw = String(item ?? '');
              return raw.trim() ? normalizePlaybookArtifactPath(raw) : '';
            }),
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(patch, 'actions')
      ? {
          actions: (Array.isArray(patch.actions) ? patch.actions : []).slice(0, PLAYBOOK_MAX_ACTIONS).map((item) => ({
            id: String(item?.id ?? '').trim() || `action-${makeId()}`,
            label: String(item?.label ?? '').slice(0, PLAYBOOK_ACTION_LABEL_MAX_CHARS),
            messages: (Array.isArray(item?.messages) ? item.messages : [])
              .slice(0, PLAYBOOK_MAX_MESSAGES)
              .map((message) => String(message ?? '').slice(0, PLAYBOOK_MESSAGE_MAX_CHARS)),
          })),
        }
      : {}),
  };
}

function isUnsavedPlaybook(playbook: EditablePlaybook): boolean {
  return playbook.id.startsWith('local-');
}

function validateEditablePlaybookForSave(playbook: EditablePlaybook): string | null {
  const label = normalizePlaybookLabel(playbook.label);
  if (!label) return 'Each playbook needs a label.';

  const blankMessageIndex = playbook.messages.findIndex((message) => !String(message?.prompt ?? '').trim());
  if (blankMessageIndex >= 0) {
    return `"${label}" has an empty run message at row ${blankMessageIndex + 1}. Fill it in or delete it before saving.`;
  }

  if (playbook.messages.length === 0) {
    return `"${label}" needs at least one message.`;
  }

  const blankArtifactIndex = playbook.artifacts.findIndex((artifact) => !String(artifact ?? '').trim());
  if (blankArtifactIndex >= 0) {
    return `"${label}" has an empty artifact path at row ${blankArtifactIndex + 1}. Fill it in or delete it before saving.`;
  }

  const incompleteActionIndex = playbook.actions.findIndex((action) => {
    const actionLabel = String(action?.label ?? '').trim();
    if (!actionLabel) return true;
    if (!Array.isArray(action?.messages) || action.messages.length === 0) return true;
    return action.messages.some((message) => !String(message ?? '').trim());
  });
  if (incompleteActionIndex >= 0) {
    return `"${label}" has an incomplete action at row ${incompleteActionIndex + 1}. Each action needs a button label and one or more queued messages before saving.`;
  }

  return null;
}

export function PlaybookSettingsSection({
  focusedPlaybookId = null,
  onFocusedPlaybookHandled,
}: PlaybookSettingsSectionProps) {
  const customAgents = useDroneHubUiStore((state) => state.customAgents);
  const [playbooks, setPlaybooks] = React.useState<EditablePlaybook[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [savingById, setSavingById] = React.useState<Record<string, true>>({});
  const [deletingById, setDeletingById] = React.useState<Record<string, true>>({});
  const [expandedByClientId, setExpandedByClientId] = React.useState<Record<string, true>>({});
  const baseAgentMenuEntries = React.useMemo(
    () => [
      ...BUILTIN_AGENT_OPTIONS.map((option) => ({ value: option.key, label: option.label })),
      ...(customAgents.length > 0
        ? [
            { kind: 'separator' as const },
            ...customAgents.map((agent) => ({ value: `custom:${agent.id}`, label: `Custom: ${agent.label}` })),
          ]
        : []),
    ],
    [customAgents],
  );

  const loadPlaybooks = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await requestJson<{ ok: true; playbooks: PlaybookDefinition[] }>('/api/playbooks');
      setPlaybooks((Array.isArray(data.playbooks) ? data.playbooks : []).map((item) => createEditablePlaybook(item)));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadPlaybooks();
  }, [loadPlaybooks]);

  React.useEffect(() => {
    if (loading || !focusedPlaybookId) return;
    const target = playbooks.find((playbook) => playbook.id === focusedPlaybookId) ?? null;
    if (target) {
      setExpandedByClientId((prev) => (prev[target.clientId] ? prev : { ...prev, [target.clientId]: true }));
      const targetId = `playbook-settings-${focusedPlaybookId}`;
      window.requestAnimationFrame(() => {
        document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
    onFocusedPlaybookHandled?.();
  }, [focusedPlaybookId, loading, onFocusedPlaybookHandled, playbooks]);

  const toggleExpanded = React.useCallback((clientId: string) => {
    setExpandedByClientId((prev) => {
      if (prev[clientId]) {
        const next = { ...prev };
        delete next[clientId];
        return next;
      }
      return { ...prev, [clientId]: true };
    });
  }, []);

  const updatePlaybook = React.useCallback((clientId: string, patch: Partial<PlaybookDefinition>) => {
    setPlaybooks((prev) =>
      prev.map((item) => (item.clientId === clientId ? patchEditablePlaybook(item, patch) : item)),
    );
  }, []);

  const addPlaybook = React.useCallback(() => {
    const created = createEditablePlaybook({
      label: '',
      agent: { kind: 'builtin', id: 'cursor' },
      model: null,
      messages: [{ id: `message-${makeId()}`, name: null, prompt: '' }],
      artifacts: [],
      actions: [],
    });
    setPlaybooks((prev) => [created, ...prev]);
    setExpandedByClientId((prev) => ({ ...prev, [created.clientId]: true }));
  }, []);

  const removePlaybook = React.useCallback(async (playbook: EditablePlaybook) => {
    if (isUnsavedPlaybook(playbook)) {
      setPlaybooks((prev) => prev.filter((item) => item.clientId !== playbook.clientId));
      setExpandedByClientId((prev) => {
        if (!prev[playbook.clientId]) return prev;
        const next = { ...prev };
        delete next[playbook.clientId];
        return next;
      });
      return;
    }
    setDeletingById((prev) => ({ ...prev, [playbook.clientId]: true }));
    setError(null);
    try {
      await requestJson(`/api/playbooks/${encodeURIComponent(playbook.id)}`, { method: 'DELETE' });
      setPlaybooks((prev) => prev.filter((item) => item.clientId !== playbook.clientId));
      setExpandedByClientId((prev) => {
        if (!prev[playbook.clientId]) return prev;
        const next = { ...prev };
        delete next[playbook.clientId];
        return next;
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setDeletingById((prev) => {
        const next = { ...prev };
        delete next[playbook.clientId];
        return next;
      });
    }
  }, []);

  const savePlaybook = React.useCallback(async (playbook: EditablePlaybook) => {
    const validationError = validateEditablePlaybookForSave(playbook);
    if (validationError) {
      setError(validationError);
      return;
    }
    const next = normalizeDraftForSave(playbook);
    setSavingById((prev) => ({ ...prev, [playbook.clientId]: true }));
    setError(null);
    try {
      const data = isUnsavedPlaybook(playbook)
        ? await requestJson<{ ok: true; playbook: PlaybookDefinition }>('/api/playbooks', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(next),
          })
        : await requestJson<{ ok: true; playbook: PlaybookDefinition }>(`/api/playbooks/${encodeURIComponent(playbook.id)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(next),
          });
      const saved = createEditablePlaybook(data.playbook);
      setPlaybooks((prev) => prev.map((item) => (item.clientId === playbook.clientId ? saved : item)));
      setExpandedByClientId((prev) => {
        if (!prev[playbook.clientId]) return prev;
        const next = { ...prev };
        delete next[playbook.clientId];
        next[saved.clientId] = true;
        return next;
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSavingById((prev) => {
        const nextBusy = { ...prev };
        delete nextBusy[playbook.clientId];
        return nextBusy;
      });
    }
  }, []);

  return (
    <div className="rounded border border-[var(--border-subtle)] bg-[var(--settings-section-bg)] px-3 py-3 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
            Playbooks
          </div>
          <div className="text-[var(--text-11)] text-[var(--muted-dim)] leading-relaxed mt-1">
            Define reusable message sequences for hidden repo runs, plus optional labeled follow-up buttons that can be sent from the runs table.
          </div>
        </div>
        <button
          type="button"
          onClick={addPlaybook}
          className="h-8 px-3 rounded text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110"
          style={{ fontFamily: 'var(--display)' }}
        >
          Add playbook
        </button>
      </div>

      {error && <div className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-11)] text-[var(--red)]">{error}</div>}

      {loading ? (
        <div className="rounded border border-[var(--border-subtle)] bg-[var(--settings-section-bg)] px-3 py-3 text-[var(--text-11)] text-[var(--muted-dim)]">
          Loading playbooks...
        </div>
      ) : playbooks.length === 0 ? (
        <div className="rounded border border-[var(--border-subtle)] bg-[var(--settings-section-bg)] px-3 py-3 text-[var(--text-11)] text-[var(--muted-dim)]">
          No playbooks yet. Create one here, then run it from the runs tab.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {playbooks.map((playbook, index) => {
            const busy = Boolean(savingById[playbook.clientId] || deletingById[playbook.clientId]);
            const expanded = Boolean(expandedByClientId[playbook.clientId]);
            const selectedAgentKey = playbookAgentKey(playbook.agent);
            const selectedAgentLabel = playbookAgentLabel(playbook.agent, customAgents);
            const customAgentId = playbook.agent.kind === 'custom' ? playbook.agent.id : null;
            const customAgentMissing = Boolean(customAgentId && !customAgents.some((agent) => agent.id === customAgentId));
            return (
              <div
                key={playbook.clientId}
                id={playbook.id ? `playbook-settings-${playbook.id}` : undefined}
                className="rounded border border-[var(--border-subtle)] bg-[var(--settings-section-bg)] px-3 py-3 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(playbook.clientId)}
                    className="min-w-0 text-left"
                    title={expanded ? 'Collapse playbook' : 'Expand playbook'}
                  >
                    <div className="text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                      Playbook #{index + 1}
                    </div>
                    <div className="text-[var(--text-12)] text-[var(--fg)] mt-1">
                      {playbook.label || 'Untitled playbook'}
                      <span className="text-[var(--muted-dim)]"> {expanded ? '[-]' : '[+]'}</span>
                    </div>
                    <div className="text-[var(--text-10)] text-[var(--muted-dim)] mt-1">
                      {playbook.messages.length} message{playbook.messages.length === 1 ? '' : 's'}, {playbook.artifacts.length} artifact{playbook.artifacts.length === 1 ? '' : 's'}, {playbook.actions.length} action{playbook.actions.length === 1 ? '' : 's'}
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(playbook.clientId)}
                      className="h-7 px-2 rounded text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase border bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                      style={{ fontFamily: 'var(--display)' }}
                    >
                      {expanded ? 'Collapse' : 'Expand'}
                    </button>
                  </div>
                </div>

                {expanded ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <div />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void savePlaybook(playbook)}
                          disabled={busy}
                          className={`h-7 px-2 rounded text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all ${
                            busy
                              ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                              : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                          }`}
                          style={{ fontFamily: 'var(--display)' }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => void removePlaybook(playbook)}
                          disabled={busy}
                          className={`h-7 px-2 rounded text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all ${
                            busy
                              ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                              : 'bg-[var(--red-subtle)] border-[var(--red-border)] text-[var(--red)] hover:bg-[var(--red-subtle)]'
                          }`}
                          style={{ fontFamily: 'var(--display)' }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-2 items-center">
                      <label className="text-[var(--text-11)] text-[var(--muted-dim)]">Label</label>
                      <input
                        type="text"
                        value={playbook.label}
                        onChange={(e) => updatePlaybook(playbook.clientId, { label: e.target.value })}
                        className="w-full h-9 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset-strong)] px-2 text-[var(--text-12)] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
                        placeholder="e.g. Find biggest bug"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-2 items-start">
                      <label className="text-[var(--text-11)] text-[var(--muted-dim)] pt-2">Agent</label>
                      <div className="flex flex-col gap-2">
                        <UiMenuSelect
                          value={selectedAgentKey}
                          onValueChange={(next) => {
                            const agent = resolvePlaybookAgentFromKey(next, customAgents);
                            updatePlaybook(playbook.clientId, { agent, ...(agent.kind === 'builtin' ? {} : { model: null }) });
                          }}
                          entries={baseAgentMenuEntries}
                          triggerLabel={selectedAgentLabel}
                          title="Choose which agent this playbook run should use."
                        />
                        <div className="text-[var(--text-10)] text-[var(--muted-dim)] leading-relaxed">
                          {playbook.agent.kind === 'builtin'
                            ? "Leave model empty to use this agent's default model."
                            : 'Custom agents manage model selection in their own CLI.'}
                        </div>
                        {customAgentMissing ? (
                          <div className="text-[var(--text-10)] text-[var(--red)] leading-relaxed">
                            This playbook references a custom agent that is not currently saved locally.
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {playbook.agent.kind === 'builtin' ? (
                      <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-2 items-center">
                        <label className="text-[var(--text-11)] text-[var(--muted-dim)]">Model</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={playbook.model ?? ''}
                            onChange={(e) => updatePlaybook(playbook.clientId, { model: e.target.value.slice(0, PLAYBOOK_MODEL_MAX_CHARS) })}
                            className="w-full h-9 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset-strong)] px-2 text-[var(--text-12)] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)] font-mono"
                            placeholder="Default model"
                          />
                          <button
                            type="button"
                            onClick={() => updatePlaybook(playbook.clientId, { model: null })}
                            disabled={!String(playbook.model ?? '').trim()}
                            className={`h-8 px-2 rounded text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all ${
                              !String(playbook.model ?? '').trim()
                                ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                            }`}
                            style={{ fontFamily: 'var(--display)' }}
                            title="Clear model override"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <div className="flex flex-col gap-2">
                      <PlaybookMessageListEditor
                        messages={playbook.messages}
                        addDisabled={playbook.messages.length >= PLAYBOOK_MAX_MESSAGES}
                        onAdd={() =>
                          updatePlaybook(playbook.clientId, {
                            messages: [...playbook.messages, { id: `message-${makeId()}`, name: null, prompt: '' }],
                          })
                        }
                        onUpdate={(messageId, patch) =>
                          updatePlaybook(playbook.clientId, {
                            messages: playbook.messages.map((item) => (item.id === messageId ? { ...item, ...patch } : item)),
                          })
                        }
                        onDelete={(messageId) => {
                          const next = playbook.messages.filter((item) => item.id !== messageId);
                          updatePlaybook(playbook.clientId, {
                            messages: next.length > 0 ? next : [{ id: `message-${makeId()}`, name: null, prompt: '' }],
                          });
                        }}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <PlaybookTextListEditor
                        title="Artifacts"
                        description="Optional repo-relative file paths to surface from each run when they exist."
                        items={playbook.artifacts}
                        emptyText="No artifact paths for this playbook."
                        addLabel="Add artifact"
                        addDisabled={playbook.artifacts.length >= PLAYBOOK_MAX_ITEMS}
                        placeholder="e.g. reports/bug-summary.md"
                        onAdd={() => updatePlaybook(playbook.clientId, { artifacts: [...playbook.artifacts, ''] })}
                        onChange={(artifactIndex, value) => {
                          const next = playbook.artifacts.slice();
                          next[artifactIndex] = value;
                          updatePlaybook(playbook.clientId, { artifacts: next });
                        }}
                        onDelete={(artifactIndex) => {
                          const next = playbook.artifacts.filter((_, idx) => idx !== artifactIndex);
                          updatePlaybook(playbook.clientId, { artifacts: next });
                        }}
                      />
                    </div>

                    <div className="flex flex-col gap-2">
                      <PlaybookActionListEditor
                        actions={playbook.actions}
                        addDisabled={playbook.actions.length >= PLAYBOOK_MAX_ACTIONS}
                        onAdd={() =>
                          updatePlaybook(playbook.clientId, {
                            actions: [...playbook.actions, { id: `action-${makeId()}`, label: '', messages: [''] }],
                          })
                        }
                        onUpdate={(actionId, patch) =>
                          updatePlaybook(playbook.clientId, {
                            actions: playbook.actions.map((item) => (item.id === actionId ? { ...item, ...patch } : item)),
                          })
                        }
                        onDelete={(actionId) =>
                          updatePlaybook(playbook.clientId, {
                            actions: playbook.actions.filter((item) => item.id !== actionId),
                          })
                        }
                      />
                    </div>
                  </>
                ) : (
                  <div className="text-[var(--text-11)] text-[var(--muted-dim)] whitespace-pre-wrap line-clamp-2">
                    {playbook.messages[0]?.prompt || 'No messages yet.'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
