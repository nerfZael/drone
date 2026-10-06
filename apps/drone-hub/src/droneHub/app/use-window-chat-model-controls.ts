import React from 'react';
import type { DroneSummary, TranscriptItem } from '../types';
import { requestJson } from '../http';
import { fetchDroneChatStateCached } from './chat-api';
import { useChatConfigState } from './use-chat-config-state';
import { buildExternalAgentComposerControls } from './external-agent-composer-controls';
import { isDroneStartingOrSeeding } from './helpers';
import { subagentsMenuAction } from './subagents-menu-action';

/** Use the main chat's configuration and model catalog for this window's chat. */
export function useWindowChatModelControls(drone: DroneSummary, chatName: string, transcripts: TranscriptItem[] | null) {
  const config = useChatConfigState({ selectedDrone: drone.id, selectedChat: chatName,
    droneById: { [drone.id]: drone }, requestJson });
  const configRef = React.useRef(config);
  configRef.current = config;
  const [saving, setSaving] = React.useState(false);
  const provisioning = isDroneStartingOrSeeding(drone.hubPhase);
  React.useEffect(() => {
    if (provisioning) return;
    let active = true;
    const controller = new AbortController();
    void fetchDroneChatStateCached({ droneId: drone.id, chatName, turn: 'last', includeConfig: true, includeTranscript: false, signal: controller.signal })
      .then(data => {
        if (!active || data.notModified) return;
        if (!data.chatInfo) throw new Error('Chat configuration is unavailable.');
        configRef.current.resolveChatInfoFromState(data.chatInfo);
      }).catch(error => { if (active) configRef.current.rejectChatInfoFromState(error); });
    return () => { active = false; controller.abort(); };
  }, [drone.id, chatName, provisioning]);
  const agent = config.chatInfo?.agent;
  const controls = buildExternalAgentComposerControls({
    hasChats: Boolean(config.chatInfo), modelControlEnabled: agent?.kind === 'builtin' || agent?.kind === 'native',
    currentAgentKey: agent?.kind === 'builtin' ? `builtin:${agent.id}` : agent?.kind ?? '',
    models: config.chatModels, currentModel: config.chatInfo?.model ?? null,
    currentReasoning: config.chatInfo?.reasoning ?? null,
    modelDisabled: saving || config.loadingChatInfo || provisioning,
    loading: config.loadingChatModels, error: config.chatModelsError, stale: config.chatModelsStale,
    transcripts,
    onUpdate: settings => {
      if (saving) return;
      setSaving(true);
      void config.setChatModelSettings(settings)
        .catch(error => config.setChatInfoError(error instanceof Error ? error.message : String(error)))
        .finally(() => setSaving(false));
    },
  });
  const menuActions = subagentsMenuAction({
    agentKey: agent?.kind === 'builtin' ? `builtin:${agent.id}` : agent?.kind ?? '',
    enabled: config.chatInfo?.subagentsEnabled === true,
    disabled: config.loadingChatInfo || provisioning,
    onToggle: (enabled) => {
      void config.setChatSubagentsEnabled(enabled)
        .catch(error => config.setChatInfoError(error instanceof Error ? error.message : String(error)));
    },
  });
  return { controls, menuActions, error: config.chatInfoError };
}
