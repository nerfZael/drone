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

type CompanionTargetsContextValue = {
  registerEditor(target: CompanionTextTarget): () => void;
  focusEditor(id: string): void;
  readOpenFile(): CompanionTextSnapshot;
  applyEditor(targetId: string, baseRevision: string, content: string): { ok: true; revision: string };
};

const CompanionTargetsContext = React.createContext<CompanionTargetsContextValue | null>(null);

export function CompanionTargetsProvider({ children }: { children: React.ReactNode }) {
  const targetsRef = React.useRef(new Map<string, CompanionTextTarget>());
  const focusedIdRef = React.useRef<string | null>(null);

  const registerEditor = React.useCallback((target: CompanionTextTarget) => {
    targetsRef.current.set(target.id, target);
    return () => {
      if (targetsRef.current.get(target.id) !== target) return;
      targetsRef.current.delete(target.id);
      if (focusedIdRef.current === target.id) focusedIdRef.current = null;
    };
  }, []);

  const focusEditor = React.useCallback((id: string) => {
    if (targetsRef.current.get(id)?.isEligible()) focusedIdRef.current = id;
  }, []);

  const resolve = React.useCallback(() => {
    const focused = focusedIdRef.current ? targetsRef.current.get(focusedIdRef.current) : null;
    if (focused?.isEligible()) return focused;
    const candidates = [...targetsRef.current.values()].filter((target) => target.isEligible());
    if (candidates.length === 0) throw new Error('NO_OPEN_FILE');
    return candidates[candidates.length - 1];
  }, []);

  const apply = React.useCallback(
    (targetId: string, baseRevision: string, content: string) => {
      const target = targetsRef.current.get(targetId);
      if (!target?.isEligible()) throw new Error('EDITOR_NOT_EDITABLE');
      return target.apply(baseRevision, content);
    },
    [],
  );

  const value = React.useMemo<CompanionTargetsContextValue>(() => ({
    registerEditor,
    focusEditor,
    readOpenFile: () => resolve().read(),
    applyEditor: (targetId, baseRevision, content) => apply(targetId, baseRevision, content),
  }), [apply, focusEditor, registerEditor, resolve]);

  return <CompanionTargetsContext.Provider value={value}>{children}</CompanionTargetsContext.Provider>;
}

export function useCompanionTargets(): CompanionTargetsContextValue | null {
  return React.useContext(CompanionTargetsContext);
}
