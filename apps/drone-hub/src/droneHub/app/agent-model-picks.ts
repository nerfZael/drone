import type { ChatAgentConfig } from '../../domain';
import { NO_AGENT_MODEL_PICK, useDroneHubUiStore, type AgentModelPick } from './use-drone-hub-ui-store';

/** The key an agent goes by in the pickers: "builtin:codex", "custom:<id>", or "native". */
export function chatAgentKey(agent: ChatAgentConfig): string {
  if (agent.kind === 'builtin' || agent.kind === 'custom') return `${agent.kind}:${agent.id}`;
  return agent.kind;
}

/** The model and reasoning last picked for this agent in any composer, or Auto when there is none. */
export function rememberedAgentModelPick(agentKey: string): AgentModelPick {
  return useDroneHubUiStore.getState().agentModelPicks[agentKey.trim()] ?? NO_AGENT_MODEL_PICK;
}

export function rememberAgentModelPick(agentKey: string, pick: AgentModelPick): void {
  useDroneHubUiStore.getState().rememberAgentModelPick(agentKey, pick);
}
