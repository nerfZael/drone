import React from 'react';

import { IconWrench } from '../app/icons';
import { IconFolder } from '../icons';

import type {
  AssistantScopeMode,
  AssistantSystemPromptSettings,
  AssistantThreadSystemPromptSettings,
  AssistantToolSummary,
  AssistantWorkspaceSummary,
} from './assistant-types';

export function ScopeModeControl({
  label,
  mode,
  onChange,
}: {
  label: string;
  mode: AssistantScopeMode;
  onChange: (mode: AssistantScopeMode) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] p-0.5">
      <div
        className="px-1 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]"
        style={{ fontFamily: 'var(--display)' }}
      >
        {label}
      </div>
      <button
        type="button"
        onClick={() => onChange('all')}
        className={`h-5 rounded px-1.5 text-[9px] font-semibold uppercase tracking-wide ${
          mode === 'all'
            ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
            : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
        }`}
        style={{ fontFamily: 'var(--display)' }}
      >
        All
      </button>
      <button
        type="button"
        onClick={() => onChange('selected')}
        className={`h-5 rounded px-1.5 text-[9px] font-semibold uppercase tracking-wide ${
          mode === 'selected'
            ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
            : 'text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
        }`}
        style={{ fontFamily: 'var(--display)' }}
      >
        Selected
      </button>
    </div>
  );
}

