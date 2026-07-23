import type { NativeChatAccessScope } from '@drone/assistant-chat';

export type McpChatAccessScope = NativeChatAccessScope;
export type McpChatAccessKind = 'read' | 'write' | 'execute';

function mode(raw: unknown, fallback: 'all' | 'selected'): 'all' | 'selected' {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  return value === 'all' || value === 'selected' ? value : fallback;
}

function cleanDroneIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.map((value) => String(value ?? '').trim()).filter(Boolean))).slice(
    0,
    100,
  );
}

export function normalizeMcpChatAccessScope(
  raw: unknown,
  ownerDroneIdRaw: string,
): McpChatAccessScope {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as any) : {};
  const ownerDroneId = String(ownerDroneIdRaw ?? '').trim();
  const readMode = mode(input.readMode, 'all');
  const writeMode = mode(input.writeMode, 'selected');
  const executeMode = mode(input.executeMode, 'selected');
  const droneIds = cleanDroneIds(input.droneIds);
  const hasSelectedScope =
    readMode === 'selected' || writeMode === 'selected' || executeMode === 'selected';
  if (hasSelectedScope && ownerDroneId && !droneIds.includes(ownerDroneId)) {
    droneIds.push(ownerDroneId);
  }
  return {
    readMode,
    writeMode,
    executeMode,
    droneIds: hasSelectedScope ? droneIds : [],
    updatedAt:
      typeof input.updatedAt === 'string' && input.updatedAt.trim()
        ? input.updatedAt.trim()
        : new Date().toISOString(),
  };
}

export function mcpChatAccessAllowsDrone(
  scope: McpChatAccessScope,
  kind: McpChatAccessKind,
  droneRef: string,
  selectedDroneRefs: string[],
): boolean {
  const accessMode =
    kind === 'write' ? scope.writeMode : kind === 'execute' ? scope.executeMode : scope.readMode;
  if (accessMode === 'all') return true;
  const allowed = new Set(
    selectedDroneRefs.map((value) => String(value ?? '').trim()).filter(Boolean),
  );
  return allowed.has(String(droneRef ?? '').trim());
}
