import React from 'react';
import { copyText } from './clipboard';
import { IconCopy, IconSpinner, IconTrash } from './icons';
import type { RepoSummary } from '../types';

type ReposModalProps = {
  repos: RepoSummary[];
  reposError: string | null | undefined;
  reposLoading: boolean;
  activeRepoPath: string;
  deletingRepos: Record<string, boolean>;
  onClose: () => void;
  onToggleActiveRepoPath: (repoPath: string) => void;
  onDeleteRepo: (repoPath: string) => void;
  getGithubUrlForRepo: (repo: RepoSummary) => string | null;
};

export function ReposModal({
  repos,
  reposError,
  reposLoading,
  activeRepoPath,
  deletingRepos,
  onClose,
  onToggleActiveRepoPath,
  onDeleteRepo,
  getGithubUrlForRepo,
}: ReposModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,.55)] backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-[560px] rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.35)] overflow-hidden animate-slide-up relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[var(--accent)] via-[var(--accent-muted)] to-transparent opacity-40" />
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <div className="font-semibold text-sm text-[var(--fg)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
            Repos ({repos.length})
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-7 h-7 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:border-[var(--border)] transition-all"
            title="Close"
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {reposError && (
            <div className="mx-4 mt-3 p-2 rounded border border-[rgba(255,90,90,.15)] bg-[var(--red-subtle)] text-[11px] text-[var(--red)]">
              Failed to load repos: {reposError}
            </div>
          )}
          {!reposLoading && repos.length === 0 && !reposError && (
            <div className="px-5 py-10 text-center">
              <div className="text-[var(--muted-dim)] text-[11px]">
                No repos registered. Run{' '}
                <code className="px-1.5 py-0.5 rounded bg-[rgba(167,139,250,.06)] border border-[rgba(167,139,250,.08)] text-[#C4B5FD] text-[10px]">
                  drone repo
                </code>{' '}
                to add one.
              </div>
            </div>
          )}
          {repos.length > 0 && (
            <div className="px-3 py-3 flex flex-col gap-0.5 select-none">
              {repos
                .slice()
                .sort((a, b) => a.path.localeCompare(b.path))
                .map((r) => {
                  const githubUrl = getGithubUrlForRepo(r);
                  const base = r.github ? `${r.github.owner}/${r.github.repo}` : r.path.split(/[\\/]/).filter(Boolean).pop() || r.path;
                  const selected = String(r.path) === String(activeRepoPath);
                  return (
                    <div
                      key={r.path}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        const p = String(r.path ?? '').trim();
                        if (!p) return;
                        onToggleActiveRepoPath(p);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          const p = String(r.path ?? '').trim();
                          if (!p) return;
                          onToggleActiveRepoPath(p);
                        }
                      }}
                      className={`group/repo px-3 py-2.5 rounded border transition-all flex items-start justify-between gap-2 ${
                        selected
                          ? 'bg-[var(--selected)] border-[var(--accent-muted)] shadow-[0_0_8px_rgba(167,139,250,.06)]'
                          : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--hover)]'
                      }`}
                      title={r.path}
                    >
                      <div className="min-w-0">
                        {githubUrl ? (
                          <a
                            href={githubUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                            className="text-[12px] text-[var(--fg-secondary)] truncate hover:underline"
                            title={githubUrl}
                          >
                            {base}
                          </a>
                        ) : (
                          <div className="text-[12px] text-[var(--fg-secondary)] truncate">{base}</div>
                        )}
                        <div className="text-[10px] text-[var(--muted-dim)] truncate font-mono mt-0.5">{r.path}</div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {githubUrl && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void copyText(githubUrl);
                            }}
                            className="opacity-0 pointer-events-none group-hover/repo:opacity-100 group-hover/repo:pointer-events-auto inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] border border-transparent hover:border-[var(--border-subtle)] transition-colors"
                            title="Copy GitHub URL"
                            aria-label="Copy GitHub URL"
                          >
                            <IconCopy className="opacity-80" />
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={Boolean(deletingRepos[r.path])}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onDeleteRepo(r.path);
                          }}
                          className={`opacity-0 pointer-events-none group-hover/repo:opacity-100 group-hover/repo:pointer-events-auto inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors ${
                            deletingRepos[r.path]
                              ? 'opacity-60 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                              : 'bg-[var(--red-subtle)] border-[rgba(248,81,73,.25)] text-[var(--red)] hover:bg-[rgba(248,81,73,.16)]'
                          }`}
                          title="Remove repo"
                          aria-label="Remove repo"
                        >
                          {deletingRepos[r.path] ? <IconSpinner className="opacity-90" /> : <IconTrash className="opacity-90" />}
                        </button>
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
