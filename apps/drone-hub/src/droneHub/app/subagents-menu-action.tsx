import type { ChatComposerMenuAction } from '../chat/ChatComposerMenu';
import { IconSubagents } from './icons';

/** Claude Code and Codex can start subagents; a chat keeps them off unless turned on. */
export function subagentsMenuAction(opts: {
  agentKey: string;
  enabled: boolean;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
}): ChatComposerMenuAction[] {
  if (opts.agentKey !== 'builtin:claude' && opts.agentKey !== 'builtin:codex') return [];
  return [
    {
      id: 'subagents',
      label: 'Subagents',
      title: opts.enabled
        ? 'Subagents are on for this chat. A change applies from the next message.'
        : 'Subagents are off for this chat. A change applies from the next message.',
      icon: <IconSubagents className="h-3.5 w-3.5" />,
      badge: opts.enabled ? 'On' : 'Off',
      active: opts.enabled,
      disabled: opts.disabled,
      onSelect: () => opts.onToggle(!opts.enabled),
    },
  ];
}
