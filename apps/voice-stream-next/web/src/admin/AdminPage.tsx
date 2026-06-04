import React from 'react';
import type { AndroidApkInfo, DashboardData, DesktopAppInfo } from '../dashboardTypes.js';
import { appDownloadMeta, AppDownloadLinks } from '../downloads/AppDownloadLinks.js';
import { cn } from '../ui/cn.js';
import { formatBytes, formatCredits } from '../utils/format.js';
import { exactTimeLabel, relativeTimeAgo, timeLabel } from '../time.js';

type ReleaseUploadProgressInfo = {
  platform: 'android' | 'desktop';
  fileName: string;
  loaded: number;
  total: number | null;
  phase: 'uploading' | 'processing';
};

type DroppedEntry = {
  isFile: boolean;
  isDirectory: boolean;
  file?: (success: (file: File) => void, failure?: (error: unknown) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: DroppedEntry[]) => void, failure?: (error: unknown) => void) => void;
  };
};

type AdminPageProps = {
  dashboard: DashboardData;
  androidInfo: AndroidApkInfo | null;
  desktopInfo: DesktopAppInfo | null;
  androidFile: File | null;
  desktopFile: File | null;
  releaseUploadProgress: ReleaseUploadProgressInfo | null;
  busy: boolean;
  creditGrantDrafts: Record<string, CreditGrantDraft>;
  emailCreditGrantDraft: EmailCreditGrantDraft;
  canGrantCreditsByEmail: boolean;
  onRefresh: () => void;
  onCreditGrantDraftChange: (userId: string, patch: Partial<CreditGrantDraft>) => void;
  onEmailCreditGrantDraftChange: React.Dispatch<React.SetStateAction<EmailCreditGrantDraft>>;
  onGrantCredits: (userId: string) => void;
  onGrantCreditsByEmail: () => void;
  onUploadAndroid: (files: File[]) => void | Promise<void>;
  onUploadDesktop: (files: File[]) => void | Promise<void>;
};

type CreditGrantDraft = {
  amountCredits: string;
  reason: string;
};

type EmailCreditGrantDraft = CreditGrantDraft & {
  email: string;
};

const assistantKickerClass = 'font-display text-[11px] font-semibold uppercase leading-none text-[var(--muted)]';
const assistantPanelClass = 'min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] p-3 text-[var(--fg-secondary)] shadow-none';
const assistantPanelHeaderClass = 'mb-3 flex items-start justify-between gap-3';
const assistantPanelTitleClass = 'm-0 mt-0.5 text-[15px] font-bold leading-tight text-[var(--fg)]';
const assistantEmptyClass = 'p-2.5 text-xs text-[var(--muted)]';
const assistantRowClass = 'rounded-[7px] border border-[var(--border-subtle)] bg-white/[.025] text-[var(--fg-secondary)]';
const assistantActionButtonClass = 'inline-flex h-8 items-center justify-center rounded border border-[var(--border)] bg-[rgba(255,255,255,.045)] px-3 font-display text-[10px] font-bold uppercase text-[var(--fg-secondary)] shadow-none transition hover:border-[rgba(167,139,250,.45)] hover:bg-white/[.075] hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-45';

