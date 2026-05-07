import React from 'react';
import { fetchJson, usePoll } from '../app/hooks';
import { IconFile, iconForFilePath } from '../icons';
import { MarkdownMessage } from '../chat/MarkdownMessage';

type AssistantThread = {
  id: string;
  title: string;
  updatedAt: string;
};

type AssistantSnapshot = {
  ok: true;
  activeThreadId: string;
  threads: AssistantThread[];
};

type AssistantArtifactSummary = {
  path: string;
  size: number;
  updatedAt: string;
  revision: string;
};

type AssistantArtifactFile = AssistantArtifactSummary & {
  content: string;
};

type AssistantArtifactsPayload = {
  ok: true;
  threadId: string;
  files: AssistantArtifactSummary[];
};

type AssistantArtifactFilePayload = {
  ok: true;
  threadId: string;
  file: AssistantArtifactFile;
};

function formatArtifactTime(raw: string): string {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return '-';
  const delta = Date.now() - ms;
  if (delta < 60_000) return 'now';
  if (delta < 60 * 60_000) return `${Math.max(1, Math.floor(delta / 60_000))}m`;
  if (delta < 24 * 60 * 60_000) return `${Math.max(1, Math.floor(delta / (60 * 60_000)))}h`;
  return new Date(ms).toLocaleDateString();
}

