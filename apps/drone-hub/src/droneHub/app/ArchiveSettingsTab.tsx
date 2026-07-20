import React from 'react';
import type { UseDeleteActionSettingsResult } from './use-delete-action-settings';

type ArchiveSettingsTabProps = {
  deleteAction: UseDeleteActionSettingsResult;
};

export function ArchiveSettingsTab({ deleteAction }: ArchiveSettingsTabProps) {
  const {
    archivedDrones,
    archivedDronesLoading,
    archivedDronesError,
    archivedChats,
    archivedChatsLoading,
    archivedChatsError,
    archiveNotice,
    restoringArchivedById,
    deletingArchivedById,
    restoringArchivedChatByKey,
    deletingArchivedChatByKey,
    loadArchivedDrones,
    loadArchivedChats,
    restoreArchivedDrone,
    permanentlyDeleteArchivedDrone,
    restoreArchivedChat,
    permanentlyDeleteArchivedChat,
  } = deleteAction;

  const archivedRows = archivedDrones?.archived ?? [];
  const archivedChatRows = archivedChats?.archived ?? [];

  return (
    <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
            Archive
          </div>
          <div className="text-[11px] text-[var(--muted-dim)] mt-1">
            Review archived drones and chats, restore them, or permanently delete them now.
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            void loadArchivedDrones();
            void loadArchivedChats();
          }}
          disabled={archivedDronesLoading || archivedChatsLoading}
          className={`h-8 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
            archivedDronesLoading || archivedChatsLoading
              ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
              : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
          }`}
          style={{ fontFamily: 'var(--display)' }}
        >
          {archivedDronesLoading || archivedChatsLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {(archivedDronesError || archivedChatsError) && (
        <div className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[12px] text-[var(--red)]">
          {archivedDronesError ?? archivedChatsError}
        </div>
      )}
      {archiveNotice && (
        <div className="rounded border border-[var(--green-border)] bg-[var(--green-subtle)] px-3 py-2 text-[12px] text-[var(--green)]">
          {archiveNotice}
        </div>
      )}

      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
        <div className="flex flex-col gap-3 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Archived drones</div>
          {archivedDronesLoading && !archivedDrones ? (
            <div className="text-[12px] text-[var(--muted-dim)]">Loading archived drones…</div>
          ) : archivedRows.length === 0 ? (
            <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-3 text-[11px] text-[var(--muted-dim)]">No archived drones.</div>
          ) : (
            <div className="overflow-x-auto rounded border border-[var(--border-subtle)]">
              <table className="w-full min-w-[620px] text-left">
                <thead className="bg-[var(--surface-softest)]">
                  <tr>
                    <th className="px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Drone</th>
                    <th className="px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Archived</th>
                    <th className="px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Deletes</th>
                    <th className="px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {archivedRows.map((row) => {
                    const restoring = Boolean(restoringArchivedById[row.id]);
                    const deleting = Boolean(deletingArchivedById[row.id]);
                    return (
                      <tr key={row.id} className="border-t border-[var(--border-subtle)]">
                        <td className="px-3 py-2 align-top">
                          <div className="text-[12px] text-[var(--fg-secondary)]">{row.name}</div>
                          <div className="text-[10px] text-[var(--muted-dim)] font-mono mt-0.5">{row.id}</div>
                        </td>
                        <td className="px-3 py-2 align-top text-[11px] text-[var(--muted-dim)]">
                          {new Date(row.archivedAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 align-top text-[11px] text-[var(--muted-dim)]">
                          {new Date(row.deleteAt).toLocaleString()}
                          <div className="text-[10px] mt-0.5">
                            {row.archiveRuntimePolicy === 'stop' ? 'Stopped on archive' : 'Still running'}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void restoreArchivedDrone(row.id)}
                              disabled={restoring || deleting}
                              className={`h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                                restoring || deleting
                                  ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                  : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                              }`}
                              style={{ fontFamily: 'var(--display)' }}
                            >
                              {restoring ? 'Restoring…' : 'Restore'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void permanentlyDeleteArchivedDrone(row.id)}
                              disabled={restoring || deleting}
                              className={`h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                                restoring || deleting
                                  ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                  : 'bg-[var(--red-subtle)] border-[var(--red-border)] text-[var(--red)] hover:bg-[var(--red-subtle)]'
                              }`}
                              style={{ fontFamily: 'var(--display)' }}
                            >
                              {deleting ? 'Deleting…' : 'Delete now'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Archived chats</div>
          {archivedChatsLoading && !archivedChats ? (
            <div className="text-[12px] text-[var(--muted-dim)]">Loading archived chats…</div>
          ) : archivedChatRows.length === 0 ? (
            <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-3 text-[11px] text-[var(--muted-dim)]">No archived chats.</div>
          ) : (
            <div className="overflow-x-auto rounded border border-[var(--border-subtle)]">
              <table className="w-full min-w-[720px] text-left">
                <thead className="bg-[var(--surface-softest)]">
                  <tr>
                    <th className="px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Drone</th>
                    <th className="px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Chat</th>
                    <th className="px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Archived</th>
                    <th className="px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Deletes</th>
                    <th className="px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {archivedChatRows.map((row) => {
                    const key = `${row.droneId}\u0000${row.chatName}`;
                    const restoring = Boolean(restoringArchivedChatByKey[key]);
                    const deleting = Boolean(deletingArchivedChatByKey[key]);
                    return (
                      <tr key={key} className="border-t border-[var(--border-subtle)]">
                        <td className="px-3 py-2 align-top">
                          <div className="text-[12px] text-[var(--fg-secondary)]">{row.droneName}</div>
                          <div className="text-[10px] text-[var(--muted-dim)] font-mono mt-0.5">{row.droneId}</div>
                        </td>
                        <td className="px-3 py-2 align-top text-[12px] text-[var(--fg-secondary)]">{row.chatName}</td>
                        <td className="px-3 py-2 align-top text-[11px] text-[var(--muted-dim)]">
                          {new Date(row.archivedAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 align-top text-[11px] text-[var(--muted-dim)]">
                          {new Date(row.deleteAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void restoreArchivedChat(row.droneId, row.chatName)}
                              disabled={restoring || deleting}
                              className={`h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                                restoring || deleting
                                  ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                  : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                              }`}
                              style={{ fontFamily: 'var(--display)' }}
                            >
                              {restoring ? 'Restoring…' : 'Restore'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void permanentlyDeleteArchivedChat(row.droneId, row.chatName)}
                              disabled={restoring || deleting}
                              className={`h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                                restoring || deleting
                                  ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                  : 'bg-[var(--red-subtle)] border-[var(--red-border)] text-[var(--red)] hover:bg-[var(--red-subtle)]'
                              }`}
                              style={{ fontFamily: 'var(--display)' }}
                            >
                              {deleting ? 'Deleting…' : 'Delete now'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
