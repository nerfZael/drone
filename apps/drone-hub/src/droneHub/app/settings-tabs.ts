export type SettingsTabId = 'general' | 'profiles' | 'trash' | 'archive' | 'shortcuts' | 'automations' | 'playbooks' | 'skills' | 'system';

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
    id: 'automations',
    label: 'Automations',
    title: 'Automation jobs',
    description: 'Manage reusable prompt loops that can be launched from chat.',
  },
  {
    id: 'playbooks',
    label: 'Playbooks',
    title: 'Playbook runs',
    description: 'Manage reusable repo-scoped message sequences and follow-up action buttons.',
  },
  {
    id: 'skills',
    label: 'Skills',
    title: 'Skill library',
    description: 'Create and manage portable skill packages for supported agent tools.',
  },
  {
    id: 'system',
    label: 'System',
    title: 'System logs',
    description: 'Inspect recent Drone Hub process output when something looks off.',
  },
];
