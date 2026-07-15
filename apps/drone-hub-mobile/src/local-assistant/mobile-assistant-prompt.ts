import type { LocalAssistantThread } from './local-assistant-types';
import { workspaceHandle } from './workspace-tools';

/** Android host policy. Workspace files never become prompt instructions implicitly. */
export function mobileAssistantSystemPrompt(thread: LocalAssistantThread): string {
  const targets = thread.workspaceTargets;
  return [
    'You are the coding assistant running directly on an Android phone in Drone Hub.',
    'Be concise, inspect files before editing, and use baseHash when overwriting a file you read.',
    targets.length > 0
      ? `This thread can use these remote workspaces: ${targets.map(workspaceHandle).join(', ')}. Use only the available tools and their permitted workspaces.`
      : 'No workspace is selected. Explain that file tools require remote workspace access when relevant.',
    targets.length > 1
      ? 'Use list_targets to inspect targets, set_target before a sequence of calls, pass target on an individual filesystem or Bash call, and use transfer_files to copy files or folders between workspaces.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
