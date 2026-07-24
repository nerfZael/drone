import type { DroneRuntime } from '../../host/runtime';
import type { BuiltinAgentId } from '../chat-types';

export type AgentModelCatalogModel = {
  id: string;
  label: string;
  isDefault?: boolean;
  isCurrent?: boolean;
  reasoningLevels?: string[];
  defaultReasoningLevel?: string;
};

export type AgentModelCatalogSource = 'live' | 'cache' | 'none';

export type AgentModelCatalogResult = {
  models: AgentModelCatalogModel[];
  source: AgentModelCatalogSource;
  discoveredAt: string;
  stale?: boolean;
  installationFingerprint?: string;
  error?: string;
};

export type AgentModelCatalogTarget = {
  runtime: DroneRuntime;
  installationKey?: string;
  containerName?: string;
  containerPort?: number;
};

export type AgentModelCatalogRequest = {
  agentId: BuiltinAgentId;
  target: AgentModelCatalogTarget;
  forceRefresh?: boolean;
};

export type AgentModelCatalogCacheEntry = {
  key: string;
  agentId: BuiltinAgentId;
  runtime: DroneRuntime;
  models: AgentModelCatalogModel[];
  discoveredAt: string;
  installationFingerprint?: string;
  error?: string;
};

export interface AgentModelCatalogStore {
  read(key: string): AgentModelCatalogCacheEntry | null;
  write(entry: AgentModelCatalogCacheEntry): Promise<void>;
}

export type AgentCatalogCommandResult = {
  code: number;
  stdout?: string;
  stderr?: string;
};

export type AgentModelCatalogRuntime = {
  runContainer(
    containerName: string,
    command: string,
    timeoutMs: number,
  ): Promise<AgentCatalogCommandResult>;
  runHost(command: string, timeoutMs: number): Promise<AgentCatalogCommandResult>;
  readHostFile(path: string): Promise<string>;
  hostHomeDirectory(): string;
  hostModelListCommand(agentId: BuiltinAgentId): string | null;
  ensureContainerAgent?(
    agentId: BuiltinAgentId,
    target: AgentModelCatalogTarget,
  ): Promise<void>;
  timeoutMs(): number;
  now?(): number;
};
