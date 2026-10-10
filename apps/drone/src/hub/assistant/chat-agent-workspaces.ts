import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { ChatWorkspaceAccess, ChatWorkspaceCatalog } from '@drone/assistant-chat';
import type { HubAssistantService } from '../assistant';
import {
  CompanionWorkspaceService,
  parseCompanionWorkspaceAccess,
} from '../companion/companion-workspaces';
import { localWorkspaceOptions } from './chat-workspace-access';
import { hostWorkspaceId, hostWorkspaceRoot } from './host-workspaces';

export type AgentChat = { droneId: string; chatName: string };

/** Where a chat's selection lives (its chat entry); `undefined` until the chat has one. */
export type AgentChatWorkspaceStore = {
  read(chat: AgentChat): Promise<unknown>;
  write(chat: AgentChat, access: ChatWorkspaceAccess): Promise<void>;
};

type Mesh = ConstructorParameters<typeof CompanionWorkspaceService>[1];

const EMPTY: ChatWorkspaceAccess = { targets: [], defaultTargetId: null };
const TOOLS_TTL_MS = 30_000;
// Services keep no state beyond serializing one chat's saves, so the oldest are simply dropped.
const MAX_SERVICES = 200;

/**
 * Workspaces an agent chat (Claude Code, Codex, … in a drone) may use through the DroneHub MCP server, chosen per chat
 * with the same picker and the same service as the Companion and the entity. A chat starts with its own workspace (the
 * container of a container drone, the folder a host drone works in), which grants nothing it could not already reach.
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
  ) {}

  catalog(chat: AgentChat, deviceId?: string): Promise<ChatWorkspaceCatalog> {
    return this.service(chat).catalog(deviceId);
  }

  save(chat: AgentChat, value: unknown, revision: string): Promise<ChatWorkspaceCatalog> {
    return this.service(chat).save(value, revision);
  }

  /** The chat's workspaces as the agent sees them: ids to pass to the other tools, and what each allows. */
  async list(chat: AgentChat) {
    const [catalog, own] = await Promise.all([this.catalog(chat), this.ownWorkspace(chat)]);
    const workspaces = catalog.access.targets.map((target) => {
      const option = catalog.workspaces.find((item) => item.id === target.id);
      const device = catalog.devices.find((item) => item.id === target.deviceId);
      return {
        id: target.id,
        name: target.name,
        kind: target.kind,
        device: target.deviceName,
        ...(option?.path ? { path: option.path } : {}),
        read: target.read,
        write: target.write,
        execute: target.execute,
        default: target.id === catalog.access.defaultTargetId,
        ...(target.id === own?.defaultTargetId ? { ownWorkspace: true } : {}),
        ...(target.kind !== 'remote' && !option ? { unavailable: 'Workspace not found' } : {}),
        ...(device?.error ? { unavailable: device.error } : {}),
      };
    });
    return { defaultWorkspaceId: catalog.access.defaultTargetId, workspaces };
  }

  /** Runs one blip workspace tool over the chat's current selection. */
  async run(
    chat: AgentChat,
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AgentToolResult<unknown>> {
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
    const stored = await this.store.read(chat);
    if (stored != null) return parseCompanionWorkspaceAccess(stored);
    const found = await this.ownWorkspace(chat);
    if (!found) return structuredClone(EMPTY);
    // In the stored shape, so the revision of the first catalog matches every later read.
    const own = parseCompanionWorkspaceAccess(found);
    // Saved on first use so the default stays put as the drone list changes.
    await this.store.write(chat, own);
    return own;
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
    const { path: _path, runtime: _runtime, status: _status, repository: _repository, ...target } =
      option;
    // The agent already reads, writes and runs commands here; a host drone runs them on this device.
    return {
      targets: [{ ...target, read: true, write: true, execute: true }],
      defaultTargetId: id,
    };
  }

  /** Tools for the current selection; rebuilt when it changes, and at least every 30 s so drones that start or stop show. */
  private async toolsByName(chat: AgentChat): Promise<Map<string, AgentTool<any>>> {
    const id = chatKey(chat);
    const key = JSON.stringify(await this.read(chat));
    const cached = this.tools.get(id);
    if (cached && cached.key === key && Date.now() - cached.at < TOOLS_TTL_MS) return cached.byName;
    const tools = await this.service(chat).tools(
      `chat:${chat.droneId}:${chat.chatName}`,
      () => {},
    );
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const now = Date.now();
    for (const [other, entry] of this.tools) if (now - entry.at >= TOOLS_TTL_MS) this.tools.delete(other);
    this.tools.set(id, { key, at: now, byName });
    return byName;
  }
}

function chatKey(chat: AgentChat): string {
  return `${chat.droneId}\u0000${chat.chatName}`;
}
