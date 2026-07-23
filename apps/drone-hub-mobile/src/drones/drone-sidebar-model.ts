import { isAgentRunFileChanges, type AssistantMessage } from '@drone/assistant-chat';
import type { AgentRunFileChanges } from '@blip/protocol';
import {
  buildRepoSidebarModel,
  compareSidebarDronesByNewestFirst,
  sidebarFolderNodeId,
  type SidebarNodeTreeModel,
  type SidebarTreeFolderNode,
} from '@drone/hub-model/sidebar';
import {
  mobileRunDetails,
  normalizeMobileAgentPlan,
  type MobileAgentPlan,
} from '../local-assistant/mobile-transcript-runs';

export type MobileDroneSummary = {
  id: string;
  name: string;
  runtime: string;
  phase: string;
  status: string;
  group: string | null;
  repoPath: string;
  cwd?: string;
  repoAttached?: boolean;
  fleetParentId: string | null;
  chats: string[];
  busyChats: string[];
  approvalChats?: string[];
  approvalRequired?: boolean;
  unreadChats?: string[];
  chatReadStates?: Record<
    string,
    {
      unread: boolean;
      latestAgentTurnId: string | null;
      latestAgentRevision: number;
    }
  >;
  createdAt?: string;
  lastActivityAt?: string;
  lastMessageAt?: string;
  statusOk?: boolean;
  statusError?: string | null;
};

export type MobileDroneTurn = {
  id: string;
  turn: number | null;
  at: string;
  promptAt: string;
  completedAt: string;
  prompt: string;
  output: string;
  error: string;
  ok: boolean;
  model: string;
  reasoning: string;
  agentPlan?: MobileAgentPlan;
  fileChanges?: AgentRunFileChanges;
  attachments: Array<{ name: string; mime: string; size: number | null }>;
  promptTruncated?: boolean;
  responseTruncated?: boolean;
  meshTruncated?: boolean;
};

export type MobileChatHistoryPage = {
  beforeCursor: number | null;
  hasOlder: boolean;
  responseTruncated: boolean;
  contentTruncated: boolean;
};

export type MobileDroneTreeNode = {
  drone: MobileDroneSummary;
  children: MobileDroneTreeNode[];
};

export type MobileDroneRepoGroup = {
  id: string;
  label: string;
  repoPath: string;
  roots: MobileDroneTreeNode[];
  folders: MobileDroneGroupFolder[];
  entries: MobileDroneSidebarEntry[];
  droneCount: number;
};

export type MobileDroneGroupFolder = {
  id: string;
  path: string;
  label: string;
  roots: MobileDroneTreeNode[];
  children: MobileDroneGroupFolder[];
  entries: MobileDroneSidebarEntry[];
  droneCount: number;
};

export type MobileDroneSidebarEntry =
  | { kind: 'drone'; node: MobileDroneTreeNode }
  | { kind: 'folder'; folder: MobileDroneGroupFolder };

export type MobileDroneSidebarOrder = {
  registeredRepoPaths: string[];
  groupCreatedAtByName: Record<string, string | null>;
  sidebarGroupOrder: string[];
  sidebarDroneOrderByGroup: Record<string, string[]>;
  sidebarNodeOrderByParent: Record<string, string[]>;
  pinnedDroneIds: string[];
};

export type MobileDroneCreateBranch = {
  name: string;
  remote: string;
  branch: string;
};

export type MobileDroneCreateRepo = {
  path: string;
  hostBranch: string | null;
  remoteBranches: MobileDroneCreateBranch[];
  branchesError: string | null;
  branchesLoaded: boolean;
};

