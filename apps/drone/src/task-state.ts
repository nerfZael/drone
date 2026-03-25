type TaskStateSnapshot = {
  enabled: boolean;
  actor: {
    id: string | null;
    name: string | null;
  };
  playbook: {
    id: string | null;
    label: string | null;
  } | null;
  repoPath: string | null;
  taskTypes: Array<{
    id: string;
    label: string;
    active: boolean;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    typeId: string;
    typeLabel: string;
    laneId: string;
    laneTitle: string;
    playbookId?: string;
    playbookLabel?: string;
    prompt?: string;
    promptId?: string;
    messageId?: string;
    chatName?: string;
    createdAt: string;
    updatedAt: string;
    droneId?: string;
    droneName?: string;
  }>;
  updatedAt: string;
};

type PendingTaskCreateRequest = {
  id: string;
  title: string;
  description: string;
  typeId: string;
  createdAt: string;
};

type PendingTaskDeleteRequest = {
  id: string;
  taskId: string;
  createdAt: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function normalizePendingTaskCreateRequest(raw: any): PendingTaskCreateRequest | null {
  const id = String(raw?.id ?? '').trim();
  const title = String(raw?.title ?? '').trim();
  const typeId = String(raw?.typeId ?? '').trim();
  if (!id || !title || !typeId) return null;
  return {
    id,
    title,
    description: String(raw?.description ?? ''),
    typeId,
    createdAt: typeof raw?.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt.trim() : nowIso(),
  };
}

export function normalizePendingTaskDeleteRequest(raw: any): PendingTaskDeleteRequest | null {
  const id = String(raw?.id ?? '').trim();
  const taskId = String(raw?.taskId ?? '').trim();
  if (!id || !taskId) return null;
  return {
    id,
    taskId,
    createdAt: typeof raw?.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt.trim() : nowIso(),
  };
}

export function normalizeTaskStateSnapshot(raw: any): TaskStateSnapshot {
  const fallback: TaskStateSnapshot = {
    enabled: false,
    actor: { id: null, name: null },
    playbook: null,
    repoPath: null,
    taskTypes: [],
    tasks: [],
    updatedAt: nowIso(),
  };
  return {
    enabled: raw?.enabled === true,
    actor: {
      id: typeof raw?.actor?.id === 'string' && raw.actor.id.trim() ? raw.actor.id.trim() : null,
      name: typeof raw?.actor?.name === 'string' && raw.actor.name.trim() ? raw.actor.name.trim() : null,
    },
    playbook:
      raw?.playbook && typeof raw.playbook === 'object'
        ? {
            id: typeof raw.playbook.id === 'string' && raw.playbook.id.trim() ? raw.playbook.id.trim() : null,
            label: typeof raw.playbook.label === 'string' && raw.playbook.label.trim() ? raw.playbook.label.trim() : null,
          }
        : null,
    repoPath: typeof raw?.repoPath === 'string' && raw.repoPath.trim() ? raw.repoPath.trim() : null,
    taskTypes: Array.isArray(raw?.taskTypes)
      ? raw.taskTypes
          .map((item: any) => {
            const id = String(item?.id ?? '').trim();
            const label = String(item?.label ?? '').trim();
            if (!id || !label) return null;
            return {
              id,
              label,
              active: item?.active !== false,
            };
          })
          .filter(Boolean)
      : fallback.taskTypes,
    tasks: Array.isArray(raw?.tasks)
      ? raw.tasks
          .map((item: any) => {
            const id = String(item?.id ?? '').trim();
            const title = String(item?.title ?? '').trim();
            const typeId = String(item?.typeId ?? '').trim();
            const laneId = String(item?.laneId ?? '').trim();
            if (!id || !title || !typeId || !laneId) return null;
            return {
              id,
              title,
              description: String(item?.description ?? ''),
              typeId,
              typeLabel: String(item?.typeLabel ?? typeId).trim() || typeId,
              laneId,
              laneTitle: String(item?.laneTitle ?? laneId).trim() || laneId,
              ...(typeof item?.playbookId === 'string' && item.playbookId.trim() ? { playbookId: item.playbookId.trim() } : {}),
              ...(typeof item?.playbookLabel === 'string' && item.playbookLabel.trim() ? { playbookLabel: item.playbookLabel.trim() } : {}),
              ...(typeof item?.prompt === 'string' && item.prompt ? { prompt: String(item.prompt) } : {}),
              ...(typeof item?.promptId === 'string' && item.promptId.trim() ? { promptId: item.promptId.trim() } : {}),
              ...(typeof item?.messageId === 'string' && item.messageId.trim() ? { messageId: item.messageId.trim() } : {}),
              ...(typeof item?.chatName === 'string' && item.chatName.trim() ? { chatName: item.chatName.trim() } : {}),
              createdAt: typeof item?.createdAt === 'string' && item.createdAt.trim() ? item.createdAt.trim() : nowIso(),
              updatedAt: typeof item?.updatedAt === 'string' && item.updatedAt.trim() ? item.updatedAt.trim() : nowIso(),
              ...(typeof item?.droneId === 'string' && item.droneId.trim() ? { droneId: item.droneId.trim() } : {}),
              ...(typeof item?.droneName === 'string' && item.droneName.trim() ? { droneName: item.droneName.trim() } : {}),
            };
          })
          .filter(Boolean)
      : fallback.tasks,
    updatedAt: typeof raw?.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt.trim() : fallback.updatedAt,
  };
}

export function firstTaskTypeId(snapshot: TaskStateSnapshot): string | null {
  const active = snapshot.taskTypes.find((item) => item.active !== false);
  return active?.id ?? snapshot.taskTypes[0]?.id ?? null;
}

export function filterTasksByTypeIds(snapshot: TaskStateSnapshot, rawTypeIds: string[]): TaskStateSnapshot['tasks'] {
  const typeIdSet = new Set(rawTypeIds.map((item) => String(item ?? '').trim()).filter(Boolean));
  if (typeIdSet.size === 0) return snapshot.tasks.slice();
  return snapshot.tasks.filter((task) => typeIdSet.has(task.typeId));
}

export function findTaskById(snapshot: TaskStateSnapshot, taskIdRaw: string): TaskStateSnapshot['tasks'][number] | null {
  const taskId = String(taskIdRaw ?? '').trim();
  if (!taskId) return null;
  return snapshot.tasks.find((task) => task.id === taskId) ?? null;
}

export function taskSummaryForResponse(snapshot: TaskStateSnapshot, tasks: TaskStateSnapshot['tasks']) {
  return {
    ok: true,
    actor: snapshot.actor,
    playbook: snapshot.playbook,
    repoPath: snapshot.repoPath,
    taskTypes: snapshot.taskTypes,
    tasks,
    updatedAt: snapshot.updatedAt,
  };
}

function normalizeSearchText(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactSearchText(raw: unknown): string {
  return normalizeSearchText(raw).replace(/\s+/g, '');
}

function isSubsequence(queryRaw: string, textRaw: string): boolean {
  const query = compactSearchText(queryRaw);
  const text = compactSearchText(textRaw);
  if (!query || !text) return false;
  let index = 0;
  for (const char of text) {
    if (char === query[index]) index += 1;
    if (index >= query.length) return true;
  }
  return false;
}

function fuzzyTaskScore(
  snapshot: TaskStateSnapshot,
  task: TaskStateSnapshot['tasks'][number],
  queryRaw: string,
): { score: number; reasons: string[] } {
  const query = normalizeSearchText(queryRaw);
  if (!query) return { score: 0, reasons: [] };
  const queryTokens = query.split(' ').filter(Boolean);
  const title = normalizeSearchText(task.title);
  const description = normalizeSearchText(task.description);
  const lane = normalizeSearchText(task.laneTitle);
  const typeLabel = normalizeSearchText(task.typeLabel || snapshot.taskTypes.find((item) => item.id === task.typeId)?.label || task.typeId);
  const playbook = normalizeSearchText(task.playbookLabel ?? '');
  const drone = normalizeSearchText(task.droneName ?? '');
  const combined = [title, description, lane, typeLabel, playbook, drone].filter(Boolean).join(' ');
  let score = 0;
  const reasons: string[] = [];

  if (title.includes(query)) {
    score += 120;
    reasons.push('title phrase');
  }
  if (description.includes(query)) {
    score += 70;
    reasons.push('description phrase');
  }
  if (combined.includes(query)) {
    score += 35;
    reasons.push('combined phrase');
  }

  let matchedTokens = 0;
  for (const token of queryTokens) {
    if (title.includes(token)) {
      score += 28;
      matchedTokens += 1;
      continue;
    }
    if (description.includes(token)) {
      score += 18;
      matchedTokens += 1;
      continue;
    }
    if (typeLabel.includes(token) || lane.includes(token) || playbook.includes(token) || drone.includes(token)) {
      score += 10;
      matchedTokens += 1;
      continue;
    }
    if (isSubsequence(token, combined)) {
      score += 4;
      matchedTokens += 1;
    }
  }

  if (matchedTokens > 0) reasons.push(`${matchedTokens}/${queryTokens.length} token matches`);
  if (isSubsequence(query, title)) {
    score += 16;
    reasons.push('title fuzzy');
  } else if (isSubsequence(query, combined)) {
    score += 8;
    reasons.push('combined fuzzy');
  }

  return { score, reasons };
}

export function searchTasks(snapshot: TaskStateSnapshot, queryRaw: string, rawTypeIds: string[]) {
  const tasks = filterTasksByTypeIds(snapshot, rawTypeIds);
  const query = String(queryRaw ?? '').trim();
  if (!query) return [];
  return tasks
    .map((task) => {
      const { score, reasons } = fuzzyTaskScore(snapshot, task, query);
      return { ...task, score, reasons };
    })
    .filter((task) => task.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aMs = Date.parse(a.updatedAt || a.createdAt);
      const bMs = Date.parse(b.updatedAt || b.createdAt);
      return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
    });
}

export type { PendingTaskCreateRequest, PendingTaskDeleteRequest, TaskStateSnapshot };
