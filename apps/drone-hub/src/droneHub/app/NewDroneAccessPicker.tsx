import React from 'react';

import type { AgentApprovalPolicy, AgentPermissionMode } from '../../domain';
import { useDropdownDismiss } from '../../ui/dropdown';

type NewDroneAccessPickerProps = {
  permissionMode: AgentPermissionMode;
  onPermissionModeChange: (value: AgentPermissionMode) => void;
  approvalPolicy: AgentApprovalPolicy;
  onApprovalPolicyChange: (value: AgentApprovalPolicy) => void;
  readOnlySupported: boolean;
  approvalsSupported: boolean;
  agentIsCodex: boolean;
  disabled?: boolean;
};

type PickerOption<T extends string> = {
  value: T;
  label: string;
  description: string;
  disabled?: boolean;
};

export function newDroneAccessLabel(value: AgentPermissionMode): string {
  if (value === 'read-only') return 'Read';
  if (value === 'workspace-write') return 'Write';
  return 'Execute';
}

export function newDroneApprovalLabel(value: AgentApprovalPolicy): string {
  if (value === 'ask') return 'Ask';
  if (value === 'agent-decides') return 'Decide for me';
  return 'Never ask';
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function ChevronIcon({ up }: { up: boolean }) {
  return (
    <svg className="h-[1.0625rem] w-[1.0625rem] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={up ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'} />
    </svg>
  );
}

export function NewDroneAccessPicker({
  permissionMode,
  onPermissionModeChange,
  approvalPolicy,
  onApprovalPolicyChange,
  readOnlySupported,
  approvalsSupported,
  agentIsCodex,
  disabled = false,
}: NewDroneAccessPickerProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [accessOpen, setAccessOpen] = React.useState(false);
  useDropdownDismiss(rootRef, open, setOpen);

  React.useEffect(() => {
    if (open) setAccessOpen(false);
  }, [open]);

  const accessOptions: PickerOption<AgentPermissionMode>[] = [
    {
      value: 'read-only',
      label: 'Read',
      description: 'Inspect files in a read-only sandbox.',
      disabled: !readOnlySupported,
    },
    {
      value: 'workspace-write',
      label: 'Write',
      description: 'Write inside the workspace sandbox.',
      disabled: !readOnlySupported,
    },
    {
      value: 'full-access',
      label: 'Execute',
      description: 'Run with full command access.',
    },
  ];
  const approvalOptions: PickerOption<AgentApprovalPolicy>[] = [
    {
      value: 'ask',
      label: 'Ask',
      description: 'Ask before approval-gated commands.',
      disabled: !approvalsSupported,
    },
    ...(agentIsCodex
      ? [
          {
            value: 'agent-decides' as const,
            label: 'Decide for me',
            description: 'Codex decides when confirmation is needed.',
            disabled: !approvalsSupported,
          },
        ]
      : []),
    {
      value: 'never',
      label: 'Never ask',
      description: 'Run within the selected sandbox without waiting for confirmation.',
      disabled: !approvalsSupported,
    },
  ];
  const triggerLabel = `${newDroneAccessLabel(permissionMode)} · ${newDroneApprovalLabel(approvalPolicy)}`;

  return (
    <div ref={rootRef} className="relative min-w-0 flex-shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        aria-label="Choose chat access and approvals"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Chat access and approvals: ${triggerLabel}`}
        className="inline-flex h-8 max-w-[14rem] items-center gap-1 px-2 text-[.6875rem] font-medium normal-case tracking-normal text-[var(--chat-composer-model-fg)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="min-w-0 truncate">{triggerLabel}</span>
        <span className="text-[var(--accent)]"><ChevronIcon up={open} /></span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Chat access and approvals"
          className="absolute bottom-full right-0 z-50 mb-[.375rem] flex max-h-[64vh] w-[min(20rem,calc(100vw-1.25rem))] flex-col overflow-hidden rounded-[.75rem] border border-[var(--border)] bg-[var(--panel)] shadow-[var(--chat-composer-shadow)]"
        >
          <div className="flex min-h-9 flex-shrink-0 items-center px-3">
            <div className="text-[.8125rem] font-semibold text-[var(--fg-strong)]">
              {accessOpen ? 'Chat access' : 'Approvals'}
            </div>
          </div>

          {!accessOpen ? (
            <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
              {approvalOptions.map((option) => {
                const active = option.value === approvalPolicy;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={disabled || option.disabled}
                    onClick={() => {
                      onApprovalPolicyChange(option.value);
                      setOpen(false);
                    }}
                    title={option.description}
                    className={`inline-flex h-8 items-center justify-center gap-1 rounded-[.5rem] border px-2.5 text-[.75rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      active
                        ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent-muted)]'
                        : 'border-transparent text-[var(--muted)] hover:bg-[var(--hover)]'
                    }`}
                  >
                    {option.label}
                    {active ? <span className="text-[var(--accent)]"><CheckIcon /></span> : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => setAccessOpen((value) => !value)}
            className="mx-2 mb-2 flex h-[2.375rem] flex-shrink-0 items-center justify-between gap-3 rounded-[.5rem] border border-[var(--chat-composer-control-border)] bg-[var(--chat-composer-surface)] px-2.5 text-left"
          >
            <span className="min-w-0 truncate text-[.75rem] font-medium text-[var(--chat-composer-fg)]">
              {newDroneAccessLabel(permissionMode)}
            </span>
            <span className="text-[var(--accent)]"><ChevronIcon up={accessOpen} /></span>
          </button>

          {accessOpen ? (
            <div className="min-h-0 overflow-y-auto px-2 pb-2">
              <div className="flex flex-col gap-1">
                {accessOptions.map((option) => {
                  const active = option.value === permissionMode;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      disabled={disabled || option.disabled}
                      onClick={() => {
                        onPermissionModeChange(option.value);
                        setAccessOpen(false);
                      }}
                      title={option.description}
                      className={`flex min-h-9 items-center rounded-[.5rem] border px-2.5 text-left text-[.75rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        active
                          ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent-muted)]'
                          : 'border-transparent text-[var(--muted)] hover:bg-[var(--hover)]'
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block">{option.label}</span>
                        <span className="mt-0.5 block text-[.625rem] font-normal text-[var(--muted-dim)]">
                          {option.description}
                        </span>
                      </span>
                      {active ? <span className="ml-2 text-[var(--accent)]"><CheckIcon /></span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {!readOnlySupported || !approvalsSupported ? (
            <div className="flex-shrink-0 border-t border-[var(--border-subtle)] px-3 py-2 text-[.625rem] leading-relaxed text-[var(--muted-dim)]">
              {!readOnlySupported
                ? 'This agent supports Execute access only.'
                : 'This agent does not expose approval controls.'}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
