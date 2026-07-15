import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Plus from 'lucide-react-native/icons/plus';
import RotateCw from 'lucide-react-native/icons/rotate-cw';
import { ErrorBanner, Label } from '../components/Ui';
import {
  AssistantModelPicker,
  type AssistantModelChoice,
} from '../local-assistant/AssistantModelPicker';
import { colors } from '../theme';
import {
  mobileRepoLabel,
  type MobileDroneCreateModel,
  type MobileDroneCreateRepo,
} from './drone-sidebar-model';

export type MobileDroneCreateMode = 'with-chat' | 'without-chat';
export type MobileDroneCreateRuntime = 'container' | 'host';
export type MobileDroneCreateBranchSource = 'host' | 'remote';
export type MobileDroneAgentPermissionMode = 'full-access' | 'read-only';
export type MobileBuiltinAgentId = 'cursor' | 'codex' | 'claude' | 'opencode' | 'pi' | 'blip';

const AGENTS: Array<{ id: MobileBuiltinAgentId; label: string }> = [
  { id: 'cursor', label: 'Cursor Agent' },
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'pi', label: 'Pi' },
  { id: 'blip', label: 'Blip' },
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
  seedAgent?: { kind: 'builtin'; id: MobileBuiltinAgentId };
  seedModel?: string;
  seedReasoning?: string;
  seedAgentPermissionMode?: MobileDroneAgentPermissionMode;
  seedPrompt?: string;
  seedSubmittedAt?: string;
};

export type MobileDroneCreateDefaults = {
  mode?: MobileDroneCreateMode;
  runtime?: MobileDroneCreateRuntime;
  group?: string;
  repoPath?: string;
  agent?: MobileBuiltinAgentId;
  agentPermissionMode?: MobileDroneAgentPermissionMode;
  model?: string;
  reasoning?: string;
};