export function normalizeMobileDroneCreateRepo(raw: unknown): MobileDroneCreateRepo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const repo = raw as Record<string, unknown>;
  const path = text(repo.path);
  if (!path) return null;
  const remoteBranches = Array.isArray(repo.remoteBranches)
    ? repo.remoteBranches.flatMap((rawBranch): MobileDroneCreateBranch[] => {
        if (!rawBranch || typeof rawBranch !== 'object' || Array.isArray(rawBranch)) return [];
        const branch = rawBranch as Record<string, unknown>;
        const name = text(branch.name);
        if (!name) return [];
        const slash = name.indexOf('/');
        return [
          {
            name,
            remote: text(branch.remote) || (slash > 0 ? name.slice(0, slash) : ''),
            branch: text(branch.branch) || (slash > 0 ? name.slice(slash + 1) : name),
          },
        ];
      })
    : [];
  const branchesError = text(repo.branchesError) || null;
  return {
    path,
    hostBranch: text(repo.hostBranch) || null,
    remoteBranches,
    branchesError,
    branchesLoaded:
      repo.branchesLoaded === true ||
      (repo.branchesLoaded !== false &&
        (Array.isArray(repo.remoteBranches) || Boolean(branchesError))),
  };
}

export type MobileDroneCreateModel = {
  provider: string;
  id: string;
  label: string;
  reasoningLevels: string[];
  defaultReasoningLevel: string;
};

export function normalizeMobileDroneCreateModelCatalog(raw: unknown): MobileDroneCreateModel[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const models = (raw as Record<string, unknown>).models;
  if (!Array.isArray(models)) return [];
  const seen = new Set<string>();
  return models.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    const provider = text(value.provider);
    const id = text(value.id);
    const key = `${provider}\u0000${id}`;
    if (!id || seen.has(key)) return [];
    seen.add(key);
    const reasoningLevels = stringList(value.reasoningLevels);
    const defaultReasoningLevel = text(value.defaultReasoningLevel);
    return [
      {
        provider,
        id,
        label: text(value.label) || id,
        reasoningLevels,
        defaultReasoningLevel:
          defaultReasoningLevel && reasoningLevels.includes(defaultReasoningLevel)
            ? defaultReasoningLevel
            : (reasoningLevels[0] ?? ''),
      },
    ];
  });
}

export const EMPTY_MOBILE_DRONE_SIDEBAR_ORDER: MobileDroneSidebarOrder = {
  registeredRepoPaths: [],
  groupCreatedAtByName: {},
  sidebarGroupOrder: [],
  sidebarDroneOrderByGroup: {},
  sidebarNodeOrderByParent: {},
  pinnedDroneIds: [],
};

export function suggestNextMobileDroneChatName(
  chats: readonly string[] | null | undefined,
): string {
  const taken = new Set(
    (Array.isArray(chats) ? chats : []).map((chat) => String(chat ?? '').trim()).filter(Boolean),
  );
  let nextIndex = Math.max(1, taken.size + 1);
  for (const chat of taken) {
    const match = chat.match(/^chat-(\d+)$/i);
    if (!match) continue;
    const index = Number(match[1]);
    if (Number.isFinite(index) && index >= 1) nextIndex = Math.max(nextIndex, index + 1);
  }
  while (taken.has(`chat-${nextIndex}`)) nextIndex += 1;
  return `chat-${nextIndex}`;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function stringList(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  const result = value.map(text).filter(Boolean);
  return result.length > 0 ? [...new Set(result)] : fallback;
}

function stringListMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, items]) => [text(key), stringList(items)] as const)
      .filter(([key, items]) => Boolean(key && items.length)),
  );
}

function nullableStringMap(value: unknown): Record<string, string | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [text(key), text(item) || null] as const)
      .filter(([key]) => Boolean(key)),
  );
}

function chatReadStateMap(value: unknown): NonNullable<MobileDroneSummary['chatReadStates']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([chatNameRaw, stateRaw]) => {
      const chatName = text(chatNameRaw);
      if (!chatName || !stateRaw || typeof stateRaw !== 'object' || Array.isArray(stateRaw)) {
        return [];
      }
      const state = stateRaw as Record<string, unknown>;
      return [
        [
          chatName,
          {
            unread: state.unread === true,
            latestAgentTurnId: text(state.latestAgentTurnId) || null,
            latestAgentRevision:
              Number.isSafeInteger(state.latestAgentRevision) &&
              Number(state.latestAgentRevision) >= 0
                ? Number(state.latestAgentRevision)
                : 0,
          },
        ] as const,
      ];
    }),
  );
}

