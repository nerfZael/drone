import React from 'react';
import { buildModelCatalogChoices } from '@drone/assistant-chat';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ErrorBanner } from '../components/Ui';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { AssistantComposer } from '../local-assistant/AssistantComposer';
import {
  AssistantModelPicker,
  type AssistantModelChoice,
} from '../local-assistant/AssistantModelPicker';
import { SidebarDroneIcon } from '../local-assistant/SidebarIcons';
import { colors } from '../theme';
import { ChatAttachmentStrip } from './ChatAttachmentStrip';
import { type MobileDroneCreateModel, type MobileDroneCreateRepo } from './drone-sidebar-model';
import {
  mobileDroneCreatePreferencesFromSelection,
  type MobileDroneCreatePreferences,
} from './create-preferences-model';
import { pickChatImages, type MobileChatImage } from './pick-chat-images';
import { ExternalAgentPicker, type ExternalAgentPickerOption } from './ExternalAgentPicker';
import { NewDroneAccessPicker } from './NewDroneAccessPicker';
import { NewDroneBranchPicker } from './NewDroneBranchPicker';
import { NewDroneRepoPicker } from './NewDroneRepoPicker';
import { NewDroneRuntimePicker } from './NewDroneRuntimePicker';

export type MobileDroneCreateMode = 'with-chat' | 'without-chat';
export type MobileDroneCreateRuntime = 'container' | 'host';
export type MobileDroneCreateBranchSource = 'host' | 'remote';
export type MobileDroneAgentPermissionMode = 'read-only' | 'workspace-write' | 'full-access';
export type MobileDroneApprovalPolicy = 'ask' | 'agent-decides' | 'never';
export type MobileDroneAgentId =
  | 'native'
  | 'cursor'
  | 'codex'
  | 'claude'
  | 'opencode'
  | 'pi'
  | 'blip';

