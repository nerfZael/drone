import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { Channel, EffectSpec, Schema } from '@entity/core';
import type { ChatWorkspaceAccess, ChatWorkspaceCatalog } from '@drone/assistant-chat';
import { loadBlipTools } from '../assistant/blip-runtime-loader';

/** The entity's own folder: always there, readable and writable, never a place to run commands. */
export const ENTITY_HOME_TARGET_ID = 'entity-home';

/** What the entity needs from the Companion's workspace service (one instance per session, with its own storage). */
export interface WorkspaceService {
  catalog(deviceId?: string): Promise<ChatWorkspaceCatalog>;
  save(value: unknown, revision: string): Promise<ChatWorkspaceCatalog>;
  tools(runId: string, assertActive: () => void, homeRoot?: string, home?: { id: string; label: string }): Promise<AgentTool<any>[]>;
}

export type WorkspaceStorage = { read(): Promise<ChatWorkspaceAccess>; write(access: ChatWorkspaceAccess): Promise<void> };
export type CreateWorkspaceService = (storage: WorkspaceStorage) => WorkspaceService;

/** The workspaces a session may use, as its limbs and the bench see them. */
export interface EntityWorkspaceView {
  targets: { id: string; name: string; kind: string; read: boolean; write: boolean; execute: boolean }[];
  defaultTargetId: string | null;
}

export const EMPTY_WORKSPACE_ACCESS: ChatWorkspaceAccess = { targets: [], defaultTargetId: null };

export function workspaceView(access: ChatWorkspaceAccess): EntityWorkspaceView {
  return {
    targets: access.targets.map(t => ({ id: t.id, name: t.name, kind: t.kind, read: t.read, write: t.write, execute: t.execute })),
    defaultTargetId: access.defaultTargetId,
  };
}

/**
 * A session's workspace access and the tools over it. The selection is the session's (its config and recording);
 * the tools are the Companion's (repositories, host and container drones, folders shared by other devices, with every
 * call checked against the current selection), rebuilt when the selection changes.
 */
export class EntityWorkspaces {
  private readonly service: WorkspaceService;
  private tools: { key: string; at: number; byName: Map<string, AgentTool<any>> } | null = null;
  private calls = 0;

  constructor(
    create: CreateWorkspaceService,
    private access: ChatWorkspaceAccess,
    private readonly homeRoot: () => string,
    private readonly runId: () => string,
    /** Called with the new selection once it is saved. */
    private readonly onChange: (access: ChatWorkspaceAccess) => void,
  ) {
    this.service = create({
      read: async () => structuredClone(this.access),
      write: async next => {
        this.access = structuredClone(next);
        this.tools = null;
        this.onChange(structuredClone(next));
      },
    });
  }

  get current(): ChatWorkspaceAccess { return structuredClone(this.access); }

  catalog(deviceId?: string): Promise<ChatWorkspaceCatalog> { return this.service.catalog(deviceId); }
  save(value: unknown, revision: string): Promise<ChatWorkspaceCatalog> { return this.service.save(value, revision); }