export function normalizeMobileDrone(raw: unknown): MobileDroneSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const repo =
    value.repo && typeof value.repo === 'object' && !Array.isArray(value.repo)
      ? (value.repo as Record<string, unknown>)
      : {};
  const id = text(value.id || value.name);
  if (!id) return null;
  const chats = stringList(value.chats, ['default']);
  const chatReadStates = chatReadStateMap(value.chatReadStates);
  const unreadChats =
    Object.keys(chatReadStates).length > 0
      ? chats.filter((chatName) => chatReadStates[chatName]?.unread === true)
      : stringList(value.unreadChats).filter((chatName) => chats.includes(chatName));
  const approvalChats = stringList(value.approvalChats).filter((chatName) =>
    chats.includes(chatName),
  );
  return {
    id,
    name: text(value.name || value.id) || id,
    runtime: text(value.runtime) || 'container',
    phase: text(value.phase),
    status: text(value.status),
    group: text(value.group) || null,
    repoPath:
      text(value.repoPath) ||
      text(value.repositoryPath) ||
      text(repo.path) ||
      text(repo.hostPath) ||
      text(repo.dest),
    cwd: text(value.cwd || value.workingDirectory),
    repoAttached:
      typeof value.repoAttached === 'boolean'
        ? value.repoAttached
        : Boolean(
            text(value.repoPath) ||
            text(value.repositoryPath) ||
            text(repo.path) ||
            text(repo.hostPath) ||
            text(repo.dest),
          ),
    fleetParentId: text(value.fleetParentId) || null,
    chats,
    busyChats: stringList(value.busyChats),
    approvalChats,
    approvalRequired:
      value.approvalRequired === true ||
      value.requiresApproval === true ||
      approvalChats.length > 0 ||
      /approval/.test(`${text(value.phase)} ${text(value.status)}`.toLowerCase()),
    unreadChats,
    chatReadStates,
    createdAt: text(value.createdAt) || undefined,
    lastActivityAt: text(value.lastActivityAt) || undefined,
    lastMessageAt: text(value.lastMessageAt) || undefined,
    statusOk: value.statusOk !== false,
    statusError: text(value.statusError) || null,
  };
}

export function normalizeMobileDrones(raw: unknown): MobileDroneSummary[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const drone = normalizeMobileDrone(item);
    return drone ? [drone] : [];
  });
}

export function excludePinnedMobileDrones(
  drones: readonly MobileDroneSummary[],
  pinnedDroneIds: readonly string[],
): MobileDroneSummary[] {
  const pinnedIds = new Set(pinnedDroneIds.map(text).filter(Boolean));
  return drones.filter((drone) => !pinnedIds.has(drone.id));
}

