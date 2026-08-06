import type {
  SidebarDropPlacement,
  SidebarLayoutState,
  SidebarMoveIntent,
} from '@drone/hub-model';

export type {
  SidebarDropPlacement,
  SidebarLayoutPatch,
  SidebarLayoutState,
  SidebarMoveIntent,
  SidebarMoveIntoFolderIntent,
  SidebarReorderIntent,
  SidebarSetPinnedIntent,
} from '@drone/hub-model';

/** One user gesture, expressed as intent rather than client-computed persisted state. */
export type SidebarMoveCommandRequest = {
  mutationId: string;
  intent: SidebarMoveIntent;
};

export type SidebarMoveCommandResult = {
  ok: true;
  mutationId: string;
  version: number | null;
  uiPreferences: SidebarLayoutState & Record<string, unknown>;
};

export function parseSidebarMoveCommandRequest(value: unknown): SidebarMoveCommandRequest {
  const source = record(value);
  const rawIntent = record(source.intent);
  const kind = text(rawIntent.kind, 'intent.kind');
  let intent: SidebarMoveIntent;
  if (kind === 'tree-entry') {
    intent = {
      kind,
      parentId: text(rawIntent.parentId, 'intent.parentId'),
      siblingNodeIds: texts(rawIntent.siblingNodeIds, 'intent.siblingNodeIds'),
      activeNodeId: text(rawIntent.activeNodeId, 'intent.activeNodeId'),
      overNodeId: text(rawIntent.overNodeId, 'intent.overNodeId'),
      placement: placement(rawIntent.placement),
    };
  } else if (kind === 'drone') {
    intent = {
      kind,
      parentId: text(rawIntent.parentId, 'intent.parentId'),
      siblingDroneIds: texts(rawIntent.siblingDroneIds, 'intent.siblingDroneIds'),
      activeDroneId: text(rawIntent.activeDroneId, 'intent.activeDroneId'),
      overDroneId: text(rawIntent.overDroneId, 'intent.overDroneId'),
      placement: placement(rawIntent.placement),
    };
  } else if (kind === 'chat') {
    intent = {
      kind,
      droneId: text(rawIntent.droneId, 'intent.droneId'),
      chatNames: texts(rawIntent.chatNames, 'intent.chatNames'),
      activeChatName: text(rawIntent.activeChatName, 'intent.activeChatName'),
      overChatName: text(rawIntent.overChatName, 'intent.overChatName'),
      placement: placement(rawIntent.placement),
    };
  } else if (kind === 'pinned-drone') {
    intent = {
      kind,
      visibleDroneIds: texts(rawIntent.visibleDroneIds, 'intent.visibleDroneIds'),
      activeDroneId: text(rawIntent.activeDroneId, 'intent.activeDroneId'),
      overDroneId: text(rawIntent.overDroneId, 'intent.overDroneId'),
      placement: placement(rawIntent.placement),
    };
  } else if (kind === 'set-pinned') {
    if (typeof rawIntent.pinned !== 'boolean') {
      invalidSidebarMove('intent.pinned must be a boolean');
    }
    intent = {
      kind,
      droneIds: texts(rawIntent.droneIds, 'intent.droneIds'),
      pinned: rawIntent.pinned,
    };
  } else if (kind === 'move-into-folder') {
    const itemKind = text(rawIntent.itemKind, 'intent.itemKind');
    const common = {
      kind,
      repoPath: textValue(rawIntent.repoPath, 'intent.repoPath'),
      sourceParentId: text(rawIntent.sourceParentId, 'intent.sourceParentId'),
      sourceSiblingNodeIds: texts(rawIntent.sourceSiblingNodeIds, 'intent.sourceSiblingNodeIds'),
      targetGroup: nullableText(rawIntent.targetGroup, 'intent.targetGroup'),
      targetParentId: text(rawIntent.targetParentId, 'intent.targetParentId'),
      targetSiblingNodeIds: texts(rawIntent.targetSiblingNodeIds, 'intent.targetSiblingNodeIds'),
      ...(rawIntent.targetOverNodeId == null
        ? {}
        : { targetOverNodeId: text(rawIntent.targetOverNodeId, 'intent.targetOverNodeId') }),
      placement: placement(rawIntent.placement, true),
    } as const;
    if (itemKind === 'drone') {
      intent = {
        ...common,
        itemKind,
        droneId: text(rawIntent.droneId, 'intent.droneId'),
        ...(rawIntent.droneIds == null
          ? {}
          : { droneIds: texts(rawIntent.droneIds, 'intent.droneIds') }),
        ...(rawIntent.targetParentDroneId === undefined
          ? {}
          : {
              targetParentDroneId: nullableText(
                rawIntent.targetParentDroneId,
                'intent.targetParentDroneId',
              ),
            }),
      };
    } else if (itemKind === 'folder') {
      intent = {
        ...common,
        itemKind,
        sourceGroup: text(rawIntent.sourceGroup, 'intent.sourceGroup'),
        sourceNodeId: text(rawIntent.sourceNodeId, 'intent.sourceNodeId'),
      };
    } else {
      invalidSidebarMove('intent.itemKind must be drone or folder');
    }
  } else {
    invalidSidebarMove('intent.kind is not supported');
  }
  const mutationId = text(source.mutationId, 'mutationId');
  if (mutationId.length > 200) invalidSidebarMove('mutationId is too long');
  return { mutationId, intent };
}

function invalidSidebarMove(message: string): never {
  throw Object.assign(new Error(message), { code: 'INVALID_REQUEST' });
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidSidebarMove('sidebar move intent must be an object');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) invalidSidebarMove(`${field} is required`);
  return result;
}

function texts(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) invalidSidebarMove(`${field} must be an array`);
  if (value.some((item) => typeof item !== 'string')) {
    invalidSidebarMove(`${field} must contain only strings`);
  }
  return [...new Set((value as string[]).map((item) => item.trim()).filter(Boolean))];
}

function nullableText(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') invalidSidebarMove(`${field} must be a string or null`);
  return value.trim() || null;
}

function textValue(value: unknown, field: string): string {
  if (typeof value !== 'string') invalidSidebarMove(`${field} must be a string`);
  return value.trim();
}

function placement(value: unknown, inside?: false): Exclude<SidebarDropPlacement, 'inside'>;
function placement(value: unknown, inside: true): SidebarDropPlacement;
function placement(value: unknown, inside = false): SidebarDropPlacement {
  if (value === 'before' || value === 'after' || (inside && value === 'inside')) return value;
  if (inside && value == null) return 'inside';
  invalidSidebarMove(
    `placement must be ${inside ? 'before, inside, or after' : 'before or after'}`,
  );
}