  /** Runs one workspace tool and returns its result as text for the model. */
  async run(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const byName = await this.toolsByName();
    const found = byName.get(tool);
    if (!found) return `error: ${tool} is not available in the selected workspaces`;
    try {
      const result = await found.execute(`entity-${++this.calls}`, args, signal);
      const text = (result?.content ?? [])
        .map((part: { type: string; text?: string }) => (part.type === 'text' ? part.text ?? '' : `[${part.type}]`))
        .join('\n')
        .trim();
      return text || 'done';
    } catch (error) {
      return `error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /** Tools for the current selection; rebuilt when it changes, and at least every 30 s so drones that start or stop show. */
  private async toolsByName(): Promise<Map<string, AgentTool<any>>> {
    const key = JSON.stringify(this.access);
    if (this.tools && this.tools.key === key && Date.now() - this.tools.at < 30_000) return this.tools.byName;
    const tools = await this.service.tools(this.runId(), () => {}, this.homeRoot(), {
      id: ENTITY_HOME_TARGET_ID,
      label: "Entity home (the entity's own scratch folder)",
    });
    this.tools = { key, at: Date.now(), byName: new Map(tools.map(tool => [tool.name, tool])) };
    return this.tools.byName;
  }
}

/** Blip's workspace tools as the entity offers them: every call names a target, or goes to the default. */
const READ_TOOLS = new Set(['read_file', 'search_files', 'list_files', 'get_working_tree_status']);

export interface WorkspacesWorld { access: EntityWorkspaceView }

/** Loads blip's tool definitions (names, descriptions, parameters); they are the same whatever is selected. */
export async function workspaceToolDefinitions(): Promise<{ name: string; description: string; parameters: Record<string, unknown> }[]> {
  const blip: any = await loadBlipTools();
  return blip
    .createWorkspaceTargetTools({
      profile: 'no-shell-workspace-write',
      includeShell: true,
      resolveTarget: () => { throw new Error('definitions only'); },
      exposeTargetParameter: true,
    })
    .map((tool: any) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
}

/** Files a write touches, for claims: `<target>:<path>`, so two workspaces never share a claim. */
function writtenPaths(tool: string, args: Record<string, any>, world: WorkspacesWorld): string[] {
  const target = typeof args.target === 'string' && args.target ? args.target : world.access.defaultTargetId ?? ENTITY_HOME_TARGET_ID;
  const paths: string[] = [];
  if (tool === 'move_path') paths.push(args.from, args.to);
  else if (tool === 'apply_patch') {
    for (const line of String(args.patch ?? '').split('\n')) {
      const match = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/.exec(line) ?? /^\*\*\* Move to: (.+)$/.exec(line);
      if (match) paths.push(match[1].trim());
    }
  } else if (typeof args.path === 'string') paths.push(args.path);
  return paths.filter(p => typeof p === 'string' && p).map(p => `${target}:${p.replace(/^\.?\/+/, '')}`);
}

/**
 * The entity's workspaces as a channel: blip's workspace tools as effects over the session's selected workspaces,
 * and the selection itself as state, kept current by `workspaces_changed` events so a replay has it too.
 */
export function workspacesChannel(
  workspaces: EntityWorkspaces,
  definitions: { name: string; description: string; parameters: Record<string, unknown> }[],
): Channel<WorkspacesWorld> {
  const effects: EffectSpec<any, WorkspacesWorld>[] = definitions.map(def => {
    const readonly = READ_TOOLS.has(def.name);
    const run = def.name === 'bash';
    return {
      name: def.name,
      description: `${def.description}${run ? ' Needs Run access to the workspace.' : readonly ? '' : ' Needs Write access to the workspace.'} target: a workspace id from your state; omitted, the default workspace.`,
      parameters: def.parameters as unknown as Schema,
      risk: 'limb',
      ...(readonly ? { readonly: true } : { output: false }),
      ...(readonly || run ? {} : { paths: (args: Record<string, unknown>) => writtenPaths(def.name, args, { access: currentView(workspaces) }) }),
      apply: (args: Record<string, unknown>) => workspaces.run(def.name, args),
    };
  });
  return {
    name: 'workspaces',
    describe: 'The workspaces you may use: repositories, folders and drones the user granted this session, and your own home folder. File tools and bash act in one workspace: pass target (a workspace id) or omit it for the default. Paths are relative to the workspace. What each workspace allows (read, write, run commands) is in state; a call it does not allow is refused.',
    inputs: [],
    init: () => ({ access: currentView(workspaces) }),
    reduce(world, event) {
      if (event.type === 'workspaces_changed') world.access = event.data.access as unknown as EntityWorkspaceView;
    },
    effects,
    render(world) {
      const allows = (t: { read: boolean; write: boolean; execute: boolean }) => [t.read && 'read', t.write && 'write', t.execute && 'run'].filter(Boolean).join(', ');
      const home = `${ENTITY_HOME_TARGET_ID}: your home folder (read, write)${world.access.defaultTargetId ? '' : ' · default'}`;
      return {
        stable: {
          workspaces: [
            home,
            ...world.access.targets.map(t => `${t.id}: ${t.name} (${t.kind}; ${allows(t)})${t.id === world.access.defaultTargetId ? ' · default' : ''}`),
          ],
        },
      };
    },
  };
}

function currentView(workspaces: EntityWorkspaces): EntityWorkspaceView {
  return workspaceView(workspaces.current);
}
