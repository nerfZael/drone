import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ChatAgentConfig } from '../../domain';
import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/menuSelect';
import { IconChevron } from './icons';
import { repoPathLabel } from './repo-path-label';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { buildDetectedModelMenuEntries, useSpawnModelCatalog } from './use-spawn-model-catalog';

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
  layout?: 'toolbar' | 'panel';
  allowWrap?: boolean;
  runtime?: 'container' | 'host';
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
  layout = 'toolbar',
  allowWrap = false,
  runtime = 'container',
}: SpawnContextToolbarProps) {
  const {
    spawnAgentKey,
    spawnModel,
    spawnReasoning,
    chatHeaderRepoPath,
    setSpawnAgentKey,
    setSpawnModel,
    setSpawnReasoning,
    setChatHeaderRepoPath,
  } = useDroneHubUiStore(
    useShallow((s) => ({
      spawnAgentKey: s.spawnAgentKey,
      spawnModel: s.spawnModel,
      spawnReasoning: s.spawnReasoning,
      chatHeaderRepoPath: s.chatHeaderRepoPath,
      setSpawnAgentKey: s.setSpawnAgentKey,
      setSpawnModel: s.setSpawnModel,
      setSpawnReasoning: s.setSpawnReasoning,
      setChatHeaderRepoPath: s.setChatHeaderRepoPath,
    })),
  );
  const modelCatalog = useSpawnModelCatalog({
    agentId:
      spawnAgentConfig.kind === 'native'
        ? 'native'
        : spawnAgentConfig.kind === 'builtin'
          ? spawnAgentConfig.id
          : '',
    runtime,
    enabled: showAgentControls && spawnAgentConfig.kind !== 'custom',
  });
  const spawnModelMenuEntries = React.useMemo(
    () => buildDetectedModelMenuEntries(modelCatalog.models, spawnModel),
    [modelCatalog.models, spawnModel],
  );
  const selectedCatalogModel = modelCatalog.models.find((model) => model.id === spawnModel) ?? null;
  const reasoningEntries = (selectedCatalogModel?.reasoningLevels ?? []).map((level) => ({
    value: level,
    label: level === 'off' ? 'Off' : level[0].toUpperCase() + level.slice(1),
  }));
  React.useEffect(() => {
    const levels = selectedCatalogModel?.reasoningLevels ?? [];
    if (levels.length === 0) {
      if (spawnReasoning) setSpawnReasoning('');
      return;
    }
    if (!levels.includes(spawnReasoning)) {
      setSpawnReasoning(selectedCatalogModel?.defaultReasoningLevel || levels[0] || '');
    }
  }, [selectedCatalogModel, setSpawnReasoning, spawnReasoning]);
  const spawnModelMenuDisabled = controlsLocked || spawnModelMenuEntries.length <= 1;
  const isPanelLayout = layout === 'panel';
  const sectionLabelClassName = 'text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-wide uppercase';
  const sectionLabelStyle = { fontFamily: 'var(--display)' } as const;
  const toolbarGroupClassName = 'flex items-center gap-1.5 min-w-0';

  if (isPanelLayout) {
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        {showAgentControls ? (
          <div className="min-w-0 rounded-[var(--radius-xlarge)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-3">
            <div className={sectionLabelClassName} style={sectionLabelStyle}>
              Agent
            </div>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <UiMenuSelect
                  variant="form"
                  value={spawnAgentKey}
                  onValueChange={setSpawnAgentKey}
                  entries={agentMenuEntries}
                  disabled={controlsLocked}
                  panelClassName="w-[320px]"
                  title={agentTitle}
                  chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
                />
              </div>
              <button
                type="button"
                onClick={onOpenCustomAgentModal}
                disabled={controlsLocked || customButtonDisabled}
                className={`inline-flex items-center justify-center gap-1 h-9 px-3 rounded border border-[var(--border-subtle)] text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
                  controlsLocked || customButtonDisabled
                    ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] text-[var(--muted-dim)]'
                    : 'bg-[var(--surface-softest)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                }`}
                style={sectionLabelStyle}
                title={customButtonTitle}
              >
                Custom
              </button>
            </div>
          </div>
        ) : null}
        {showAgentControls && spawnAgentConfig.kind !== 'custom' ? (
          <div className="min-w-0 rounded-[var(--radius-xlarge)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-3">
            <div className={sectionLabelClassName} style={sectionLabelStyle}>
              Model
            </div>
            <div className="mt-2 flex flex-col gap-2">
              <UiMenuSelect
                variant="form"
                value={spawnModel}
                onValueChange={setSpawnModel}
                entries={spawnModelMenuEntries}
                disabled={spawnModelMenuDisabled}
                panelClassName="w-[320px]"
                menuClassName="max-h-[220px] overflow-y-auto"
                title={modelTitle}
                triggerLabel={spawnModel || (modelCatalog.loading ? 'Detecting models…' : 'Default model')}
                triggerLabelClassName="font-mono"
                searchable
                searchPlaceholder="Search models"
                chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
              />
              {reasoningEntries.length > 0 ? (
                <UiMenuSelect
                  variant="form"
                  value={spawnReasoning}
                  onValueChange={setSpawnReasoning}
                  entries={reasoningEntries}
                  disabled={controlsLocked}
                  panelClassName="w-[180px]"
                  title="Reasoning level"
                  chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
                />
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={spawnModel}
                  onChange={(event) => setSpawnModel(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') event.currentTarget.blur();
                  }}
                  disabled={controlsLocked}
                  placeholder="Default model"
                  className={`h-9 min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 text-[var(--text-11)] text-[var(--muted)] placeholder:text-[var(--muted-dim)] focus:outline-none transition-all font-mono ${
                    controlsLocked ? 'opacity-40 cursor-not-allowed' : 'hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
                  }`}
                  title={modelTitle}
                />
                <button
                  type="button"
                  onClick={() => setSpawnModel('')}
                  disabled={controlsLocked || !spawnModel.trim()}
                  className={`inline-flex items-center justify-center gap-1 h-9 px-3 rounded border border-[var(--border-subtle)] text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
                    controlsLocked || !spawnModel.trim()
                      ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] text-[var(--muted-dim)]'
                      : 'bg-[var(--surface-softest)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                  }`}
                  style={sectionLabelStyle}
                  title="Clear model override"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <div
          className={
            repoContainerClassName
              ? `min-w-0 rounded-[var(--radius-xlarge)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-3 lg:col-span-2 ${repoContainerClassName}`
              : 'min-w-0 rounded-[var(--radius-xlarge)] border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-3 lg:col-span-2'
          }
        >
          <div className={sectionLabelClassName} style={sectionLabelStyle}>
            Repo
          </div>
          <div className="mt-2">
            <UiMenuSelect
              variant="form"
              value={chatHeaderRepoPath}
              onValueChange={setChatHeaderRepoPath}
              entries={createRepoMenuEntries}
              disabled={controlsLocked}
              panelClassName="w-[380px] max-w-[calc(100vw-3rem)]"
              menuClassName="max-h-[240px] overflow-y-auto"
              title={chatHeaderRepoPath || 'No repo'}
              triggerLabel={chatHeaderRepoPath ? repoPathLabel(chatHeaderRepoPath) : 'No repo'}
              triggerLabelClassName={chatHeaderRepoPath ? 'font-mono text-[var(--text-11)]' : undefined}
              chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
            />
          </div>
        </div>
      </div>
    );
  }

  const toolbarContent = (
    <>
      {showAgentControls ? (
        <div className={toolbarGroupClassName}>
          <span className={sectionLabelClassName} style={sectionLabelStyle}>
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
            className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
              controlsLocked || customButtonDisabled
                ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] text-[var(--muted-dim)]'
                : 'bg-[var(--surface-softest)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
            }`}
            style={sectionLabelStyle}
            title={customButtonTitle}
          >
            Custom
          </button>
        </div>
      ) : null}
      {showAgentControls && spawnAgentConfig.kind !== 'custom' ? (
        <div className={toolbarGroupClassName}>
          <span className={sectionLabelClassName} style={sectionLabelStyle}>
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
            triggerLabel={spawnModel || (modelCatalog.loading ? 'Detecting models…' : 'Default model')}
            triggerLabelClassName="font-mono"
            searchable
            searchPlaceholder="Search models"
            chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
          />
          {reasoningEntries.length > 0 ? (
            <UiMenuSelect
              variant="toolbar"
              value={spawnReasoning}
              onValueChange={setSpawnReasoning}
              entries={reasoningEntries}
              disabled={controlsLocked}
              triggerClassName="min-w-[100px] max-w-[130px]"
              panelClassName="w-[170px]"
              title="Reasoning level"
              chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
            />
          ) : null}
          <input
            value={spawnModel}
            onChange={(event) => setSpawnModel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') event.currentTarget.blur();
            }}
            disabled={controlsLocked}
            placeholder="Default model"
            className={`h-[28px] ${allowWrap ? 'w-[190px]' : 'w-[170px]'} rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-2 text-[var(--text-11)] text-[var(--muted)] placeholder:text-[var(--muted-dim)] focus:outline-none transition-all font-mono ${
              controlsLocked ? 'opacity-40 cursor-not-allowed' : 'hover:text-[var(--fg-secondary)] hover:border-[var(--border)]'
            }`}
            title={modelTitle}
          />
          <button
            type="button"
            onClick={() => setSpawnModel('')}
            disabled={controlsLocked || !spawnModel.trim()}
            className={`inline-flex items-center gap-1 h-[28px] px-2 rounded border border-[var(--border-subtle)] text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase transition-all ${
              controlsLocked || !spawnModel.trim()
                ? 'opacity-40 cursor-not-allowed bg-[var(--surface-softest)] text-[var(--muted-dim)]'
                : 'bg-[var(--surface-softest)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
            }`}
            style={sectionLabelStyle}
            title="Clear model override"
          >
            Clear
          </button>
        </div>
      ) : null}
      <div className={repoContainerClassName ? `${toolbarGroupClassName} ${repoContainerClassName}` : toolbarGroupClassName}>
        <span className={sectionLabelClassName} style={sectionLabelStyle}>
          Repo
        </span>
        <UiMenuSelect
          variant="toolbar"
          value={chatHeaderRepoPath}
          onValueChange={setChatHeaderRepoPath}
          entries={createRepoMenuEntries}
          disabled={controlsLocked}
          triggerClassName="min-w-[220px] max-w-[420px]"
          panelClassName="w-[380px] max-w-[calc(100vw-3rem)]"
          menuClassName="max-h-[240px] overflow-y-auto"
          title={chatHeaderRepoPath || 'No repo'}
          triggerLabel={chatHeaderRepoPath ? repoPathLabel(chatHeaderRepoPath) : 'No repo'}
          triggerLabelClassName={chatHeaderRepoPath ? 'font-mono text-[var(--text-11)]' : undefined}
          chevron={() => <IconChevron down className="text-[var(--muted-dim)] opacity-60" />}
        />
      </div>
    </>
  );

  return allowWrap ? <div className="flex flex-wrap items-center gap-2">{toolbarContent}</div> : toolbarContent;
}
