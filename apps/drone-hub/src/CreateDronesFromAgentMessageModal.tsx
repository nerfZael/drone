import * as React from 'react';
import { UiMenuSelect } from './ui/menuSelect';

type EditableJob = {
  id: string;
  name: string;
  title: string;
  details: string;
};

type JobsModalState = {
  turn: number;
  message: string;
  jobs: EditableJob[];
  group: string;
  prefix: string;
  agentKey: string;
};

function IconSpinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function CreateDronesFromAgentMessageModal(props: {
  jobsModal: JobsModalState | null;
  builtinAgentOptions: Array<{ key: string; label: string }>;
  customAgents: Array<{ id: string; label: string }>;

  spawningAllJobs: boolean;
  spawningJobById: Record<string, boolean>;
  spawnedJobById: Record<string, boolean>;
  spawnJobErrorById: Record<string, string>;
  detailsOpenByJobId: Record<string, boolean>;

  isValidDroneName: (name: string) => boolean;

  onClose: () => void;
  onSpawnAll: () => void;
  onSpawnOne: (jobId: string) => void;
  onSpawnJob: (job: EditableJob, group: string, prefix: string, agentKey: string) => void;

  onOpenCustomAgents: () => void;
  onChangeGroup: (value: string) => void;
  onClearGroup: () => void;
  onChangeAgentKey: (value: string) => void;
  onChangePrefix: (value: string) => void;
  onClearPrefix: () => void;
  onUpdateJob: (jobId: string, patch: Partial<Pick<EditableJob, 'name' | 'title' | 'details'>>) => void;
  onToggleDetails: (jobId: string) => void;
}) {
  const { jobsModal } = props;
  if (!jobsModal) return null;
  const agentMenuEntries = React.useMemo(
    () => [
      ...props.builtinAgentOptions.map((o) => ({ value: o.key, label: o.label })),
      ...(props.customAgents.length > 0
        ? [
            { kind: 'separator' as const },
            ...props.customAgents.map((a) => ({ value: `custom:${a.id}`, label: `Custom: ${a.label}` })),
          ]
        : []),
    ],
    [props.builtinAgentOptions, props.customAgents]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,.55)] backdrop-blur-sm px-4" role="dialog" aria-modal="true">
      <div
        className="w-full max-w-[760px] rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.35)] overflow-hidden animate-slide-up relative"
        onKeyDownCapture={(e) => {
          // Ctrl+Enter: spawn focused job (if inside a job card)
          // Ctrl+Shift+Enter: spawn all (anywhere in popup)
          if (e.key !== 'Enter') return;
          if (!e.ctrlKey) return;

          if (e.shiftKey) {
            if (e.repeat) return;
            e.preventDefault();
            e.stopPropagation();
            props.onSpawnAll();
            return;
          }

          const target = e.target as any;
          if (!target || typeof target.closest !== 'function') return;
          const card = target.closest('[data-job-id]') as HTMLElement | null;
          const jobId = card?.dataset?.jobId;
          if (!jobId) return;
          e.preventDefault();
          e.stopPropagation();
          props.onSpawnOne(jobId);
        }}
      >
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[var(--accent)] via-[var(--accent-muted)] to-transparent opacity-40" />
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-sm text-[var(--fg)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>Create drones from agent message</div>
            <div className="text-[10px] text-[var(--muted)] mt-0.5 font-mono">
              {jobsModal.jobs.length} job{jobsModal.jobs.length === 1 ? '' : 's'} detected
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={props.onSpawnAll}
              disabled={props.spawningAllJobs}
              className={`h-8 px-4 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                props.spawningAllJobs
                  ? 'opacity-70 cursor-wait bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)]'
                  : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
              }`}
              style={{ fontFamily: 'var(--display)' }}
              title="Spawn all drones (one per job)"
            >
              {props.spawningAllJobs ? (
                <span className="inline-flex items-center gap-2">
                  <IconSpinner className="w-3.5 h-3.5" />
                  Queuing…
                </span>
              ) : (
                'Spawn all'
              )}
            </button>
            <button
              type="button"
              onClick={props.onClose}
              className="inline-flex items-center justify-center w-7 h-7 rounded border border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] transition-colors"
              title="Close"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="px-5 py-4 max-h-[70vh] overflow-auto">
          <div className="mb-4">
            <div className="text-[10px] font-semibold text-[var(--muted-dim)] mb-1.5 tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>Group for spawned drones</div>
            <div className="flex items-center gap-2">
              <input
                value={jobsModal.group}
                onChange={(e) => props.onChangeGroup(e.target.value)}
                className="flex-1 h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors"
                placeholder="e.g. auth, billing, frontend"
              />
              <button
                type="button"
                onClick={props.onClearGroup}
                className="h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)] hover:bg-[var(--hover)] hover:text-[var(--muted)]"
                style={{ fontFamily: 'var(--display)' }}
                title="Clear group"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="mb-4">
            <div className="text-[10px] font-semibold text-[var(--muted-dim)] mb-1.5 tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>Agent for spawned drones</div>
            <div className="flex items-center gap-2">
              <UiMenuSelect
                variant="form"
                value={jobsModal.agentKey}
                onValueChange={props.onChangeAgentKey}
                entries={agentMenuEntries}
                triggerClassName="flex-1"
                panelClassName="right-auto w-[460px] max-w-[calc(100vw-3rem)]"
                title="Choose which agent implementation to use for the default chat in all spawned drones."
              />
              <button
                type="button"
                onClick={props.onOpenCustomAgents}
                className="h-9 px-3 rounded-lg text-[12px] font-semibold border transition-colors bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                title="Manage saved custom agents"
              >
                Custom…
              </button>
            </div>
          </div>

          <div className="mb-4">
            <div className="text-[11px] font-semibold text-[var(--muted)] mb-1">Prefix message (sent to every spawned drone)</div>
            <div className="flex items-start gap-2">
              <textarea
                value={jobsModal.prefix}
                onChange={(e) => props.onChangePrefix(e.target.value)}
                rows={2}
                className="flex-1 min-h-[56px] resize-y rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 py-2 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none"
                placeholder="e.g. First, please check out branch origin/refactor/server-app-entrypoint"
              />
              <button
                type="button"
                onClick={props.onClearPrefix}
                className="h-9 px-3 rounded-lg text-[12px] font-semibold border transition-colors bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                title="Clear prefix"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {jobsModal.jobs.map((j) => {
              // Important: don't `trim()` controlled input values.
              // Trimming here would delete trailing spaces as the user types (e.g. "hello␠"),
              // making it feel like the spacebar doesn't work.
              const nameRaw = String(j?.name ?? '');
              const titleRaw = String(j?.title ?? '');
              const detailsRaw = String(j?.details ?? '');

              const name = nameRaw.trim();
              const title = titleRaw;
              const detailsTrimmed = detailsRaw.trim();
              const detailsPreview = (() => {
                if (!detailsTrimmed) return '';
                const lines = detailsTrimmed
                  .split('\n')
                  .map((l) => l.trimEnd())
                  .filter((l) => l.trim().length > 0);
                const head = lines.slice(0, 4).join('\n');
                const s = head.length > 420 ? `${head.slice(0, 420).trimEnd()}…` : head;
                return s;
              })();
              const spawning = Boolean(props.spawningJobById[j.id]);
              const spawned = Boolean(props.spawnedJobById[j.id]);
              const err = String(props.spawnJobErrorById[j.id] ?? '').trim();
              const detailsOpen = Boolean(props.detailsOpenByJobId[j.id]);
              const invalidName = Boolean(nameRaw) && (/\s/.test(nameRaw) || !props.isValidDroneName(name));
              const dupName = Boolean(name) && jobsModal.jobs.filter((x) => String((x as any)?.name ?? '').trim() === name).length > 1;
              return (
                <div
                  key={j.id}
                  data-job-id={j.id}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-4 py-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="grid grid-cols-1 gap-2">
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] font-semibold text-[var(--muted-dim)]">Drone name (dash-case)</span>
                          <input
                            value={nameRaw}
                            onChange={(e) => props.onUpdateJob(j.id, { name: e.target.value })}
                            className={`w-full h-9 rounded-lg border bg-[var(--panel-raised)] px-3 text-[13px] font-mono text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none ${
                              invalidName || dupName ? 'border-[rgba(248,81,73,.35)]' : 'border-[var(--border-subtle)]'
                            }`}
                            placeholder="e.g. split-server-app"
                          />
                          {(invalidName || dupName) && (
                            <span className="text-[10px] text-[var(--red)]">
                              {dupName ? 'Duplicate name in list.' : 'Invalid name. Use dash-case with no spaces, max 48 chars.'}
                            </span>
                          )}
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[10px] font-semibold text-[var(--muted-dim)]">Title</span>
                          <input
                            value={title}
                            onChange={(e) => props.onUpdateJob(j.id, { title: e.target.value })}
                            className="w-full h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none"
                            placeholder="One-line title"
                          />
                        </label>
                      </div>

                      {detailsTrimmed && (
                        <div className="mt-2">
                          {!detailsOpen && detailsPreview && (
                            <div className="text-[11px] leading-[1.6] text-[var(--muted-dim)] whitespace-pre-wrap border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] rounded-lg px-3 py-2">
                              {detailsPreview}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => props.onToggleDetails(j.id)}
                            className="text-[11px] font-semibold text-[var(--accent)] hover:text-[var(--fg)] transition-colors"
                          >
                            {detailsOpen ? 'Hide full details' : 'Show full details'}
                          </button>
                          {detailsOpen && (
                            <textarea
                              value={detailsRaw}
                              onChange={(e) => props.onUpdateJob(j.id, { details: e.target.value })}
                              rows={8}
                              className="mt-2 w-full resize-y text-[11.5px] leading-[1.6] text-[var(--fg-secondary)] whitespace-pre-wrap border border-[var(--border-subtle)] bg-[var(--panel-raised)] rounded-lg px-3 py-2 focus:outline-none"
                            />
                          )}
                        </div>
                      )}
                      {err && (
                        <div className="mt-2 text-[11px] text-[var(--red)] whitespace-pre-wrap" title={err}>
                          {err}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => props.onSpawnJob(j, jobsModal.group, jobsModal.prefix, jobsModal.agentKey)}
                      disabled={spawning || spawned || !name || invalidName || dupName}
                      className={`flex-shrink-0 h-8 px-3 rounded-lg text-[12px] font-semibold border transition-colors ${
                        spawning || spawned || !name || invalidName || dupName
                          ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                          : 'bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                      }`}
                      title={spawned ? 'Drone spawned' : 'Spawn drone for this job'}
                    >
                      {spawning ? (
                        <span className="inline-flex items-center gap-2">
                          <IconSpinner className="w-3.5 h-3.5" />
                          Spawning…
                        </span>
                      ) : spawned ? (
                        'Spawned'
                      ) : (
                        'Spawn'
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
