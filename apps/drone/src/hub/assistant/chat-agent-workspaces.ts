import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { ChatWorkspaceAccess, ChatWorkspaceCatalog, ChatWorkspaceOption, ChatWorkspaceTarget } from '@drone/assistant-chat';
import {
  formatWorkspaceLink,
  parseWorkspaceLink,
  resolveWorkspaceRef,
  workspaceLinkRef,
} from '@drone/assistant-chat';
import type { HubAssistantService } from '../assistant';
import {
  CompanionWorkspaceService,
  parseCompanionWorkspaceAccess,
} from '../companion/companion-workspaces';
import { localWorkspaceOptions } from './chat-workspace-access';
import { hostWorkspaceId, hostWorkspaceRoot } from './host-workspaces';
import { chatHomes, chatHomeTargetId, type ChatHomes } from '../chat-homes';

export type AgentChat = { droneId: string; chatName: string };

/** Where a chat's selection lives (its chat entry); `undefined` until the chat has one. */
export type AgentChatWorkspaceStore = {
  read(chat: AgentChat): Promise<unknown>;
  write(chat: AgentChat, access: ChatWorkspaceAccess): Promise<void>;
  /** The chat's stable id, which names its home; `undefined` for a chat without one. */
  id(chat: AgentChat): Promise<string | undefined>;
  /** True for a native chat: DroneHub's own agent keeps its workspaces on its assistant thread, not here. */
  native?(chat: AgentChat): Promise<boolean>;
};

export type WorkspaceGrant = { workspace: string; read?: boolean; write?: boolean; execute?: boolean };

const PERMISSIONS = ['read', 'write', 'execute'] as const;
const GRANT_ATTEMPTS = 3;

type Mesh = ConstructorParameters<typeof CompanionWorkspaceService>[1];

const EMPTY: ChatWorkspaceAccess = { targets: [], defaultTargetId: null };

/** Tool arguments that hold a path, each with the argument naming its workspace. */
const PATH_ARGUMENTS: Array<{ path: string; workspace: string }> = [
  { path: 'path', workspace: 'target' },
  { path: 'from', workspace: 'target' },
  { path: 'to', workspace: 'target' },
  { path: 'cwd', workspace: 'target' },
  { path: 'sourcePath', workspace: 'sourceTarget' },
  { path: 'destinationPath', workspace: 'destinationTarget' },
];
const TOOLS_TTL_MS = 30_000;
// Services keep no state beyond serializing one chat's saves, so the oldest are simply dropped.
const MAX_SERVICES = 200;

/**
 * Workspaces an agent chat (Claude Code, Codex, … in a drone) may use through the DroneHub MCP server, chosen per chat
 * with the same picker and the same service as the Companion and the entity. A chat starts with its own workspace (the
 * container of a container drone, the folder a host drone works in), which grants nothing it could not already reach,
 * and its home: a folder of its own on this device, deleted with the chat (see chat-homes.ts).
 */
export class AgentChatWorkspaces {
  private readonly services = new Map<string, CompanionWorkspaceService>();
  private readonly tools = new Map<
    string,
    { key: string; at: number; byName: Map<string, AgentTool<any>> }
  >();
  private calls = 0;

  constructor(
    private readonly assistant: Pick<
      HubAssistantService,
      'workspaceInventory' | 'executeAuthorizedWorkspaceTool'
    >,
    private readonly mesh: Mesh,
    private readonly store: AgentChatWorkspaceStore,
    private readonly homes: Pick<ChatHomes, 'ensure'> = chatHomes(),
  ) {}

  async catalog(chat: AgentChat, deviceId?: string): Promise<ChatWorkspaceCatalog> {
    // Makes the chat's first selection (and its home) before the catalog lists folders, so it lists the home it selects.
    await this.read(chat);
    return this.service(chat).catalog(deviceId);
  }

  save(chat: AgentChat, value: unknown, revision: string): Promise<ChatWorkspaceCatalog> {
    return this.service(chat).save(value, revision);
  }