function Segmented<T extends string>({
  value,
  options,
  disabled,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
  onChange(value: T): void;
}) {
  return (
    <View style={[styles.segmented, disabled && styles.disabled]}>
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
  deviceName,
  repos,
  loadingOptions,
  busy,
  requestError,
  initialValues,
  onDetectModels,
  onLoadRepoBranches,
  onCreate,
}: {
  deviceName: string;
  repos: MobileDroneCreateRepo[];
  loadingOptions: boolean;
  busy: boolean;
  requestError: string | null;
  initialValues?: MobileDroneCreateDefaults;
  onDetectModels(
    agent: MobileBuiltinAgentId,
    runtime: MobileDroneCreateRuntime,
    refresh?: boolean,
  ): Promise<MobileDroneCreateModel[]>;
  onLoadRepoBranches(repoPath: string, refresh?: boolean): Promise<MobileDroneCreateRepo>;
  onCreate(payload: MobileDroneCreatePayload): Promise<boolean>;
}) {
  const [mode, setMode] = React.useState<MobileDroneCreateMode>(
    initialValues?.mode ?? 'with-chat',
  );
  const [runtime, setRuntime] = React.useState<MobileDroneCreateRuntime>(
    initialValues?.runtime ?? 'container',
  );
  const [persistVolume, setPersistVolume] = React.useState(false);
  const [draft, setDraft] = React.useState(false);
  const [name, setName] = React.useState('');
  const [group, setGroup] = React.useState(initialValues?.group ?? '');
  const [agent, setAgent] = React.useState<MobileBuiltinAgentId>(
    initialValues?.agent ?? 'cursor',
  );
  const [agentPermissionMode, setAgentPermissionMode] =
    React.useState<MobileDroneAgentPermissionMode>(
      initialValues?.agentPermissionMode ?? 'full-access',
    );
  const [model, setModel] = React.useState(initialValues?.model ?? '');
  const [reasoning, setReasoning] = React.useState(initialValues?.reasoning ?? '');
  const [models, setModels] = React.useState<MobileDroneCreateModel[]>([]);
  const [modelsLoading, setModelsLoading] = React.useState(false);
  const [modelsError, setModelsError] = React.useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false);
  const [repoPath, setRepoPath] = React.useState(initialValues?.repoPath ?? '');
  const [branchSource, setBranchSource] =
    React.useState<MobileDroneCreateBranchSource>('host');
  const [remoteBranch, setRemoteBranch] = React.useState('');
  const [pullHostBranch, setPullHostBranch] = React.useState(false);
  const [initialMessage, setInitialMessage] = React.useState('');
  const [repoPickerOpen, setRepoPickerOpen] = React.useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = React.useState(false);
  const [branchesLoading, setBranchesLoading] = React.useState(false);
  const [branchesLoadError, setBranchesLoadError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const modelRequestId = React.useRef(0);
  const branchRequestId = React.useRef(0);
  const selectedRepo = repos.find((repo) => repo.path === repoPath) ?? null;
  const readOnlySupported = agent === 'codex' || agent === 'blip';
  const selectedModel = models.find((option) => option.id === model) ?? null;
  const modelChoices = React.useMemo<AssistantModelChoice[]>(
    () =>
      models.flatMap((option) =>
        option.reasoningLevels.length > 0
          ? option.reasoningLevels.map((thinkingLevel) => ({
              provider: agent,
              id: option.id,
              name: option.label,
              thinkingLevel,
            }))
          : [{ provider: agent, id: option.id, name: option.label }],
      ),
    [agent, models],
  );

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

  React.useEffect(
    () => () => {
      modelRequestId.current += 1;
      branchRequestId.current += 1;
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
    setRepoPath(path);
    setRepoPickerOpen(false);
    setBranchSource('host');
    setRemoteBranch('');
    setBranchPickerOpen(false);
  };

  const submit = async () => {
    const prompt = initialMessage.trim();
    if (mode === 'with-chat' && !prompt) {
      setFormError('Add a first message, or choose Create empty drone.');
      return;
    }
    if (repoPath && runtime === 'container' && branchSource === 'remote' && !remoteBranch) {
      setFormError('Choose a remote branch for this repo.');
      return;
    }
    setFormError(null);
    const effectiveBranchSource = runtime === 'host' ? 'host' : branchSource;
    const created = await onCreate({
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
            seedAgent: { kind: 'builtin' as const, id: agent },
            ...(model.trim() ? { seedModel: model.trim() } : {}),
            ...(reasoning.trim() ? { seedReasoning: reasoning.trim() } : {}),
            ...(agentPermissionMode === 'read-only'
              ? { seedAgentPermissionMode: 'read-only' as const }
              : {}),
            seedPrompt: prompt,
            seedSubmittedAt: new Date().toISOString(),
          }
        : {}),
    });
    if (!created) return;
    setName('');
    setInitialMessage('');
  };

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.intro}>
        <View style={styles.introMark}>
          <Plus color={colors.accent} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.introCopy}>
          <Text style={styles.title}>New drone</Text>
          <Text style={styles.subtitle}>Create on {deviceName}</Text>
        </View>
      </View>

      <ErrorBanner message={formError ?? requestError} />

      <View style={styles.section}>
        <Label>Mode</Label>
        <Segmented<MobileDroneCreateMode>
          value={mode}
          onChange={setMode}
          disabled={busy}
          options={[
            { value: 'with-chat', label: 'Start with chat' },
            { value: 'without-chat', label: 'Empty drone' },
          ]}
        />
        <Text style={styles.helper}>
          {mode === 'with-chat'
            ? 'Creates the runtime and starts its default chat with your first message.'
            : 'Creates only the runtime. You can start chats later.'}
        </Text>
      </View>

      <View style={styles.section}>
        <Label>Runtime</Label>
        <Segmented<MobileDroneCreateRuntime>
          value={runtime}
          onChange={(value) => {
            if (value !== runtime) {
              modelRequestId.current += 1;
              setModels([]);
              setModel('');
              setReasoning('');
            }
            setRuntime(value);
            if (value === 'host') setBranchSource('host');
          }}
          disabled={busy}
          options={[
            { value: 'container', label: 'Container' },
            { value: 'host', label: 'Host' },
          ]}
        />
        <Text style={styles.helper}>
          {runtime === 'host'
            ? 'Runs directly on the selected Drone Hub device.'
            : 'Runs inside a managed container.'}
        </Text>
        {runtime === 'container' ? (
          <Toggle
            label="Persist volume"
            detail="Mount /dvm-data on a Docker volume."
            value={persistVolume}
            disabled={busy}
            onChange={setPersistVolume}
          />
        ) : null}
        <Toggle
          label="Create as draft"
          detail="Queue messages until the drone is published."
          value={draft}
          disabled={busy}
          onChange={setDraft}
        />
      </View>

      <View style={styles.section}>
        <Label>Details</Label>
        <Text style={styles.fieldTitle}>Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          editable={!busy}
          placeholder="Optional name"
          placeholderTextColor={colors.subtle}
          autoCapitalize="none"
          style={[styles.input, styles.monoInput]}
        />
        <Text style={styles.fieldTitle}>Group</Text>
        <TextInput
          value={group}
          onChangeText={setGroup}
          editable={!busy}
          placeholder="Optional group"
          placeholderTextColor={colors.subtle}
          autoCapitalize="none"
          style={styles.input}
        />
      </View>

      {mode === 'with-chat' ? (
        <View style={styles.section}>
          <Label>Agent</Label>
          <View style={styles.agentGrid}>
            {AGENTS.map((option) => {
              const active = option.id === agent;
              return (
                <Pressable
                  key={option.id}
                  disabled={busy}
                  onPress={() => {
                    if (option.id !== agent) {
                      modelRequestId.current += 1;
                      setModels([]);
                      setModel('');
                      setReasoning('');
                    }
                    setAgent(option.id);
                  }}
                  style={({ pressed }) => [
                    styles.agentChoice,
                    active && styles.agentChoiceActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.agentChoiceText, active && styles.activeText]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.fieldTitle}>Access</Text>
          <Segmented<MobileDroneAgentPermissionMode>
            value={agentPermissionMode}
            onChange={setAgentPermissionMode}
            disabled={busy}
            options={
              [
                { value: 'full-access', label: 'Full access' },
                { value: 'read-only', label: 'Read only' },
              ].filter((option) => option.value !== 'read-only' || readOnlySupported) as Array<{
                value: MobileDroneAgentPermissionMode;
                label: string;
              }>
            }
          />
          {!readOnlySupported ? (
            <Text style={styles.helper}>Read-only access is available for Codex and Blip.</Text>
          ) : null}
          <Text style={styles.fieldTitle}>Model</Text>
          <View style={styles.modelRow}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => setModelPickerOpen(true)}
              style={({ pressed }) => [styles.pickerTrigger, styles.modelTrigger, pressed && styles.pressed]}
            >
              <View style={styles.selectionCopy}>
                <Text numberOfLines={1} style={styles.pickerValue}>
                  {selectedModel?.label || model || (modelsLoading ? 'Detecting models…' : 'Default model')}
                </Text>
                {reasoning ? <Text style={styles.selectionDetail}>Reasoning: {reasoning}</Text> : null}
              </View>
              {modelsLoading ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <ChevronDown color={colors.muted} size={17} strokeWidth={2} />
              )}
            </Pressable>
            <Pressable
              accessibilityLabel="Refresh detected models"
              disabled={busy || modelsLoading}
              onPress={() => void detectModels(true)}
              style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
            >
              <RotateCw color={colors.muted} size={16} strokeWidth={2} />
            </Pressable>
          </View>
          {model ? (
            <Pressable
              disabled={busy}
              onPress={() => { setModel(''); setReasoning(''); }}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={styles.inlineAction}>Use agent default</Text>
            </Pressable>
          ) : null}
          {modelsError ? <Text style={styles.errorText}>{modelsError}</Text> : null}
          {!modelsLoading && models.length === 0 ? (
            <TextInput
              value={model}
              onChangeText={setModel}
              editable={!busy}
              placeholder="Enter a model manually"
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, styles.monoInput]}
            />
          ) : null}
          <AssistantModelPicker
            open={modelPickerOpen}
            currentProvider={agent}
            currentModel={model}
            currentThinkingLevel={reasoning}
            options={modelChoices}
            busy={modelsLoading}
            showReasoning={Boolean(selectedModel?.reasoningLevels.length)}
            onClose={() => setModelPickerOpen(false)}
            onSelect={(choice, selection) => {
              if (selection === 'model') setModel(choice.id);
              if (choice.thinkingLevel) setReasoning(choice.thinkingLevel);
            }}
          />
        </View>
      ) : null}

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
            <ChevronDown
              color={colors.muted}
              size={17}
              strokeWidth={2}
              style={{ transform: [{ rotate: repoPickerOpen ? '180deg' : '0deg' }] }}
            />
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

      {mode === 'with-chat' ? (
        <View style={styles.section}>
          <Label>First message</Label>
          <TextInput
            value={initialMessage}
            onChangeText={setInitialMessage}
            editable={!busy}
            multiline
            textAlignVertical="top"
            placeholder="Tell this drone what to do…"
            placeholderTextColor={colors.subtle}
            style={[styles.input, styles.messageInput]}
          />
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => void submit()}
        style={({ pressed }) => [styles.submit, busy && styles.disabled, pressed && styles.pressed]}
      >
        {busy ? <ActivityIndicator color={colors.crust} size="small" /> : null}
        <Text style={styles.submitText}>
          {busy ? 'Creating…' : mode === 'with-chat' ? 'Create & start chat' : 'Create drone'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  pageContent: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 36, gap: 4 },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 18 },
  introMark: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.accentDark,
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  introCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.textStrong, fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 3 },
  section: {
    paddingVertical: 17,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  segmented: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 7,
    backgroundColor: colors.panel,
  },
  segment: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 5 },
  segmentActive: {
    backgroundColor: colors.accentDark,
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  segmentText: { color: colors.muted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  segmentTextActive: { color: colors.accent },
  helper: { color: colors.muted, fontSize: 11, lineHeight: 16 },
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
  switchThumbActive: { transform: [{ translateX: 16 }], backgroundColor: colors.crust },
  input: {
    minHeight: 44,
    color: colors.text,
    fontSize: 13,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  monoInput: { fontFamily: 'monospace' },
  agentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  agentChoice: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: colors.panel,
  },
  agentChoiceActive: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark },
  agentChoiceText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  activeText: { color: colors.accent },
  pickerTrigger: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 7,
    backgroundColor: colors.panel,
  },
  pickerValue: { color: colors.text, fontSize: 12, fontWeight: '800' },
  modelRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  modelTrigger: { flex: 1 },
  refreshButton: {
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 7,
    backgroundColor: colors.panel,
  },
  inlineAction: { color: colors.accent, fontSize: 11, fontWeight: '700' },
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
  selectionRowActive: { backgroundColor: colors.accentWash },
  selectionCopy: { flex: 1, minWidth: 0 },
  selectionLabel: { color: colors.text, fontSize: 12, fontWeight: '700' },
  selectionDetail: { color: colors.muted, fontSize: 9, fontFamily: 'monospace', marginTop: 3 },
  branchBlock: { gap: 10, paddingTop: 7 },
  errorText: { color: colors.danger, fontSize: 11, lineHeight: 16 },
  messageInput: { minHeight: 112, maxHeight: 220 },
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
    color: colors.crust,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.45,
  },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
});
