import { getCatalogStore, type CatalogPlaybookRecord } from './catalog-store';
import {
  getDroneLifecycleRepository,
  type CanonicalDroneLifecycleRecord,
} from './drone-lifecycle-repository';
import { getFleetWorkflowStore, type WorkflowQueueItem } from './fleet-workflow-store';
import { getHubDatabase } from './hub-database';
import { getPromptQueueRepository, type PromptQueueItem } from './prompt-queue-repository';
import { loadRegistryCompatibilityBase, type DroneRegistry } from './registry';
import { listStoredTokensFromRegistry } from '../hub/mcp-tokens';
import { listMcpServersFromRegistry } from '../hub/mcp-servers';
import { listSkillsFromRegistry } from '../hub/skills';
import { readStoredSyncSets } from '../hub/sync-sets';
import {
  importArchivedChatsFromRegistry,
  importDroneChatsFromRegistry,
  listArchivedChatsFromStore,
  listChatsFromStore,
  readChatFromStore,
} from '../hub/transcript-store';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function mapBy<T>(records: T[], key: (record: T) => string): Record<string, T> {
  return Object.fromEntries(records.map((record) => [key(record), record]));
}

function recordValues(value: unknown): any[] {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.values(value as Record<string, unknown>)
    : [];
}

function withUpdatedAt(value: unknown, updatedAt: string | null): any {
  return {
    ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
    updatedAt,
  };
}

function setOrDelete(target: any, key: string, value: unknown, updatedAt: string | null): void {
  if (value == null) delete target[key];
  else target[key] = withUpdatedAt(value, updatedAt);
}

/** Maps canonical setting rows back to the exact legacy registry fields. */
function overlayCanonicalSettings(registry: any): void {
  const database = getHubDatabase();
  if (!database) return;
  const hasTable = database.read((connection) => Boolean(
    connection.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='hub_canonical_settings'").get(),
  ));
  if (!hasTable) return;
  const rows = database.read((connection) => connection.prepare(
    'SELECT setting_key,value_json,updated_at FROM hub_canonical_settings ORDER BY setting_key',
  ).all() as Array<{ setting_key: string; value_json: string; updated_at: string | null }>);
  registry.settings ??= {};
  for (const row of rows) {
    let value: any;
    try {
      value = JSON.parse(row.value_json);
    } catch {
      continue;
    }
    const settings = registry.settings;
    const updatedAt = row.updated_at;
    const provider = /^api-key\.(openai|gemini|groq|exa)$/.exec(row.setting_key)?.[1];
    if (provider) {
      if (value?.apiKey) settings[provider] = { apiKey: value.apiKey, updatedAt };
      else delete settings[provider];
      continue;
    }
    switch (row.setting_key) {
      case 'llm.provider':
        if (value?.provider) settings.llm = { provider: value.provider, updatedAt };
        else delete settings.llm;
        break;
      case 'delete-action': setOrDelete(settings, 'deleteAction', value, updatedAt); break;
      case 'filesystem': setOrDelete(settings, 'filesystem', value, updatedAt); break;
      case 'agent-message-auto-continue': setOrDelete(settings, 'agentMessageAutoContinue', value, updatedAt); break;
      case 'agent-suggestion': setOrDelete(settings, 'agentSuggestion', value, updatedAt); break;
      case 'ui-preferences': setOrDelete(settings, 'uiPreferences', value, updatedAt); break;
      case 'registry-backups': setOrDelete(settings, 'backups', value, updatedAt); break;
      case 'agents.default': setOrDelete(settings, 'agents', value, updatedAt); break;
      case 'environment.non-repository': setOrDelete(settings, 'nonRepoEnvironment', value, updatedAt); break;
      default:
        break;
    }
  }
}

