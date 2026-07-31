import React from 'react';
import type {
  AgentApprovalPolicy,
  AgentPermissionMode,
  ChatAgentConfig,
} from '../../domain';
import type { DroneSummary } from '../types';
import type { ChatSendPayload } from '../chat';
import type { DraftChatState } from './app-types';
import { normalizeChatImageAttachmentPayloads } from './chat-attachment-payloads';
import { resolveRepoSeedFromParentDroneId } from './child-drone-repo-seed';
import { createDraftQueuedPrompt, createSubmittedDraftChat } from './draft-chat-queue';
import {
  buildDraftDroneCreatePayload,
  materializeAgentsMdForCreate,
  resolveAgentsMdLibraryFileIdForCreate,
  resolveAgentsMdOverrideForCreate,
  runtimeSupportsCustomAgents,
  shouldAutoRenameDraftDrone,
  type RepoBranchSelectionState,
  type RepoBranchSourceMode,
} from './drone-create-runtime';
import type { AgentsMdFile } from './settings-types';
import { makeId, newDraftChatFocusKey } from './helpers';
import { allocateUntitledDisplayName } from './name-helpers';
import type { DesktopNewDronePreferences } from './new-drone-preferences';
import {
  addOptimisticStartupSeeds,
  clearOptimisticStartupSeeds,
  replaceOptimisticStartupSeeds,
  type StartupSeedMap,
} from './startup-seed-optimistic';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type QueueDronesResponse = {
  ok: true;
  accepted: Array<{ id: string; name: string; phase: 'draft' | 'starting'; draft?: boolean }>;
  rejected: Array<{ id?: string; name: string; error: string; status?: number }>;
  total: number;
};

export type CloneDroneResult = {
  ok: boolean;
  droneId?: string;
  droneName?: string;
};

export type StartDraftPromptOptions = {
  keepComposerOpen?: boolean;
  deliveryMode?: 'queue' | 'asap';
};

