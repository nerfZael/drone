import React from 'react';

export type CompanionTextSnapshot = {
  targetId: string;
  path: string;
  content: string;
  revision: string;
  mode: 'edit' | 'preview' | 'read-only' | 'loading' | 'saving' | 'large-file';
  dirty?: boolean;
};

export type CompanionTextTarget = {
  id: string;
  isEligible(): boolean;
  read(): CompanionTextSnapshot;
  apply(baseRevision: string, content: string): { ok: true; revision: string };
};

export type CompanionComposerTarget = {
  readActiveComposer(): CompanionTextSnapshot;
  applyComposer(
    targetId: string,
    baseRevision: string,
    content: string,
  ): { ok: true; revision: string };
};

export type CompanionWorkspaceTarget = {
  getAppContext(): Record<string, unknown>;
  prepareDroneDraft(
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> | Record<string, unknown>;
  highlightDrones(
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> | Record<string, unknown>;
};

type CompanionWorkspaceContextValue = {
  registerWorkspaceTarget(target: CompanionWorkspaceTarget): () => void;
  registerComposerTarget(target: CompanionComposerTarget): () => void;
  registerEditor(target: CompanionTextTarget): () => void;
  focusEditor(id: string): void;
  getAppContext(): Record<string, unknown>;
  prepareDroneDraft(args: Record<string, unknown>): Promise<Record<string, unknown>>;
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
  const workspaceTargetRef = React.useRef<CompanionWorkspaceTarget | null>(null);
  const composerTargetRef = React.useRef<CompanionComposerTarget | null>(null);
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

  const registerComposerTarget = React.useCallback((target: CompanionComposerTarget) => {
    composerTargetRef.current = target;
    return () => {
      if (composerTargetRef.current === target) composerTargetRef.current = null;
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

  const resolveComposerTarget = React.useCallback(() => {
    const target = composerTargetRef.current;
    if (!target) throw new Error('NO_ACTIVE_COMPOSER');
    return target;
  }, []);

  const applyEditor = React.useCallback(
    (targetId: string, baseRevision: string, content: string) => {
      const target = editorTargetsRef.current.get(targetId);
      if (!target?.isEligible()) throw new Error('EDITOR_NOT_EDITABLE');
      return target.apply(baseRevision, content);
    },
    [],
  );

  const value = React.useMemo<CompanionWorkspaceContextValue>(
    () => ({
      registerWorkspaceTarget,
      registerComposerTarget,
      registerEditor,
      focusEditor,
      getAppContext: () => resolveWorkspaceTarget().getAppContext(),
      prepareDroneDraft: async (args) => await resolveWorkspaceTarget().prepareDroneDraft(args),
      highlightDrones: async (args) => await resolveWorkspaceTarget().highlightDrones(args),
      readActiveComposer: () => resolveComposerTarget().readActiveComposer(),
      applyComposer: (targetId, baseRevision, content) =>
        resolveComposerTarget().applyComposer(targetId, baseRevision, content),
      readOpenFile: () => resolveEditor().read(),
      applyEditor,
    }),
    [
      applyEditor,
      focusEditor,
      registerEditor,
      registerComposerTarget,
      registerWorkspaceTarget,
      resolveEditor,
      resolveComposerTarget,
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
