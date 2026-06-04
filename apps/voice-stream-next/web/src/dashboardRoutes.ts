import type { DashboardView } from './dashboardTypes.js';

export type SettingsPane = 'devices' | 'assistant' | 'assistant-config' | 'skills' | 'voice' | 'recordings' | 'activity';

export const SETTINGS_PANES: Array<{ id: SettingsPane; label: string; slug: string }> = [
  { id: 'devices', label: 'Devices', slug: 'devices' },
  { id: 'assistant', label: 'Assistants', slug: 'assistants' },
  { id: 'assistant-config', label: 'Assistant Config', slug: 'assistant-config' },
  { id: 'skills', label: 'Skills', slug: 'skills' },
  { id: 'voice', label: 'Voice', slug: 'voice' },
  { id: 'recordings', label: 'Recordings', slug: 'recordings' },
  { id: 'activity', label: 'Activity', slug: 'activity' },
];

const defaultSettingsPane: SettingsPane = 'devices';
const settingsPaneBySlug = new Map<string, SettingsPane>([
  ...SETTINGS_PANES.map((pane) => [pane.slug, pane.id] as const),
  ['assistant', 'assistant'],
  ['assistance', 'assistant'],
]);

export function dashboardRoutePath(view: DashboardView, settingsPane: SettingsPane = defaultSettingsPane): string {
  if (view === 'admin') return '/admin';
  if (view === 'settings') {
    const pane = SETTINGS_PANES.find((entry) => entry.id === settingsPane) ?? SETTINGS_PANES[0];
    return `/settings/${pane.slug}`;
  }
  return '/';
}

export function parseDashboardRoute(pathname: string): { view: DashboardView; settingsPane: SettingsPane } {
  const cleanPath = pathname.replace(/\/+$/, '') || '/';
  if (cleanPath === '/admin') return { view: 'admin', settingsPane: defaultSettingsPane };
  if (cleanPath === '/settings') return { view: 'settings', settingsPane: defaultSettingsPane };
  if (cleanPath.startsWith('/settings/')) {
    const slug = cleanPath.slice('/settings/'.length).split('/')[0]?.toLowerCase() ?? '';
    return { view: 'settings', settingsPane: settingsPaneBySlug.get(slug) ?? defaultSettingsPane };
  }
  return { view: 'threads', settingsPane: defaultSettingsPane };
}