function formatArtifactSize(bytesRaw: number): string {
  const bytes = Number(bytesRaw);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileNameFromPath(pathRaw: string): string {
  const path = String(pathRaw ?? '').trim();
  return path.split('/').filter(Boolean).pop() || path || 'artifact';
}

function selectDefaultArtifactPath(files: AssistantArtifactSummary[]): string | null {
  if (files.length === 0) return null;
  const preferred = files.find((file) => file.path === 'status.md') ?? files.find((file) => file.path.endsWith('/status.md'));
  return preferred?.path ?? files[0]?.path ?? null;
}

function IconRefresh({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 5.5A5.5 5.5 0 003.4 4" />
      <path d="M3 1.8V4.6h2.8" />
      <path d="M3 10.5a5.5 5.5 0 009.6 1.5" />
      <path d="M13 14.2v-2.8h-2.8" />
    </svg>
  );
}

export function AssistantArtifactsDock() {
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  const {
    value: snapshot,
    error: snapshotError,
    loading: snapshotLoading,
  } = usePoll<AssistantSnapshot>(() => fetchJson('/api/assistant/threads'), 3000, [refreshNonce]);

  const activeThread = React.useMemo(() => {
    if (!snapshot) return null;
    return snapshot.threads.find((thread) => thread.id === snapshot.activeThreadId) ?? snapshot.threads[0] ?? null;
  }, [snapshot]);
  const activeThreadId = String(activeThread?.id ?? '').trim();

  const {
    value: artifactsPayload,
    error: artifactsError,
    loading: artifactsLoading,
  } = usePoll<AssistantArtifactsPayload>(
    () =>
      activeThreadId
        ? fetchJson(`/api/assistant/threads/${encodeURIComponent(activeThreadId)}/artifacts`)
        : Promise.resolve({ ok: true, threadId: '', files: [] }),
    1500,
    [activeThreadId, refreshNonce],
    { enabled: Boolean(activeThreadId) },
  );

  const files = React.useMemo(
    () => (Array.isArray(artifactsPayload?.files) ? artifactsPayload.files : []),
    [artifactsPayload?.files],
  );
  const selectedStillExists = Boolean(selectedPath && files.some((file) => file.path === selectedPath));

  React.useEffect(() => {
    if (files.length === 0) {
      setSelectedPath(null);
      return;
    }
    setSelectedPath((prev) => (prev && files.some((file) => file.path === prev) ? prev : selectDefaultArtifactPath(files)));
  }, [files]);

  const {
    value: filePayload,
    error: fileError,
    loading: fileLoading,
  } = usePoll<AssistantArtifactFilePayload>(
    () =>
      activeThreadId && selectedPath
        ? fetchJson(
            `/api/assistant/threads/${encodeURIComponent(activeThreadId)}/artifacts/file?path=${encodeURIComponent(selectedPath)}`,
          )
        : Promise.resolve({
            ok: true,
            threadId: activeThreadId,
            file: { path: '', content: '', size: 0, updatedAt: '', revision: '' },
          }),
    1500,
    [activeThreadId, selectedPath, refreshNonce],
    { enabled: Boolean(activeThreadId && selectedPath && selectedStillExists) },
  );

  const selectedFile = selectedStillExists ? filePayload?.file ?? null : null;
  const combinedError = snapshotError ?? artifactsError ?? fileError;
  const loading = snapshotLoading || artifactsLoading || (Boolean(selectedPath) && fileLoading);

  return (
    <div className="h-full min-h-0 bg-[var(--bg)] text-[var(--fg)] flex flex-col">
      <div className="shrink-0 border-b border-[var(--border-subtle)] px-3 py-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[var(--glow-accent)]" aria-hidden="true" />
            <div className="truncate text-[13px] font-semibold text-[var(--fg-secondary)]">Artifacts</div>
          </div>
          <div className="mt-0.5 truncate text-[10px] text-[var(--muted-dim)]">
            {activeThread ? activeThread.title || activeThread.id : 'No thread'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setRefreshNonce((n) => n + 1)}
          className="h-7 w-7 rounded-md border border-[var(--border-subtle)] bg-[var(--panel)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] inline-flex items-center justify-center"
          title="Refresh artifacts"
          aria-label="Refresh artifacts"
        >
          {loading ? (
            <span className="inline-block h-3 w-3 rounded-full border border-current border-t-transparent animate-spin" aria-hidden="true" />
          ) : (
            <IconRefresh className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {combinedError ? (
        <div className="m-3 rounded border border-[rgba(255,90,90,.24)] bg-[var(--red-subtle)] px-3 py-2 text-[11px] text-[var(--red)]">
          {combinedError}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 flex">
        <aside className="w-[154px] min-w-[132px] max-w-[190px] shrink-0 border-r border-[var(--border-subtle)] bg-[rgba(255,255,255,.015)] overflow-y-auto">
          {files.length === 0 ? (
            <div className="px-3 py-4 text-[11px] text-[var(--muted-dim)]">No artifacts</div>
          ) : (
            <div className="p-2 space-y-1">
              {files.map((file) => {
                const Icon = iconForFilePath(file.path) ?? IconFile;
                const active = file.path === selectedPath;
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setSelectedPath(file.path)}
                    className={`w-full min-w-0 rounded-md border px-2 py-2 text-left transition-colors ${
                      active
                        ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--fg-secondary)]'
                        : 'border-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                    }`}
                    title={file.path}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate text-[11px] font-medium">{fileNameFromPath(file.path)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[9px] text-[var(--muted-dim)]">
                      <span>{formatArtifactTime(file.updatedAt)}</span>
                      <span aria-hidden="true">-</span>
                      <span>{formatArtifactSize(file.size)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <main className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
          {selectedFile ? (
            <>
              <div className="shrink-0 px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--panel)]">
                <div className="truncate text-[12px] font-medium text-[var(--fg-secondary)]">{selectedFile.path}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--muted-dim)]">
                  <span>{formatArtifactSize(selectedFile.size)}</span>
                  <span aria-hidden="true">-</span>
                  <span>{formatArtifactTime(selectedFile.updatedAt)}</span>
                  <span aria-hidden="true">-</span>
                  <span className="font-mono">{selectedFile.revision}</span>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-auto px-4 py-3">
                {selectedFile.content.trim() ? (
                  <MarkdownMessage text={selectedFile.content} />
                ) : (
                  <div className="text-[12px] text-[var(--muted-dim)]">Empty file</div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 min-h-0 flex items-center justify-center px-5 text-center">
              <div>
                <div className="mx-auto h-9 w-9 rounded-md border border-[var(--border-subtle)] bg-[var(--panel)] flex items-center justify-center text-[var(--muted)]">
                  <IconFile className="h-4 w-4" />
                </div>
                <div className="mt-3 text-[12px] text-[var(--fg-secondary)]">{loading ? 'Loading artifacts...' : 'No artifact selected'}</div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