export function AdminPage({
  dashboard,
  androidInfo,
  desktopInfo,
  androidFile,
  desktopFile,
  releaseUploadProgress,
  busy,
  creditGrantDrafts,
  emailCreditGrantDraft,
  canGrantCreditsByEmail,
  onRefresh,
  onCreditGrantDraftChange,
  onEmailCreditGrantDraftChange,
  onGrantCredits,
  onGrantCreditsByEmail,
  onUploadAndroid,
  onUploadDesktop,
}: AdminPageProps) {
  if (!dashboard.user.admin) return <div className={assistantEmptyClass}>Admin access required.</div>;

  const releaseUploadingPlatform = releaseUploadProgress?.platform ?? null;
  return (
    <section className="grid min-h-0 gap-3 overflow-auto p-3">
      <section className={assistantPanelClass}>
        <div className={assistantPanelHeaderClass}>
          <div>
            <span className={assistantKickerClass}>Admin</span>
            <h2 className={assistantPanelTitleClass}>Users & Credits</h2>
          </div>
          <button type="button" className={assistantActionButtonClass} disabled={busy} onClick={onRefresh}>
            Refresh
          </button>
        </div>
        <div className="grid gap-2">
          <form
            className={cn(assistantRowClass, 'grid grid-cols-[minmax(180px,1.2fr)_110px_minmax(160px,1fr)_auto] items-end gap-2 p-3 max-[760px]:grid-cols-2 max-[520px]:grid-cols-1')}
            onSubmit={(event) => {
              event.preventDefault();
              onGrantCreditsByEmail();
            }}
          >
            <label className="grid gap-1 text-[11px] text-[var(--muted)]">
              Email
              <input
                value={emailCreditGrantDraft.email}
                onChange={(event) => onEmailCreditGrantDraftChange((current) => ({ ...current, email: event.currentTarget.value }))}
                type="email"
                placeholder="person@example.com"
                disabled={busy}
                className="h-8 min-w-0"
              />
            </label>
            <label className="grid gap-1 text-[11px] text-[var(--muted)]">
              Credits
              <input
                value={emailCreditGrantDraft.amountCredits}
                onChange={(event) => onEmailCreditGrantDraftChange((current) => ({ ...current, amountCredits: event.currentTarget.value }))}
                type="number"
                min="0"
                step="0.01"
                placeholder="Credits"
                disabled={busy}
                className="h-8 min-w-0"
              />
            </label>
            <label className="grid gap-1 text-[11px] text-[var(--muted)]">
              Reason
              <input
                value={emailCreditGrantDraft.reason}
                onChange={(event) => onEmailCreditGrantDraftChange((current) => ({ ...current, reason: event.currentTarget.value }))}
                placeholder="Reason"
                disabled={busy}
                className="h-8 min-w-0"
              />
            </label>
            <button type="submit" className={assistantActionButtonClass} disabled={busy || !canGrantCreditsByEmail}>
              Grant by Email
            </button>
          </form>
          {dashboard.adminPendingCreditGrants.length > 0 ? (
            <div className="grid gap-1.5 rounded border border-[var(--border-subtle)] bg-white/[.018] p-2">
              <div className="flex items-center justify-between gap-2 px-1">
                <span className={assistantKickerClass}>Pending email grants</span>
                <span className="text-[10px] uppercase text-[var(--muted)]">{dashboard.adminPendingCreditGrants.length}</span>
              </div>
              {dashboard.adminPendingCreditGrants.map((grant) => (
                <div key={grant.id} className="grid grid-cols-[minmax(0,1fr)_90px_minmax(0,1fr)_120px] items-center gap-2 rounded border border-[var(--border-subtle)] bg-white/[.018] px-2 py-1.5 text-xs max-[760px]:grid-cols-2 max-[520px]:grid-cols-1">
                  <strong className="min-w-0 truncate text-[var(--fg)]">{grant.email}</strong>
                  <span className="text-[var(--fg-secondary)]">{formatCredits(grant.amountMicrocredits)}</span>
                  <span className="min-w-0 truncate text-[var(--muted)]">{grant.reason || 'Admin credit grant'}</span>
                  <time className="text-[10px] uppercase text-[var(--muted)]">{relativeTimeAgo(grant.createdAt)}</time>
                </div>
              ))}
            </div>
          ) : null}
          {dashboard.adminUsers.map((item) => {
            const draft = creditGrantDrafts[item.user.id] ?? { amountCredits: '', reason: '' };
            const lastSeenExact = item.user.lastSeenAt ? exactTimeLabel(item.user.lastSeenAt) : '';
            const lastSeenRelative = item.user.lastSeenAt ? relativeTimeAgo(item.user.lastSeenAt) : 'never';
            const canGrant = Number(draft.amountCredits) > 0;
            return (
              <article key={item.user.id} className={cn(assistantRowClass, 'grid grid-cols-[minmax(180px,1.4fr)_120px_120px_120px_minmax(240px,1.3fr)] items-center gap-3 p-3 max-[1040px]:grid-cols-2 max-[680px]:grid-cols-1')}>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <strong className="min-w-0 truncate text-xs text-[var(--fg)]">{item.user.email || item.user.displayName || item.user.id}</strong>
                    {item.user.admin ? <span className="rounded border border-[rgba(74,222,128,.24)] bg-[rgba(74,222,128,.08)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--green)]">Admin</span> : null}
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[11px] text-[var(--muted)]">
                    <span className="min-w-0 truncate">{item.user.displayName || 'No name'}</span>
                    <span title={lastSeenExact}>Last seen {lastSeenRelative}</span>
                  </div>
                </div>
                <div className="grid gap-0.5">
                  <span className={assistantKickerClass}>Threads</span>
                  <strong className="text-sm text-[var(--fg)]">{item.threadCount}</strong>
                </div>
                <div className="grid gap-0.5">
                  <span className={assistantKickerClass}>Profiles</span>
                  <strong className="text-sm text-[var(--fg)]">{item.assistantProfileCount}</strong>
                </div>
                <div className="grid gap-0.5">
                  <span className={assistantKickerClass}>Credits</span>
                  <strong className="text-sm text-[var(--fg)]">{formatCredits(item.creditBalanceMicrocredits)}</strong>
                  <small className="text-[10px] text-[var(--muted)]">
                    Granted {formatCredits(item.creditsGrantedMicrocredits)} / Spent {formatCredits(item.creditsSpentMicrocredits)}
                  </small>
                </div>
                <form
                  className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-2 max-[520px]:grid-cols-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onGrantCredits(item.user.id);
                  }}
                >
                  <input
                    value={draft.amountCredits}
                    onChange={(event) => onCreditGrantDraftChange(item.user.id, { amountCredits: event.currentTarget.value })}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Credits"
                    disabled={busy}
                    className="h-8 min-w-0"
                  />
                  <input
                    value={draft.reason}
                    onChange={(event) => onCreditGrantDraftChange(item.user.id, { reason: event.currentTarget.value })}
                    placeholder="Reason"
                    disabled={busy}
                    className="h-8 min-w-0"
                  />
                  <button type="submit" className={assistantActionButtonClass} disabled={busy || !canGrant}>
                    Grant
                  </button>
                </form>
              </article>
            );
          })}
          {dashboard.adminUsers.length === 0 ? <div className={assistantEmptyClass}>No users yet.</div> : null}
        </div>
      </section>

      <section className={assistantPanelClass}>
        <div className={assistantPanelHeaderClass}>
          <div>
            <span className={assistantKickerClass}>Admin</span>
            <h2 className={assistantPanelTitleClass}>App Releases</h2>
          </div>
        </div>
        <div className="mb-3 grid gap-2 rounded border border-[var(--border-subtle)] bg-white/[.02] p-3">
          <span className={assistantKickerClass}>Current downloads</span>
          <AppDownloadLinks androidInfo={androidInfo} desktopInfo={desktopInfo} />
        </div>
        <div className="grid grid-cols-2 gap-3 max-[880px]:grid-cols-1">
          <ReleaseDropZone
            platform="desktop"
            title="Upload desktop app"
            idleLabel="Drop desktop build folder or archive + latest.json"
            activeLabel="Uploading desktop release"
            fileHint={desktopFile ? `${desktopFile.name} / ${formatBytes(desktopFile.size)}` : 'Click to choose the archive and companion latest.json'}
            currentMeta={appDownloadMeta(desktopInfo)}
            accept=".tar.gz,.tgz,.zip,.dmg,.exe,.AppImage,.json,application/gzip,application/zip,application/json"
            busy={busy}
            releaseUploadingPlatform={releaseUploadingPlatform}
            progress={releaseUploadProgress?.platform === 'desktop' ? releaseUploadProgress : null}
            onUpload={onUploadDesktop}
          />

          <ReleaseDropZone
            platform="android"
            title="Upload Android APK"
            idleLabel="Drop Android build folder or APK + metadata"
            activeLabel="Uploading Android APK"
            fileHint={androidFile ? `${androidFile.name} / ${formatBytes(androidFile.size)}` : 'Click to choose the APK and latest.json or output-metadata.json'}
            currentMeta={appDownloadMeta(androidInfo)}
            accept=".apk,.json,application/vnd.android.package-archive,application/json"
            busy={busy}
            releaseUploadingPlatform={releaseUploadingPlatform}
            progress={releaseUploadProgress?.platform === 'android' ? releaseUploadProgress : null}
            onUpload={onUploadAndroid}
          />
        </div>
      </section>

      <section className={assistantPanelClass}>
        <div className={assistantPanelHeaderClass}>
          <div>
            <span className={assistantKickerClass}>Admin</span>
            <h2 className={assistantPanelTitleClass}>Device Monitor</h2>
          </div>
        </div>
        <div className="grid gap-2">
          {dashboard.adminDevices.map((device) => (
            <article key={device.id} className={cn(assistantRowClass, 'grid grid-cols-[minmax(0,1fr)_120px_140px_auto] items-center gap-2 p-2 max-[620px]:grid-cols-1')}>
              <strong className="min-w-0 text-xs text-[var(--fg)]">{device.displayName}</strong>
              <span className="text-xs text-[var(--muted)]">{device.deviceType}</span>
              <span className="text-xs text-[var(--muted)]">token {device.tokenHint}...</span>
              <time className="text-xs text-[var(--muted)]">{timeLabel(device.lastSeenAt)}</time>
            </article>
          ))}
          {dashboard.adminClientStatuses.map((status) => (
            <article key={`admin-status-${status.deviceId}`} className="grid grid-cols-[minmax(0,1fr)_120px_140px_auto] items-center gap-2 rounded-[7px] border border-[rgba(74,222,128,.18)] bg-[rgba(74,222,128,.06)] p-2 text-[var(--fg-secondary)] max-[620px]:grid-cols-1">
              <strong className="min-w-0 text-xs text-[var(--fg)]">{status.displayName}</strong>
              <span className="text-xs text-[var(--muted)]">{status.mode}</span>
              <span className="text-xs text-[var(--muted)]">{status.microphone || status.status}</span>
              <time className="text-xs text-[var(--muted)]">{timeLabel(status.updatedAt)}</time>
            </article>
          ))}
          {dashboard.adminDevices.length === 0 ? <div className={assistantEmptyClass}>No connected devices yet.</div> : null}
        </div>
      </section>
    </section>
  );
}