  /** The chat's workspaces as the agent sees them: ids to pass to the other tools, and what each allows. */
  async list(chat: AgentChat) {
    const [catalog, own, chatId] = await Promise.all([this.catalog(chat), this.ownWorkspace(chat), this.store.id(chat)]);
    const home = chatId ? chatHomeTargetId(chatId) : null;
    // Named as the Hub's apps resolve links: against every workspace on this device, not only the chat's.
    const named = [...catalog.workspaces, ...catalog.access.targets.filter((target) => !catalog.workspaces.some((item) => item.id === target.id))];
    const workspaces = catalog.access.targets.map((target) => {
      const option = catalog.workspaces.find((item) => item.id === target.id);
      const device = catalog.devices.find((item) => item.id === target.deviceId);
      return {
        id: target.id,
        // As the catalog names it now: a selection keeps the name it had when chosen (a home's chat is renamed later).
        name: option?.name ?? target.name,
        kind: target.kind,
        device: target.deviceName,
        ...(option?.path ? { path: option.path } : {}),
        read: target.read,
        write: target.write,
        execute: target.execute,
        default: target.id === catalog.access.defaultTargetId,
        // Links to its files: append a path relative to its root (and #L12 for a line).
        link: formatWorkspaceLink({ workspace: workspaceLinkRef(target, named), path: '', line: null, column: null }),
        ...(target.id === own?.defaultTargetId ? { ownWorkspace: true } : {}),
        ...(target.id === home ? { home: true } : {}),
        ...(target.kind !== 'remote' && !option ? { unavailable: 'Workspace not found' } : {}),
        ...(device?.error ? { unavailable: device.error } : {}),
      };
    });
    return { defaultWorkspaceId: catalog.access.defaultTargetId, workspaces };
  }

  /**
   * The chat's home, made if it has none yet, with what the chat may do there (null once the user removed it from the
   * chat's workspaces: the folder stays the chat's). Null for a chat without an id.
   */
  async home(chat: AgentChat): Promise<{ id: string; path: string; access: { read: boolean; write: boolean; execute: boolean } | null } | null> {
    // A native chat's workspaces are its assistant thread's; a home made here would be one it cannot use.
    if (await this.store.native?.(chat)) return null;
    const chatId = await this.store.id(chat);
    if (!chatId) return null;
    const access = await this.read(chat);
    const { root } = await this.homes.ensure(chatId);
    const id = chatHomeTargetId(chatId);
    const target = access.targets.find((item) => item.id === id);
    return { id, path: root, access: target ? { read: target.read, write: target.write, execute: target.execute } : null };
  }

  /**
   * Gives another chat access this chat has: each permission granted must be one this chat holds on that workspace, and
   * it is added to whatever the other chat already has there. Nothing is ever taken away, so the other chat keeps it
   * after this chat loses it; only the user removes access, in the picker.
   */
  async grant(from: AgentChat, to: AgentChat, request: WorkspaceGrant) {
    if (chatKey(from) === chatKey(to)) throw new Error('A chat cannot grant workspace access to itself.');
    if (await this.store.native?.(to)) {
      throw new Error(`"${to.chatName}" is a native chat; only the user chooses its workspaces, in its Workspaces picker.`);
    }
    const source = await this.catalog(from);
    const held = resolveWorkspaceRef(String(request.workspace ?? ''), source.access.targets);
    if (!held) {
      throw new Error(`This chat has no workspace "${String(request.workspace ?? '')}". See list_workspaces.`);
    }
    const wanted = PERMISSIONS.filter((permission) => request[permission] === true);
    if (!wanted.length) throw new Error('Choose at least one permission to grant: read, write or execute.');
    const missing = wanted.filter((permission) => !held[permission]);
    if (missing.length) {
      throw new Error(`This chat can only grant access it has; it has no ${missing.join(' or ')} access to ${held.name}.`);
    }
    for (let attempt = 1; ; attempt += 1) {
      const current = await this.catalog(to);
      const existing = current.access.targets.find((target) => target.id === held.id);
      // A chat's workspaces always allow Read (the picker's rule), and every workspace the granting chat holds does.
      const next: ChatWorkspaceTarget = {
        ...(existing ?? identity(held)),
        read: true,
        write: Boolean(existing?.write) || wanted.includes('write'),
        execute: Boolean(existing?.execute) || wanted.includes('execute'),
      };
      const permissions = (target: ChatWorkspaceTarget) => ({ read: target.read, write: target.write, execute: target.execute });
      if (existing && PERMISSIONS.every((permission) => existing[permission] === next[permission])) {
        return { workspace: held.id, name: held.name, changed: false, access: permissions(existing) };
      }
      const targets = existing
        ? current.access.targets.map((target) => (target.id === held.id ? next : target))
        : [...current.access.targets, next];
      try {
        await this.save(to, { targets, defaultTargetId: current.access.defaultTargetId ?? held.id }, current.revision);
        return { workspace: held.id, name: held.name, changed: true, access: permissions(next) };
      } catch (error: any) {
        // The other chat's selection changed while this was applied (its user or another chat): apply onto the new one.
        if (attempt >= GRANT_ATTEMPTS || !/changed elsewhere/.test(String(error?.message))) throw error;
      }
    }
  }