export function AssistantToolsPanel({
  tools,
  enabledTools,
  disabled,
  onToggleTool,
  onToggleTools,
  onEnableAll,
  onDisableAll,
  onClose,
  variant = 'popover',
  placement = 'top',
}: {
  tools: AssistantToolSummary[];
  enabledTools: string[];
  disabled: boolean;
  onToggleTool: (toolName: string, enabled: boolean) => void;
  onToggleTools: (toolNames: string[], enabled: boolean) => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
  onClose?: () => void;
  variant?: 'popover' | 'settings';
  placement?: 'top' | 'composer';
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (variant !== 'popover' || !onClose) return;
    const dismiss = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest?.('[data-assistant-tools-trigger]')) return;
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [onClose, variant]);
  const enabled = new Set(enabledTools);
  const { ungroupedTools, mcpGroups } = React.useMemo(() => {
    const ungroupedTools: AssistantToolSummary[] = [];
    const groups = new Map<string, { label: string; tools: AssistantToolSummary[] }>();
    for (const tool of tools) {
      if (!tool.group || tool.group.kind !== 'mcp') {
        ungroupedTools.push(tool);
        continue;
      }
      const current = groups.get(tool.group.id) ?? { label: tool.group.label, tools: [] };
      current.tools.push(tool);
      groups.set(tool.group.id, current);
    }
    return { ungroupedTools, mcpGroups: Array.from(groups.entries()) };
  }, [tools]);

  const renderTool = (tool: AssistantToolSummary) => {
    const checked = enabled.has(tool.name);
    return (
      <label key={tool.name} className={`flex cursor-pointer items-start gap-2 rounded border border-[var(--border-subtle)] px-2 py-1.5 transition-colors ${checked ? 'bg-[rgba(255,255,255,.055)]' : 'bg-[rgba(255,255,255,.02)] hover:bg-[var(--hover)]'}`}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onToggleTool(tool.name, event.target.checked)} className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 accent-[var(--accent)]" />
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-medium text-[var(--fg-secondary)]">{tool.label}</span>
          <span className="mt-0.5 block text-[10px] leading-snug text-[var(--muted-dim)]">{tool.description}</span>
        </span>
      </label>
    );
  };

  return (
    <div ref={panelRef} className={variant === 'popover'
      ? `absolute right-2 z-30 w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_18px_55px_rgba(0,0,0,.48)] ${placement === 'composer' ? 'bottom-full mb-2' : 'top-10'}`
      : 'overflow-hidden rounded border border-[var(--border)] bg-[rgba(0,0,0,.10)]'}>
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <IconWrench className="h-3.5 w-3.5 text-[var(--muted)]" />
          <div
            className="text-[12px] font-semibold text-[var(--fg)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            {variant === 'settings' ? 'Default tools' : 'Tools'}
          </div>
        </div>
        <div className="text-[10px] tabular-nums text-[var(--muted-dim)]">{enabledTools.length} / {tools.length}</div>
      </div>
      <div className="flex items-center border-b border-[var(--border-subtle)] px-3 py-1.5">
        <div className="inline-flex overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]" role="group" aria-label="Set all tools">
          <button type="button" onClick={onEnableAll} disabled={disabled || enabledTools.length === tools.length} className="h-5 px-2 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-35" title="Enable every tool">All</button>
          <button type="button" onClick={onDisableAll} disabled={disabled || enabledTools.length === 0} className="h-5 border-l border-[var(--border-subtle)] px-2 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-35" title="Disable every tool">None</button>
        </div>
      </div>
      <div className={variant === 'popover' ? 'max-h-[min(520px,calc(100vh-190px))] overflow-y-auto p-2' : 'p-2'}>
        {ungroupedTools.length > 0 ? <section className="mb-3"><div className="space-y-1">{ungroupedTools.map(renderTool)}</div></section> : null}
        {mcpGroups.map(([groupId, group]) => {
          const groupToolNames = group.tools.map((tool) => tool.name);
          const enabledCount = groupToolNames.filter((name) => enabled.has(name)).length;
          return (
            <section key={groupId} className="mb-3 last:mb-0">
              <div className="mb-1 flex items-center gap-1 px-1">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>{group.label}</div>
                <div className="text-[9px] text-[var(--muted-dim)]">{enabledCount} / {group.tools.length}</div>
                <div className="ml-auto inline-flex overflow-hidden rounded border border-[var(--border-subtle)]">
                  <button type="button" onClick={() => onToggleTools(groupToolNames, true)} disabled={disabled || enabledCount === group.tools.length} className="h-5 px-1.5 text-[8px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-35" title={`Enable all ${group.label} tools`}>All</button>
                  <button type="button" onClick={() => onToggleTools(groupToolNames, false)} disabled={disabled || enabledCount === 0} className="h-5 border-l border-[var(--border-subtle)] px-1.5 text-[8px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-35" title={`Disable all ${group.label} tools`}>None</button>
                </div>
              </div>
              <div className="space-y-1">{group.tools.map(renderTool)}</div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function AssistantWorkspacesPanel({
  workspaces,
  enabledWorkspaceIds,
  disabled,
  onToggleWorkspace,
  onEnableAll,
  onDisableAll,
  onOpenRemoteAccess,
  onClose,
  placement = 'top',
}: {
  workspaces: AssistantWorkspaceSummary[];
  enabledWorkspaceIds: string[];
  disabled: boolean;
  onToggleWorkspace: (workspaceId: string, enabled: boolean) => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
  onOpenRemoteAccess: () => void;
  onClose: () => void;
  placement?: 'top' | 'composer';
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest?.('[data-assistant-workspaces-trigger]')) return;
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [onClose]);
  const enabled = new Set(enabledWorkspaceIds);

  return (
    <div ref={panelRef} className={`absolute right-2 z-30 w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_18px_55px_rgba(0,0,0,.48)] ${placement === 'composer' ? 'bottom-full mb-2' : 'top-10'}`}>
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <IconFolder className="h-3.5 w-3.5 text-[var(--muted)]" />
          <div className="text-[12px] font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>Workspaces</div>
        </div>
        <div className="text-[10px] tabular-nums text-[var(--muted-dim)]">{enabledWorkspaceIds.length} / {workspaces.length}</div>
      </div>
      <div className="flex items-center border-b border-[var(--border-subtle)] px-3 py-1.5">
        <div className="inline-flex overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]" role="group" aria-label="Set all workspaces">
          <button type="button" onClick={onEnableAll} disabled={disabled || enabledWorkspaceIds.length === workspaces.length} className="h-5 px-2 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-35">All</button>
          <button type="button" onClick={onDisableAll} disabled={disabled || enabledWorkspaceIds.length === 0} className="h-5 border-l border-[var(--border-subtle)] px-2 text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:opacity-35">None</button>
        </div>
      </div>
      <div className="max-h-[min(520px,calc(100vh-190px))] overflow-y-auto p-2">
        <div className="space-y-1">
          {workspaces.map((workspace) => {
            const checked = enabled.has(workspace.id);
            return (
              <label key={workspace.id} className={`flex cursor-pointer items-start gap-2 rounded border border-[var(--border-subtle)] px-2 py-1.5 transition-colors ${checked ? 'bg-[rgba(255,255,255,.055)]' : 'bg-[rgba(255,255,255,.02)] hover:bg-[var(--hover)]'}`}>
                <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onToggleWorkspace(workspace.id, event.target.checked)} className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 accent-[var(--accent)]" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="block truncate text-[11px] font-medium text-[var(--fg-secondary)]">{workspace.label}</span>
                    <span className="text-[8px] font-semibold uppercase tracking-wide text-[var(--muted-dim)]">{workspace.kind === 'artifacts' ? 'Private' : workspace.capabilities.join(' · ')}</span>
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-[var(--muted-dim)]">{workspace.description}</span>
                </span>
              </label>
            );
          })}
          {workspaces.length === 0 ? <div className="px-2 py-5 text-center text-[10px] text-[var(--muted-dim)]">No local workspaces are available.</div> : null}
        </div>
      </div>
      <button type="button" onClick={onOpenRemoteAccess} className="flex w-full items-center justify-between border-t border-[var(--border-subtle)] px-3 py-2 text-left text-[10px] font-semibold text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]">
        <span>Connected-device workspaces</span>
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

type PromptDiffLine = {
  kind: 'same' | 'add' | 'remove';
  text: string;
  oldLine?: number;
  newLine?: number;
};

function promptDiffLines(oldText: string, newText: string): PromptDiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const dp: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    Array(newLines.length + 1).fill(0),
  );
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      dp[i][j] =
        oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lines: PromptDiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldLine = 1;
  let newLine = 1;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      lines.push({ kind: 'same', text: oldLines[i], oldLine, newLine });
      i += 1;
      j += 1;
      oldLine += 1;
      newLine += 1;
    } else if (j < newLines.length && (i >= oldLines.length || dp[i][j + 1] >= dp[i + 1][j])) {
      lines.push({ kind: 'add', text: newLines[j], newLine });
      j += 1;
      newLine += 1;
    } else if (i < oldLines.length) {
      lines.push({ kind: 'remove', text: oldLines[i], oldLine });
      i += 1;
      oldLine += 1;
    }
  }
  return lines;
}

function AssistantPromptDiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const lines = React.useMemo(() => promptDiffLines(oldText, newText), [oldText, newText]);
  const changed = lines.some((line) => line.kind !== 'same');
  return (
    <div className="mt-3 overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <div
          className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          Promotion diff
        </div>
        <div className="text-[10px] text-[var(--muted-dim)]">Global to chat draft</div>
      </div>
      <div className="max-h-[260px] overflow-auto font-mono text-[11px] leading-relaxed">
        {!changed ? (
          <div className="px-3 py-3 text-[var(--muted-dim)]">No differences.</div>
        ) : (
          lines.map((line, index) => {
            const tone =
              line.kind === 'add'
                ? 'bg-[rgba(52,211,153,.08)] text-[#a7f3d0]'
                : line.kind === 'remove'
                  ? 'bg-[rgba(255,90,90,.08)] text-[#fecaca]'
                  : 'text-[var(--muted)]';
            const marker = line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' ';
            return (
              <div
                key={`${index}:${line.kind}`}
                className={`grid grid-cols-[4.5rem_1rem_minmax(0,1fr)] gap-2 px-2 py-0.5 ${tone}`}
              >
                <span className="select-none text-right text-[var(--muted-dim)]">
                  {line.kind === 'add' ? '' : line.oldLine}
                  <span className="px-1 text-[var(--muted-dim)]">/</span>
                  {line.kind === 'remove' ? '' : line.newLine}
                </span>
                <span className="select-none text-[var(--muted-dim)]">{marker}</span>
                <span className="min-w-0 whitespace-pre-wrap break-words">{line.text || ' '}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function AssistantSystemPromptModal({
  mode,
  settings,
  draft,
  threadSettings,
  threadDraft,
  loading,
  saving,
  threadSaving,
  promoting,
  error,
  notice,
  onModeChange,
  onDraftChange,
  onThreadDraftChange,
  onUseGlobalForThread,
  onUseDefaultForGlobal,
  onClose,
  onSaveGlobal,
  onSaveThread,
  onPromoteThread,
}: {
  mode: 'thread' | 'global';
  settings: AssistantSystemPromptSettings | null;
  draft: string;
  threadSettings: AssistantThreadSystemPromptSettings | null;
  threadDraft: string;
  loading: boolean;
  saving: boolean;
  threadSaving: boolean;
  promoting: boolean;
  error: string | null;
  notice: string | null;
  onModeChange: (mode: 'thread' | 'global') => void;
  onDraftChange: (value: string) => void;
  onThreadDraftChange: (value: string) => void;
  onUseGlobalForThread: () => void;
  onUseDefaultForGlobal: () => void;
  onClose: () => void;
  onSaveGlobal: () => void;
  onSaveThread: () => void;
  onPromoteThread: () => void;
}) {
  const [diffOpen, setDiffOpen] = React.useState(false);
  const activeGlobalSettings = settings?.assistantSystemPrompt;
  const currentPrompt = activeGlobalSettings?.prompt ?? '';
  const currentThreadPrompt = threadSettings?.threadSystemPrompt.prompt ?? '';
  const currentGlobalPrompt = threadSettings?.threadSystemPrompt.globalPrompt ?? currentPrompt;
  const maxChars =
    (mode === 'thread'
      ? threadSettings?.threadSystemPrompt.maxPromptChars
      : activeGlobalSettings?.maxPromptChars) ?? 20_000;
  const activeGlobalDraft = draft;
  const globalDirty = activeGlobalDraft !== currentPrompt;
  const threadDirty = threadDraft !== currentThreadPrompt;
  const globalSaveDisabled = loading || saving || !globalDirty || !activeGlobalDraft.trim();
  const threadSaveDisabled = loading || threadSaving || !threadDirty || !threadDraft.trim();
  const activeDraft = mode === 'thread' ? threadDraft : activeGlobalDraft;
  const activeSource =
    mode === 'thread'
      ? (threadSettings?.threadSystemPrompt.promptSource ?? 'thread')
      : (activeGlobalSettings?.promptSource ?? 'default');

  React.useEffect(() => {
    if (mode !== 'thread') setDiffOpen(false);
  }, [mode]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-3 py-4">
      <div className="flex max-h-[min(760px,calc(100vh-2rem))] w-[min(860px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_24px_80px_rgba(0,0,0,.55)]">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <div
              className="text-[13px] font-semibold text-[var(--fg)]"
              style={{ fontFamily: 'var(--display)' }}
            >
              Built-in agent system prompts
            </div>
            <div className="mt-1 text-[11px] text-[var(--muted-dim)]">
              Chat changes affect only the current chat. Global changes apply to new chats.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
            style={{ fontFamily: 'var(--display)' }}
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-3 grid h-8 w-full max-w-[280px] grid-cols-2 overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]">
            {(['thread', 'global'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onModeChange(item)}
                aria-pressed={mode === item}
                className={`text-[10px] font-semibold uppercase tracking-wide ${
                  mode === item
                    ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'text-[var(--muted)] hover:bg-[rgba(255,255,255,.025)] hover:text-[var(--fg-secondary)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                {item === 'thread' ? 'This chat' : 'Global'}
              </button>
            ))}
          </div>
          {error ? (
            <div className="mb-3 rounded border border-[rgba(255,90,90,.35)] bg-[rgba(255,90,90,.08)] px-3 py-2 text-[11px] text-[var(--red)]">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="mb-3 rounded border border-[rgba(52,211,153,.2)] bg-[rgba(16,185,129,.08)] px-3 py-2 text-[11px] text-[#34d399]">
              {notice}
            </div>
          ) : null}
          <label className="flex min-h-0 flex-col gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">
              Prompt
            </span>
            <textarea
              value={activeDraft}
              onChange={(event) =>
                mode === 'thread'
                  ? onThreadDraftChange(event.target.value)
                  : onDraftChange(event.target.value)
              }
              disabled={loading || saving || threadSaving || promoting}
              maxLength={maxChars}
              rows={20}
              className="min-h-[360px] resize-y rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] px-3 py-2 font-mono text-[12px] leading-relaxed text-[var(--fg)] placeholder:text-[var(--muted-dim)] transition-colors focus:border-[var(--accent-muted)] focus:outline-none disabled:opacity-50"
              placeholder={
                loading ? 'Loading system prompt...' : 'Enter the Built-in agent system prompt'
              }
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--muted-dim)]">
            <span>Source: {activeSource}</span>
            <span>
              {activeDraft.length.toLocaleString()} / {maxChars.toLocaleString()}
            </span>
          </div>
          <div className="mt-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-2 text-[11px] leading-relaxed text-[var(--muted-dim)]">
            {(mode === 'thread'
              ? threadSettings?.threadSystemPrompt.runtimeAppendix
              : activeGlobalSettings?.runtimeAppendix) ??
              'Access-scope instructions are appended at run time.'}
          </div>
          {mode === 'thread' && diffOpen ? (
            <AssistantPromptDiffView oldText={currentGlobalPrompt} newText={threadDraft} />
          ) : null}
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          {mode === 'thread' ? (
            <>
              <button
                type="button"
                onClick={() => setDiffOpen((value) => !value)}
                disabled={loading}
                className="mr-auto h-9 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-45"
                style={{ fontFamily: 'var(--display)' }}
              >
                {diffOpen ? 'Hide diff' : 'Show diff'}
              </button>
              <button
                type="button"
                onClick={onUseGlobalForThread}
                disabled={loading || threadSaving || promoting}
                className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-45"
                style={{ fontFamily: 'var(--display)' }}
              >
                Use global
              </button>
              <button
                type="button"
                onClick={onPromoteThread}
                disabled={loading || threadSaving || promoting || !threadDraft.trim()}
                className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-45"
                style={{ fontFamily: 'var(--display)' }}
              >
                {promoting ? 'Promoting...' : 'Promote to global'}
              </button>
              <button
                type="button"
                onClick={onSaveThread}
                disabled={threadSaveDisabled}
                className={`h-9 rounded border px-3 text-[11px] font-semibold uppercase tracking-wide ${
                  threadSaveDisabled
                    ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] opacity-45'
                    : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                {threadSaving ? 'Saving...' : 'Save for this chat'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onUseDefaultForGlobal}
                disabled={loading || saving || promoting}
                className="h-9 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)] disabled:cursor-not-allowed disabled:opacity-45"
                style={{ fontFamily: 'var(--display)' }}
              >
                Use default
              </button>
              <button
                type="button"
                onClick={onSaveGlobal}
                disabled={globalSaveDisabled}
                className={`h-9 rounded border px-3 text-[11px] font-semibold uppercase tracking-wide ${
                  globalSaveDisabled
                    ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] opacity-45'
                    : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                {saving ? 'Saving...' : 'Save for new chats'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