function ReleaseDropZone({
  platform,
  title,
  idleLabel,
  activeLabel,
  fileHint,
  currentMeta,
  accept,
  busy,
  releaseUploadingPlatform,
  progress,
  onUpload,
}: {
  platform: 'android' | 'desktop';
  title: string;
  idleLabel: string;
  activeLabel: string;
  fileHint: string;
  currentMeta: string;
  accept: string;
  busy: boolean;
  releaseUploadingPlatform: 'android' | 'desktop' | null;
  progress: ReleaseUploadProgressInfo | null;
  onUpload: (files: File[]) => void | Promise<void>;
}) {
  return (
    <section className="grid gap-2.5 rounded border border-[var(--border-subtle)] bg-white/[.02] p-3">
      <div>
        <span className={assistantKickerClass}>{platform === 'android' ? 'Android' : 'Desktop'}</span>
        <h3 className="m-0 mt-1 text-sm leading-tight text-[var(--fg)]">{title}</h3>
      </div>
      <label
        className={cn(
          'grid min-h-[132px] cursor-pointer place-items-center gap-2 rounded border border-dashed border-[var(--border)] bg-black/[.12] p-4 text-center transition hover:border-[rgba(167,139,250,.52)] hover:bg-white/[.035]',
          releaseUploadingPlatform === platform && 'pointer-events-none border-[rgba(74,222,128,.48)] bg-[rgba(74,222,128,.06)] shadow-[inset_0_0_0_1px_rgba(74,222,128,.10),0_0_28px_rgba(74,222,128,.08)]',
          busy && releaseUploadingPlatform !== platform && 'pointer-events-none cursor-wait border-[var(--border-subtle)] bg-black/[.18]',
        )}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => void droppedFiles(event).then(onUpload)}
      >
        <input
          type="file"
          className="hidden"
          multiple
          accept={accept}
          onChange={(event) => void onUpload(fileList(event.currentTarget.files))}
        />
        <span className={cn('font-display text-[10px] font-bold uppercase text-[var(--fg-secondary)]', releaseUploadingPlatform === platform && 'text-[var(--green)]')}>
          {releaseUploadingPlatform === platform ? activeLabel : idleLabel}
        </span>
        <small className="max-w-full truncate text-[11px] text-[var(--muted)]">{fileHint}</small>
        <small className="text-[10px] text-[var(--muted-dim)]">Current: {currentMeta}</small>
        {progress ? <ReleaseUploadProgress progress={progress} /> : null}
      </label>
    </section>
  );
}

