export type AgentChatSurfaceCapabilities = {
  attachments: 'none' | 'images' | 'files';
  sendWhileWaiting: boolean;
  toolActivity: 'hidden' | 'visible';
};

export type AgentChatSurfaceAdapter = {
  agentType: 'external' | 'native';
  capabilities: AgentChatSurfaceCapabilities;
};

export function adaptExternalAgentChatSurface(
  capabilities: Partial<AgentChatSurfaceCapabilities> = {},
): AgentChatSurfaceAdapter {
  return {
    agentType: 'external',
    capabilities: {
      attachments: capabilities.attachments ?? 'images',
      sendWhileWaiting: capabilities.sendWhileWaiting ?? false,
      toolActivity: capabilities.toolActivity ?? 'hidden',
    },
  };
}

export function adaptNativeAgentChatSurface(
  capabilities: Partial<AgentChatSurfaceCapabilities> = {},
): AgentChatSurfaceAdapter {
  return {
    agentType: 'native',
    capabilities: {
      attachments: capabilities.attachments ?? 'files',
      sendWhileWaiting: capabilities.sendWhileWaiting ?? true,
      toolActivity: capabilities.toolActivity ?? 'visible',
    },
  };
}
