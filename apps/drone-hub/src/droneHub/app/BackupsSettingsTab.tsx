import React from 'react';
import type { RegistryBackupManifest } from './settings-types';
import type { UseRegistryBackupSettingsResult } from './use-registry-backup-settings';

type BackupsSettingsTabProps = {
  backups: UseRegistryBackupSettingsResult;
};

function formatDateTime(raw: string | null | undefined): string {
  if (!raw) return 'Never';
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return raw;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function backupKindLabel(kind: RegistryBackupManifest['kind']): string {
  if (kind === 'suspect') return 'Quarantine';
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function ToggleButton({
  active,
  disabled,
  onClick,
  label,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 items-center gap-2 rounded border px-2.5 text-[11px] font-semibold uppercase tracking-wide transition-all ${
        active
          ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]'
          : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted)] hover:bg-[var(--hover)]'
      } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
      style={{ fontFamily: 'var(--display)' }}
    >
      <span className={`h-3.5 w-6 rounded-full ${active ? 'bg-[var(--surface-inset-strong)]' : 'bg-[var(--control-off)]'}`}>
        <span
          className={`block h-3 w-3 rounded-full bg-current transition-transform ${
            active ? 'translate-x-[11px]' : 'translate-x-[1px]'
          } translate-y-[1px]`}
        />
      </span>
      {label}
    </button>
  );
}

function BackupStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">{label}</div>
      <div className="mt-1 text-[12px] text-[var(--fg-secondary)] break-words">{value}</div>
    </div>
  );
}

function BackupManifestRow({ manifest }: { manifest: RegistryBackupManifest }) {
  return (
    <div
      className={`grid grid-cols-1 gap-2 rounded border px-3 py-3 text-[11px] md:grid-cols-[110px_130px_minmax(0,1fr)_110px] ${
        manifest.suspect
          ? 'border-[var(--yellow-border)] bg-[var(--yellow-subtle)]'
          : 'border-[var(--border-subtle)] bg-[var(--surface-softest)]'
      }`}
    >
      <div>
        <div className="font-semibold text-[var(--fg-secondary)]">{backupKindLabel(manifest.kind)}</div>
        <div className="mt-1 text-[var(--muted-dim)]">{manifest.bucket}</div>
      </div>
      <div className="text-[var(--muted)]">{formatDateTime(manifest.createdAt)}</div>
      <div className="min-w-0">
        <div className="truncate text-[var(--fg-secondary)]">{manifest.paths.registryJson}</div>
        <div className="mt-1 truncate text-[var(--muted-dim)]">{manifest.paths.sqlite ?? 'JSON export only'}</div>
        {manifest.reason && <div className="mt-1 text-[var(--yellow)]">{manifest.reason}</div>}
      </div>
      <div className="text-[var(--muted)]">
        <span className="text-[var(--fg-secondary)]">{manifest.counts.total}</span> drone entries
      </div>
    </div>
  );
}

export function BackupsSettingsTab({ backups }: BackupsSettingsTabProps) {
  const {
    backupSettings,
    backupSettingsLoading,
    backupSettingsError,
    backupSettingsNotice,
    backupsEnabledDraft,
    hourlyEnabledDraft,
    dailyEnabledDraft,
    hourlyRetentionHoursDraft,
    dailyRetentionDaysDraft,
    savingBackupSettings,
    runningBackup,
    setBackupsEnabledDraft,
    setHourlyEnabledDraft,
    setDailyEnabledDraft,
    setHourlyRetentionHoursDraft,
    setDailyRetentionDaysDraft,
    saveBackupSettings,
    runBackupNow,
  } = backups;

  const disabled = backupSettingsLoading || savingBackupSettings || runningBackup;
  const current = backupSettings?.backupSettings;
  const dirty =
    Boolean(current) &&
    (backupsEnabledDraft !== current!.enabled ||
      hourlyEnabledDraft !== current!.hourlyEnabled ||
      dailyEnabledDraft !== current!.dailyEnabled ||
      hourlyRetentionHoursDraft !== String(current!.hourlyRetentionHours) ||
      dailyRetentionDaysDraft !== String(current!.dailyRetentionDays));
  const last = backupSettings?.last ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              Registry backups
            </div>
            <div className="mt-1 text-[11px] leading-relaxed text-[var(--muted-dim)]">
              SQLite backups plus registry JSON exports, with suspicious empty-registry states quarantined.
            </div>
          </div>
          <button
            type="button"
            onClick={() => void runBackupNow()}
            disabled={disabled}
            className={`h-9 rounded border px-3 text-[11px] font-semibold uppercase tracking-wide transition-all ${
              disabled
                ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] opacity-40'
                : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            {runningBackup ? 'Running...' : 'Run backup now'}
          </button>
        </div>

        {backupSettingsError && (
          <div className="mt-3 rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[12px] text-[var(--red)]">
            {backupSettingsError}
          </div>
        )}
        {backupSettingsNotice && (
          <div className="mt-3 rounded border border-[var(--green-border)] bg-[var(--green-subtle)] px-3 py-2 text-[12px] text-[var(--green)]">
            {backupSettingsNotice}
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <BackupStat label="Last backup" value={last ? `${backupKindLabel(last.kind)} at ${formatDateTime(last.createdAt)}` : 'None yet'} />
          <BackupStat label="Backup folder" value={backupSettings?.backupDir ?? 'Loading'} />
          <BackupStat
            label="Next due"
            value={
              backupSettings
                ? `${backupSettings.next.hourlyDue ? 'Hourly due' : 'Hourly current'} / ${
                    backupSettings.next.dailyDue ? 'Daily due' : 'Daily current'
                  }`
                : 'Loading'
            }
          />
        </div>
      </div>

      <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-3">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
          <div className="flex flex-wrap gap-2">
            <ToggleButton active={backupsEnabledDraft} disabled={disabled} onClick={() => setBackupsEnabledDraft((v) => !v)} label="Enabled" />
            <ToggleButton active={hourlyEnabledDraft} disabled={disabled} onClick={() => setHourlyEnabledDraft((v) => !v)} label="Hourly" />
            <ToggleButton active={dailyEnabledDraft} disabled={disabled} onClick={() => setDailyEnabledDraft((v) => !v)} label="Daily" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Hourly hours</span>
              <input
                value={hourlyRetentionHoursDraft}
                onChange={(e) => setHourlyRetentionHoursDraft(e.target.value)}
                disabled={disabled}
                inputMode="numeric"
                className="h-9 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 text-[12px] text-[var(--fg)] focus:border-[var(--accent-muted)] focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Daily days</span>
              <input
                value={dailyRetentionDaysDraft}
                onChange={(e) => setDailyRetentionDaysDraft(e.target.value)}
                disabled={disabled}
                inputMode="numeric"
                className="h-9 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-2 text-[12px] text-[var(--fg)] focus:border-[var(--accent-muted)] focus:outline-none"
              />
            </label>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void saveBackupSettings()}
            disabled={!dirty || disabled}
            className={`h-9 rounded border px-3 text-[11px] font-semibold uppercase tracking-wide transition-all ${
              !dirty || disabled
                ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[var(--surface-softest)] text-[var(--muted-dim)] opacity-40'
                : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            {savingBackupSettings ? 'Saving...' : 'Save backup settings'}
          </button>
        </div>
      </div>

      <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
          Recent backups
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {backupSettings?.recent.length ? (
            backupSettings.recent.map((manifest) => <BackupManifestRow key={manifest.id} manifest={manifest} />)
          ) : (
            <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-3 text-[12px] text-[var(--muted)]">
              No backups recorded yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
