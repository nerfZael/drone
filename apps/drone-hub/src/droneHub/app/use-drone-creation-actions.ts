import React from 'react';
import type { ChatAgentConfig } from '../../domain';
import type { ChatSendPayload } from '../chat';
import { makeId } from './helpers';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type QueueDronesResponse = {
  ok: true;
  accepted: Array<{ id: string; name: string; phase: 'starting' }>;
  rejected: Array<{ id?: string; name: string; error: string; status?: number }>;
  total: number;
};

type UseDroneCreationActionsArgs = {
  drones: Array<{ id: string; name: string }>;
  createNameRows: string[];
  createMessageSuffixRows: string[];
  createGroup: string;
  createRepoPath: string;
  createInitialMessage: string;
  createMode: 'create' | 'clone';
  cloneSourceId: string | null;
  cloneIncludeChats: boolean;
  spawnAgentKey: string;
  spawnModelForSeed: string | null;
  draftChat: { droneId: string; droneName: string; prompt: any | null } | null;
  draftCreateName: string;
  draftCreateGroup: string;
  chatHeaderRepoPath: string;
  startupSeedMissingGraceMs: number;
  resolveAgentKeyToConfig: (key: string) => ChatAgentConfig;
  queueDrones: (list: any[]) => Promise<QueueDronesResponse>;
  requestJson: RequestJsonFn;
  suggestAndRenameDraftDrone: (droneId: string, prompt: string) => Promise<void>;
  rememberStartupSeed: (
    drones: Array<{ id: string; name: string }>,
    opts: { agent: ChatAgentConfig | null; model?: string | null; prompt: string; chatName?: string },
  ) => void;
  isValidDroneName: (name: string) => boolean;
  hasWhitespaceInNameRaw: (nameRaw: string) => boolean;
  setCreateError: React.Dispatch<React.SetStateAction<string | null>>;
  setCreating: React.Dispatch<React.SetStateAction<boolean>>;
  setCreateName: React.Dispatch<React.SetStateAction<string>>;
  setCreateMessageSuffixRows: React.Dispatch<React.SetStateAction<string[]>>;
  setCreateOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setCreateMode: React.Dispatch<React.SetStateAction<'create' | 'clone'>>;
  setCloneSourceId: React.Dispatch<React.SetStateAction<string | null>>;
  setCreateGroup: React.Dispatch<React.SetStateAction<string>>;
  setCreateRepoPath: React.Dispatch<React.SetStateAction<string>>;
  setCreateInitialMessage: React.Dispatch<React.SetStateAction<string>>;
  setDraftChat: React.Dispatch<React.SetStateAction<any>>;
  setDraftCreateError: React.Dispatch<React.SetStateAction<string | null>>;
  setDraftCreateName: React.Dispatch<React.SetStateAction<string>>;
  setDraftCreateGroup: React.Dispatch<React.SetStateAction<string>>;
  setDraftSuggestedName: React.Dispatch<React.SetStateAction<string>>;
  setDraftNameSuggesting: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftNameSuggestionError: React.Dispatch<React.SetStateAction<string | null>>;
  setDraftAutoRenaming: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftCreateOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftCreating: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedDrone: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedDroneIds: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedChat: React.Dispatch<React.SetStateAction<string>>;
  selectionAnchorRef: React.MutableRefObject<string | null>;
  preferredSelectedDroneRef: React.MutableRefObject<string | null>;
  preferredSelectedDroneHoldUntilRef: React.MutableRefObject<number>;
};

