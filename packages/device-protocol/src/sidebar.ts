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
  SidebarSetMutedIntent,
  SidebarMuteTargetKind,
  SidebarChatTreeIntent,
} from '@drone/hub-model';

/** One user gesture, expressed as intent rather than client-computed persisted state. */
export type SidebarMoveCommandRequest = {
  mutationId: string;
  intent: SidebarMoveIntent;
};

export type SidebarMoveCommandStage = {
  status: 'not-required' | 'not-attempted' | 'applied' | 'failed' | 'unknown';
  error?: string;
};

export type SidebarMoveCanonicalGroup = {
  id: string;
  repoPath: string;
  name: string;
};

export type SidebarMoveCanonicalState = {
  group: SidebarMoveCanonicalGroup | null;
  sidebar: {
    version: number | null;
    uiPreferences: SidebarLayoutState & Record<string, unknown>;
  } | null;
};

type SidebarMoveCommandResultBase = {
  mutationId: string;
  stages: {
    membership: SidebarMoveCommandStage;
    layout: SidebarMoveCommandStage;
  };
  canonical: SidebarMoveCanonicalState;
};

export type SidebarMoveCommandResult =
  | (SidebarMoveCommandResultBase & {
      ok: true;
      version: number | null;
      uiPreferences: SidebarLayoutState & Record<string, unknown>;
    })
  | (SidebarMoveCommandResultBase & {
      ok: false;
      code:
        | 'MEMBERSHIP_UPDATE_FAILED'
        | 'LAYOUT_UPDATE_FAILED'
        | 'REQUEST_FAILED';
      error: string;
    });

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
  } else if (kind === 'chat-tree-entry') {
    intent = {
      kind,
      parentId: text(rawIntent.parentId, 'intent.parentId'),
      siblingNodeIds: texts(rawIntent.siblingNodeIds, 'intent.siblingNodeIds'),
      activeNodeId: text(rawIntent.activeNodeId, 'intent.activeNodeId'),
      overNodeId: text(rawIntent.overNodeId, 'intent.overNodeId'),
      placement: placement(rawIntent.placement),
    };
  } else if (kind === 'chat-tree-move') {
    const itemKind = text(rawIntent.itemKind, 'intent.itemKind');
    if (itemKind !== 'chat' && itemKind !== 'folder') {
      invalidSidebarMove('intent.itemKind must be chat or folder');
    }
    intent = {
      kind,
      droneId: text(rawIntent.droneId, 'intent.droneId'),
      itemKind,
      activeNodeId: text(rawIntent.activeNodeId, 'intent.activeNodeId'),
      ...(rawIntent.activeNodeIds == null
        ? {}
        : { activeNodeIds: texts(rawIntent.activeNodeIds, 'intent.activeNodeIds') }),
      sourcePath: nullableText(rawIntent.sourcePath, 'intent.sourcePath'),
      sourceSiblingNodeIds: texts(rawIntent.sourceSiblingNodeIds, 'intent.sourceSiblingNodeIds'),
      targetPath: nullableText(rawIntent.targetPath, 'intent.targetPath'),
      targetSiblingNodeIds: texts(rawIntent.targetSiblingNodeIds, 'intent.targetSiblingNodeIds'),
      ...(rawIntent.overNodeId == null
        ? {}
        : { overNodeId: text(rawIntent.overNodeId, 'intent.overNodeId') }),
      placement: placement(rawIntent.placement, true),
    };
  } else if (kind === 'chat-group-create') {
    intent = {
      kind,
      droneId: text(rawIntent.droneId, 'intent.droneId'),
      path: text(rawIntent.path, 'intent.path'),
    };
  } else if (kind === 'chat-group-rename') {
    intent = {
      kind,
      droneId: text(rawIntent.droneId, 'intent.droneId'),
      path: text(rawIntent.path, 'intent.path'),
      newPath: text(rawIntent.newPath, 'intent.newPath'),
    };
  } else if (kind === 'chat-group-delete') {
    intent = {
      kind,
      droneId: text(rawIntent.droneId, 'intent.droneId'),
      path: text(rawIntent.path, 'intent.path'),
    };
  } else if (kind === 'chat-tree-remove') {
    intent = {
      kind,
      droneId: text(rawIntent.droneId, 'intent.droneId'),
      nodeIds: texts(rawIntent.nodeIds, 'intent.nodeIds'),
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
  } else if (kind === 'set-muted') {
    const targetKind = text(rawIntent.targetKind, 'intent.targetKind');
    if (targetKind !== 'group' && targetKind !== 'drone' && targetKind !== 'chat') {
      invalidSidebarMove('intent.targetKind must be group, drone, or chat');
    }
    if (typeof rawIntent.muted !== 'boolean') {
      invalidSidebarMove('intent.muted must be a boolean');
    }
    intent = {
      kind,
      targetKind,
      targetId: text(rawIntent.targetId, 'intent.targetId'),
      muted: rawIntent.muted,
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
      const droneId = text(rawIntent.droneId, 'intent.droneId');
      const droneIds =
        rawIntent.droneIds == null
          ? undefined
          : texts(rawIntent.droneIds, 'intent.droneIds');
      if (droneId.length > 128 || droneIds?.some((id) => id.length > 128)) {
        invalidSidebarMove('intent contains an invalid drone id');
      }
      intent = {
        ...common,
        itemKind,
        droneId,
        ...(droneIds === undefined ? {} : { droneIds }),
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
        ...(rawIntent.sourceGroupId === undefined
          ? {}
          : {
              sourceGroupId: nullableText(
                rawIntent.sourceGroupId,
                'intent.sourceGroupId',
              ),
            }),
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
