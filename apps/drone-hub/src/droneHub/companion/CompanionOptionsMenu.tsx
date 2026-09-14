import React from 'react';
import { contextMenuItemBaseClass, contextMenuSeparatorClass } from '../../ui/dropdown';
import { useCompanion } from './CompanionContext';
import { CompanionCurrentWorkspaceAccess } from './CompanionCurrentWorkspaceAccess';
import { CompanionLivePanel } from './CompanionLivePanel';
import { CompanionModelPicker } from './CompanionModelPicker';

const iconProps = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export function CompanionMenuSection({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      {label ? <div className="dh-type-eyebrow px-2.5 pb-0.5 pt-2">{label}</div> : null}
      {children}
    </div>
  );
}

export function CompanionMenuSeparator() {
  return <div role="separator" className={contextMenuSeparatorClass} />;
}

/** One row of the Companion options menu: icon, label, optional meta on the right, and a switch or chevron as its state. */
export function CompanionMenuItem({
  icon,
  label,
  description,
  meta,
  tone = 'neutral',
  disabled = false,
  checked,
  expanded,
  controls,
  onSelect,
}: {
  icon?: React.ReactNode;
  label: string;
  /** Accessible and hover title; defaults to the label. */
  description?: string;
  meta?: React.ReactNode;
  tone?: 'neutral' | 'danger';
  disabled?: boolean;
  /** Renders a switch; the row stays open so the state change is visible. */
  checked?: boolean;
  /** Renders a chevron for rows that open something. */
  expanded?: boolean;
  controls?: string;
  onSelect(): void;
}) {
  const color = tone === 'danger'
    ? 'text-[var(--red)] hover:bg-[var(--red-subtle)]'
    : 'text-[var(--fg-secondary)] hover:bg-[var(--hover)] hover:text-[var(--fg)]';
  return (
    <button
      type="button"
      role={checked === undefined ? undefined : 'switch'}
      aria-checked={checked}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={description}
      title={description}
      disabled={disabled}
      onClick={onSelect}
      className={`${contextMenuItemBaseClass} ${color}`}
    >
      <span className="flex w-4 shrink-0 items-center justify-center text-[var(--muted)]">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta ? <span className="dh-type-menu-meta shrink-0 truncate">{meta}</span> : null}
      {checked !== undefined ? (
        <span aria-hidden="true" className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${checked ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}>
          <span className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-3' : ''}`} />
        </span>
      ) : expanded !== undefined ? (
        <svg {...iconProps} className={`shrink-0 text-[var(--muted-dim)] transition-transform ${expanded ? 'rotate-90' : ''}`}><path d="m9 6 6 6-6 6" /></svg>
      ) : null}
    </button>
  );
}

