import type { WorkflowPermission } from './workflow-types';

export type WorkflowBlipToolMapping = {
  permissionMode: 'read-only' | 'workspace-write' | 'full-access';
  toolProfile: 'read-only' | 'no-shell-workspace-write' | 'local-trusted-write';
};

const CANONICAL_ORDER: readonly WorkflowPermission[] = [
  'workspace:read',
  'workspace:write',
  'process:execute',
];

export function normalizeWorkflowPermissions(
  permissions: readonly WorkflowPermission[],
): WorkflowPermission[] {
  const selected = new Set(permissions);
  return CANONICAL_ORDER.filter((permission) => selected.has(permission));
}

export function workflowPermissionIssue(permissions: readonly WorkflowPermission[]): string | null {
  const unique = new Set(permissions);
  if (unique.size !== permissions.length) return 'permissions must not contain duplicates';
  if (!unique.has('workspace:read')) return 'permissions must include workspace:read';
  if (unique.has('process:execute') && !unique.has('workspace:write')) {
    return 'process:execute requires workspace:write';
  }
  return null;
}

export function mapWorkflowPermissionsToBlip(
  permissions: readonly WorkflowPermission[],
): WorkflowBlipToolMapping {
  const issue = workflowPermissionIssue(permissions);
  if (issue) throw new Error(issue);
  const selected = new Set(permissions);
  if (selected.has('process:execute')) {
    return { permissionMode: 'full-access', toolProfile: 'local-trusted-write' };
  }
  if (selected.has('workspace:write')) {
    return {
      permissionMode: 'workspace-write',
      toolProfile: 'no-shell-workspace-write',
    };
  }
  return { permissionMode: 'read-only', toolProfile: 'read-only' };
}

export function isWorkflowWriter(permissions: readonly WorkflowPermission[]): boolean {
  return permissions.includes('workspace:write') || permissions.includes('process:execute');
}

export function workflowBlipPermissionArgs(chat: unknown): string | null {
  const toolProfile = String((chat as any)?.workflowToolProfile ?? '').trim();
  if (toolProfile === 'no-shell-workspace-write') {
    return '--permission workspace-write --profile no-shell-workspace-write';
  }
  if (toolProfile === 'read-only') {
    return '--permission read-only --profile read-only';
  }
  if (toolProfile === 'local-trusted-write') {
    return '--permission full-access --profile local-trusted-write';
  }
  return null;
}
