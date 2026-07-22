import React from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import { ErrorBanner, Label } from '../components/Ui';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { TopTabs } from '../components/TopTabs';
import { AssistantComposer } from '../local-assistant/AssistantComposer';
import {
  AssistantModelPicker,
  type AssistantModelChoice,
} from '../local-assistant/AssistantModelPicker';
import { colors } from '../theme';
import { ChatImageStrip } from './ChatImageStrip';
import {
  mobileRepoLabel,
  type MobileDroneCreateModel,
  type MobileDroneCreateRepo,
} from './drone-sidebar-model';
import {
  mobileDroneCreatePreferencesFromSelection,
  type MobileDroneCreatePreferences,
} from './create-preferences-model';
import { pickChatImages, type MobileChatImage } from './pick-chat-images';
import {
  ExternalAgentPicker,
  type ExternalAgentPickerOption,
} from './ExternalAgentPicker';

export type MobileDroneCreateMode = 'with-chat' | 'without-chat';
export type MobileDroneCreateRuntime = 'container' | 'host';
export type MobileDroneCreateBranchSource = 'host' | 'remote';
export type MobileDroneAgentPermissionMode = 'full-access' | 'read-only';
export type MobileDroneAgentId = 'native' | 'cursor' | 'codex' | 'claude' | 'opencode' | 'pi' | 'blip';

type ExternalAgentId = Exclude<MobileDroneAgentId, 'native'>;
type MobileDroneAgentMode = 'builtin' | 'external';

const EXTERNAL_AGENTS: Array<ExternalAgentPickerOption & { id: ExternalAgentId }> = [
  { id: 'cursor', label: 'Cursor Agent', detail: 'Use Cursor’s external coding agent.' },
  { id: 'codex', label: 'Codex', detail: 'Use the OpenAI Codex CLI agent.' },
  { id: 'claude', label: 'Claude Code', detail: 'Use Anthropic’s Claude Code agent.' },
  { id: 'opencode', label: 'OpenCode', detail: 'Use the OpenCode coding agent.' },
  { id: 'pi', label: 'Pi', detail: 'Use the Pi coding agent.' },
  { id: 'blip', label: 'Blip', detail: 'Use the portable Blip agent runtime.' },
];

export type MobileDroneCreatePayload = {
  runtime: MobileDroneCreateRuntime;
  name?: string;
  group?: string;
  draft?: boolean;
  persistVolume?: boolean;
  repoPath?: string;
  repoBranchSource: MobileDroneCreateBranchSource;
  pullHostBranchBeforeCreate: boolean;
  remoteBranch?: string;
  seedAgent?: { kind: 'native' } | { kind: 'builtin'; id: Exclude<MobileDroneAgentId, 'native'> };
  seedProvider?: string;
  seedModel?: string;
  seedReasoning?: string;
  seedAgentPermissionMode?: MobileDroneAgentPermissionMode;
  seedPrompt?: string;
  seedSubmittedAt?: string;
  autoRename?: boolean;
};

export type MobileDroneCreateDefaults = {
  mode?: MobileDroneCreateMode;
  runtime?: MobileDroneCreateRuntime;
  draft?: boolean;
  persistVolume?: boolean;
  group?: string;
  repoPath?: string;
  repoBranchSource?: MobileDroneCreateBranchSource;
  repoCreateRemoteBranch?: string;
  pullHostBranchBeforeCreate?: boolean;
  agent?: MobileDroneAgentId;
  agentPermissionMode?: MobileDroneAgentPermissionMode;
  model?: string;
  provider?: string;
  reasoning?: string;
};

