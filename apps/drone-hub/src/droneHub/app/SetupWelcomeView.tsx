import React from 'react';
import { formatProfileDisplayName } from './profile-display';
import type { SetupStatusResponse } from './settings-types';

type SetupWelcomeViewProps = {
  setupStatus: SetupStatusResponse | null;
  setupStatusLoading: boolean;
  setupStatusError: string | null;
  dismissingWelcome: boolean;
  onDismissWelcome: () => void;
  onReload: () => void;
  onOpenProfiles: () => void;
  onOpenGeneralSettings: () => void;
};

function dependencyTone(status: string, blocking: boolean): string {
  if (status === 'ready') return 'border-[var(--green-border)] bg-[var(--green-subtle)]';
  if (blocking) return 'border-[var(--red-border)] bg-[var(--red-subtle)]';
  return 'border-[var(--yellow-border)] bg-[var(--yellow-subtle)]';
}

function dependencySeverityLabel(status: string, blocking: boolean): string {
  if (status === 'ready') return 'ready';
  return blocking ? 'blocker' : 'warning';
}

export function SetupWelcomeView({
  setupStatus,
  setupStatusLoading,
  setupStatusError,
  dismissingWelcome,
  onDismissWelcome,
  onReload,
  onOpenProfiles,
  onOpenGeneralSettings,
}: SetupWelcomeViewProps) {
  const dependencies = setupStatus?.dependencies ?? [];
  const blockers = dependencies.filter((item) => item.blocking && item.status !== 'ready');
  const recommended = dependencies.filter((item) => !item.blocking && item.status !== 'ready');

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="min-h-full px-4 py-5 sm:px-5 sm:py-6 lg:px-6 lg:py-8">
        <div className="mx-auto max-w-[1180px] flex flex-col gap-5">
          <div className="rounded-[20px] border border-[var(--border)] bg-[var(--panel-raised)] overflow-hidden shadow-[0_16px_48px_var(--shadow-color)]">
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
              <div className="px-6 py-6 sm:px-8 sm:py-8 flex flex-col gap-5">
                <div className="flex flex-col gap-3">
                  <div className="inline-flex items-center gap-2 text-[var(--text-10)] uppercase tracking-[0.16em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                    <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                    Drone Hub Setup
                  </div>
                  <div className="max-w-[18ch] text-[34px] leading-[1.02] font-[var(--weight-semibold)] text-[var(--fg-strong)]" style={{ fontFamily: 'var(--display)' }}>
                    Bring this profile online before you start flying.
                  </div>
                  <div className="max-w-[64ch] text-[var(--text-13)] leading-relaxed text-[var(--muted)]">
                    This screen tracks machine dependencies and whether the active profile is still empty. It is meant to catch fresh installs and fresh profiles before users hit confusing failures later.
                  </div>
                </div>

                {setupStatusError && (
                  <div className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--red)]">
                    {setupStatusError}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-4 py-4">
                    <div className="text-[var(--text-10)] uppercase tracking-[0.1em] text-[var(--muted-dim)] font-[var(--weight-semibold)]">Active profile</div>
                    <div className="mt-2 text-[22px] font-[var(--weight-semibold)] text-[var(--fg-strong)]" style={{ fontFamily: 'var(--display)' }}>
                      {setupStatus?.activeProfile ? formatProfileDisplayName(setupStatus.activeProfile) : 'Default'}
                    </div>
                    <div className="mt-1 text-[var(--text-11)] text-[var(--muted-dim)]">
                      {setupStatus?.profile.isFresh ? 'Fresh profile' : 'Returning profile'}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-4 py-4">
                    <div className="text-[var(--text-10)] uppercase tracking-[0.1em] text-[var(--muted-dim)] font-[var(--weight-semibold)]">Blockers</div>
                    <div className="mt-2 text-[22px] font-[var(--weight-semibold)] text-[var(--fg-strong)]" style={{ fontFamily: 'var(--display)' }}>
                      {blockers.length}
                    </div>
                    <div className="mt-1 text-[var(--text-11)] text-[var(--muted-dim)]">Things that will stop important flows from working.</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-4 py-4">
                    <div className="text-[var(--text-10)] uppercase tracking-[0.1em] text-[var(--muted-dim)] font-[var(--weight-semibold)]">Warnings</div>
                    <div className="mt-2 text-[22px] font-[var(--weight-semibold)] text-[var(--fg-strong)]" style={{ fontFamily: 'var(--display)' }}>
                      {recommended.length}
                    </div>
                    <div className="mt-1 text-[var(--text-11)] text-[var(--muted-dim)]">Recommended improvements that are not hard blockers.</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-4 py-4">
                    <div className="text-[var(--text-10)] uppercase tracking-[0.1em] text-[var(--muted-dim)] font-[var(--weight-semibold)]">Profile contents</div>
                    <div className="mt-2 text-[22px] font-[var(--weight-semibold)] text-[var(--fg-strong)]" style={{ fontFamily: 'var(--display)' }}>
                      {setupStatus ? `${setupStatus.profile.droneCount} drones` : '...'}
                    </div>
                    <div className="mt-1 text-[var(--text-11)] text-[var(--muted-dim)]">
                      {setupStatus ? `${setupStatus.profile.repoCount} repos registered in this profile.` : 'Loading profile summary…'}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onDismissWelcome}
                    disabled={dismissingWelcome || setupStatusLoading}
                    className={`h-10 px-4 rounded text-[var(--text-11)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all ${
                      dismissingWelcome || setupStatusLoading
                        ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                        : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    {dismissingWelcome ? 'Opening…' : 'Continue to Hub'}
                  </button>
                  <button
                    type="button"
                    onClick={onOpenProfiles}
                    className="h-10 px-4 rounded text-[var(--text-11)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    Open profiles
                  </button>
                  <button
                    type="button"
                    onClick={onOpenGeneralSettings}
                    className="h-10 px-4 rounded text-[var(--text-11)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    Open general settings
                  </button>
                  <button
                    type="button"
                    onClick={onReload}
                    className="h-10 px-4 rounded text-[var(--text-11)] font-[var(--weight-semibold)] tracking-wide uppercase border transition-all bg-[var(--surface-softest)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    Refresh checks
                  </button>
                </div>
              </div>

              <div className="border-t xl:border-t-0 xl:border-l border-[var(--border)] bg-[var(--panel-alt)] px-6 py-6 sm:px-8 sm:py-8 flex flex-col gap-4">
                <div>
                  <div className="text-[var(--text-10)] uppercase tracking-[0.12em] text-[var(--muted-dim)] font-[var(--weight-semibold)]" style={{ fontFamily: 'var(--display)' }}>
                    Suggested flow
                  </div>
                  <div className="mt-2 text-[var(--text-12)] leading-relaxed text-[var(--muted)]">
                    Fix blockers first, then decide whether this profile stays empty for testing or becomes a normal working profile.
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-4 py-4">
                    <div className="text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">1. Resolve blockers</div>
                    <div className="mt-1 text-[var(--text-11)] text-[var(--muted-dim)]">Docker, GitHub auth, and LLM setup have the biggest impact on first-run success.</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-4 py-4">
                    <div className="text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">2. Choose your profile strategy</div>
                    <div className="mt-1 text-[var(--text-11)] text-[var(--muted-dim)]">Keep this profile empty for onboarding tests or start creating drones and repos here.</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-4 py-4">
                    <div className="text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">3. Optional base image</div>
                    <div className="mt-1 text-[var(--text-11)] text-[var(--muted-dim)]">Nice to have, not required. It improves repeatability once you know the shape of your environment.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)] gap-4">
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-5 py-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[var(--text-10)] uppercase tracking-[0.12em] text-[var(--muted-dim)] font-[var(--weight-semibold)]" style={{ fontFamily: 'var(--display)' }}>
                    Dependency checks
                  </div>
                  <div className="mt-1 text-[var(--text-12)] text-[var(--muted)]">Backend-reported readiness for the current machine and active profile.</div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                {(setupStatusLoading && !setupStatus
                  ? Array.from({ length: 4 }).map((_, index) => (
                      <div key={index} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-4 py-4 text-[var(--text-12)] text-[var(--muted-dim)]">
                        Loading checks…
                      </div>
                    ))
                  : dependencies
                ).map((item: any, index: number) =>
                  item?.id ? (
                    <div key={item.id} className={`rounded-2xl border px-4 py-4 ${dependencyTone(item.status, Boolean(item.blocking))}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[var(--text-13)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">{item.label}</div>
                        <div className="text-[var(--text-10)] uppercase tracking-[0.12em] text-[var(--muted-dim)]">
                          {dependencySeverityLabel(item.status, Boolean(item.blocking))}
                        </div>
                      </div>
                      <div className="mt-2 text-[var(--text-11)] text-[var(--muted-dim)]">Used for {item.requiredFor}</div>
                      <div className="mt-3 text-[var(--text-12)] leading-relaxed text-[var(--fg-secondary)]">{item.detail}</div>
                    </div>
                  ) : (
                    <div key={index} />
                  ),
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-5 py-5 flex flex-col gap-4">
              <div>
                <div className="text-[var(--text-10)] uppercase tracking-[0.12em] text-[var(--muted-dim)] font-[var(--weight-semibold)]" style={{ fontFamily: 'var(--display)' }}>
                  Current profile
                </div>
                <div className="mt-2 text-[var(--text-12)] text-[var(--muted)]">
                  {setupStatus?.profile.isFresh
                    ? 'This profile is still empty, so it is ideal for onboarding and first-run flow testing.'
                    : 'This profile already contains saved Hub state, so it behaves like a returning workspace.'}
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-4 py-4">
                <div className="text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">Drone data root</div>
                <div className="mt-2 text-[var(--text-11)] text-[var(--muted-dim)] break-all">{setupStatus?.profile.droneDataDir ?? 'Loading…'}</div>
              </div>
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-4 py-4">
                <div className="text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">DVM data root</div>
                <div className="mt-2 text-[var(--text-11)] text-[var(--muted-dim)] break-all">{setupStatus?.profile.dvmDataDir ?? 'Loading…'}</div>
              </div>
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-4 py-4">
                <div className="text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">Recommended next move</div>
                <div className="mt-2 text-[var(--text-11)] text-[var(--muted-dim)]">
                  {blockers.length > 0
                    ? 'Resolve the blocking dependencies first.'
                    : recommended.length > 0
                      ? 'You can continue now, but a couple of optional setup steps will make the workflow smoother.'
                      : 'The machine and profile are ready. You can continue straight into the Hub.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