export function normalizeMobileDroneListPayload(raw: unknown): {
  drones: MobileDroneSummary[];
  schemaVersion: number | null;
  sidebar: MobileDroneSidebarOrder;
  createRepos: MobileDroneCreateRepo[];
  deleteMode: 'archive' | 'permanent';
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      drones: [],
      schemaVersion: null,
      sidebar: EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
      createRepos: [],
      deleteMode: 'permanent',
    };
  }
  const value = raw as Record<string, unknown>;
  const sidebar =
    value.sidebar && typeof value.sidebar === 'object' && !Array.isArray(value.sidebar)
      ? (value.sidebar as Record<string, unknown>)
      : {};
  const repoPathByDroneId =
    value.repoPathByDroneId &&
    typeof value.repoPathByDroneId === 'object' &&
    !Array.isArray(value.repoPathByDroneId)
      ? (value.repoPathByDroneId as Record<string, unknown>)
      : {};
  const drones = normalizeMobileDrones(value.drones).map((drone) => ({
    ...drone,
    repoPath: drone.repoPath || text(repoPathByDroneId[drone.id]),
  }));
  const createOptions =
    value.createOptions &&
    typeof value.createOptions === 'object' &&
    !Array.isArray(value.createOptions)
      ? (value.createOptions as Record<string, unknown>)
      : {};
  const optionRepos = Array.isArray(createOptions.repos)
    ? createOptions.repos.flatMap((rawRepo): MobileDroneCreateRepo[] => {
        const repo = normalizeMobileDroneCreateRepo(rawRepo);
        return repo ? [repo] : [];
      })
    : [];
  const registeredRepoPaths = stringList(sidebar.registeredRepoPaths);
  const createRepoByPath = new Map(optionRepos.map((repo) => [repo.path, repo]));
  for (const path of registeredRepoPaths) {
    if (createRepoByPath.has(path)) continue;
    createRepoByPath.set(path, {
      path,
      hostBranch: null,
      remoteBranches: [],
      branchesError: null,
      branchesLoaded: false,
    });
  }
  const createRepos = [...createRepoByPath.values()];
  return {
    drones,
    schemaVersion:
      typeof value.schemaVersion === 'number' && Number.isFinite(value.schemaVersion)
        ? value.schemaVersion
        : null,
    sidebar: {
      registeredRepoPaths,
      groupCreatedAtByName: nullableStringMap(sidebar.groupCreatedAtByName),
      sidebarGroupOrder: stringList(sidebar.sidebarGroupOrder),
      sidebarDroneOrderByGroup: stringListMap(sidebar.sidebarDroneOrderByGroup),
      sidebarNodeOrderByParent: stringListMap(sidebar.sidebarNodeOrderByParent),
      pinnedDroneIds: stringList(sidebar.pinnedDroneIds),
    },
    createRepos,
    deleteMode: value.deleteMode === 'archive' ? 'archive' : 'permanent',
  };
}

export function mobileRepoLabel(repoPath: string): string {
  const path = text(repoPath);
  if (!path) return 'Ungrouped';
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || path;
}

export function compareMobileDronesByNewestFirst(
  left: MobileDroneSummary,
  right: MobileDroneSummary,
): number {
  return compareSidebarDronesByNewestFirst(left, right);
}

function mobileDroneTreeNode(
  tree: SidebarNodeTreeModel,
  dronesById: Map<string, MobileDroneSummary>,
  nodeId: string,
): MobileDroneTreeNode | null {
  const node = tree.nodesById[nodeId];
  if (!node || node.kind !== 'drone') return null;
  const drone = dronesById.get(node.droneId);
  if (!drone) return null;
  return {
    drone,
    children: (tree.childIdsByParent[node.id] ?? []).flatMap((childId) => {
      const child = mobileDroneTreeNode(tree, dronesById, childId);
      return child ? [child] : [];
    }),
  };
}

function mobileDroneGroupFolder(
  tree: SidebarNodeTreeModel,
  dronesById: Map<string, MobileDroneSummary>,
  node: SidebarTreeFolderNode,
): MobileDroneGroupFolder {
  const entries = (tree.childIdsByParent[node.id] ?? []).flatMap(
    (childId): MobileDroneSidebarEntry[] => {
      const child = tree.nodesById[childId];
      if (!child) return [];
      if (child.kind === 'drone') {
        const droneNode = mobileDroneTreeNode(tree, dronesById, childId);
        return droneNode ? [{ kind: 'drone', node: droneNode }] : [];
      }
      return [{ kind: 'folder', folder: mobileDroneGroupFolder(tree, dronesById, child) }];
    },
  );
  return {
    id: node.path,
    path: node.groupPath ?? node.path,
    label: node.label,
    roots: entries.flatMap((entry) => (entry.kind === 'drone' ? [entry.node] : [])),
    children: entries.flatMap((entry) => (entry.kind === 'folder' ? [entry.folder] : [])),
    entries,
    droneCount: node.totalDroneCount,
  };
}