function ReleaseUploadProgress({ progress }: { progress: ReleaseUploadProgressInfo }) {
  const percent = progress.total ? Math.min(100, Math.max(0, Math.round((progress.loaded / progress.total) * 100))) : null;
  const label = progress.phase === 'processing'
    ? 'Processing upload'
    : percent == null
      ? `Uploading ${formatBytes(progress.loaded)}`
      : `Uploading ${percent}%`;
  const transferLabel = progress.total ? `${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}` : formatBytes(progress.loaded);
  return (
    <div className="grid w-full max-w-[380px] gap-1.5 text-left">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate font-display text-[10px] font-bold uppercase text-[var(--green)]">{label}</span>
        <span className="shrink-0 text-[11px] font-semibold text-[var(--fg-secondary)]">{transferLabel}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded bg-black/[.32] ring-1 ring-white/[.08]">
        <div
          className={cn(
            'h-full rounded bg-[linear-gradient(90deg,var(--green),var(--accent))] shadow-[0_0_16px_rgba(74,222,128,.24)] transition-[width] duration-150',
            progress.phase === 'processing' && 'animate-pulse',
          )}
          style={{ width: `${progress.phase === 'processing' ? 100 : percent ?? 12}%` }}
        />
      </div>
      <small className="max-w-full truncate text-[10px] text-[var(--fg-secondary)]">{progress.fileName}</small>
    </div>
  );
}