function lifecycleProjection(record: CanonicalDroneLifecycleRecord): Record<string, any> {
  const projected = { ...record.lifecycle };
  projected.id = record.id;
  projected.name = record.name;
  if (record.containerName == null) delete projected.containerName;
  else projected.containerName = record.containerName;
  projected.runtime = record.runtimeKind;
  if (record.phase == null) delete projected.phase;
  else projected.phase = record.phase;
  if (record.state === 'archived') {
    projected.archivedAt = record.archivedAt;
    projected.deleteAt = record.deleteAt;
    projected.archiveRetention = record.archiveRetention;
    if (record.archiveRuntimePolicy == null) delete projected.archiveRuntimePolicy;
    else projected.archiveRuntimePolicy = record.archiveRuntimePolicy;
  } else {
    delete projected.archivedAt;
    delete projected.deleteAt;
    delete projected.archiveRetention;
    delete projected.archiveRuntimePolicy;
  }
  return projected;
}

function chatsForDrone(droneId: string): Record<string, any> {
  const listed = listChatsFromStore({ droneId });
  if (!listed.available) return {};
  const out: Record<string, any> = {};
  for (const chatName of listed.chats) {
    const read = readChatFromStore({ droneId, chatName });
    if (read.available && read.chat) out[chatName] = read.chat;
  }
  return out;
}

function archivedChatsForDrone(droneId: string): Record<string, any> {
  const listed = listArchivedChatsFromStore({ droneId });
  if (!listed.available) return {};
  return Object.fromEntries(listed.archivedChats.map((record) => [record.chatName, {
    ...(record.chat && typeof record.chat === 'object' ? record.chat : {}),
    archivedAt: record.archivedAt,
    deleteAt: record.deleteAt,
    archiveRetention: record.archiveRetention,
  }]));
}

async function backfillLegacyChatState(registry: any): Promise<void> {
  const promptQueue = getPromptQueueRepository();
  for (const bucket of [registry?.drones, registry?.pending, registry?.archived]) {
    for (const [droneId, entry] of Object.entries(bucket ?? {}) as Array<[string, any]>) {
      const chats = entry?.chats && typeof entry.chats === 'object' && !Array.isArray(entry.chats)
        ? entry.chats as Record<string, any>
        : {};
      await importDroneChatsFromRegistry({ droneId, chats });
      await importArchivedChatsFromRegistry({ droneId, archivedChats: entry?.archivedChats });
      if (!promptQueue) continue;
      for (const [chatName, chat] of Object.entries(chats)) {
        const canonicalChat = readChatFromStore({ droneId, chatName });
        if (!canonicalChat.available || !canonicalChat.chat) continue;
        const completedIds = new Set(
          (Array.isArray(chat?.turns) ? chat.turns : [])
            .map((turn: any) => String(turn?.id ?? '').trim())
            .filter(Boolean),
        );
        const prompts = (Array.isArray(chat?.pendingPrompts) ? chat.pendingPrompts : [])
          .filter((prompt: any) => !completedIds.has(String(prompt?.id ?? '').trim())) as PromptQueueItem[];
        await promptQueue.backfillLegacy({ droneId, chatName, prompts });
      }
    }
  }
}

function legacyPlaybooks(registry: any): CatalogPlaybookRecord[] {
  return recordValues(registry?.playbooks).flatMap((raw: any) => {
    const id = String(raw?.id ?? '').trim();
    const label = String(raw?.label ?? '').trim();
    if (!id || !label) return [];
    const createdAt = String(raw.createdAt ?? '').trim() || new Date(0).toISOString();
    return [{
      ...raw,
      id,
      label,
      agent: raw.agent ?? { kind: 'builtin', id: 'cursor' },
      messages: Array.isArray(raw.messages) ? raw.messages : [],
      artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
      actions: Array.isArray(raw.actions) ? raw.actions : [],
      createdAt,
      updatedAt: String(raw.updatedAt ?? '').trim() || createdAt,
    }];
  });
}

function legacyQueue(registry: any): WorkflowQueueItem[] {
  const items = Array.isArray(registry?.playbookRunQueue?.items) ? registry.playbookRunQueue.items : [];
  return items.filter((item: any) => item && typeof item === 'object' && String(item.id ?? '').trim());
}