export function buildMobileDroneRepoGroups(
  drones: MobileDroneSummary[],
  order: MobileDroneSidebarOrder = EMPTY_MOBILE_DRONE_SIDEBAR_ORDER,
): MobileDroneRepoGroup[] {
  const { groups, nodeTree: tree } = buildRepoSidebarModel({
    drones,
    registeredRepoPaths: order.registeredRepoPaths,
    sidebarDroneOrderByGroup: order.sidebarDroneOrderByGroup,
    sidebarGroupOrder: order.sidebarGroupOrder,
    sidebarNodeOrderByParent: order.sidebarNodeOrderByParent,
    sidebarGroupCreatedAtByName: order.groupCreatedAtByName,
  });
  const dronesById = new Map(drones.map((drone) => [String(drone.id ?? '').trim(), drone]));

  return groups.flatMap((group): MobileDroneRepoGroup[] => {
    const repoRoot = tree.nodesById[sidebarFolderNodeId(group.group)];
    if (!repoRoot || repoRoot.kind !== 'folder') return [];
    const entries = (tree.childIdsByParent[repoRoot.id] ?? []).flatMap(
      (childId): MobileDroneSidebarEntry[] => {
        const child = tree.nodesById[childId];
        if (!child) return [];
        if (child.kind === 'drone') {
          const node = mobileDroneTreeNode(tree, dronesById, childId);
          return node ? [{ kind: 'drone', node }] : [];
        }
        return [{ kind: 'folder', folder: mobileDroneGroupFolder(tree, dronesById, child) }];
      },
    );
    const repoPath = group.group === 'repo:ungrouped' ? '' : group.group.slice('repo:'.length);
    return [
      {
        id: group.group,
        label: group.label,
        repoPath,
        roots: entries.flatMap((entry) => (entry.kind === 'drone' ? [entry.node] : [])),
        folders: entries.flatMap((entry) => (entry.kind === 'folder' ? [entry.folder] : [])),
        entries,
        droneCount: group.items.length,
      },
    ];
  });
}

export function mobileDroneTurnsToAssistantMessages(raw: unknown): AssistantMessage[] {
  return normalizeMobileDroneTurns(raw).flatMap((turn): AssistantMessage[] => {
    const { prompt, output, error, attachments } = turn;
    const promptTruncated = turn.promptTruncated === true || turn.meshTruncated === true;
    const responseTruncated = turn.responseTruncated === true || turn.meshTruncated === true;
    const messages: AssistantMessage[] = [];
    if (prompt || attachments.length > 0) {
      messages.push({
        ...(promptTruncated ? { id: `${turn.id}:user` } : {}),
        role: 'user',
        ...(prompt ? { content: prompt } : {}),
        ...(turn.promptAt || turn.at ? { createdAt: turn.promptAt || turn.at } : {}),
        ...(attachments.length > 0 ? { details: { attachments } } : {}),
        ...(promptTruncated ? { meshTruncated: true } : {}),
      });
    }
    if (output || error || turn.completedAt || turn.agentPlan) {
      const runDetails = turn.agentPlan
        ? mobileRunDetails({ id: turn.id, plan: turn.agentPlan })
        : undefined;
      messages.push(
        !turn.ok && error
          ? {
              ...(responseTruncated ? { id: `${turn.id}:assistant` } : {}),
              role: 'assistant',
              ...(output ? { content: output } : {}),
              ...(turn.completedAt || turn.at ? { createdAt: turn.completedAt || turn.at } : {}),
              ...(runDetails ? { details: runDetails } : {}),
              isError: true,
              errorMessage: error,
              ...(responseTruncated ? { meshTruncated: true } : {}),
            }
          : {
              ...(responseTruncated ? { id: `${turn.id}:assistant` } : {}),
              role: 'assistant',
              content: output || error,
              ...(turn.completedAt || turn.at ? { createdAt: turn.completedAt || turn.at } : {}),
              ...(runDetails ? { details: runDetails } : {}),
              ...(responseTruncated ? { meshTruncated: true } : {}),
            },
      );
    }
    if (isAgentRunFileChanges(turn.fileChanges)) {
      messages.push({
        id: `${turn.id}:run-summary`,
        role: 'runSummary',
        content: '',
        createdAt: turn.completedAt || turn.at,
        details: { fileChanges: turn.fileChanges },
      });
    }
    return messages;
  });
}