  /** Runs one blip workspace tool over the chat's current selection. */
  async run(
    chat: AgentChat,
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AgentToolResult<unknown>> {
    args = await this.resolveWorkspaceLinks(chat, args);
    for (let attempt = 0; ; attempt += 1) {
      const found = (await this.toolsByName(chat)).get(tool);
      if (!found) {
        throw new Error(
          tool === 'transfer_files'
            ? 'transfer_files needs at least two workspaces, one readable and one writable. Ask the user to add workspaces to this chat.'
            : `${tool} is not available in this chat's workspaces. Ask the user to grant the access it needs.`,
        );
      }
      try {
        return await found.execute(`chat-workspace-${++this.calls}`, args, signal);
      } catch (error: any) {
        // The selection changed between building the tools and running one: rebuild once and run against the new one.
        if (attempt > 0 || !/^Workspace access changed\./.test(String(error?.message))) throw error;
        this.tools.delete(chatKey(chat));
      }
    }
  }

  /**
   * A path argument may be a workspace link (`workspace://Guides/notes.md`): it becomes the path inside that workspace,
   * and the workspace argument beside it names the workspace, so links in documents can be followed as written.
   */
  private async resolveWorkspaceLinks(chat: AgentChat, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const linked = PATH_ARGUMENTS.filter(({ path }) => typeof args?.[path] === 'string' && parseWorkspaceLink(args[path]));
    if (!linked.length) return args;
    const catalog = await this.catalog(chat);
    const next: Record<string, unknown> = { ...args };
    for (const { path, workspace } of linked) {
      const link = parseWorkspaceLink(args[path])!;
      const target = resolveWorkspaceRef(link.workspace, catalog.access.targets);
      if (!target) {
        throw new Error(
          `This chat has no workspace "${link.workspace}" (from ${String(args[path])}). See list_workspaces; ask the user to add it to this chat's workspaces.`,
        );
      }
      const named = next[workspace];
      if (typeof named === 'string' && named.trim() && named !== target.id) {
        throw new Error(`${String(args[path])} is in workspace ${target.id}, not ${named}.`);
      }
      next[workspace] = target.id;
      // The root itself: the tools take no path for it.
      if (link.path) next[path] = link.path;
      else delete next[path];
    }
    return next;
  }

  private service(chat: AgentChat): CompanionWorkspaceService {
    const key = chatKey(chat);
    let service = this.services.get(key);
    if (!service) {
      service = new CompanionWorkspaceService(this.assistant, this.mesh, {
        read: () => this.read(chat),
        write: async (access) => {
          await this.store.write(chat, access);
          this.tools.delete(key);
        },
      });
      this.services.set(key, service);
      if (this.services.size > MAX_SERVICES)
        this.services.delete(this.services.keys().next().value!);
    }
    return service;
  }

  private async read(chat: AgentChat): Promise<ChatWorkspaceAccess> {
    const [stored, chatId] = await Promise.all([this.store.read(chat), this.store.id(chat)]);
    // The home is granted once, when it is made: removed in the picker, it stays removed.
    const madeHome = chatId ? (await this.homes.ensure(chatId)).created : false;
    if (stored != null && !madeHome) return parseCompanionWorkspaceAccess(stored);
    const access =
      stored != null
        ? parseCompanionWorkspaceAccess(stored)
        : ((await this.ownWorkspace(chat)) ?? structuredClone(EMPTY));
    const home = chatId ? await this.homeWorkspace(chat, chatId) : null;
    if (home && !access.targets.some((target) => target.id === home.id)) {
      access.targets.push(home);
      access.defaultTargetId ??= home.id;
    }
    if (stored == null && !access.targets.length) return access;
    // In the stored shape, so the revision of the first catalog matches every later read.
    const initial = parseCompanionWorkspaceAccess(access);
    // Saved on first use so the default stays put as the drone list changes.
    await this.store.write(chat, initial);
    return initial;
  }

  /** The chat's home as a selected workspace: Read and Write, and Execute only where its agent already runs commands on this device. */
  private async homeWorkspace(chat: AgentChat, chatId: string): Promise<ChatWorkspaceTarget | null> {
    const [inventory, directory] = await Promise.all([
      this.assistant.workspaceInventory(),
      this.mesh.workspaceAccessDevices(),
    ]);
    const option = localWorkspaceOptions(inventory, directory.self).workspaces.find(
      (item) => item.id === chatHomeTargetId(chatId),
    );
    if (!option) return null;
    const drone = inventory.drones.find((item) => item.id === chat.droneId);
    return { ...identity(option), read: true, write: true, execute: drone?.runtime === 'host' };
  }

  private async ownWorkspace(chat: AgentChat): Promise<ChatWorkspaceAccess | null> {
    const [inventory, directory] = await Promise.all([
      this.assistant.workspaceInventory(),
      this.mesh.workspaceAccessDevices(),
    ]);
    const drone = inventory.drones.find((item) => item.id === chat.droneId);
    if (!drone) return null;
    const id =
      drone.runtime === 'host' ? hostWorkspaceId(hostWorkspaceRoot(drone)) : `drone:${drone.id}`;
    const option = localWorkspaceOptions(inventory, directory.self).workspaces.find(
      (item) => item.id === id,
    );
    if (!option) return null;
    // The agent already reads, writes and runs commands here; a host drone runs them on this device.
    return {
      targets: [{ ...identity(option), read: true, write: true, execute: true }],
      defaultTargetId: id,
    };
  }

  /** Tools for the current selection; rebuilt when it changes, and at least every 30 s so drones that start or stop show. */
  private async toolsByName(chat: AgentChat): Promise<Map<string, AgentTool<any>>> {
    const id = chatKey(chat);
    const key = JSON.stringify(await this.read(chat));
    const cached = this.tools.get(id);
    if (cached && cached.key === key && Date.now() - cached.at < TOOLS_TTL_MS) return cached.byName;
    // What the chat read stays its own across renames: it is known by its id.
    const chatId = await this.store.id(chat);
    const tools = await this.service(chat).tools(
      `chat:${chat.droneId}:${chat.chatName}`,
      () => {},
      undefined,
      undefined,
      chatId ? `chat:${chatId}` : `chat:${chat.droneId}:${chat.chatName}`,
    );
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const now = Date.now();
    for (const [other, entry] of this.tools) if (now - entry.at >= TOOLS_TTL_MS) this.tools.delete(other);
    this.tools.set(id, { key, at: now, byName });
    return byName;
  }
}

/** A workspace as a selection names it, without what the catalog adds to describe it. */
function identity(option: ChatWorkspaceOption | ChatWorkspaceTarget): ChatWorkspaceTarget {
  const { path: _path, runtime: _runtime, status: _status, repository: _repository, chatHome: _chatHome, ...target } =
    option as ChatWorkspaceOption;
  return target;
}

function chatKey(chat: AgentChat): string {
  return `${chat.droneId}\u0000${chat.chatName}`;
}
