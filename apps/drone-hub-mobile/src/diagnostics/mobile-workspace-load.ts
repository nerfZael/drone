import { WorkspaceLoadDiagnostics, type WorkspaceLoadRecord } from '@drone/hub-model';

const config = {
  uuid: () => `file-load-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  platform: 'android',
  save: (_record: WorkspaceLoadRecord): void | Promise<void> => {},
};
export const mobileWorkspaceLoads = new WorkspaceLoadDiagnostics(config);
export function configureMobileWorkspaceDiagnostics(value: typeof config) { Object.assign(config, value); }