type UseDroneCreationActionsArgs = {
  drones: Array<Pick<DroneSummary, 'id' | 'name' | 'runtime' | 'repoPath' | 'repoAttached' | 'persistVolume'>>;
  creating: boolean;
  repoBranchSource: RepoBranchSourceMode;
  repoCreateRemoteBranch: string;
  pullHostBranchBeforeCreate: boolean;
  createRuntime: 'container' | 'host';
  createAsDraft: boolean;
  createPersistVolume: boolean;
  spawnAgentKey: string;
  spawnModelForSeed: string | null;
  spawnReasoningForSeed: string | null;
  spawnAgentPermissionMode: AgentPermissionMode;
  spawnApprovalPolicy: AgentApprovalPolicy;
  draftChat: DraftChatState | null;
  draftCreateMode: 'with-chat' | 'without-chat';
  draftCreateName: string;
  draftCreateGroup: string;
  draftCreateParentDroneId: string | null;
  draftAgentsMdLibraryFileId: string;
  draftAgentsMdOverrideEnabled: boolean;
  draftAgentsMdOverride: string;
  draftCreateRepoPath: string;
  startupSeedMissingGraceMs: number;
  suggestCloneName: (sourceName: string) => string;
  resolveAgentKeyToConfig: (key: string) => ChatAgentConfig;
  enqueueQueuedPrompt: (
    droneIdRaw: string,
    chatNameRaw: string,
    promptRaw: string,
    attachmentsRaw?: ChatSendPayload['attachments'],
  ) => { id: string } | null;
  requestJson: RequestJsonFn;
  suggestAndRenameDraftDrone: (droneId: string, prompt: string) => Promise<void>;
  rememberStartupSeed: (
    drones: Array<{ id: string; name: string }>,
    opts: {
      runtime?: 'container' | 'host';
      agent: ChatAgentConfig | null;
      model?: string | null;
      reasoning?: string | null;
      agentPermissionMode?: AgentPermissionMode;
      approvalPolicy?: AgentApprovalPolicy;
      prompt: string;
      chatName?: string;
      group?: string | null;
      repoPath?: string | null;
      at?: string | null;
    },
  ) => void;
  rememberSeenModels: (models: Iterable<string | null | undefined>) => void;
  rememberNewDronePreferences: (repoPath: string, preferences: DesktopNewDronePreferences) => void;
  setStartupSeedByDrone: React.Dispatch<React.SetStateAction<StartupSeedMap>>;
  setCreating: React.Dispatch<React.SetStateAction<boolean>>;
  setCreateRuntime: React.Dispatch<React.SetStateAction<'container' | 'host'>>;
  setCreateAsDraft: React.Dispatch<React.SetStateAction<boolean>>;
  setCreatePersistVolume: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftChat: React.Dispatch<React.SetStateAction<any>>;
  setDraftCreateError: React.Dispatch<React.SetStateAction<string | null>>;
  setDraftCreateName: React.Dispatch<React.SetStateAction<string>>;
  setDraftCreateGroup: React.Dispatch<React.SetStateAction<string>>;
  setDraftCreateParentDroneId: React.Dispatch<React.SetStateAction<string | null>>;
  setDraftAgentsMdLibraryFileId: React.Dispatch<React.SetStateAction<string>>;
  setDraftAgentsMdOverrideEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftAgentsMdOverride: React.Dispatch<React.SetStateAction<string>>;
  setDraftSuggestedName: React.Dispatch<React.SetStateAction<string>>;
  setDraftNameSuggesting: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftNameSuggestionError: React.Dispatch<React.SetStateAction<string | null>>;
  setDraftAutoRenaming: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftCreateOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftCreating: React.Dispatch<React.SetStateAction<boolean>>;
  setNameSuggestToast: React.Dispatch<
    React.SetStateAction<{ id: string; title?: string; message: string; tone?: 'success' | 'error' } | null>
  >;
  setSelectedDrone: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedDroneIds: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedChat: React.Dispatch<React.SetStateAction<string>>;
  selectionAnchorRef: React.MutableRefObject<string | null>;
  preferredSelectedDroneRef: React.MutableRefObject<string | null>;
  preferredSelectedDroneHoldUntilRef: React.MutableRefObject<number>;
};