export function CompanionOptionsMenu({
  historyOpen,
  onToggleHistory,
  onOpenWorkspaces,
  onOpenPrompt,
  onOpenInstructions,
  workspacePickerOpen,
  promptEditorOpen,
  instructionsEditorOpen,
  onClose,
}: {
  historyOpen: boolean;
  onToggleHistory(): void;
  onOpenWorkspaces(): void;
  onOpenPrompt(): void;
  onOpenInstructions(): void;
  workspacePickerOpen: boolean;
  promptEditorOpen: boolean;
  instructionsEditorOpen: boolean;
  onClose(): void;
}) {
  const companion = useCompanion();
  if (!companion) return null;
  const live = companion.live;
  const liveConversation = live?.status === 'listening' || live?.status === 'connecting';
  const plainRecording = !liveConversation && companion.status === 'recording';
  const preparing = !liveConversation && (companion.status === 'starting' || companion.status === 'transcribing');
  const working = companion.status === 'working';
  const latestExecutionFailed = companion.proposalHistory[companion.proposalHistory.length - 1]?.execution.ok === false;
  const pick = (action: () => void) => () => { action(); onClose(); };

  const stopIcon = <svg {...iconProps} fill="currentColor" stroke="none"><rect x="7" y="7" width="10" height="10" rx="1" /></svg>;
  const crossIcon = <svg {...iconProps}><path d="M6 6l12 12M18 6L6 18" /></svg>;

  return (
    <>
      {working || plainRecording || preparing ? (
        <>
          <CompanionMenuSection label="Session">
            {working ? (
              <CompanionMenuItem tone="danger" icon={stopIcon}
                label="Stop turn"
                description={liveConversation ? 'Stop Companion turn and end voice' : 'Stop Companion turn'}
                onSelect={pick(companion.stop)} />
            ) : null}
            {plainRecording ? (
              <>
                <CompanionMenuItem icon={companion.recordingPaused
                    ? <svg {...iconProps}><path d="M8 5v14l11-7Z" /></svg>
                    : <svg {...iconProps}><path d="M9 5v14M15 5v14" /></svg>}
                  label={companion.recordingPaused ? 'Resume recording' : 'Pause recording'}
                  onSelect={pick(companion.toggleRecordingPause)} />
                <CompanionMenuItem icon={stopIcon} label="Finish recording and send" onSelect={pick(() => void companion.toggle())} />
              </>
            ) : null}
            {plainRecording || preparing ? (
              <CompanionMenuItem tone="danger" icon={crossIcon} label="Discard recording" onSelect={pick(() => void companion.discardRecording())} />
            ) : null}
          </CompanionMenuSection>
          <CompanionMenuSeparator />
        </>
      ) : null}

      <CompanionMenuSection label="Companion">
        <CompanionMenuItem
          icon={<svg {...iconProps}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>}
          label="Execution history"
          description={companion.proposalHistory.length > 0
            ? `${historyOpen ? 'Hide' : 'Show'} execution history${latestExecutionFailed ? '; latest execution failed' : ''}`
            : 'No proposals executed this session'}
          meta={companion.proposalHistory.length > 0
            ? <span className={latestExecutionFailed ? 'text-[var(--red)]' : undefined}>{latestExecutionFailed ? 'Failed' : companion.proposalHistory.length}</span>
            : undefined}
          disabled={companion.proposalHistory.length === 0}
          expanded={historyOpen}
          controls="companion-proposal-history"
          onSelect={pick(onToggleHistory)}
        />
        <CompanionMenuItem
          icon={<svg {...iconProps}><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z" /></svg>}
          label="Workspaces"
          description="Companion workspaces"
          expanded={workspacePickerOpen}
          controls="companion-workspace-picker"
          onSelect={pick(onOpenWorkspaces)}
        />
        <CompanionMenuItem
          icon={<svg {...iconProps}><path d="m16 3 5 5-12 12-6 1 1-6Z" /><path d="m14 5 5 5" /></svg>}
          label="System prompt"
          description="Edit Companion system prompt"
          expanded={promptEditorOpen}
          controls="companion-prompt-editor"
          onSelect={pick(onOpenPrompt)}
        />
        <CompanionMenuItem
          icon={<svg {...iconProps}><path d="M4 3h12l4 4v14H4Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg>}
          label="Instructions"
          description="Edit Companion instructions"
          expanded={instructionsEditorOpen}
          controls="companion-instructions-editor"
          onSelect={pick(onOpenInstructions)}
        />
      </CompanionMenuSection>

      {live ? (
        <>
          <CompanionMenuSeparator />
          <CompanionMenuSection label="Voice">
            <CompanionMenuItem
              icon={<svg {...iconProps}><path d="M3 10v4M7 6v12M12 3v18M17 6v12M21 10v4" /></svg>}
              label="Live voice"
              description={live.loading ? 'Loading Live voice setting' : live.saving ? 'Saving Live voice setting'
                : `Live voice ${live.enabled ? 'on' : 'off'}; remembered across Companion sessions`}
              meta={live.loading ? 'Loading…' : live.saving ? 'Saving…' : undefined}
              checked={live.enabled}
              disabled={live.loading || live.saving || companion.switchingVoice || ['starting', 'transcribing'].includes(companion.status)}
              onSelect={() => void companion.toggleLiveVoice()}
            />
            <CompanionLivePanel />
          </CompanionMenuSection>
        </>
      ) : null}

      <CompanionMenuSeparator />
      <CompanionMenuSection label="Model">
        <CompanionModelPicker />
      </CompanionMenuSection>

      <CompanionMenuSeparator />
      <CompanionMenuSection label="Workspace access">
        <CompanionCurrentWorkspaceAccess refreshKey={workspacePickerOpen} />
      </CompanionMenuSection>
    </>
  );
}