function Segmented<T extends string>({
  value,
  options,
  label,
  disabled,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  label?: string;
  disabled?: boolean;
  onChange(value: T): void;
}) {
  const control = (
    <View style={[styles.segmented, !label && disabled && styles.disabled]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              active && styles.segmentActive,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
  if (!label) return control;
  return (
    <View style={[styles.labeledSegmented, disabled && styles.disabled]}>
      <Text style={styles.segmentedLabel}>{label}:</Text>
      {control}
    </View>
  );
}

function Toggle({
  label,
  detail,
  value,
  disabled,
  onChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  disabled?: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [
        styles.toggleRow,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.toggleCopy}>
        <Text style={styles.fieldTitle}>{label}</Text>
        <Text style={styles.helper}>{detail}</Text>
      </View>
      <View style={[styles.switchTrack, value && styles.switchTrackActive]}>
        <View style={[styles.switchThumb, value && styles.switchThumbActive]} />
      </View>
    </Pressable>
  );
}

function CompactCheckbox({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: boolean;
  disabled?: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [
        styles.compactCheckbox,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.checkboxBox, value && styles.checkboxBoxActive]}>
        {value ? <Check color={colors.onAccent} size={12} strokeWidth={3} /> : null}
      </View>
      <Text style={[styles.compactCheckboxText, value && styles.activeText]}>{label}</Text>
    </Pressable>
  );
}

function SelectionRow({
  label,
  detail,
  selected,
  onPress,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.selectionRow,
        selected && styles.selectionRowActive,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.selectionCopy}>
        <Text numberOfLines={1} style={[styles.selectionLabel, selected && styles.activeText]}>
          {label}
        </Text>
        {detail ? (
          <Text numberOfLines={1} style={styles.selectionDetail}>
            {detail}
          </Text>
        ) : null}
      </View>
      {selected ? <Check color={colors.accent} size={16} strokeWidth={2.4} /> : null}
    </Pressable>
  );
}