/** Builds the registry-shaped compatibility read model without rewriting canonical state. */
export async function buildHubStateProjection(baseRegistry?: DroneRegistry): Promise<DroneRegistry> {
  const base = clone(baseRegistry ?? (await loadRegistryCompatibilityBase())) as any;

  // Insert-only migration must happen before canonical collections replace the seed.
  const lifecycle = await getDroneLifecycleRepository();
  if (lifecycle) {
    await backfillLegacyChatState(base);
    await lifecycle.backfillLegacyInsertOnly(base);
    base.drones = mapBy(lifecycle.list('real').map((record) => ({
      ...lifecycleProjection(record),
      chats: chatsForDrone(record.id),
      archivedChats: archivedChatsForDrone(record.id),
    })), (record: any) => record.id);
    base.pending = mapBy(lifecycle.list('pending').map((record) => {
      const chats = chatsForDrone(record.id);
      const archivedChats = archivedChatsForDrone(record.id);
      return {
        ...lifecycleProjection(record),
        ...(Object.keys(chats).length > 0 ? { chats } : {}),
        ...(Object.keys(archivedChats).length > 0 ? { archivedChats } : {}),
      };
    }), (record: any) => record.id);
    base.archived = mapBy(lifecycle.list('archived').map((record) => {
      const chats = chatsForDrone(record.id);
      const archivedChats = archivedChatsForDrone(record.id);
      return {
        ...lifecycleProjection(record),
        ...(Object.keys(chats).length > 0 ? { chats } : {}),
        ...(Object.keys(archivedChats).length > 0 ? { archivedChats } : {}),
      };
    }), (record: any) => record.id);
  }

  const catalog = await getCatalogStore();
  await Promise.all([
    catalog.backfillSkills(listSkillsFromRegistry(base)),
    catalog.backfillMcpServers(listMcpServersFromRegistry(base)),
    catalog.backfillMcpTokens(listStoredTokensFromRegistry(base)),
    catalog.backfillPlaybooks(legacyPlaybooks(base)),
    catalog.backfillGroups(Object.entries(base.groups ?? {}).map(([key, raw]: [string, any]) => {
      const name = String(raw?.name ?? key).trim();
      const createdAt = String(raw?.createdAt ?? '').trim() || new Date(0).toISOString();
      return { name, createdAt, updatedAt: String(raw?.updatedAt ?? '').trim() || createdAt };
    }).filter((record: any) => record.name)),
    catalog.backfillRepositories(Object.entries(base.repos ?? {}).flatMap(([key, raw]: [string, any]) => {
      if (!raw || typeof raw !== 'object') return [];
      const repoPath = String(raw.path ?? key).trim();
      if (!repoPath) return [];
      return [{ ...raw, path: repoPath, addedAt: String(raw.addedAt ?? '').trim() || new Date(0).toISOString() }];
    })),
  ]);
  base.skills = mapBy(catalog.listSkills(), (record: any) => record.id);
  base.mcpServers = mapBy(catalog.listMcpServers(), (record: any) => record.id);
  base.mcpTokens = mapBy(catalog.listMcpTokens(), (record: any) => record.id);
  base.playbooks = mapBy(catalog.listPlaybooks(), (record: any) => record.id);
  base.groups = mapBy(catalog.listGroups(), (record: any) => record.name);
  base.repos = mapBy(catalog.listRepositories(), (record: any) => record.path);

  const workflows = await getFleetWorkflowStore();
  await workflows.backfillSyncSets(readStoredSyncSets(base));
  await workflows.backfillQueue(legacyQueue(base));
  const syncSets = workflows.listSyncSets();
  base.settings ??= {};
  base.settings.syncSets = {
    items: syncSets,
    updatedAt: syncSets.reduce(
      (latest: string | null, item: any) => !latest || item.updatedAt > latest ? item.updatedAt : latest,
      null,
    ),
  };
  const queueItems = workflows.listQueue(true).filter(
    (item: any) => item.state !== 'completed' && item.state !== 'cancelled',
  );
  if (queueItems.length > 0) base.playbookRunQueue = { items: queueItems };
  else delete base.playbookRunQueue;
  overlayCanonicalSettings(base);
  return base as DroneRegistry;
}

export async function serializeHubStateProjection(baseRegistry?: DroneRegistry): Promise<string> {
  return `${JSON.stringify(await buildHubStateProjection(baseRegistry), null, 2)}\n`;
}
