import React from 'react';
import { IconTrash } from './icons';
import type { CustomAgentProfile } from '../types';

type CustomAgentsModalProps = {
  open: boolean;
  customAgentError: string | null;
  customAgents: CustomAgentProfile[];
  newCustomAgentLabel: string;
  onNewCustomAgentLabelChange: (value: string) => void;
  newCustomAgentCommand: string;
  onNewCustomAgentCommandChange: (value: string) => void;
  onDeleteCustomAgent: (id: string) => void;
  onAddCustomAgent: () => void;
  onRequestClose: () => void;
};

export function CustomAgentsModal({
  open,
  customAgentError,
  customAgents,
  newCustomAgentLabel,
  onNewCustomAgentLabelChange,
  newCustomAgentCommand,
  onNewCustomAgentCommandChange,
  onDeleteCustomAgent,
  onAddCustomAgent,
  onRequestClose,
}: CustomAgentsModalProps) {
  if (!open) return null;

  const canAdd = Boolean(newCustomAgentLabel.trim()) && Boolean(newCustomAgentCommand.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,.55)] backdrop-blur-sm px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-[640px] rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.35)] overflow-hidden animate-slide-up relative">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[var(--accent)] via-[var(--accent-muted)] to-transparent opacity-40" />
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <div className="font-semibold text-sm text-[var(--fg)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>Custom agents</div>
          <button
            type="button"
            onClick={onRequestClose}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[var(--muted)] hover:text-[var(--fg-secondary)] hover:bg-[var(--hover)] border border-transparent hover:border-[var(--border-subtle)] transition-colors"
            title="Close"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4">
          {customAgentError && (
            <div className="mb-3 p-3 rounded-lg bg-[var(--red-subtle)] border border-[rgba(248,81,73,.2)] text-xs text-[var(--red)]">
              {customAgentError}
            </div>
          )}

          {customAgents.length > 0 && (
            <div className="mb-4">
              <div className="text-[11px] font-semibold text-[var(--muted)] mb-2">Saved</div>
              <div className="flex flex-col gap-2">
                {customAgents.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-[var(--fg-secondary)] truncate">{a.label}</div>
                      <div className="text-[11px] text-[var(--muted-dim)] truncate font-mono" title={a.command}>
                        {a.command}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteCustomAgent(a.id)}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-md border bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)] hover:text-[var(--red)] hover:border-[rgba(248,81,73,.35)] hover:bg-[var(--red-subtle)] transition-colors"
                      title={`Delete custom agent "${a.label}"`}
                      aria-label={`Delete custom agent "${a.label}"`}
                    >
                      <IconTrash className="opacity-80" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-[var(--muted)]">Name</span>
              <input
                value={newCustomAgentLabel}
                onChange={(e) => onNewCustomAgentLabelChange(e.target.value)}
                className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-muted)]"
                placeholder="e.g. My Agent CLI"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-[var(--muted)]">Command (runs inside tmux in the drone)</span>
              <input
                value={newCustomAgentCommand}
                onChange={(e) => onNewCustomAgentCommandChange(e.target.value)}
                className="h-9 rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-muted)] font-mono"
                placeholder="e.g. agent --approve-mcps  (or: codex)"
              />
            </label>
            <div className="text-[10px] text-[var(--muted-dim)]">
              Custom agents always use CLI mode (full tmux output). Built-in Cursor, Codex, Claude Code, and OpenCode use transcript mode by default.
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[var(--border)] bg-[var(--panel-alt)] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onRequestClose}
            className="h-9 px-3 rounded-lg text-[12px] font-semibold border transition-colors bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onAddCustomAgent}
            disabled={!canAdd}
            className={`h-9 px-4 rounded-lg text-[12px] font-semibold border transition-colors ${
              !canAdd
                ? 'opacity-50 cursor-not-allowed bg-[var(--panel-raised)] border-[var(--border-subtle)] text-[var(--muted)]'
                : 'bg-[var(--accent)] border-[var(--accent-muted)] text-[white] hover:brightness-110'
            }`}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
