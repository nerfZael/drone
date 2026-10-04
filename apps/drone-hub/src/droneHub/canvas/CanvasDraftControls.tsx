import React from 'react';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/components/MenuSelect';
import type { ChatAgentConfig } from '../../domain';
import { buildExternalAgentComposerControls } from '../app/external-agent-composer-controls';
import { normalizeAgentModelCatalog, type AgentModelCatalogOption } from '../app/use-agent-model-catalog';
import { repoPathLabel } from '../app/repo-path-label';
import type { ChatComposerRuntimePickerConfig } from '../chat/ChatComposerRuntimePicker';
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
 * The model section of the canvas composer's picker, from the agent's catalog. Null for an agent without one, such as
 * a custom agent.
 */
export function useCanvasModelPicker({ agent, agentKey, model, reasoning, onChange, disabled }: {
  agent: ChatAgentConfig;
  agentKey: string;
  model: string;
  reasoning: string;
  onChange: (next: { model?: string; reasoning?: string }) => void;
  disabled?: boolean;
}): ChatComposerRuntimePickerConfig['model'] {
  const { models, loading, error } = useModelCatalog(agent);
  if (!catalogAgent(agent)) return undefined;
  const control = buildExternalAgentComposerControls({
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
    onUpdate: (next) => onChange({
      ...(next.model !== undefined ? { model: next.model ?? '' } : {}),
      ...(next.reasoning !== undefined ? { reasoning: next.reasoning ?? '' } : {}),
    }),
  })?.controls[0];
  return control?.kind === 'model-picker' ? control : undefined;
}

/** The repository a new drone starts in, beside the composer's recipient line. */
export function DraftRepoSelect({ repoPath, repoEntries, onRepoChange, disabled }: {
  repoPath: string;
  repoEntries: UiMenuSelectEntry[];
  onRepoChange: (path: string) => void;
  disabled?: boolean;
}) {
  return (
    <span className="flex flex-shrink-0 items-center" data-canvas-draft-controls="true">
      <UiMenuSelect variant="toolbar" value={repoPath} onValueChange={onRepoChange} entries={repoEntries} disabled={disabled}
        title={repoPath || 'No repo'} triggerLabel={repoPath ? repoPathLabel(repoPath) : 'No repo'}
        triggerClassName="h-6 min-w-0 max-w-[170px]" triggerLabelClassName={repoPath ? 'font-mono text-11' : undefined}
        panelClassName={`${UPWARD_PANEL} w-[340px] max-w-[calc(100vw-3rem)]`} menuClassName="max-h-[220px] overflow-y-auto" />
    </span>
  );
}
