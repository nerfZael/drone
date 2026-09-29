import React from 'react';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/components/MenuSelect';
import type { ChatAgentConfig } from '../../domain';
import { BUILTIN_AGENT_OPTIONS } from '../app/app-config';
import { fetchDroneChatStateCached } from '../app/chat-api';
import { buildExternalAgentComposerControls } from '../app/external-agent-composer-controls';
import { normalizeAgentModelCatalog, type AgentModelCatalogOption } from '../app/use-agent-model-catalog';
import { repoPathLabel } from '../app/repo-path-label';
import { ChatComposerModelPicker } from '../chat/ChatComposerModelPicker';
import { requestJson } from '../http';

/** Menus in the canvas composer open upwards: the composer sits at the canvas's bottom edge. */
const UPWARD_PANEL = 'bottom-full mt-0 mb-1.5';

function catalogAgent(agent: ChatAgentConfig | null | undefined): string | null {
  if (agent?.kind === 'builtin') return agent.id;
  if (agent?.kind === 'native') return 'native';
  return null;
}

function useModelCatalog(agent: ChatAgentConfig | null | undefined): { models: AgentModelCatalogOption[]; loading: boolean; error: string | null } {
  const id = catalogAgent(agent);
  const [state, setState] = React.useState<{ id: string | null; models: AgentModelCatalogOption[]; error: string | null }>({ id: null, models: [], error: null });
  React.useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    const query = new URLSearchParams(id === 'native' ? { agent: id } : { agent: id, runtime: 'container' });
    void requestJson(`/api/model-catalog?${query}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setState({ id, models: normalizeAgentModelCatalog(data), error: null }); })
      .catch((error) => {
        if (!controller.signal.aborted) setState({ id, models: [], error: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, [id]);
  return { models: state.id === id ? state.models : [], loading: Boolean(id) && state.id !== id, error: state.id === id ? state.error : null };
}

/**
 * The model and reasoning a new drone will start with, in the same picker as a chat's own. Picking one keeps it as the
 * default for the next drone too.
 */
export function DraftModelPicker({ agent, agentKey, model, reasoning, onModelChange, onReasoningChange, disabled }: {
  agent: ChatAgentConfig;
  agentKey: string;
  model: string;
  reasoning: string;
  onModelChange: (model: string) => void;
  onReasoningChange: (reasoning: string) => void;
  disabled?: boolean;
}) {
  const { models, loading, error } = useModelCatalog(agent);
  if (!catalogAgent(agent)) return null;
  const controls = buildExternalAgentComposerControls({
    hasChats: true,
    modelControlEnabled: true,
    currentAgentKey: agentKey,
    models,
    currentModel: model || null,
    currentReasoning: reasoning || null,
    modelDisabled: Boolean(disabled),
    loading,
    error,
    stale: false,
    transcripts: null,
    onUpdate: (next) => {
      if (next.model !== undefined) onModelChange(next.model ?? '');
      if (next.reasoning !== undefined) onReasoningChange(next.reasoning ?? '');
    },
  })?.controls[0];
  if (controls?.kind !== 'model-picker') return null;
  const { kind: _kind, ...config } = controls;
  return (
    <div className="flex flex-shrink-0 items-center" data-canvas-draft-model="true">
      <ChatComposerModelPicker config={{ ...config, id: 'canvas-draft-model', title: 'Model and reasoning for the new drone' }} />
    </div>
  );
}

/** Agent and repository for a new drone, beside the composer's recipient line. */
export function DraftAgentAndRepo({ agentKey, agentEntries, onAgentChange, repoPath, repoEntries, onRepoChange, disabled }: {
  agentKey: string;
  agentEntries: UiMenuSelectEntry[];
  onAgentChange: (key: string) => void;
  repoPath?: string;
  repoEntries?: UiMenuSelectEntry[];
  onRepoChange?: (path: string) => void;
  disabled?: boolean;
}) {
  return (
    <span className="flex flex-shrink-0 items-center gap-1" data-canvas-draft-controls="true">
      <UiMenuSelect variant="toolbar" value={agentKey} onValueChange={onAgentChange} entries={agentEntries} disabled={disabled}
        title="Agent for the new drone" triggerClassName="h-6 min-w-0 max-w-[140px]" panelClassName={`${UPWARD_PANEL} w-[260px]`} />
      {repoEntries && onRepoChange ? (
        <UiMenuSelect variant="toolbar" value={repoPath ?? ''} onValueChange={onRepoChange} entries={repoEntries} disabled={disabled}
          title={repoPath || 'No repo'} triggerLabel={repoPath ? repoPathLabel(repoPath) : 'No repo'}
          triggerClassName="h-6 min-w-0 max-w-[170px]" triggerLabelClassName={repoPath ? 'font-mono text-11' : undefined}
          panelClassName={`${UPWARD_PANEL} w-[340px] max-w-[calc(100vw-3rem)]`} menuClassName="max-h-[220px] overflow-y-auto" />
      ) : null}
    </span>
  );
}

const BUILTIN_ENTRIES: UiMenuSelectEntry[] = BUILTIN_AGENT_OPTIONS.map((option) => ({ value: option.key, label: option.label }));

function agentKeyOf(agent: ChatAgentConfig | null | undefined): string {
  return BUILTIN_AGENT_OPTIONS.find((option) => JSON.stringify(option.agent) === JSON.stringify(agent))?.key ?? '';
}

/**
 * The agent of a draft chat on a drone's canvas: nothing has been sent to it, so it can still change. The change
 * applies to that chat at once, as in the chat's own composer, and is kept as the default for the next chat.
 */
export function DraftChatAgentSelect({ droneId, chatName, onRemember, disabled }: {
  droneId: string;
  chatName: string;
  onRemember?: (key: string) => void;
  disabled?: boolean;
}) {
  const [agentKey, setAgentKey] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    const controller = new AbortController();
    setAgentKey('');
    void fetchDroneChatStateCached({ droneId, chatName, includeConfig: true, includeTranscript: false, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted && !data.notModified) setAgentKey(agentKeyOf(data.chatInfo?.agent)); })
      .catch(() => {});
    return () => controller.abort();
  }, [droneId, chatName]);
  const change = async (key: string) => {
    const option = BUILTIN_AGENT_OPTIONS.find((item) => item.key === key);
    if (!option || key === agentKey) return;
    const previous = agentKey;
    setAgentKey(key);
    setBusy(true);
    try {
      await requestJson(`/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/config`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: option.agent }),
      });
      onRemember?.(key);
      window.dispatchEvent(new CustomEvent('drone-hub:chat-model-settings-changed', { detail: { droneId, chatName, settings: {} } }));
    } catch {
      setAgentKey(previous);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex flex-shrink-0" data-canvas-draft-chat-agent={agentKey || 'loading'}>
    <UiMenuSelect variant="toolbar" value={agentKey} onValueChange={(key) => void change(key)} entries={BUILTIN_ENTRIES}
      disabled={disabled || busy || !agentKey} title="Agent for this new chat (it can change until its first message)"
      triggerClassName="h-6 min-w-0 max-w-[140px]" panelClassName={`${UPWARD_PANEL} w-[240px]`} />
    </span>
  );
}