function fileList(files: FileList | File[] | null | undefined): File[] {
  return Array.from(files ?? []);
}

async function droppedFiles(event: React.DragEvent<HTMLElement>): Promise<File[]> {
  event.preventDefault();
  return filesFromDrop(event.dataTransfer);
}

async function filesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  const itemEntries = Array.from(dataTransfer.items ?? [])
    .map((item) => {
      const getter = (item as DataTransferItem & { webkitGetAsEntry?: () => DroppedEntry | null }).webkitGetAsEntry;
      return getter ? getter.call(item) : null;
    })
    .filter((entry): entry is DroppedEntry => Boolean(entry));
  if (itemEntries.length === 0) return fileList(dataTransfer.files);
  const nested = await Promise.all(itemEntries.map((entry) => filesFromEntry(entry)));
  return nested.flat();
}

async function filesFromEntry(entry: DroppedEntry): Promise<File[]> {
  if (entry.isFile && entry.file) {
    return new Promise((resolve, reject) => entry.file?.((file) => resolve([file]), reject));
  }
  if (!entry.isDirectory || !entry.createReader) return [];
  const reader = entry.createReader();
  const entries: DroppedEntry[] = [];
  for (;;) {
    const batch = await new Promise<DroppedEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    entries.push(...batch);
  }
  const nested = await Promise.all(entries.map((child) => filesFromEntry(child)));
  return nested.flat();
}
