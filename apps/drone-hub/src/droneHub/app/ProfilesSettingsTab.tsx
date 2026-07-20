import React from 'react';
import { formatProfileDisplayName } from './profile-display';
import type { UseProfileSettingsResult } from './use-profile-settings';

export function ProfilesSettingsTab({ profile }: { profile: UseProfileSettingsResult }) {
  const {
    profileSettings,
    profileSettingsLoading,
    profileSettingsError,
    profileSettingsNotice,
    createProfileDraft,
    creatingProfile,
    activatingProfileName,
    renamingProfileName,
    deletingProfileName,
    setCreateProfileDraft,
    createProfile,
    activateProfile,
    renameProfile,
    deleteProfile,
  } = profile;
  const [editingName, setEditingName] = React.useState<string | null>(null);
  const [renameDrafts, setRenameDrafts] = React.useState<Record<string, string>>({});

  const profileList = profileSettings?.profiles ?? [];
  const activeProfileName = profileSettings?.activeProfile ?? null;
  const createProfileDraftTrimmed = String(createProfileDraft ?? '').trim();

  const isBusy =
    profileSettingsLoading ||
    creatingProfile ||
    Boolean(activatingProfileName) ||
    Boolean(renamingProfileName) ||
    Boolean(deletingProfileName);

  return (
    <div className="flex flex-col gap-4">
      {profileSettingsError && (
        <div className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[12px] text-[var(--red)]">
          {profileSettingsError}
        </div>
      )}
      {profileSettingsNotice && (
        <div className="rounded border border-[var(--green-border)] bg-[var(--green-subtle)] px-3 py-2 text-[12px] text-[var(--green)]">
          {profileSettingsNotice}
        </div>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)] gap-4">
        <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-4 py-4 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              Active profile
            </div>
            <div className="text-[20px] font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>
              {activeProfileName ? formatProfileDisplayName(activeProfileName) : 'Default'}
            </div>
            <div className="text-[11px] text-[var(--muted-dim)] leading-relaxed">
              Profiles isolate drone state, repo registrations, Hub onboarding state, and DVM base-image config.
            </div>
          </div>

          <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-3 flex flex-col gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">Resolved paths</div>
            <div className="text-[11px] text-[var(--muted-dim)] break-all">Drone: {profileSettings?.droneDataDir ?? 'Loading…'}</div>
            <div className="text-[11px] text-[var(--muted-dim)] break-all">DVM: {profileSettings?.dvmDataDir ?? 'Loading…'}</div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">Create profile</div>
            <input
              value={createProfileDraft}
              onChange={(e) => setCreateProfileDraft(e.target.value)}
              className="h-10 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors"
              placeholder="Enter profile name"
              disabled={isBusy}
            />
            <button
              type="button"
              onClick={() => void createProfile()}
              disabled={!createProfileDraftTrimmed || isBusy}
              className={`h-10 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                !createProfileDraftTrimmed || isBusy
                  ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                  : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
              }`}
              style={{ fontFamily: 'var(--display)' }}
            >
              {creatingProfile ? 'Creating…' : 'Create profile'}
            </button>
          </div>
        </div>

        <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-4 py-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                Available profiles
              </div>
              <div className="text-[12px] text-[var(--muted)] mt-1">Switch, rename, or remove isolated Hub workspaces.</div>
            </div>
            <div className="text-[11px] text-[var(--muted-dim)]">{profileList.length} total</div>
          </div>

          {profileSettingsLoading && !profileSettings ? (
            <div className="text-[12px] text-[var(--muted-dim)]">Loading profiles…</div>
          ) : profileList.length === 0 ? (
            <div className="text-[12px] text-[var(--muted-dim)]">No profiles found.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {profileList.map((item) => {
                const switching = activatingProfileName === item.name;
                const renaming = renamingProfileName === item.name;
                const deleting = deletingProfileName === item.name;
                const editing = editingName === item.name;
                const renameDraft = renameDrafts[item.name] ?? item.name;
                const rowBusy = isBusy && !editing;
                return (
                  <div
                    key={item.name}
                    className={`rounded border px-4 py-4 transition-colors ${
                      item.active
                        ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)]'
                        : 'border-[var(--border-subtle)] bg-[var(--surface-softest)]'
                    }`}
                  >
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          {editing ? (
                            <div className="flex flex-col gap-2">
                              <input
                                value={renameDraft}
                                onChange={(e) =>
                                  setRenameDrafts((prev) => ({
                                    ...prev,
                                    [item.name]: e.target.value,
                                  }))
                                }
                                className="h-10 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 text-[13px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors"
                                disabled={renaming}
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => void renameProfile(item.name, renameDraft)}
                                  disabled={!String(renameDraft).trim() || renaming}
                                  className={`h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                                    !String(renameDraft).trim() || renaming
                                      ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                      : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
                                  }`}
                                  style={{ fontFamily: 'var(--display)' }}
                                >
                                  {renaming ? 'Saving…' : 'Save name'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingName(null);
                                    setRenameDrafts((prev) => {
                                      const next = { ...prev };
                                      delete next[item.name];
                                      return next;
                                    });
                                  }}
                                  disabled={renaming}
                                  className="h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                                  style={{ fontFamily: 'var(--display)' }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-[16px] font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>
                                  {formatProfileDisplayName(item.name)}
                                </div>
                                {item.active && (
                                  <span className="rounded-full border border-[var(--green-border)] bg-[var(--green-subtle)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--green)]">
                                    Active
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-[var(--muted-dim)] break-all mt-2">Drone: {item.droneDataDir}</div>
                              <div className="text-[11px] text-[var(--muted-dim)] break-all">DVM: {item.dvmDataDir}</div>
                            </>
                          )}
                        </div>

                        {!editing && (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void activateProfile(item.name)}
                              disabled={item.active || rowBusy}
                              className={`h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                                item.active || rowBusy
                                  ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                  : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                              }`}
                              style={{ fontFamily: 'var(--display)' }}
                            >
                              {switching ? 'Switching…' : item.active ? 'In use' : 'Switch'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingName(item.name);
                                setRenameDrafts((prev) => ({
                                  ...prev,
                                  [item.name]: prev[item.name] ?? item.name,
                                }));
                              }}
                              disabled={rowBusy}
                              className={`h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                                rowBusy
                                  ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                  : 'bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                              }`}
                              style={{ fontFamily: 'var(--display)' }}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const ok = window.confirm(
                                  `Delete profile ${formatProfileDisplayName(item.name)}?\n\nThis removes all containers and host runtimes tracked by that profile.`,
                                );
                                if (!ok) return;
                                void deleteProfile(item.name);
                              }}
                              disabled={item.active || rowBusy}
                              className={`h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                                item.active || rowBusy
                                  ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                                  : 'bg-[var(--red-subtle)] border-[var(--red-border)] text-[var(--red)] hover:bg-[var(--red-subtle)]'
                              }`}
                              style={{ fontFamily: 'var(--display)' }}
                            >
                              {deleting ? 'Deleting…' : 'Delete'}
                            </button>
                          </div>
                        )}
                      </div>
                      {item.active && !editing && (
                        <div className="text-[11px] text-[var(--muted-dim)]">
                          Active profiles cannot be deleted. Switch to another profile first.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
