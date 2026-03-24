import React from 'react';
import { requestJson } from '../http';
import type { PlaybookDefinition } from '../types';
import { makeId } from './helpers';
import { PlaybookActionListEditor, PlaybookTextListEditor } from './PlaybookSettingsEditors';
import {
  createPlaybookDefinition,
  patchPlaybookDefinition,
  PLAYBOOK_MAX_ITEMS,
  PLAYBOOK_MAX_ACTIONS,
  PLAYBOOK_MAX_MESSAGES,
} from './playbook-config';

type EditablePlaybook = PlaybookDefinition & {
  clientId: string;
};

function createEditablePlaybook(seed?: Partial<PlaybookDefinition>): EditablePlaybook {
  const playbook = createPlaybookDefinition(seed);
  return {
    ...playbook,
    clientId: `playbook-${playbook.id || makeId()}`,
    id: playbook.id || `local-${makeId()}`,
    messages: playbook.messages.length > 0 ? playbook.messages : [''],
    artifacts: playbook.artifacts ?? [],
    actions: playbook.actions ?? [],
  };
}

function normalizeDraftForSave(playbook: EditablePlaybook): PlaybookDefinition {
  return createPlaybookDefinition({
    ...playbook,
    messages: playbook.messages,
    artifacts: playbook.artifacts,
    actions: playbook.actions,
  });
}

function isUnsavedPlaybook(playbook: EditablePlaybook): boolean {
  return playbook.id.startsWith('local-');
}

export function PlaybookSettingsSection() {
  const [playbooks, setPlaybooks] = React.useState<EditablePlaybook[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [savingById, setSavingById] = React.useState<Record<string, true>>({});
  const [deletingById, setDeletingById] = React.useState<Record<string, true>>({});

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

  const updatePlaybook = React.useCallback((clientId: string, patch: Partial<PlaybookDefinition>) => {
    setPlaybooks((prev) =>
      prev.map((item) => (item.clientId === clientId ? { ...patchPlaybookDefinition(item, patch), clientId: item.clientId } : item)),
    );
  }, []);

  const addPlaybook = React.useCallback(() => {
    setPlaybooks((prev) => [
      createEditablePlaybook({
        label: '',
        messages: [''],
        artifacts: [],
        actions: [],
      }),
      ...prev,
    ]);
  }, []);

  const removePlaybook = React.useCallback(async (playbook: EditablePlaybook) => {
    if (isUnsavedPlaybook(playbook)) {
      setPlaybooks((prev) => prev.filter((item) => item.clientId !== playbook.clientId));
      return;
    }
    setDeletingById((prev) => ({ ...prev, [playbook.clientId]: true }));
    setError(null);
    try {
      await requestJson(`/api/playbooks/${encodeURIComponent(playbook.id)}`, { method: 'DELETE' });
      setPlaybooks((prev) => prev.filter((item) => item.clientId !== playbook.clientId));
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
    const next = normalizeDraftForSave(playbook);
    if (!next.label) {
      setError('Each playbook needs a label.');
      return;
    }
    if (next.messages.length === 0) {
      setError(`"${next.label}" needs at least one message.`);
      return;
    }
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
    <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
            Playbooks
          </div>
          <div className="text-[11px] text-[var(--muted-dim)] leading-relaxed mt-1">
            Define reusable message sequences for hidden repo runs, plus optional labeled follow-up buttons that can be sent from the runs table.
          </div>
        </div>
        <button
          type="button"
          onClick={addPlaybook}
          className="h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110"
          style={{ fontFamily: 'var(--display)' }}
        >
          Add playbook
        </button>
      </div>

      {error && <div className="rounded border border-[rgba(255,90,90,.28)] bg-[var(--red-subtle)] px-3 py-2 text-[11px] text-[var(--red)]">{error}</div>}

      {loading ? (
        <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.16)] px-3 py-3 text-[11px] text-[var(--muted-dim)]">
          Loading playbooks...
        </div>
      ) : playbooks.length === 0 ? (
        <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.16)] px-3 py-3 text-[11px] text-[var(--muted-dim)]">
          No playbooks yet. Create one here, then run it from the runs tab.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {playbooks.map((playbook, index) => {
            const busy = Boolean(savingById[playbook.clientId] || deletingById[playbook.clientId]);
            return (
              <div key={playbook.clientId} className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.16)] px-3 py-3 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                    Playbook #{index + 1}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void savePlaybook(playbook)}
                      disabled={busy}
                      className={`h-7 px-2 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                        busy
                          ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                          : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                      }`}
                      style={{ fontFamily: 'var(--display)' }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => void removePlaybook(playbook)}
                      disabled={busy}
                      className={`h-7 px-2 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                        busy
                          ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                          : 'bg-[var(--red-subtle)] border-[rgba(255,90,90,.28)] text-[var(--red)] hover:bg-[rgba(255,90,90,.18)]'
                      }`}
                      style={{ fontFamily: 'var(--display)' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-2 items-center">
                  <label className="text-[11px] text-[var(--muted-dim)]">Label</label>
                  <input
                    type="text"
                    value={playbook.label}
                    onChange={(e) => updatePlaybook(playbook.clientId, { label: e.target.value })}
                    className="w-full h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-2 text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
                    placeholder="e.g. Find biggest bug"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <PlaybookTextListEditor
                    title="Run Messages"
                    items={playbook.messages}
                    emptyText="No run messages for this playbook."
                    addLabel="Add message"
                    addDisabled={playbook.messages.length >= PLAYBOOK_MAX_MESSAGES}
                    placeholder="Message queued into the run chat..."
                    multiline
                    onAdd={() => updatePlaybook(playbook.clientId, { messages: [...playbook.messages, ''] })}
                    onChange={(messageIndex, value) => {
                      const next = playbook.messages.slice();
                      next[messageIndex] = value;
                      updatePlaybook(playbook.clientId, { messages: next });
                    }}
                    onDelete={(messageIndex) => {
                      const next = playbook.messages.filter((_, idx) => idx !== messageIndex);
                      updatePlaybook(playbook.clientId, { messages: next.length > 0 ? next : [''] });
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
                        actions: [...playbook.actions, { id: `action-${makeId()}`, label: '', message: '' }],
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
