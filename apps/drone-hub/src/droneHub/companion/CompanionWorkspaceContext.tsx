import React from 'react';
import type {
  CompanionBrowserWorkspace,
  CompanionProposal,
  CompanionProposalExecution,
  CompanionProposalExecutionContext,
  CompanionProposalExecutionProgress,
  CompanionTextSnapshot,
} from '@drone/assistant-chat';
import { useActiveComposer } from '../chat/ActiveComposerContext';
import type { DesktopNewDronePreferences } from '../app/new-drone-preferences';

export type { CompanionTextSnapshot } from '@drone/assistant-chat';

export type CompanionTextTarget = {
  id: string;
  isEligible(): boolean;
  read(): CompanionTextSnapshot;
  apply(baseRevision: string, content: string): { ok: true; revision: string };
};

export type CompanionWorkspaceTarget = {
  getChatWindowLayout?(): unknown;
  arrangeChatWindows?(args: Record<string, unknown>): unknown;
  getAppContext(): Record<string, unknown>;
  resolveDroneName(droneId: string): string | null;
  /** Effective new-drone preferences a create_drone operation inherits when it omits overrides. */
  resolveDroneCreationDefaults(repoPath: string): DesktopNewDronePreferences | null;
  executeProposal(
    proposal: CompanionProposal,
    context: CompanionProposalExecutionContext,
    onProgress?: (progress: CompanionProposalExecutionProgress) => void,
  ): Promise<CompanionProposalExecution>;
  openDroneChat(
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> | Record<string, unknown>;
  highlightDrones(
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> | Record<string, unknown>;
};

export type CapturedCompanionWorkspace = Omit<CompanionBrowserWorkspace, 'getAppContext'> & {
  getAppContext(): Record<string, unknown>;
};

type CompanionWorkspaceContextValue = {
  capture(): CapturedCompanionWorkspace;
  registerWorkspaceTarget(target: CompanionWorkspaceTarget): () => void;
  registerEditor(target: CompanionTextTarget): () => void;
  focusEditor(id: string): void;
  getAppContext(): Record<string, unknown>;
  resolveDroneName(droneId: string): string | null;
  resolveDroneCreationDefaults(repoPath: string): DesktopNewDronePreferences | null;
  executeProposal(
    proposal: CompanionProposal,
    context: CompanionProposalExecutionContext,
    onProgress?: (progress: CompanionProposalExecutionProgress) => void,
  ): Promise<CompanionProposalExecution>;
  openDroneChat(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  highlightDrones(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  readActiveComposer(): CompanionTextSnapshot;
  applyComposer(
    targetId: string,
    baseRevision: string,
    content: string,
  ): { ok: true; revision: string };
  readOpenFile(): CompanionTextSnapshot;
  applyEditor(
    targetId: string,
    baseRevision: string,
    content: string,
  ): { ok: true; revision: string };
};

const CompanionWorkspaceContext = React.createContext<CompanionWorkspaceContextValue | null>(null);

export function CompanionWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const activeComposer = useActiveComposer();
  const workspaceTargetRef = React.useRef<CompanionWorkspaceTarget | null>(null);
  const editorTargetsRef = React.useRef(new Map<string, CompanionTextTarget>());
  const focusedEditorIdRef = React.useRef<string | null>(null);

  const registerWorkspaceTarget = React.useCallback((target: CompanionWorkspaceTarget) => {
    workspaceTargetRef.current = target;
    return () => {
      if (workspaceTargetRef.current === target) workspaceTargetRef.current = null;
    };
  }, []);

  const registerEditor = React.useCallback((target: CompanionTextTarget) => {
    editorTargetsRef.current.set(target.id, target);
    return () => {
      if (editorTargetsRef.current.get(target.id) !== target) return;
      editorTargetsRef.current.delete(target.id);
      if (focusedEditorIdRef.current === target.id) focusedEditorIdRef.current = null;
    };
  }, []);

  const focusEditor = React.useCallback((id: string) => {
    if (editorTargetsRef.current.get(id)?.isEligible()) focusedEditorIdRef.current = id;
  }, []);

  const resolveWorkspaceTarget = React.useCallback(() => {
    const target = workspaceTargetRef.current;
    if (!target) throw new Error('NO_ACTIVE_WORKSPACE');
    return target;
  }, []);

  const resolveEditor = React.useCallback(() => {
    const focused = focusedEditorIdRef.current
      ? editorTargetsRef.current.get(focusedEditorIdRef.current)
      : null;
    if (focused?.isEligible()) return focused;
    const candidates = [...editorTargetsRef.current.values()].filter((target) =>
      target.isEligible(),
    );
    if (candidates.length === 0) throw new Error('NO_OPEN_FILE');
    return candidates[candidates.length - 1]!;
  }, []);

  const applyEditor = React.useCallback(
    (targetId: string, baseRevision: string, content: string) => {
      const target = resolveEditor();
      if (target.id !== targetId) throw new Error('STALE_EDITOR_TARGET');
      return target.apply(baseRevision, content);
    },
    [resolveEditor],
  );

  const value = React.useMemo<CompanionWorkspaceContextValue>(
    () => ({
      capture: () => {
        // Missing workspace context must not prevent recording or unrelated tools.
        // Preserve its absence for this message instead of consulting a later selection.
        const workspaceTarget = workspaceTargetRef.current;
        const appContext = workspaceTarget ? structuredClone(workspaceTarget.getAppContext()) : null;
        let composerId: string | null = null;
        let editorId: string | null = null;
        try {
          composerId = activeComposer.readActiveComposer().targetId;
        } catch {
          // No composer at capture; do not fall back to one opened later.
        }
        try {
          editorId = resolveEditor().id;
        } catch {
          // No editor at capture.
        }
        const capturedEditor = () => {
          const target = editorId ? editorTargetsRef.current.get(editorId) : null;
          if (!target?.isEligible()) throw new Error('STALE_EDITOR_TARGET');
          return target;
        };
        return {
          getAppContext: () => {
            if (!appContext) throw new Error('NO_ACTIVE_WORKSPACE');
            return structuredClone(appContext);
          },
          readActiveComposer: () => {
            if (!composerId) throw new Error('NO_ACTIVE_COMPOSER');
            return activeComposer.readComposer(composerId);
          },
          applyComposer: (id, revision, content) => {
            if (!composerId || id !== composerId) throw new Error('STALE_COMPOSER_TARGET');
            return activeComposer.applyCapturedComposer(id, revision, content);
          },
          readOpenFile: () => capturedEditor().read(),
          applyEditor: (id, revision, content) => {
            if (id !== editorId) throw new Error('STALE_EDITOR_TARGET');
            return capturedEditor().apply(revision, content);
          },
          openDroneChat: async (args) => await resolveWorkspaceTarget().openDroneChat(args),
          highlightDrones: async (args) => await resolveWorkspaceTarget().highlightDrones(args),
          getChatWindowLayout: () => resolveWorkspaceTarget().getChatWindowLayout?.() ?? { supported: false },
          arrangeChatWindows: (args) => {
            const target = resolveWorkspaceTarget();
            if (!target.arrangeChatWindows) throw new Error('CHAT_LAYOUT_UNSUPPORTED');
            return target.arrangeChatWindows(args);
          },
        };
      },
      registerWorkspaceTarget,
      registerEditor,
      focusEditor,
      getAppContext: () => resolveWorkspaceTarget().getAppContext(),
      resolveDroneName: (droneId) => resolveWorkspaceTarget().resolveDroneName(droneId),
      resolveDroneCreationDefaults: (repoPath) =>
        resolveWorkspaceTarget().resolveDroneCreationDefaults(repoPath),
      executeProposal: async (proposal, context, onProgress) =>
        await resolveWorkspaceTarget().executeProposal(proposal, context, onProgress),
      openDroneChat: async (args) => await resolveWorkspaceTarget().openDroneChat(args),
      highlightDrones: async (args) => await resolveWorkspaceTarget().highlightDrones(args),
      readActiveComposer: activeComposer.readActiveComposer,
      applyComposer: (targetId, baseRevision, content) =>
        activeComposer.applyComposer(targetId, baseRevision, content),
      readOpenFile: () => resolveEditor().read(),
      applyEditor,
    }),
    [
      applyEditor,
      activeComposer.applyComposer,
      activeComposer.readActiveComposer,
      activeComposer.readComposer,
      activeComposer.applyCapturedComposer,
      focusEditor,
      registerEditor,
      registerWorkspaceTarget,
      resolveEditor,
      resolveWorkspaceTarget,
    ],
  );

  return (
    <CompanionWorkspaceContext.Provider value={value}>
      {children}
    </CompanionWorkspaceContext.Provider>
  );
}

export function useCompanionWorkspace(): CompanionWorkspaceContextValue | null {
  return React.useContext(CompanionWorkspaceContext);
}
