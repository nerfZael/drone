export type SettingsTabId = 'general' | 'devices' | 'sync' | 'backups' | 'profiles' | 'trash' | 'archive' | 'shortcuts' | 'skills' | 'mcp' | 'agents' | 'system';

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
    title: 'Repo instructions',
    description: 'Manage the default AGENTS.md injected into repo-attached container drones and configure per-repo overrides.',
  },
  {
    id: 'system',
    label: 'System',
    title: 'System logs',
    description: 'Inspect recent Drone Hub process output when something looks off.',
  },
];
