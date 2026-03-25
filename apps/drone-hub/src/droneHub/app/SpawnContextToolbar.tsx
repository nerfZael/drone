import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ChatAgentConfig } from '../../domain';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/menuSelect';
import { IconChevron } from './icons';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { buildSpawnModelMenuEntries, getSpawnModelTriggerLabel } from './spawn-model-history';

type SpawnContextToolbarProps = {
  agentMenuEntries: UiMenuSelectEntry[];
  spawnAgentConfig: ChatAgentConfig;
  createRepoMenuEntries: UiMenuSelectEntry[];
  onOpenCustomAgentModal: () => void;
  agentTitle: string;
  modelTitle: string;
  customButtonTitle: string;
  controlsLocked?: boolean;
  showAgentControls?: boolean;
  customButtonDisabled?: boolean;
  repoContainerClassName?: string;
};

export function SpawnContextToolbar({
  agentMenuEntries,
  spawnAgentConfig,
  createRepoMenuEntries,
  onOpenCustomAgentModal,
  agentTitle,
  modelTitle,
  customButtonTitle,
  controlsLocked = false,
  showAgentControls = true,
  customButtonDisabled = false,
  repoContainerClassName,
}: SpawnContextToolbarProps) {
  const {
    spawnAgentKey,
    spawnModel,
    seenModelIds,
    chatHeaderRepoPath,
    setSpawnAgentKey,
    setSpawnModel,
    setChatHeaderRepoPath,
  } = useDroneHubUiStore(
    useShallow((s) => ({
      spawnAgentKey: s.spawnAgentKey,
      spawnModel: s.spawnModel,
      seenModelIds: s.seenModelIds,
      chatHeaderRepoPath: s.chatHeaderRepoPath,
      setSpawnAgentKey: s.setSpawnAgentKey,
      setSpawnModel: s.setSpawnModel,
      setChatHeaderRepoPath: s.setChatHeaderRepoPath,
    })),
  );
  const spawnModelMenuEntries = React.useMemo(
    () => buildSpawnModelMenuEntries(seenModelIds, spawnModel),
    [seenModelIds, spawnModel],
  );
  const spawnModelTriggerLabel = React.useMemo(
    () => getSpawnModelTriggerLabel(seenModelIds, spawnModel),
    [seenModelIds, spawnModel],
  );
  const spawnModelMenuDisabled = controlsLocked || spawnModelMenuEntries.length <= 1;

  return (
    <>
      {showAgentControls ? (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
            Agent
          </span>
          <UiMenuSelect
            variant="toolbar"
            value={spawnAgentKey}
            onValueChange={setSpawnAgentKey}
            entries={agentMenuEntries}
            disabled={controlsLocked}
            triggerClassName="min-w-[170px] max-w-[240px]"
            panelClassName="w-[320px]"
            title={agentTitle}
            chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
          />
          <button
            type="button"
            onClick={onOpenCustomAgentModal}
            disabled={controlsLocked || customButtonDisabled}
            className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
              controlsLocked || customButtonDisabled
                ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title={customButtonTitle}
          >
            Custom
          </button>
        </div>
      ) : null}
      {showAgentControls && spawnAgentConfig.kind === 'builtin' ? (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
            Model
          </span>
          <UiMenuSelect
            variant="toolbar"
            value={spawnModel}
            onValueChange={setSpawnModel}
            entries={spawnModelMenuEntries}
            disabled={spawnModelMenuDisabled}
            triggerClassName="min-w-[140px] max-w-[180px]"
            panelClassName="w-[320px]"
            menuClassName="max-h-[220px] overflow-y-auto"
            title={modelTitle}
            triggerLabel={spawnModelTriggerLabel}
            triggerLabelClassName="font-mono"
            chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
          />
          <input
            value={spawnModel}
            onChange={(event) => setSpawnModel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') event.currentTarget.blur();
            }}
            disabled={controlsLocked}
            placeholder="Default model"
            className={`h-[28px] w-[170px] rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[11px] text-[var(--muted)] placeholder:text-[var(--muted-dim)] focus:outline-none transition-all font-mono ${
              controlsLocked ? 'opacity-40 cursor-not-allowed' : 'hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
            }`}
            title={modelTitle}
          />
          <button
            type="button"
            onClick={() => setSpawnModel('')}
            disabled={controlsLocked || !spawnModel.trim()}
            className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold tracking-wide uppercase transition-all ${
              controlsLocked || !spawnModel.trim()
                ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)]'
                : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
            title="Clear model override"
          >
            Clear
          </button>
        </div>
      ) : null}
      <div className={repoContainerClassName ? `flex items-center gap-1.5 ${repoContainerClassName}` : 'flex items-center gap-1.5'}>
        <span className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>
          Repo
        </span>
        <UiMenuSelect
          variant="toolbar"
          value={chatHeaderRepoPath}
          onValueChange={setChatHeaderRepoPath}
          entries={createRepoMenuEntries}
          disabled={controlsLocked}
          triggerClassName="min-w-[220px] max-w-[420px]"
          panelClassName="w-[720px] max-w-[calc(100vw-3rem)]"
          menuClassName="max-h-[240px] overflow-y-auto"
          title={chatHeaderRepoPath || 'No repo'}
          triggerLabel={chatHeaderRepoPath || 'No repo'}
          triggerLabelClassName={chatHeaderRepoPath ? 'font-mono text-[11px]' : undefined}
          chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
        />
      </div>
    </>
  );
}