const AGENTS: Array<ExternalAgentPickerOption & { id: MobileDroneAgentId }> = [
  { id: 'native', label: 'Built-in', detail: 'Use DroneHub’s built-in assistant.' },
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
  remoteBranch?: string;
  seedAgent?: { kind: 'native' } | { kind: 'builtin'; id: Exclude<MobileDroneAgentId, 'native'> };
  seedProvider?: string;
  seedModel?: string;
  seedReasoning?: string;
  seedAgentPermissionMode?: MobileDroneAgentPermissionMode;
  seedApprovalPolicy?: MobileDroneApprovalPolicy;
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
  agent?: MobileDroneAgentId;
  agentPermissionMode?: MobileDroneAgentPermissionMode;
  approvalPolicy?: MobileDroneApprovalPolicy;
  model?: string;
  provider?: string;
  reasoning?: string;
};

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
  const mode: MobileDroneCreateMode = 'with-chat';
  const [runtime, setRuntime] = React.useState<MobileDroneCreateRuntime>(
    localDevice ? 'host' : (initialValues?.runtime ?? 'container'),
  );
  const [persistVolume, setPersistVolume] = React.useState(initialValues?.persistVolume ?? false);
  const [name, setName] = React.useState('');
  const group = initialValues?.group ?? '';
  const [agent, setAgent] = React.useState<MobileDroneAgentId>(
    localDevice ? 'native' : (initialValues?.agent ?? 'native'),
  );
  const [agentPickerOpen, setAgentPickerOpen] = React.useState(false);
  const [accessPickerOpen, setAccessPickerOpen] = React.useState(false);
  const [agentPermissionMode, setAgentPermissionMode] =
    React.useState<MobileDroneAgentPermissionMode>(
      initialValues?.agentPermissionMode ?? 'full-access',
    );
  const [approvalPolicy, setApprovalPolicy] = React.useState<MobileDroneApprovalPolicy>(
    initialValues?.approvalPolicy ?? 'ask',
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
  const [initialMessage, setInitialMessage] = React.useState('');
  const [initialImages, setInitialImages] = React.useState<MobileChatImage[]>([]);
  const [repoPickerOpen, setRepoPickerOpen] = React.useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = React.useState(false);
  const [runtimePickerOpen, setRuntimePickerOpen] = React.useState(false);
  const [branchesLoading, setBranchesLoading] = React.useState(false);
  const [branchesLoadError, setBranchesLoadError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const modelRequestId = React.useRef(0);
  const branchRequestId = React.useRef(0);
  const preferenceRequestId = React.useRef(0);
  const pageRef = React.useRef<ScrollView>(null);
  const composerFocusedRef = React.useRef(false);
  const selectedRepo = repos.find((repo) => repo.path === repoPath) ?? null;
  const readOnlySupported = agent === 'native' || agent === 'codex' || agent === 'blip';
  const approvalAgentSupported = agent === 'native' || agent === 'codex';
  const approvalSupported = agentPermissionMode === 'full-access' && approvalAgentSupported;
  const selectedModel =
    models.find(
      (option) => option.id === model && (!modelProvider || option.provider === modelProvider),
    ) ?? null;
  const modelChoices = React.useMemo<AssistantModelChoice[]>(
    () => buildModelCatalogChoices(models, agent),
    [agent, models],
  );
  const effectiveBranchSource: MobileDroneCreateBranchSource =
    runtime === 'host' ? 'host' : branchSource;

  const scrollMessageIntoView = React.useCallback(() => {
    requestAnimationFrame(() => pageRef.current?.scrollToEnd({ animated: true }));
  }, []);

  React.useEffect(() => {
    if (!localDevice) return;
    setRuntime('host');
    setAgent('native');
    setAgentPickerOpen(false);
    setRuntimePickerOpen(false);
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
    void detectModels(false);
  }, [detectModels]);

  React.useEffect(() => {
    if (models.length === 0) return;
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
  }, [agent, model, modelProvider, models]);

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
    if (!readOnlySupported && agentPermissionMode !== 'full-access') {
      setAgentPermissionMode('full-access');
    }
  }, [agentPermissionMode, readOnlySupported]);
  React.useEffect(() => {
    if (!approvalSupported) setApprovalPolicy('ask');
    else if (agent === 'codex' && approvalPolicy === 'ask') setApprovalPolicy('agent-decides');
    else if (agent !== 'codex' && approvalPolicy === 'agent-decides') setApprovalPolicy('ask');
  }, [agent, approvalPolicy, approvalSupported]);

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
    setRuntime(localDevice ? 'host' : 'container');
    setPersistVolume(false);
    setAgent('native');
    setAgentPickerOpen(false);
    setAccessPickerOpen(false);
    setRuntimePickerOpen(false);
    setAgentPermissionMode('full-access');
    setApprovalPolicy('ask');
    setModels([]);
    setModel('');
    setModelProvider('');
    setReasoning('');
    onRememberedDraftChange(false);
    setBranchSource('host');
    setRemoteBranch('');
    setBranchPickerOpen(false);
    void onLoadRepoPreferences(path).then((remembered) => {
      if (preferenceRequestId.current !== requestId || !remembered) return;
      setRuntime(localDevice ? 'host' : remembered.runtime);
      setPersistVolume(remembered.persistVolume);
      setAgent(localDevice ? 'native' : remembered.agent);
      setAgentPermissionMode(remembered.agentPermissionMode);
      setApprovalPolicy(remembered.approvalPolicy);
      setModel(remembered.model);
      setModelProvider(remembered.provider);
      setReasoning(remembered.reasoning);
      onRememberedDraftChange(remembered.draft);
      setBranchSource(localDevice ? 'host' : remembered.repoBranchSource);
      setRemoteBranch(localDevice ? '' : remembered.repoCreateRemoteBranch);
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
    setAgentPickerOpen(false);
  };

  const chooseRuntime = (value: MobileDroneCreateRuntime) => {
    if (value !== runtime) {
      modelRequestId.current += 1;
      setModels([]);
      setModel('');
      setModelProvider('');
      setReasoning('');
    }
    setRuntime(value);
    if (value === 'host') setBranchSource('host');
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
    if (!prompt && initialImages.length === 0) {
      setFormError('Add a first message to create this drone.');
      return;
    }
    if (repoPath && runtime === 'container' && branchSource === 'remote' && !remoteBranch) {
      setFormError('Choose a remote branch for this repo.');
      return;
    }
    setFormError(null);
    const effectiveBranchSource = runtime === 'host' ? 'host' : branchSource;
    const effectiveApprovalPolicy: MobileDroneApprovalPolicy =
      agent === 'codex' && agentPermissionMode === 'full-access' && approvalPolicy === 'ask'
        ? 'agent-decides'
        : approvalPolicy;
    const payload: MobileDroneCreatePayload = {
      runtime,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(group.trim() ? { group: group.trim() } : {}),
      ...(draft ? { draft: true } : {}),
      ...(runtime === 'container' ? { persistVolume } : {}),
      ...(repoPath ? { repoPath } : {}),
      repoBranchSource: effectiveBranchSource,
      ...(effectiveBranchSource === 'remote' && remoteBranch ? { remoteBranch } : {}),
      seedAgent:
        agent === 'native' ? { kind: 'native' as const } : { kind: 'builtin' as const, id: agent },
      ...(agent === 'native' && modelProvider.trim() ? { seedProvider: modelProvider.trim() } : {}),
      ...(model.trim() ? { seedModel: model.trim() } : {}),
      ...(reasoning.trim() ? { seedReasoning: reasoning.trim() } : {}),
      ...(agentPermissionMode !== 'full-access'
        ? { seedAgentPermissionMode: agentPermissionMode }
        : {}),
      ...(effectiveApprovalPolicy !== 'ask' ? { seedApprovalPolicy: effectiveApprovalPolicy } : {}),
      seedPrompt: prompt,
      seedSubmittedAt: new Date().toISOString(),
      ...(!name.trim() && prompt ? { autoRename: true } : {}),
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
        approvalPolicy: effectiveApprovalPolicy,
        model,
        provider: modelProvider,
        reasoning,
        repoBranchSource: effectiveBranchSource,
        repoCreateRemoteBranch: effectiveBranchSource === 'remote' ? remoteBranch : '',
      }),
      initialImages,
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
      contentContainerStyle={[styles.pageContent, styles.pageContentWithChat]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <ErrorBanner message={formError ?? requestError} />

      <View style={styles.nameSection}>
        <Text style={styles.fieldTitle}>Name</Text>
        <ThemedTextInput
          accessibilityLabel="Drone name"
          value={name}
          onChangeText={setName}
          editable={!busy}
          placeholder="Automatic name"
          placeholderTextColor={colors.subtle}
          autoCapitalize="none"
          onFocus={() => {
            setAgentPickerOpen(false);
            setAccessPickerOpen(false);
            setRuntimePickerOpen(false);
            setBranchPickerOpen(false);
            setRepoPickerOpen(false);
          }}
          style={styles.nameInput}
        />
      </View>

      <View style={styles.emptyState}>
        <View style={styles.emptyStateIcon}>
          <SidebarDroneIcon color={colors.accent} size={20} strokeWidth={1.7} />
        </View>
        <Text style={styles.emptyStateTitle}>Start a new drone</Text>
      </View>

      <View style={[styles.section, styles.messageSection]}>
        <View style={styles.composerWrap}>
          <View style={styles.topConfigRow}>
            <NewDroneRuntimePicker
              open={runtimePickerOpen}
              value={runtime}
              disabled={busy}
              localDevice={localDevice}
              onOpen={() => {
                if (localDevice) return;
                setBranchPickerOpen(false);
                setAccessPickerOpen(false);
                setAgentPickerOpen(false);
                setRepoPickerOpen(false);
                setRuntimePickerOpen(true);
              }}
              onClose={() => setRuntimePickerOpen(false)}
              onSelect={chooseRuntime}
            />
            {selectedRepo ? (
              <View style={styles.topBranchSlot}>
                <NewDroneBranchPicker
                  open={branchPickerOpen}
                  branchSource={effectiveBranchSource}
                  remoteBranch={remoteBranch}
                  hostBranch={selectedRepo.hostBranch}
                  remoteBranches={selectedRepo.remoteBranches}
                  remoteEnabled={runtime === 'container'}
                  loading={branchesLoading}
                  disabled={busy}
                  onOpen={() => {
                    setRuntimePickerOpen(false);
                    setAccessPickerOpen(false);
                    setAgentPickerOpen(false);
                    setRepoPickerOpen(false);
                    setBranchPickerOpen(true);
                  }}
                  onClose={() => setBranchPickerOpen(false)}
                  onSelect={(selection) => {
                    if (selection.branchSource === 'remote' && selection.remoteBranch) {
                      setRemoteBranch(selection.remoteBranch);
                    }
                    setBranchSource(selection.branchSource);
                  }}
                />
              </View>
            ) : null}
          </View>
          <AssistantComposer
            voiceResetKey="new-drone"
            value={initialMessage}
            onChangeText={setInitialMessage}
            onSend={(promptOverride) => void submit(promptOverride)}
            onOpenModel={() => {
              setRepoPickerOpen(false);
              setModelPickerOpen(true);
            }}
            modelLabel={
              selectedModel?.label ||
              model ||
              (modelsLoading ? 'Detecting models…' : 'Default model')
            }
            reasoningLabel={reasoning}
            placeholder="Ask the agent"
            sending={busy}
            editable={!busy}
            alwaysExpanded
            showAttachments={!draft}
            hasAttachments={initialImages.length > 0}
            onAddAttachment={draft ? undefined : () => void addInitialImages()}
            footer={
              <>
                <ChatAttachmentStrip
                  attachments={initialImages}
                  disabled={busy}
                  onRemove={(id) =>
                    setInitialImages((current) => current.filter((image) => image.id !== id))
                  }
                />
                <View style={styles.bottomConfigRow}>
                  <ExternalAgentPicker
                    open={agentPickerOpen}
                    value={agent}
                    options={
                      localDevice ? AGENTS.filter((option) => option.id === 'native') : AGENTS
                    }
                    disabled={busy || localDevice}
                    onOpen={() => {
                      setRuntimePickerOpen(false);
                      setBranchPickerOpen(false);
                      setAccessPickerOpen(false);
                      setRepoPickerOpen(false);
                      setAgentPickerOpen(true);
                    }}
                    onClose={() => setAgentPickerOpen(false)}
                    onSelect={(value) => chooseAgent(value as MobileDroneAgentId)}
                  />
                  <NewDroneAccessPicker
                    open={accessPickerOpen}
                    permissionMode={agentPermissionMode}
                    approvalPolicy={approvalPolicy}
                    readOnlySupported={readOnlySupported}
                    approvalsSupported={approvalSupported}
                    agentIsCodex={agent === 'codex'}
                    disabled={busy}
                    onOpen={() => {
                      setRuntimePickerOpen(false);
                      setBranchPickerOpen(false);
                      setAgentPickerOpen(false);
                      setRepoPickerOpen(false);
                      setAccessPickerOpen(true);
                    }}
                    onClose={() => setAccessPickerOpen(false)}
                    onPermissionModeChange={setAgentPermissionMode}
                    onApprovalPolicyChange={setApprovalPolicy}
                  />
                  <NewDroneRepoPicker
                    open={repoPickerOpen}
                    value={repoPath}
                    repos={repos}
                    loading={loadingOptions}
                    disabled={busy}
                    onOpen={() => {
                      setRuntimePickerOpen(false);
                      setBranchPickerOpen(false);
                      setAccessPickerOpen(false);
                      setAgentPickerOpen(false);
                      setRepoPickerOpen(true);
                    }}
                    onClose={() => setRepoPickerOpen(false)}
                    onSelect={chooseRepo}
                  />
                </View>
                {selectedRepo && (branchesLoadError || selectedRepo.branchesError) ? (
                  <Text style={styles.errorText}>
                    {branchesLoadError ?? selectedRepo.branchesError}
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
              setAccessPickerOpen(false);
              setRuntimePickerOpen(false);
              setBranchPickerOpen(false);
              setRepoPickerOpen(false);
              scrollMessageIntoView();
            }}
            onInputBlur={() => {
              composerFocusedRef.current = false;
            }}
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  pageContent: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 0, paddingBottom: 36 },
  pageContentWithChat: { paddingBottom: 12 },
  section: {
    paddingVertical: 10,
    gap: 10,
  },
  nameSection: { gap: 6, paddingTop: 10 },
  fieldTitle: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.55,
  },
  nameInput: {
    minHeight: 42,
    color: colors.text,
    fontSize: 13,
    fontFamily: 'monospace',
    backgroundColor: colors.panel,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  emptyState: {
    flexGrow: 1,
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingVertical: 32,
  },
  emptyStateIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    shadowColor: colors.shadow,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  emptyStateTitle: { color: colors.text, fontSize: 17, fontWeight: '700', letterSpacing: -0.25 },
  topConfigRow: {
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 9,
    paddingBottom: 2,
  },
  topBranchSlot: { flex: 1, alignItems: 'flex-end' },
  bottomConfigRow: {
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    columnGap: 2,
  },
  inlineAction: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  inlineNotice: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inlineNoticeText: { flex: 1 },
  errorText: { color: colors.danger, fontSize: 11, lineHeight: 16 },
  messageSection: { justifyContent: 'flex-end', paddingBottom: 0 },
  composerWrap: { marginHorizontal: -9, marginBottom: -8 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
});