export function useDroneCreationActions({
  drones,
  creating,
  repoBranchSource,
  repoCreateRemoteBranch,
  pullHostBranchBeforeCreate,
  createRuntime,
  createAsDraft,
  createPersistVolume,
  spawnAgentKey,
  spawnModelForSeed,
  spawnReasoningForSeed,
  spawnAgentPermissionMode,
  spawnApprovalPolicy,
  draftChat,
  draftCreateMode,
  draftCreateName,
  draftCreateGroup,
  draftCreateParentDroneId,
  draftAgentsMdLibraryFileId,
  draftAgentsMdOverrideEnabled,
  draftAgentsMdOverride,
  draftCreateRepoPath,
  startupSeedMissingGraceMs,
  suggestCloneName,
  resolveAgentKeyToConfig,
  enqueueQueuedPrompt,
  requestJson,
  suggestAndRenameDraftDrone,
  rememberStartupSeed,
  rememberSeenModels,
  rememberNewDronePreferences,
  setStartupSeedByDrone,
  setCreating,
  setCreateRuntime,
  setCreateAsDraft,
  setCreatePersistVolume,
  setDraftChat,
  setDraftCreateError,
  setDraftCreateName,
  setDraftCreateGroup,
  setDraftCreateParentDroneId,
  setDraftAgentsMdLibraryFileId,
  setDraftAgentsMdOverrideEnabled,
  setDraftAgentsMdOverride,
  setDraftSuggestedName,
  setDraftNameSuggesting,
  setDraftNameSuggestionError,
  setDraftAutoRenaming,
  setDraftCreateOpen,
  setDraftCreating,
  setNameSuggestToast,
  setSelectedDrone,
  setSelectedDroneIds,
  setSelectedChat,
  selectionAnchorRef,
  preferredSelectedDroneRef,
  preferredSelectedDroneHoldUntilRef,
}: UseDroneCreationActionsArgs) {
  const draftChatRef = React.useRef(draftChat);
  React.useEffect(() => {
    draftChatRef.current = draftChat;
  }, [draftChat]);
  const cloneDronePendingRef = React.useRef(false);
  const draftCreateInFlightCountRef = React.useRef(0);
  const beginDraftCreate = React.useCallback(() => {
    draftCreateInFlightCountRef.current += 1;
    setDraftCreating(true);
  }, [setDraftCreating]);
  const endDraftCreate = React.useCallback(() => {
    draftCreateInFlightCountRef.current = Math.max(0, draftCreateInFlightCountRef.current - 1);
    setDraftCreating(draftCreateInFlightCountRef.current > 0);
  }, [setDraftCreating]);
  const showTransientToast = React.useCallback(
    (message: string, title = 'Action failed') => {
      const text = String(message ?? '').trim();
      if (!text) return;
      const id = makeId();
      setNameSuggestToast({ id, title, message: text, tone: 'error' });
      window.setTimeout(() => {
        setNameSuggestToast((current) => (current?.id === id ? null : current));
      }, 5000);
    },
    [setNameSuggestToast],
  );
  const setDraftChatState = React.useCallback(
    (next: DraftChatState | null | ((prev: DraftChatState | null) => DraftChatState | null)) => {
      setDraftChat((prev: DraftChatState | null) => {
        const resolved = typeof next === 'function' ? (next as (prev: DraftChatState | null) => DraftChatState | null)(prev) : next;
        draftChatRef.current = resolved;
        return resolved;
      });
    },
    [setDraftChat],
  );
  const queueCloneDrone = React.useCallback(
    async (
      source: DroneSummary,
      opts?: { selectOnSuccess?: boolean },
    ): Promise<CloneDroneResult> => {
      const sourceId = String(source?.id ?? '').trim();
      if (!sourceId || creating || cloneDronePendingRef.current) return { ok: false };
      const sourceRuntime = String(source?.runtime ?? 'container').trim().toLowerCase();
      if (sourceRuntime === 'host') {
        showTransientToast('Host runtime drones cannot be cloned.', 'Clone failed');
        return { ok: false };
      }
      const name = suggestCloneName(String(source?.name ?? '').trim());
      const group = String(source?.group ?? '').trim();
      const repoPath =
        source && (source.repoAttached ?? Boolean(String(source.repoPath ?? '').trim()))
          ? String(source.repoPath ?? '').trim()
          : '';
      const persistVolume = source.persistVolume !== false;

      setCreating(true);
      cloneDronePendingRef.current = true;
      const optimisticSeeds = addOptimisticStartupSeeds(setStartupSeedByDrone, [name], {
        runtime: 'container',
        agent: null,
        model: null,
        prompt: '',
        chatName: 'default',
        group,
        repoPath,
      });
      try {
        const resp = await requestJson<QueueDronesResponse>(`/api/drones/batch`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            drones: [
              {
                name,
                runtime: 'container',
                ...(group ? { group } : {}),
                ...(repoPath ? { repoPath } : {}),
                persistVolume,
                cloneFrom: sourceId,
                cloneChats: true,
              },
            ],
            pullHostBranchBeforeCreate: false,
          }),
        });
        const acceptedList = Array.isArray(resp?.accepted) ? resp.accepted : [];
        const firstAccepted = acceptedList.length > 0 ? acceptedList[0] : null;
        const firstAcceptedId = String((firstAccepted as any)?.id ?? '').trim();
        const firstAcceptedName =
          String((firstAccepted as any)?.name ?? '').trim() || name || firstAcceptedId;
        if (firstAcceptedId) {
          replaceOptimisticStartupSeeds(setStartupSeedByDrone, optimisticSeeds, [{ id: firstAcceptedId, name: firstAcceptedName }], {
            runtime: 'container',
            agent: null,
            model: null,
            prompt: '',
            chatName: 'default',
            group,
            repoPath,
          });
          if (opts?.selectOnSuccess !== false) {
            preferredSelectedDroneRef.current = firstAcceptedId;
            preferredSelectedDroneHoldUntilRef.current = Date.now() + startupSeedMissingGraceMs;
            setSelectedDrone(firstAcceptedId);
            setSelectedDroneIds([firstAcceptedId]);
            selectionAnchorRef.current = firstAcceptedId;
          }
          return { ok: true, droneId: firstAcceptedId, droneName: firstAcceptedName };
        }

        const rejected = Array.isArray(resp?.rejected) ? resp.rejected : [];
        const firstRejected = rejected.length > 0 ? rejected[0] : null;
        const rejectedMessage = String((firstRejected as any)?.error ?? '').trim();
        clearOptimisticStartupSeeds(setStartupSeedByDrone, optimisticSeeds);
        showTransientToast(rejectedMessage || `Failed to clone ${source.name}.`, 'Clone failed');
        return { ok: false };
      } catch (e: any) {
        clearOptimisticStartupSeeds(setStartupSeedByDrone, optimisticSeeds);
        showTransientToast(e?.message ?? `Failed to clone ${source.name}.`, 'Clone failed');
        return { ok: false };
      } finally {
        cloneDronePendingRef.current = false;
        setCreating(false);
      }
    },
    [
      addOptimisticStartupSeeds,
      clearOptimisticStartupSeeds,
      creating,
      preferredSelectedDroneHoldUntilRef,
      preferredSelectedDroneRef,
      replaceOptimisticStartupSeeds,
      requestJson,
      selectionAnchorRef,
      setCreating,
      setSelectedDrone,
      setSelectedDroneIds,
      showTransientToast,
      startupSeedMissingGraceMs,
      suggestCloneName,
    ],
  );
  const cloneDrone = React.useCallback(
    async (source: DroneSummary): Promise<boolean> => {
      return (await queueCloneDrone(source, { selectOnSuccess: true })).ok;
    },
    [queueCloneDrone],
  );
  const cloneDroneWithoutSelection = React.useCallback(
    async (source: DroneSummary): Promise<CloneDroneResult> => {
      return await queueCloneDrone(source, { selectOnSuccess: false });
    },
    [queueCloneDrone],
  );

  const createDroneFromDraft = React.useCallback(
    async (opts?: {
      prompt?: string;
      attachments?: ChatSendPayload['attachments'];
      name?: string;
      group?: string;
      createMode?: 'with-chat' | 'without-chat';
      autoRename?: boolean;
      autoRenamePrompt?: string;
      keepDraftComposerOpen?: boolean;
      submittedAt?: string;
      deliveryMode?: 'queue' | 'asap';
    }): Promise<boolean> => {
      const latestDraftChat = draftChatRef.current;
      const pending = latestDraftChat?.prompt ?? null;
      const effectiveCreateMode = opts?.createMode ?? draftCreateMode;
      const createWithoutChat = effectiveCreateMode === 'without-chat';
      const prompt = String(opts?.prompt ?? pending?.prompt ?? '').trim();
      const draftAttachments = normalizeChatImageAttachmentPayloads(opts?.attachments ?? pending?.attachmentPayloads ?? []);
      const hasDraftAttachments = draftAttachments.length > 0;
      const queuedPromptsToHandoff = Array.isArray(latestDraftChat?.queuedPrompts) ? latestDraftChat.queuedPrompts : [];
      const hasQueuedDraftAttachments = queuedPromptsToHandoff.some(
        (queuedPrompt) => normalizeChatImageAttachmentPayloads(queuedPrompt.attachmentPayloads).length > 0,
      );
      const shouldSeedPromptViaCreate = !createWithoutChat && !hasDraftAttachments && prompt.length > 0;
      const nameRaw = String(opts?.name ?? draftCreateName ?? '');
      const name = nameRaw.trim();
      const autoRename = shouldAutoRenameDraftDrone({
        requested: opts?.autoRename,
        name,
        createWithoutChat,
      });
      const group = String(opts?.group ?? draftCreateGroup ?? '').trim();
      const fleetParentId = String(draftCreateParentDroneId ?? '').trim();
      const runtime = createRuntime;
      const keepDraftComposerOpen = Boolean(opts?.keepDraftComposerOpen);
      const persistVolume = runtime === 'container' ? createPersistVolume : undefined;
      const repoPath = String(draftCreateRepoPath ?? '').trim();
      const repoSeedFromDroneId = resolveRepoSeedFromParentDroneId({
        drones,
        parentDroneId: fleetParentId,
        repoPath,
        runtime,
      });
      const remoteBranch = String(repoCreateRemoteBranch ?? '').trim();
      const effectiveRepoBranchSource: RepoBranchSourceMode = createRuntime === 'host' ? 'host' : repoBranchSource;
      const customAgentsMdOverride = resolveAgentsMdOverrideForCreate({
        enabled: draftAgentsMdOverrideEnabled,
        content: draftAgentsMdOverride,
        repoPath,
        runtime,
        isClone: false,
      });
      const agentsMdLibraryFileId = resolveAgentsMdLibraryFileIdForCreate({
        fileId: draftAgentsMdLibraryFileId,
        customOverrideEnabled: draftAgentsMdOverrideEnabled,
        repoPath,
        runtime,
        isClone: false,
      });
      if (!createWithoutChat && !prompt && !hasDraftAttachments) {
        setDraftCreateError('Send a first message before creating a drone.');
        return false;
      }
      if (createAsDraft && (hasDraftAttachments || hasQueuedDraftAttachments)) {
        setDraftCreateError('Draft drones cannot queue attachments until they are published.');
        return false;
      }
      if (name && (name.length > 80 || /[\r\n]/.test(name))) {
        setDraftCreateError('Invalid name. Must be 1-80 chars and cannot contain newlines.');
        return false;
      }
      if (name && drones.some((d) => d.name === name)) {
        setDraftCreateError(`A drone named "${name}" already exists.`);
        return false;
      }
      if (repoPath && effectiveRepoBranchSource === 'remote' && !remoteBranch) {
        setDraftCreateError('Choose a remote branch before creating a repo drone from a remote branch.');
        return false;
      }

      const seedAgent = createWithoutChat ? null : resolveAgentKeyToConfig(spawnAgentKey);
      const seedAgentPermissionMode: AgentPermissionMode = seedAgent ? spawnAgentPermissionMode : 'full-access';
      const seedApprovalPolicy: AgentApprovalPolicy = seedAgent
        ? seedAgent.kind === 'builtin' &&
          seedAgent.id === 'codex' &&
          spawnApprovalPolicy === 'ask'
          ? 'agent-decides'
          : spawnApprovalPolicy
        : 'ask';
      if (!runtimeSupportsCustomAgents(runtime) && seedAgent?.kind === 'custom') {
        setDraftCreateError('Host runtime currently supports builtin agents only.');
        return false;
      }
      if (
        seedAgentPermissionMode !== 'full-access' &&
        !(
          seedAgent?.kind === 'native' ||
          (seedAgent?.kind === 'builtin' &&
            (seedAgent.id === 'codex' || seedAgent.id === 'blip'))
        )
      ) {
        setDraftCreateError('Agent access controls are available for native, Codex, and Blip chats.');
        return false;
      }
      beginDraftCreate();
      setDraftCreateError(null);
      const seedModel = createWithoutChat ? null : spawnModelForSeed;
      const seedReasoning = createWithoutChat ? null : spawnReasoningForSeed;
      let createdDrone = false;
      let postCreateError: string | null = null;
      const optimisticDraftName =
        name ||
        String(latestDraftChat?.droneName ?? '').trim() ||
        allocateUntitledDisplayName(drones.map((drone) => String(drone?.name ?? '').trim()));
      const optimisticSeeds = createWithoutChat
        ? addOptimisticStartupSeeds(setStartupSeedByDrone, [optimisticDraftName], {
            runtime,
            agent: seedAgent,
            model: seedModel,
            reasoning: seedReasoning,
            agentPermissionMode: seedAgentPermissionMode,
            approvalPolicy: seedApprovalPolicy,
            prompt: shouldSeedPromptViaCreate ? prompt : '',
            chatName: 'default',
            group,
            repoPath,
          })
        : [];

      const runCreate = async (): Promise<boolean> => {
        try {
          const agentsMdOverride = await materializeAgentsMdForCreate({
            customOverride: customAgentsMdOverride,
            libraryFileId: agentsMdLibraryFileId,
            loadLibraryFile: async (fileId) =>
              (
                await requestJson<{ ok: true; file: AgentsMdFile }>(
                  `/api/settings/agents/files/${encodeURIComponent(fileId)}`,
                )
              ).file.content,
          });
          const body = buildDraftDroneCreatePayload({
            name,
            group,
            repoPath,
            fleetParentId,
            repoSeedFromDroneId,
            runtime,
            persistVolume,
            repoBranchSelection: {
              repoBranchSource: effectiveRepoBranchSource,
              pullHostBranchBeforeCreate,
              remoteBranch,
            },
            seedAgent,
            seedModel,
            seedReasoning,
            seedAgentPermissionMode,
            agentsMd: agentsMdOverride,
            seedApprovalPolicy,
            prompt: shouldSeedPromptViaCreate ? prompt : '',
          });
          if (createAsDraft) (body as any).draft = true;
          const data = await requestJson<{ ok: true; id: string; name: string; phase: 'starting' }>(
            `/api/drones`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            },
          );
          const droneId = String((data as any)?.id ?? '').trim();
          const createdName = String((data as any)?.name ?? name ?? '').trim() || droneId;
          if (!droneId) throw new Error('create drone did not return an id');
          createdDrone = true;
          rememberNewDronePreferences(repoPath, {
            mode: effectiveCreateMode,
            runtime,
            createAsDraft,
            persistVolume: persistVolume === true,
            spawnAgentKey,
            spawnModel: String(spawnModelForSeed ?? '').trim(),
            spawnReasoning: String(spawnReasoningForSeed ?? '').trim(),
            spawnAgentPermissionMode,
            spawnApprovalPolicy: seedApprovalPolicy,
            repoBranchSource: effectiveRepoBranchSource,
            repoCreateRemoteBranch: remoteBranch,
            pullHostBranchBeforeCreate,
          });

          if (optimisticSeeds.length > 0) {
            replaceOptimisticStartupSeeds(setStartupSeedByDrone, optimisticSeeds, [{ id: droneId, name: createdName }], {
              runtime,
              agent: seedAgent,
              model: seedModel,
              reasoning: seedReasoning,
              agentPermissionMode: seedAgentPermissionMode,
              approvalPolicy: seedApprovalPolicy,
              prompt: shouldSeedPromptViaCreate ? prompt : '',
              chatName: 'default',
              group,
              repoPath,
            });
          } else if (!createWithoutChat) {
            if (seedModel) rememberSeenModels([seedModel]);
            rememberStartupSeed([{ id: droneId, name: createdName }], {
              runtime,
              agent: seedAgent,
              model: seedModel,
              reasoning: seedReasoning,
              agentPermissionMode: seedAgentPermissionMode,
              approvalPolicy: seedApprovalPolicy,
            prompt,
              chatName: 'default',
              group,
              repoPath,
              at: opts?.submittedAt ?? pending?.at ?? null,
            });
          }
          if (!keepDraftComposerOpen) {
            preferredSelectedDroneRef.current = droneId;
            preferredSelectedDroneHoldUntilRef.current = Date.now() + startupSeedMissingGraceMs;
            setSelectedDrone(droneId);
            setSelectedDroneIds([droneId]);
            selectionAnchorRef.current = droneId;
            setSelectedChat('default');
          }

          setDraftChatState((prev) => {
            if (!prev?.prompt) return prev;
            return {
              ...(prev ?? { focusKey: undefined }),
              droneId,
              // Keep the optimistic display name stable until the automatic rename
              // completes and the real workspace takes over.
              droneName: String(prev.droneName ?? '').trim() || createdName,
              queuedPrompts: Array.isArray(prev.queuedPrompts) ? prev.queuedPrompts : [],
              prompt: {
                ...prev.prompt,
                state: 'sent',
                updatedAt: new Date().toISOString(),
              },
            };
          });

          if (hasDraftAttachments) {
            enqueueQueuedPrompt(droneId, 'default', prompt, draftAttachments);
          }
          for (const queuedPrompt of queuedPromptsToHandoff) {
            enqueueQueuedPrompt(droneId, 'default', queuedPrompt.prompt, queuedPrompt.attachmentPayloads);
          }
          if (queuedPromptsToHandoff.length > 0) {
            setDraftChatState((prev) => {
              if (!prev?.prompt) return prev;
              return {
                ...prev,
                queuedPrompts: [],
              };
            });
          }

          if (autoRename) {
            const renameSourcePrompt = String(opts?.autoRenamePrompt ?? prompt ?? '').trim();
            if (renameSourcePrompt) {
              setDraftAutoRenaming(true);
              void suggestAndRenameDraftDrone(droneId, renameSourcePrompt).finally(() => setDraftAutoRenaming(false));
            }
          }

          setDraftCreateOpen(false);
          if (!keepDraftComposerOpen) {
            setDraftCreateName('');
            setDraftCreateGroup('');
            setDraftCreateParentDroneId(null);
            setDraftAgentsMdLibraryFileId('');
            setDraftAgentsMdOverrideEnabled(false);
            setDraftAgentsMdOverride('');
            setCreateAsDraft(false);
            setDraftCreateError(postCreateError);
            setDraftNameSuggestionError(null);
            setDraftNameSuggesting(false);
          } else if (postCreateError) {
            setDraftCreateError(postCreateError);
          }
          if (createWithoutChat && !keepDraftComposerOpen) setDraftChatState(null);
          return true;
        } catch (e: any) {
          const err = e?.message ?? String(e);
          clearOptimisticStartupSeeds(setStartupSeedByDrone, optimisticSeeds);
          if (createdDrone) {
            setDraftCreateError(`Drone created, but setup was incomplete: ${err}`);
            return true;
          }
          setDraftChatState((prev) => {
            if (!prev?.prompt) return prev;
            return {
              ...(prev ?? { droneId: '', droneName: '' }),
              prompt: {
                ...prev.prompt,
                state: 'failed',
                error: err,
                updatedAt: new Date().toISOString(),
              },
            };
          });
          setDraftCreateError(err);
          return false;
        } finally {
          endDraftCreate();
        }
      };

      if (keepDraftComposerOpen) {
        setDraftChatState({ droneId: '', droneName: '', prompt: null, queuedPrompts: [], focusKey: newDraftChatFocusKey() });
        void runCreate();
        return true;
      }

      return await runCreate();
    },
    [
      draftCreateRepoPath,
      draftCreateMode,
      draftCreateGroup,
      draftCreateName,
      draftCreateParentDroneId,
      draftAgentsMdLibraryFileId,
      draftAgentsMdOverride,
      draftAgentsMdOverrideEnabled,
      createRuntime,
      createAsDraft,
      createPersistVolume,
      drones,
      addOptimisticStartupSeeds,
      clearOptimisticStartupSeeds,
      enqueueQueuedPrompt,
      pullHostBranchBeforeCreate,
      repoBranchSource,
      repoCreateRemoteBranch,
      preferredSelectedDroneHoldUntilRef,
      preferredSelectedDroneRef,
      rememberSeenModels,
      rememberNewDronePreferences,
      rememberStartupSeed,
      replaceOptimisticStartupSeeds,
      requestJson,
      resolveAgentKeyToConfig,
      selectionAnchorRef,
      beginDraftCreate,
      endDraftCreate,
      setDraftAutoRenaming,
      setCreateAsDraft,
      setDraftAgentsMdLibraryFileId,
      setDraftAgentsMdOverride,
      setDraftAgentsMdOverrideEnabled,
      setDraftChat,
      setDraftCreateError,
      setDraftCreateGroup,
      setDraftCreateParentDroneId,
      setDraftCreateName,
      setDraftCreateOpen,
      setDraftCreating,
      setDraftNameSuggestionError,
      setDraftNameSuggesting,
      setSelectedChat,
      setSelectedDrone,
      setSelectedDroneIds,
      spawnAgentKey,
      spawnAgentPermissionMode,
      spawnApprovalPolicy,
      spawnModelForSeed,
      spawnReasoningForSeed,
      startupSeedMissingGraceMs,
      suggestAndRenameDraftDrone,
      setDraftChatState,
    ],
  );

  const queueDraftPromptDuringCreate = React.useCallback(
    (payload: ChatSendPayload): boolean => {
      const nextPrompt = createDraftQueuedPrompt(payload);
      if (!nextPrompt) return false;
      setDraftChatState((prev) => {
        if (!prev?.prompt) return prev;
        const queuedPrompts = Array.isArray(prev.queuedPrompts) ? prev.queuedPrompts : [];
        return {
          ...prev,
          queuedPrompts: [...queuedPrompts, nextPrompt],
        };
      });
      return true;
    },
    [setDraftChatState],
  );

  const startDraftPrompt = React.useCallback(
    async (payload: ChatSendPayload, opts?: StartDraftPromptOptions): Promise<boolean> => {
      const attachments = normalizeChatImageAttachmentPayloads(payload?.attachments);
      const prompt = String(payload?.prompt ?? '').trim();
      if (!prompt && attachments.length === 0) return false;
      if (opts?.keepComposerOpen) {
        setDraftCreateError(null);
        setDraftSuggestedName('');
        setDraftNameSuggesting(false);
        setDraftNameSuggestionError(null);
        setDraftAutoRenaming(false);
        setDraftCreateOpen(false);
        return await createDroneFromDraft({
          prompt,
          attachments,
          autoRename: !draftCreateName.trim(),
          keepDraftComposerOpen: true,
        });
      }
      const nextDraftChat = createSubmittedDraftChat({
        payload: { prompt, attachments },
        droneName:
          draftCreateName.trim() ||
          allocateUntitledDisplayName(drones.map((drone) => String(drone?.name ?? '').trim())),
        focusKey: draftChat?.focusKey,
      });
      if (!nextDraftChat) return false;
      setDraftChatState(nextDraftChat);
      setDraftCreateError(null);
      setDraftCreateName('');
      setDraftSuggestedName('');
      setDraftNameSuggesting(false);
      setDraftNameSuggestionError(null);
      setDraftAutoRenaming(false);
      setDraftCreateOpen(false);

      return await createDroneFromDraft({
        prompt,
        attachments,
        autoRename: !draftCreateName.trim(),
          submittedAt: nextDraftChat.prompt?.at,
          deliveryMode: opts?.deliveryMode,
      });
    },
    [
      createDroneFromDraft,
      drones,
      draftCreateName,
      setDraftAutoRenaming,
      setDraftChatState,
      setDraftCreateError,
      setDraftCreateName,
      setDraftCreateOpen,
      setDraftNameSuggestionError,
      setDraftNameSuggesting,
      setDraftSuggestedName,
    ],
  );

  return {
    cloneDrone,
    cloneDroneWithoutSelection,
    createDroneFromDraft,
    queueDraftPromptDuringCreate,
    startDraftPrompt,
  };
}