export function useDroneCreationActions({
  drones,
  createNameRows,
  createMessageSuffixRows,
  createGroup,
  createRepoPath,
  createInitialMessage,
  createMode,
  cloneSourceId,
  cloneIncludeChats,
  spawnAgentKey,
  spawnModelForSeed,
  draftChat,
  draftCreateName,
  draftCreateGroup,
  chatHeaderRepoPath,
  startupSeedMissingGraceMs,
  resolveAgentKeyToConfig,
  queueDrones,
  requestJson,
  suggestAndRenameDraftDrone,
  rememberStartupSeed,
  isValidDroneName,
  hasWhitespaceInNameRaw,
  setCreateError,
  setCreating,
  setCreateName,
  setCreateMessageSuffixRows,
  setCreateOpen,
  setCreateMode,
  setCloneSourceId,
  setCreateGroup,
  setCreateRepoPath,
  setCreateInitialMessage,
  setDraftChat,
  setDraftCreateError,
  setDraftCreateName,
  setDraftCreateGroup,
  setDraftSuggestedName,
  setDraftNameSuggesting,
  setDraftNameSuggestionError,
  setDraftAutoRenaming,
  setDraftCreateOpen,
  setDraftCreating,
  setSelectedDrone,
  setSelectedDroneIds,
  setSelectedChat,
  selectionAnchorRef,
  preferredSelectedDroneRef,
  preferredSelectedDroneHoldUntilRef,
}: UseDroneCreationActionsArgs) {
  const createDrone = React.useCallback(async () => {
    const rowSpecs = createNameRows.map((nameRaw, idx) => ({
      nameRaw: String(nameRaw ?? ''),
      name: String(nameRaw ?? '').trim(),
      messageSuffix: String(createMessageSuffixRows[idx] ?? ''),
    }));
    const namedRows = rowSpecs.filter((row) => row.name);
    const names = namedRows.map((row) => row.name);
    const group = createGroup.trim();
    const repoPath = createRepoPath.trim();
    const seedPrompt = createInitialMessage.trim();
    const isClone = createMode === 'clone' && Boolean(cloneSourceId);
    const seedAgent = isClone && cloneIncludeChats ? null : resolveAgentKeyToConfig(spawnAgentKey);
    const seedModel = isClone && cloneIncludeChats ? null : spawnModelForSeed;
    if (names.length === 0) {
      setCreateError('At least one name is required.');
      return;
    }

    const invalid = Array.from(
      new Set(
        namedRows
          .filter((row) => hasWhitespaceInNameRaw(row.nameRaw) || !isValidDroneName(row.name))
          .map((row) => row.name),
      ),
    );
    if (invalid.length > 0) {
      const preview = invalid.slice(0, 4).join(', ');
      const extra = invalid.length > 4 ? ` (+${invalid.length - 4} more)` : '';
      setCreateError(
        `Invalid name(s): ${preview}${extra}. Use dash-case (letters/numbers and single hyphens), no spaces, max 48 chars.`,
      );
      return;
    }

    const nameCounts = new Map<string, number>();
    for (const name of names) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    const duplicates = Array.from(nameCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([name]) => name);
    if (duplicates.length > 0) {
      const preview = duplicates.slice(0, 4).join(', ');
      const extra = duplicates.length > 4 ? ` (+${duplicates.length - 4} more)` : '';
      setCreateError(`Duplicate name(s) in list: ${preview}${extra}.`);
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const resp = await queueDrones(
        namedRows.map(({ name, messageSuffix }) => {
          const suffix = messageSuffix.trim();
          const combinedSeedPrompt = [seedPrompt || null, suffix || null]
            .filter((part) => typeof part === 'string' && part.trim().length > 0)
            .join('\n\n');
          return {
            name,
            ...(group ? { group } : {}),
            ...(repoPath ? { repoPath } : {}),
            ...(isClone && cloneSourceId
              ? { cloneFrom: cloneSourceId, cloneChats: Boolean(cloneIncludeChats) }
              : {}),
            seedChat: 'default',
            ...(seedAgent ? { seedAgent } : {}),
            ...(seedModel ? { seedModel } : {}),
            ...(combinedSeedPrompt ? { seedPrompt: combinedSeedPrompt } : {}),
          };
        }),
      );

      const acceptedList = Array.isArray(resp?.accepted) ? resp.accepted : [];
      const acceptedByName = new Map<string, { id: string; name: string }>();
      const acceptedNames = new Set<string>();
      for (const a of acceptedList) {
        const id = String((a as any)?.id ?? '').trim();
        const name = String((a as any)?.name ?? '').trim();
        if (!id || !name) continue;
        acceptedByName.set(name, { id, name });
        acceptedNames.add(name);
      }
      const rejected = Array.isArray(resp?.rejected) ? resp.rejected : [];

      if (acceptedByName.size > 0) {
        rememberStartupSeed(Array.from(acceptedByName.values()), {
          agent: seedAgent,
          model: seedModel,
          prompt: seedPrompt,
          chatName: 'default',
        });
      }

      const firstAccepted = acceptedList.length > 0 ? acceptedList[0] : null;
      const firstAcceptedId = String((firstAccepted as any)?.id ?? '').trim();
      if (firstAcceptedId) {
        preferredSelectedDroneRef.current = firstAcceptedId;
        preferredSelectedDroneHoldUntilRef.current = Date.now() + startupSeedMissingGraceMs;
        setSelectedDrone(firstAcceptedId);
        setSelectedDroneIds([firstAcceptedId]);
        selectionAnchorRef.current = firstAcceptedId;
      }

      if (rejected.length > 0) {
        const byName = new Map<string, string>();
        for (const r of rejected) {
          const name = String((r as any)?.name ?? '').trim();
          if (!name) continue;
          byName.set(name, String((r as any)?.error ?? 'Failed to queue drone.'));
        }
        const pendingRows = namedRows.filter((row) => !acceptedNames.has(row.name));
        setCreateName(pendingRows.map((row) => row.name).join('\n'));
        setCreateMessageSuffixRows(pendingRows.map((row) => row.messageSuffix));

        const pendingNames = pendingRows.map((row) => row.name);
        const topErrors = pendingNames
          .slice(0, 4)
          .map((name) => `${name}: ${byName.get(name) ?? 'Failed to queue drone.'}`)
          .join('\n');
        const hiddenCount = Math.max(0, pendingNames.length - 4);
        const moreText = hiddenCount > 0 ? `\n(+${hiddenCount} more)` : '';
        const queuedText = acceptedNames.size > 0 ? `${acceptedNames.size} queued. ` : '';
        setCreateError(`${queuedText}${pendingNames.length} failed:\n${topErrors}${moreText}`);
        return;
      }

      setCreateOpen(false);
      setCreateMode('create');
      setCloneSourceId(null);
      setCreateName('');
      setCreateGroup('');
      setCreateRepoPath('');
      setCreateInitialMessage('');
      setCreateMessageSuffixRows(['']);
    } catch (e: any) {
      setCreateError(e?.message ?? String(e));
    } finally {
      setCreating(false);
    }
  }, [
    cloneIncludeChats,
    cloneSourceId,
    createGroup,
    createInitialMessage,
    createMessageSuffixRows,
    createMode,
    createNameRows,
    createRepoPath,
    hasWhitespaceInNameRaw,
    isValidDroneName,
    preferredSelectedDroneHoldUntilRef,
    preferredSelectedDroneRef,
    queueDrones,
    rememberStartupSeed,
    resolveAgentKeyToConfig,
    selectionAnchorRef,
    setCloneSourceId,
    setCreateError,
    setCreateGroup,
    setCreateInitialMessage,
    setCreateMessageSuffixRows,
    setCreateMode,
    setCreateName,
    setCreateOpen,
    setCreateRepoPath,
    setCreating,
    setSelectedDrone,
    setSelectedDroneIds,
    spawnAgentKey,
    spawnModelForSeed,
    startupSeedMissingGraceMs,
  ]);

  const createDroneFromDraft = React.useCallback(
    async (opts?: { prompt?: string; name?: string; group?: string; autoRename?: boolean }): Promise<boolean> => {
      const pending = draftChat?.prompt ?? null;
      const prompt = String(opts?.prompt ?? pending?.prompt ?? '').trim();
      const nameRaw = String(opts?.name ?? draftCreateName ?? '');
      const name = nameRaw.trim();
      const group = String(opts?.group ?? draftCreateGroup ?? '').trim();
      const repoPath = String(chatHeaderRepoPath ?? '').trim();
      if (!prompt) {
        setDraftCreateError('Send a first message before creating a drone.');
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

      setDraftCreating(true);
      setDraftCreateError(null);
      const seedAgent = resolveAgentKeyToConfig(spawnAgentKey);
      const seedModel = spawnModelForSeed;
      try {
        const body: any = {
          ...(name ? { name } : {}),
          ...(group ? { group } : {}),
          ...(repoPath ? { repoPath } : {}),
          seedChat: 'default',
          ...(seedAgent ? { seedAgent } : {}),
          ...(seedModel ? { seedModel } : {}),
          ...(prompt ? { seedPrompt: prompt } : {}),
        };
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

        rememberStartupSeed([{ id: droneId, name: createdName }], {
          agent: seedAgent,
          model: seedModel,
          prompt,
          chatName: 'default',
        });
        preferredSelectedDroneRef.current = droneId;
        preferredSelectedDroneHoldUntilRef.current = Date.now() + startupSeedMissingGraceMs;
        setSelectedDrone(droneId);
        setSelectedDroneIds([droneId]);
        selectionAnchorRef.current = droneId;
        setSelectedChat('default');

        setDraftChat((prev: any) => {
          if (!prev?.prompt) return prev;
          return {
            droneId,
            droneName: createdName,
            prompt: {
              ...prev.prompt,
              state: 'sent',
              updatedAt: new Date().toISOString(),
            },
          };
        });

        if (opts?.autoRename) {
          setDraftAutoRenaming(true);
          void suggestAndRenameDraftDrone(droneId, prompt).finally(() => setDraftAutoRenaming(false));
        }

        setDraftCreateOpen(false);
        setDraftCreateName('');
        setDraftCreateGroup('');
        setDraftCreateError(null);
        setDraftNameSuggestionError(null);
        setDraftNameSuggesting(false);
        return true;
      } catch (e: any) {
        const err = e?.message ?? String(e);
        setDraftChat((prev: any) => {
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
        setDraftCreating(false);
      }
    },
    [
      chatHeaderRepoPath,
      draftChat?.prompt,
      draftCreateGroup,
      draftCreateName,
      drones,
      preferredSelectedDroneHoldUntilRef,
      preferredSelectedDroneRef,
      rememberStartupSeed,
      requestJson,
      resolveAgentKeyToConfig,
      selectionAnchorRef,
      setDraftAutoRenaming,
      setDraftChat,
      setDraftCreateError,
      setDraftCreateGroup,
      setDraftCreateName,
      setDraftCreateOpen,
      setDraftCreating,
      setDraftNameSuggestionError,
      setDraftNameSuggesting,
      setSelectedChat,
      setSelectedDrone,
      setSelectedDroneIds,
      spawnAgentKey,
      spawnModelForSeed,
      startupSeedMissingGraceMs,
      suggestAndRenameDraftDrone,
    ],
  );

  const startDraftPrompt = React.useCallback(
    async (payload: ChatSendPayload): Promise<boolean> => {
      const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
      if (attachments.length > 0) {
        setDraftCreateError('Image attachments are only supported after the drone is created.');
        return false;
      }
      const prompt = String(payload?.prompt ?? '').trim();
      if (!prompt) return false;
      setDraftChat({
        droneId: '',
        droneName: '',
        prompt: {
          id: `draft-${makeId()}`,
          at: new Date().toISOString(),
          prompt,
          state: 'sending',
        },
      });
      setDraftCreateError(null);
      setDraftCreateName('');
      setDraftCreateGroup('');
      setDraftSuggestedName('');
      setDraftNameSuggesting(false);
      setDraftNameSuggestionError(null);
      setDraftAutoRenaming(false);
      setDraftCreateOpen(false);

      return await createDroneFromDraft({ prompt, group: '', autoRename: true });
    },
    [
      createDroneFromDraft,
      setDraftAutoRenaming,
      setDraftChat,
      setDraftCreateError,
      setDraftCreateGroup,
      setDraftCreateName,
      setDraftCreateOpen,
      setDraftNameSuggestionError,
      setDraftNameSuggesting,
      setDraftSuggestedName,
    ],
  );

  return {
    createDrone,
    createDroneFromDraft,
    startDraftPrompt,
  };
}