export function NewDroneScreen({
  repos,
  loadingOptions,
  busy,
  draft,
  requestError,
  initialValues,
  localDevice = false,
  onDetectModels,
  onLoadRepoBranches,
  onLoadRepoPreferences,
  onRememberedDraftChange,
  onCreate,
}: {
  repos: MobileDroneCreateRepo[];
  loadingOptions: boolean;
  busy: boolean;
  draft: boolean;
  requestError: string | null;
  initialValues?: MobileDroneCreateDefaults;
  localDevice?: boolean;
  onDetectModels(
    agent: MobileDroneAgentId,
    runtime: MobileDroneCreateRuntime,
    refresh?: boolean,
  ): Promise<MobileDroneCreateModel[]>;
  onLoadRepoBranches(repoPath: string, refresh?: boolean): Promise<MobileDroneCreateRepo>;
  onLoadRepoPreferences(repoPath: string): Promise<MobileDroneCreatePreferences | null>;
  onRememberedDraftChange(draft: boolean): void;
  onCreate(
    payload: MobileDroneCreatePayload,
    preferences: MobileDroneCreatePreferences,
    initialImages?: readonly MobileChatImage[],
  ): Promise<boolean>;
}) {
  const [mode, setMode] = React.useState<MobileDroneCreateMode>(
    initialValues?.mode ?? 'with-chat',
  );
  const [runtime, setRuntime] = React.useState<MobileDroneCreateRuntime>(
    localDevice ? 'host' : (initialValues?.runtime ?? 'container'),
  );
  const [persistVolume, setPersistVolume] = React.useState(
    initialValues?.persistVolume ?? false,
  );
  const [name, setName] = React.useState('');
  const [group, setGroup] = React.useState(initialValues?.group ?? '');
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [agent, setAgent] = React.useState<MobileDroneAgentId>(
    localDevice ? 'native' : (initialValues?.agent ?? 'native'),
  );
  const [lastExternalAgent, setLastExternalAgent] = React.useState<ExternalAgentId>(() => {
    const initialAgent = initialValues?.agent;
    return initialAgent && initialAgent !== 'native' ? initialAgent : 'codex';
  });
  const [agentPickerOpen, setAgentPickerOpen] = React.useState(false);
  const [agentPermissionMode, setAgentPermissionMode] =
    React.useState<MobileDroneAgentPermissionMode>(
      initialValues?.agentPermissionMode ?? 'full-access',
    );
  const [model, setModel] = React.useState(initialValues?.model ?? '');
  const [modelProvider, setModelProvider] = React.useState(initialValues?.provider ?? '');
  const [reasoning, setReasoning] = React.useState(initialValues?.reasoning ?? '');
  const [models, setModels] = React.useState<MobileDroneCreateModel[]>([]);
  const [modelsLoading, setModelsLoading] = React.useState(false);
  const [modelsError, setModelsError] = React.useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false);
  const [repoPath, setRepoPath] = React.useState(initialValues?.repoPath ?? '');
  const [branchSource, setBranchSource] = React.useState<MobileDroneCreateBranchSource>(
    initialValues?.repoBranchSource ?? 'host',
  );
  const [remoteBranch, setRemoteBranch] = React.useState(
    initialValues?.repoCreateRemoteBranch ?? '',
  );
  const [pullHostBranch, setPullHostBranch] = React.useState(
    initialValues?.pullHostBranchBeforeCreate ?? false,
  );
  const [initialMessage, setInitialMessage] = React.useState('');
  const [initialImages, setInitialImages] = React.useState<MobileChatImage[]>([]);
  const [repoPickerOpen, setRepoPickerOpen] = React.useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = React.useState(false);
  const [branchesLoading, setBranchesLoading] = React.useState(false);
  const [branchesLoadError, setBranchesLoadError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const modelRequestId = React.useRef(0);
  const branchRequestId = React.useRef(0);
  const preferenceRequestId = React.useRef(0);
  const pageRef = React.useRef<ScrollView>(null);
  const composerFocusedRef = React.useRef(false);
  const selectedRepo = repos.find((repo) => repo.path === repoPath) ?? null;
  const agentMode: MobileDroneAgentMode = agent === 'native' ? 'builtin' : 'external';
  const readOnlySupported = agent === 'codex' || agent === 'blip';
  const selectedModel =
    models.find(
      (option) => option.id === model && (!modelProvider || option.provider === modelProvider),
    ) ?? null;
  const modelChoices = React.useMemo<AssistantModelChoice[]>(
    () =>
      models.flatMap((option) =>
        option.reasoningLevels.length > 0
          ? option.reasoningLevels.map((thinkingLevel) => ({
              provider: option.provider || agent,
              id: option.id,
              name: option.label,
              thinkingLevel,
            }))
          : [{ provider: option.provider || agent, id: option.id, name: option.label }],
      ),
    [agent, models],
  );

  const scrollMessageIntoView = React.useCallback(() => {
    requestAnimationFrame(() => pageRef.current?.scrollToEnd({ animated: true }));
  }, []);

  React.useEffect(() => {
    if (!localDevice) return;
    setRuntime('host');
    setAgent('native');
    setAgentPickerOpen(false);
    setRepoPath('');
    setPersistVolume(false);
  }, [localDevice]);

  React.useEffect(() => {
    if (draft) setInitialImages([]);
  }, [draft]);

  React.useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      if (composerFocusedRef.current) scrollMessageIntoView();
    });
    return () => subscription.remove();
  }, [scrollMessageIntoView]);

  const detectModels = React.useCallback(
    async (refresh = false) => {
      const requestId = modelRequestId.current + 1;
      modelRequestId.current = requestId;
      setModelsLoading(true);
      setModelsError(null);
      try {
        const next = await onDetectModels(agent, runtime, refresh);
        if (modelRequestId.current !== requestId) return;
        setModels(next);
      } catch (error: any) {
        if (modelRequestId.current !== requestId) return;
        setModelsError(String(error?.message ?? error ?? 'Could not detect models.'));
      } finally {
        if (modelRequestId.current === requestId) setModelsLoading(false);
      }
    },
    [agent, onDetectModels, runtime],
  );

  React.useEffect(() => {
    if (mode !== 'with-chat') return;
    void detectModels(false);
  }, [detectModels, mode]);

  React.useEffect(() => {
    if (mode !== 'with-chat' || models.length === 0) return;
    const current = models.find(
      (option) => option.id === model && (!modelProvider || option.provider === modelProvider),
    );
    if (current) {
      if (!modelProvider) setModelProvider(current.provider || agent);
      return;
    }
    const fallback = models[0];
    setModel(fallback.id);
    setModelProvider(fallback.provider || agent);
  }, [agent, mode, model, modelProvider, models]);

  React.useEffect(
    () => () => {
      modelRequestId.current += 1;
      branchRequestId.current += 1;
      preferenceRequestId.current += 1;
    },
    [],
  );

  React.useEffect(() => {
    const requestId = branchRequestId.current + 1;
    branchRequestId.current = requestId;
    setBranchesLoadError(null);
    if (!repoPath || !selectedRepo || selectedRepo.branchesLoaded) {
      setBranchesLoading(false);
      return;
    }
    setBranchesLoading(true);
    void onLoadRepoBranches(repoPath)
      .catch((error: any) => {
        if (branchRequestId.current !== requestId) return;
        setBranchesLoadError(String(error?.message ?? error ?? 'Could not load branches.'));
      })
      .finally(() => {
        if (branchRequestId.current === requestId) setBranchesLoading(false);
      });
  }, [onLoadRepoBranches, repoPath, selectedRepo?.branchesLoaded]);

  React.useEffect(() => {
    if (
      branchSource !== 'remote' ||
      !remoteBranch ||
      !selectedRepo?.branchesLoaded ||
      selectedRepo.remoteBranches.some((branch) => branch.name === remoteBranch)
    ) {
      return;
    }
    setRemoteBranch('');
  }, [branchSource, remoteBranch, selectedRepo]);

  React.useEffect(() => {
    if (!model) {
      setReasoning('');
      return;
    }
    if (!selectedModel) return;
    if (selectedModel.reasoningLevels.length === 0) {
      setReasoning('');
      return;
    }
    if (!selectedModel.reasoningLevels.includes(reasoning)) {
      setReasoning(selectedModel.defaultReasoningLevel || selectedModel.reasoningLevels[0] || '');
    }
  }, [reasoning, selectedModel]);

  React.useEffect(() => {
    if (!readOnlySupported && agentPermissionMode === 'read-only') {
      setAgentPermissionMode('full-access');
    }
  }, [agentPermissionMode, readOnlySupported]);

  React.useEffect(() => {
    if (loadingOptions || repos.some((repo) => repo.path === repoPath)) return;
    setRepoPath('');
    setBranchSource('host');
    setRemoteBranch('');
  }, [loadingOptions, repoPath, repos]);

  const chooseRepo = (path: string) => {
    const requestId = ++preferenceRequestId.current;
    modelRequestId.current += 1;
    setRepoPath(path);
    setRepoPickerOpen(false);
    setMode('with-chat');
    setRuntime(localDevice ? 'host' : 'container');
    setPersistVolume(false);
    setAgent('native');
    setAgentPickerOpen(false);
    setAgentPermissionMode('full-access');
    setModels([]);
    setModel('');
    setModelProvider('');
    setReasoning('');
    onRememberedDraftChange(false);
    setBranchSource('host');
    setRemoteBranch('');
    setPullHostBranch(false);
    setBranchPickerOpen(false);
    void onLoadRepoPreferences(path).then((remembered) => {
      if (preferenceRequestId.current !== requestId || !remembered) return;
      setMode(remembered.mode);
      setRuntime(localDevice ? 'host' : remembered.runtime);
      setPersistVolume(remembered.persistVolume);
      setAgent(localDevice ? 'native' : remembered.agent);
      if (!localDevice && remembered.agent !== 'native') {
        setLastExternalAgent(remembered.agent);
      }
      setAgentPermissionMode(localDevice ? 'full-access' : remembered.agentPermissionMode);
      setModel(remembered.model);
      setModelProvider(remembered.provider);
      setReasoning(remembered.reasoning);
      onRememberedDraftChange(remembered.draft);
      setBranchSource(localDevice ? 'host' : remembered.repoBranchSource);
      setRemoteBranch(localDevice ? '' : remembered.repoCreateRemoteBranch);
      setPullHostBranch(remembered.pullHostBranchBeforeCreate);
    });
  };

  const chooseAgent = (nextAgent: MobileDroneAgentId) => {
    if (nextAgent !== agent) {
      modelRequestId.current += 1;
      setModels([]);
      setModel('');
      setModelProvider('');
      setReasoning('');
      setAgent(nextAgent);
    }
    if (nextAgent !== 'native') setLastExternalAgent(nextAgent);
    setAgentPickerOpen(false);
  };

  const chooseAgentMode = (nextMode: MobileDroneAgentMode) => {
    if (nextMode === 'builtin') {
      chooseAgent('native');
      return;
    }
    chooseAgent(lastExternalAgent);
    requestAnimationFrame(() => setAgentPickerOpen(true));
  };

  const addInitialImages = async () => {
    try {
      setFormError(null);
      const images = await pickChatImages(initialImages);
      if (images.length > 0) setInitialImages((current) => [...current, ...images]);
    } catch (error: any) {
      setFormError(error?.message ?? String(error));
    }
  };

  const submit = async (promptOverride?: string) => {
    const prompt = String(promptOverride ?? initialMessage).trim();
    if (mode === 'with-chat' && !prompt && initialImages.length === 0) {
      setFormError('Add a first message, or choose Create empty drone.');
      return;
    }
    if (repoPath && runtime === 'container' && branchSource === 'remote' && !remoteBranch) {
      setFormError('Choose a remote branch for this repo.');
      return;
    }
    setFormError(null);
    const effectiveBranchSource = runtime === 'host' ? 'host' : branchSource;
    const payload: MobileDroneCreatePayload = {
      runtime,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(group.trim() ? { group: group.trim() } : {}),
      ...(draft ? { draft: true } : {}),
      ...(runtime === 'container' ? { persistVolume } : {}),
      ...(repoPath ? { repoPath } : {}),
      repoBranchSource: effectiveBranchSource,
      pullHostBranchBeforeCreate: effectiveBranchSource === 'host' && pullHostBranch,
      ...(effectiveBranchSource === 'remote' && remoteBranch ? { remoteBranch } : {}),
      ...(mode === 'with-chat'
        ? {
            seedAgent: agent === 'native'
              ? { kind: 'native' as const }
              : { kind: 'builtin' as const, id: agent },
            ...(agent === 'native' && modelProvider.trim()
              ? { seedProvider: modelProvider.trim() }
              : {}),
            ...(model.trim() ? { seedModel: model.trim() } : {}),
            ...(reasoning.trim() ? { seedReasoning: reasoning.trim() } : {}),
            ...(agentPermissionMode === 'read-only'
              ? { seedAgentPermissionMode: 'read-only' as const }
              : {}),
            seedPrompt: prompt,
            seedSubmittedAt: new Date().toISOString(),
            ...(!name.trim() && prompt ? { autoRename: true } : {}),
          }
        : {}),
    };
    const created = await onCreate(
      payload,
      mobileDroneCreatePreferencesFromSelection({
        mode,
        runtime,
        draft,
        persistVolume: runtime === 'container' && persistVolume,
        agent,
        agentPermissionMode,
        model,
        provider: modelProvider,
        reasoning,
        repoBranchSource: effectiveBranchSource,
        repoCreateRemoteBranch: effectiveBranchSource === 'remote' ? remoteBranch : '',
        pullHostBranchBeforeCreate:
          effectiveBranchSource === 'host' && pullHostBranch,
      }),
      mode === 'with-chat' ? initialImages : [],
    );
    if (!created) return;
    setName('');
    setInitialMessage('');
    setInitialImages([]);
  };

  return (
    <ScrollView
      ref={pageRef}
      style={styles.page}
      contentContainerStyle={[
        styles.pageContent,
        mode === 'with-chat' && styles.pageContentWithChat,
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <TopTabs<MobileDroneCreateMode>
        value={mode}
        disabled={busy}
        style={styles.modeTabsFullBleed}
        options={[
          { value: 'with-chat', label: 'Start with chat' },
          { value: 'without-chat', label: 'Empty drone' },
        ]}
        onChange={(value) => {
          setMode(value);
          if (value === 'without-chat') {
            setAgentPickerOpen(false);
            setModelPickerOpen(false);
            setInitialImages([]);
          }
        }}
      />

      <ErrorBanner message={formError ?? requestError} />

      <View style={styles.section}>
        <View style={styles.runtimeRow}>
          <View style={styles.runtimeControl}>
            <Label>Runtime</Label>
            <Segmented<MobileDroneCreateRuntime>
              value={runtime}
              onChange={(value) => {
                if (value !== runtime) {
                  modelRequestId.current += 1;
                  setModels([]);
                  setModel('');
                  setModelProvider('');
                  setReasoning('');
                }
                setRuntime(value);
                if (value === 'host') setBranchSource('host');
              }}
              disabled={busy}
              options={localDevice
                ? [{ value: 'host', label: 'Host' }]
                : [
                    { value: 'container', label: 'Container' },
                    { value: 'host', label: 'Host' },
                  ]}
            />
          </View>
          {runtime === 'container' ? (
            <CompactCheckbox
              label="Persist volume"
              value={persistVolume}
              disabled={busy}
              onChange={setPersistVolume}
            />
          ) : null}
        </View>
        <Text style={styles.helper}>
          {runtime === 'host'
            ? 'Runs directly on the selected Drone Hub device.'
            : 'Runs inside a managed container.'}
        </Text>
      </View>

      <View style={styles.section}>
        <Label>Repo</Label>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: repoPickerOpen }}
          disabled={busy || loadingOptions}
          onPress={() => setRepoPickerOpen((open) => !open)}
          style={({ pressed }) => [styles.pickerTrigger, pressed && styles.pressed]}
        >
          <View style={styles.selectionCopy}>
            <Text style={styles.pickerValue}>
              {loadingOptions
                ? 'Loading repos…'
                : selectedRepo
                  ? mobileRepoLabel(selectedRepo.path)
                  : 'No repo'}
            </Text>
            {selectedRepo ? (
              <Text numberOfLines={1} style={styles.selectionDetail}>
                {selectedRepo.path}
              </Text>
            ) : null}
          </View>
          {loadingOptions ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            repoPickerOpen ? (
              <ChevronUp color={colors.muted} size={17} strokeWidth={2} />
            ) : (
              <ChevronDown color={colors.muted} size={17} strokeWidth={2} />
            )
          )}
        </Pressable>
        {repoPickerOpen ? (
          <View style={styles.pickerOptions}>
            <SelectionRow label="No repo" selected={!repoPath} onPress={() => chooseRepo('')} />
            {repos.map((repo) => (
              <SelectionRow
                key={repo.path}
                label={mobileRepoLabel(repo.path)}
                detail={repo.path}
                selected={repo.path === repoPath}
                onPress={() => chooseRepo(repo.path)}
              />
            ))}
          </View>
        ) : null}

        {selectedRepo ? (
          <View style={styles.branchBlock}>
            <Text style={styles.fieldTitle}>Repo branch source</Text>
            <Segmented<MobileDroneCreateBranchSource>
              value={runtime === 'host' ? 'host' : branchSource}
              onChange={setBranchSource}
              disabled={busy || runtime === 'host'}
              options={[
                { value: 'host', label: 'Host branch' },
                { value: 'remote', label: 'Remote branch' },
              ]}
            />
            {runtime === 'host' ? (
              <Text style={styles.helper}>Host runtime uses the host repository directly.</Text>
            ) : branchSource === 'host' ? (
              <>
                <Text style={styles.helper}>
                  {branchesLoading
                    ? 'Loading current host branch…'
                    : `Current host branch: ${selectedRepo.hostBranch ?? 'Unavailable'}`}
                </Text>
                <Toggle
                  label="Pull before create"
                  detail="Run a fast-forward-only pull on the host branch first."
                  value={pullHostBranch}
                  disabled={busy}
                  onChange={setPullHostBranch}
                />
              </>
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: branchPickerOpen }}
                  disabled={busy || branchesLoading || selectedRepo.remoteBranches.length === 0}
                  onPress={() => setBranchPickerOpen((open) => !open)}
                  style={({ pressed }) => [
                    styles.pickerTrigger,
                    (branchesLoading || selectedRepo.remoteBranches.length === 0) &&
                      styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text numberOfLines={1} style={styles.pickerValue}>
                    {branchesLoading
                      ? 'Loading remote branches…'
                      : remoteBranch || 'Choose remote branch'}
                  </Text>
                  {branchesLoading ? (
                    <ActivityIndicator color={colors.accent} size="small" />
                  ) : (
                    <ChevronDown color={colors.muted} size={17} strokeWidth={2} />
                  )}
                </Pressable>
                {branchPickerOpen ? (
                  <View style={styles.pickerOptions}>
                    {selectedRepo.remoteBranches.map((branch) => (
                      <SelectionRow
                        key={branch.name}
                        label={branch.name}
                        detail={
                          branch.remote ? `${branch.remote} · ${branch.branch}` : branch.branch
                        }
                        selected={branch.name === remoteBranch}
                        onPress={() => {
                          setRemoteBranch(branch.name);
                          setBranchPickerOpen(false);
                        }}
                      />
                    ))}
                  </View>
                ) : null}
                {branchesLoadError || selectedRepo.branchesError ? (
                  <Text style={styles.errorText}>
                    {branchesLoadError ?? selectedRepo.branchesError}
                  </Text>
                ) : selectedRepo.branchesLoaded && selectedRepo.remoteBranches.length === 0 ? (
                  <Text style={styles.helper}>No remote branches are available for this repo.</Text>
                ) : null}
              </>
            )}
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: detailsOpen }}
          onPress={() => setDetailsOpen((open) => !open)}
          style={({ pressed }) => [styles.accordionHeader, pressed && styles.pressed]}
        >
          <View style={styles.accordionCopy}>
            <Text style={styles.accordionTitle}>Name & group</Text>
            <Text numberOfLines={1} style={styles.accordionSummary}>
              {name.trim() || group.trim()
                ? [name.trim() || 'Automatic name', group.trim()].filter(Boolean).join(' · ')
                : 'Optional details'}
            </Text>
          </View>
          {detailsOpen ? (
            <ChevronUp color={colors.muted} size={17} strokeWidth={2} />
          ) : (
            <ChevronDown color={colors.muted} size={17} strokeWidth={2} />
          )}
        </Pressable>
        {detailsOpen ? (
          <View style={styles.accordionBody}>
            <Text style={styles.fieldTitle}>Name</Text>
            <ThemedTextInput
              value={name}
              onChangeText={setName}
              editable={!busy}
              placeholder="Automatic name"
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              style={[styles.input, styles.monoInput]}
            />
            <Text style={styles.fieldTitle}>Group</Text>
            <ThemedTextInput
              value={group}
              onChangeText={setGroup}
              editable={!busy}
              placeholder="No group"
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              style={styles.input}
            />
          </View>
        ) : null}
      </View>

      {mode === 'with-chat' ? (
        <View style={[styles.section, styles.messageSection]}>
          <View style={styles.composerWrap}>
            <AssistantComposer
              voiceResetKey={`new-drone:${mode}`}
              value={initialMessage}
              onChangeText={setInitialMessage}
              onSend={(promptOverride) => void submit(promptOverride)}
              onOpenModel={() => setModelPickerOpen(true)}
              modelLabel={
                selectedModel?.label ||
                model ||
                (modelsLoading ? 'Detecting models…' : 'Default model')
              }
              reasoningLabel={reasoning}
              placeholder="Ask the agent"
              sending={busy}
              editable={!busy}
              showAttachments={!draft}
              hasAttachments={initialImages.length > 0}
              onAddAttachment={draft ? undefined : () => void addInitialImages()}
              footer={
                <>
                  <ChatImageStrip
                    images={initialImages}
                    disabled={busy}
                    onRemove={(id) =>
                      setInitialImages((current) =>
                        current.filter((image) => image.id !== id),
                      )
                    }
                  />
                  <View style={styles.composerConfigRow}>
                    <Segmented<MobileDroneAgentMode>
                      label="Agent"
                      value={agentMode}
                      onChange={chooseAgentMode}
                      disabled={busy || localDevice}
                      options={
                        localDevice
                          ? [{ value: 'builtin', label: 'Built-in' }]
                          : [
                              { value: 'builtin', label: 'Built-in' },
                              { value: 'external', label: 'External' },
                            ]
                      }
                    />
                    {agentMode === 'external' ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Choose external agent"
                        accessibilityState={{ expanded: agentPickerOpen, disabled: busy }}
                        disabled={busy}
                        onPress={() => setAgentPickerOpen(true)}
                        style={({ pressed }) => [
                          styles.externalAgentTrigger,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text numberOfLines={1} style={styles.externalAgentText}>
                          {EXTERNAL_AGENTS.find((option) => option.id === agent)?.label ?? agent}
                        </Text>
                        <ChevronDown color={colors.accent} size={16} strokeWidth={2.2} />
                      </Pressable>
                    ) : null}
                    <Segmented<MobileDroneAgentPermissionMode>
                      label="Access"
                      value={agentPermissionMode}
                      onChange={setAgentPermissionMode}
                      disabled={busy}
                      options={
                        [
                          { value: 'full-access', label: 'Full' },
                          { value: 'read-only', label: 'Read only' },
                        ].filter(
                          (option) => option.value !== 'read-only' || readOnlySupported,
                        ) as Array<{
                          value: MobileDroneAgentPermissionMode;
                          label: string;
                        }>
                      }
                    />
                  </View>
                  <ExternalAgentPicker
                    open={agentMode === 'external' && agentPickerOpen}
                    value={agent === 'native' ? lastExternalAgent : agent}
                    options={EXTERNAL_AGENTS}
                    disabled={busy}
                    onClose={() => setAgentPickerOpen(false)}
                    onSelect={(value) => chooseAgent(value as ExternalAgentId)}
                  />
                  {!readOnlySupported ? (
                    <Text style={styles.helper}>
                      Read-only access is available for Codex and Blip.
                    </Text>
                  ) : null}
                  {modelsError ? (
                    <View style={styles.inlineNotice}>
                      <Text style={[styles.errorText, styles.inlineNoticeText]}>{modelsError}</Text>
                      <Pressable
                        disabled={busy || modelsLoading}
                        onPress={() => void detectModels(true)}
                        style={({ pressed }) => pressed && styles.pressed}
                      >
                        <Text style={styles.inlineAction}>Retry models</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  <AssistantModelPicker
                    open={modelPickerOpen}
                    currentProvider={modelProvider || agent}
                    currentModel={model}
                    currentThinkingLevel={reasoning}
                    options={modelChoices}
                    busy={modelsLoading}
                    onClose={() => setModelPickerOpen(false)}
                    onSelect={(choice, selection) => {
                      if (selection === 'model') {
                        setModel(choice.id);
                        setModelProvider(choice.provider);
                      }
                      if (choice.thinkingLevel) setReasoning(choice.thinkingLevel);
                      if (selection === 'reasoning') setModelPickerOpen(false);
                    }}
                  />
                </>
              }
              onInputFocus={() => {
                composerFocusedRef.current = true;
                setAgentPickerOpen(false);
                scrollMessageIntoView();
              }}
              onInputBlur={() => {
                composerFocusedRef.current = false;
              }}
            />
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.submit,
            busy && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {busy ? <ActivityIndicator color={colors.onAccent} size="small" /> : null}
          <Text style={styles.submitText}>{busy ? 'Creating…' : 'Create drone'}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  pageContent: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 0, paddingBottom: 36 },
  pageContentWithChat: { paddingBottom: 12 },
  modeTabsFullBleed: {
    marginHorizontal: -18,
    marginBottom: 4,
  },
  section: {
    paddingVertical: 10,
    gap: 10,
  },
  segmented: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderRadius: 7,
    backgroundColor: colors.panel,
    overflow: 'hidden',
  },
  segment: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 13,
  },
  segmentActive: {
    backgroundColor: colors.accent,
  },
  segmentText: { color: colors.text, fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  segmentTextActive: { color: colors.onAccent },
  labeledSegmented: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  segmentedLabel: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.45,
  },
  helper: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  runtimeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 14,
  },
  runtimeControl: { gap: 10 },
  compactCheckbox: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 2,
  },
  checkboxBox: {
    width: 17,
    height: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  checkboxBoxActive: { backgroundColor: colors.accent },
  compactCheckboxText: { color: colors.text, fontSize: 10, fontWeight: '800' },
  toggleRow: {
    minHeight: 49,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 7,
  },
  toggleCopy: { flex: 1, minWidth: 0 },
  fieldTitle: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.55,
  },
  switchTrack: {
    width: 38,
    height: 22,
    padding: 3,
    borderRadius: 11,
    backgroundColor: colors.surface1,
  },
  switchTrackActive: { backgroundColor: colors.accent },
  switchThumb: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.text },
  switchThumbActive: { transform: [{ translateX: 16 }], backgroundColor: colors.onAccent },
  input: {
    minHeight: 44,
    color: colors.text,
    fontSize: 13,
    backgroundColor: colors.panel,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  monoInput: { fontFamily: 'monospace' },
  composerConfigRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  externalAgentTrigger: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 10,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentDark,
  },
  externalAgentText: { flexShrink: 1, color: colors.textStrong, fontSize: 12, fontWeight: '800' },
  activeText: { color: colors.accent },
  pickerTrigger: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 7,
    backgroundColor: colors.panel,
  },
  pickerValue: { color: colors.text, fontSize: 12, fontWeight: '800' },
  inlineAction: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  inlineNotice: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inlineNoticeText: { flex: 1 },
  pickerOptions: { borderLeftWidth: 1, borderLeftColor: colors.accentBorder, paddingLeft: 9 },
  selectionRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  selectionRowActive: { backgroundColor: colors.selectionWash },
  selectionCopy: { flex: 1, minWidth: 0 },
  selectionLabel: { color: colors.text, fontSize: 12, fontWeight: '700' },
  selectionDetail: { color: colors.muted, fontSize: 9, fontFamily: 'monospace', marginTop: 3 },
  branchBlock: { gap: 10, paddingTop: 7 },
  errorText: { color: colors.danger, fontSize: 11, lineHeight: 16 },
  accordionHeader: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  accordionCopy: { flex: 1, minWidth: 0 },
  accordionTitle: { color: colors.text, fontSize: 12, fontWeight: '800' },
  accordionSummary: { color: colors.muted, fontSize: 10, marginTop: 3 },
  accordionBody: { gap: 9, paddingTop: 4 },
  messageSection: { flexGrow: 1, justifyContent: 'flex-end', paddingBottom: 0 },
  composerWrap: { marginHorizontal: -9, marginBottom: -8 },
  submit: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 18,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  submitText: {
    color: colors.onAccent,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.45,
  },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
});
