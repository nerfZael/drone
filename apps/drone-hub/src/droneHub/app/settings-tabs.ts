export type SettingsTabId = 'notifications' | 'custom-events' | 'usage' | 'general' | 'next-actions' | 'asks' | 'companion' | 'recordings' | 'devices' | 'sync' | 'backups' | 'profiles' | 'trash' | 'archive' | 'shortcuts' | 'skills' | 'mcp' | 'agents' | 'components' | 'system';

export const SETTINGS_TABS: Array<{
  id: SettingsTabId;
  label: string;
  title: string;
  description: string;
}> = [
  {
    id: 'general',
    label: 'General',
    title: 'General settings',
    description: 'GitHub readiness, LLM providers, filesystem uploads, transcript defaults, and onboarding controls.',
  },
  { id: 'notifications', label: 'Notifications', title: 'Notifications', description: 'Floating desktop cards for drone completion, failure, and selected custom events.' },
  { id: 'usage', label: 'Usage', title: 'Usage analytics', description: 'Token consumption, estimated cost, and model prices for new agent executions.' },
  {
    id: 'next-actions',
    label: 'Next actions',
    title: 'Next actions',
    description: 'Suggest one-click follow-up replies under finished agent messages.',
  },
  {
    id: 'asks',
    label: 'Asks',
    title: 'Asks',
    description: 'Keep a list of what you asked in each chat, and whether it was done or answered.',
  },
  {
    id: 'companion',
    label: 'Companion',
    title: 'Companion settings',
    description: 'Configure the voice Companion model, tools, and system prompt.',
  },
  {
    id: 'recordings',
    label: 'Recordings',
    title: 'Recordings',
    description: 'Replay speech-to-text recordings, read their transcripts, and transcribe them again.',
  },
  {
    id: 'devices',
    label: 'Devices',
    title: 'Device mesh',
    description: 'Pair trusted computers and phones, then grant operations per destination.',
  },
  {
    id: 'sync',
    label: 'Sync',
    title: 'Sync sets',
    description: 'Mirror host or Hub-managed file trees into every new drone and bulk-apply them to existing drones.',
  },
  {
    id: 'backups',
    label: 'Backups',
    title: 'Registry backups',
    description: 'Schedule SQLite-safe Hub backups, inspect recent manifests, and run a manual backup.',
  },
  {
    id: 'profiles',
    label: 'Profiles',
    title: 'Profiles',
    description: 'Create, rename, switch, and delete isolated Hub workspaces.',
  },
  {
    id: 'trash',
    label: 'Trash',
    title: 'Trash behavior',
    description: 'Decide whether delete actions archive first or remove drones and chats permanently.',
  },
  {
    id: 'archive',
    label: 'Archive',
    title: 'Archive',
    description: 'Review archived drones and chats, then restore or delete them for real.',
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    title: 'Keyboard shortcuts',
    description: 'Bind keys for the commands you use most often in Drone Hub.',
  },
  {
    id: 'skills',
    label: 'Skills',
    title: 'Skill library',
    description: 'Create and manage portable skill packages for supported agent tools.',
  },
  {
    id: 'mcp',
    label: 'MCP',
    title: 'Global MCP servers',
    description: 'Manage global MCP servers projected into each drone agent config.',
  },
  {
    id: 'agents',
    label: 'Agents',
    title: 'Agents and repo instructions',
    description: 'Refresh external-agent model lists and manage the default AGENTS.md injected into repo-attached container drones.',
  },
  {
    id: 'components',
    label: 'Components',
    title: 'Component library',
    description: 'Preview the shared visual primitives and their interactive states across every supported theme.',
  },
  { id: 'custom-events', label: 'Custom events', title: 'Custom events', description: 'Browse retained custom events and their data.' },
  {
    id: 'system',
    label: 'System',
    title: 'System logs',
    description: 'Inspect recent Drone Hub process output when something looks off.',
  },
];
