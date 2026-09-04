import React from 'react';
import type {
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

type CompanionWorkspaceContextValue = {
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