export function normalizeMobileNativeChatHistory(raw: unknown): {
  messages: AssistantMessage[];
  page: MobileChatHistoryPage;
} {
  const source =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : {};
  const entries = Array.isArray(raw) ? raw : Array.isArray(source.entries) ? source.entries : [];
  const messages = entries.flatMap((entry): AssistantMessage[] => {
    const message = entry?.message && typeof entry.message === 'object' ? entry.message : entry;
    if (!message || typeof message !== 'object' || !String(message.role ?? '').trim()) return [];
    return [
      {
        ...message,
        id: String(entry?.id ?? message.id ?? '').trim() || undefined,
        ...(entry?.meshTruncated === true || message.meshTruncated === true
          ? { meshTruncated: true }
          : {}),
      } as AssistantMessage,
    ];
  });
  const page = source.page && typeof source.page === 'object' ? source.page : {};
  const beforeCursor = Number(page.beforeCursor);
  return {
    messages,
    page: {
      beforeCursor: Number.isSafeInteger(beforeCursor) && beforeCursor > 0 ? beforeCursor : null,
      hasOlder: page.hasOlder === true,
      responseTruncated: page.responseTruncated === true,
      contentTruncated: page.contentTruncated === true,
    },
  };
}

function normalizeTurnAttachments(value: unknown): MobileDroneTurn['attachments'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const attachment = item as Record<string, unknown>;
    const name = text(attachment.name || attachment.fileName);
    if (!name) return [];
    const size = Number(attachment.size);
    return [
      {
        name,
        mime: text(attachment.mime || attachment.mimeType) || 'file',
        size: Number.isFinite(size) && size >= 0 ? size : null,
      },
    ];
  });
}

export function normalizeMobileDroneTurns(raw: unknown): MobileDroneTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const turn = item as Record<string, unknown>;
    const turnNumber = Number(turn.turn);
    const at = text(turn.at);
    const agentPlan = normalizeMobileAgentPlan(turn.agentPlan);
    const fileChanges =
      turn.fileChanges && typeof turn.fileChanges === 'object' && !Array.isArray(turn.fileChanges)
        ? (turn.fileChanges as AgentRunFileChanges)
        : undefined;
    const hasPreciseTruncation =
      Object.prototype.hasOwnProperty.call(turn, 'promptTruncated') ||
      Object.prototype.hasOwnProperty.call(turn, 'responseTruncated');
    const promptTruncated =
      turn.promptTruncated === true || (!hasPreciseTruncation && turn.meshTruncated === true);
    const responseTruncated =
      turn.responseTruncated === true || (!hasPreciseTruncation && turn.meshTruncated === true);
    return [
      {
        id: text(turn.id) || `turn-${Number.isFinite(turnNumber) ? turnNumber : index}`,
        turn: Number.isFinite(turnNumber) ? turnNumber : null,
        at,
        promptAt: text(turn.promptAt) || at,
        completedAt: text(turn.completedAt) || at,
        prompt: text(turn.prompt),
        output: text(turn.output),
        error: text(turn.error),
        ok: turn.ok !== false,
        model: text(turn.model),
        reasoning: text(turn.reasoning),
        ...(agentPlan ? { agentPlan } : {}),
        ...(isAgentRunFileChanges(fileChanges) ? { fileChanges } : {}),
        attachments: normalizeTurnAttachments(turn.attachments),
        ...(promptTruncated ? { promptTruncated: true } : {}),
        ...(responseTruncated ? { responseTruncated: true } : {}),
      },
    ];
  });
}
