import React from 'react';
import type { CompanionTextSnapshot } from '@drone/assistant-chat';

export type RecorderCompanionTarget = {
  read(): CompanionTextSnapshot;
  apply(targetId: string, baseRevision: string, content: string): { ok: true; revision: string };
};

const Context = React.createContext<{
  target: React.MutableRefObject<RecorderCompanionTarget | null>;
  height: number;
  setHeight: React.Dispatch<React.SetStateAction<number>>;
} | null>(null);

export function RecorderCompanionProvider({ children }: { children: React.ReactNode }) {
  const target = React.useRef<RecorderCompanionTarget | null>(null);
  const [height, setHeight] = React.useState(0);
  const value = React.useMemo(() => ({ target, height, setHeight }), [height]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useRecorderCompanion() {
  return React.useContext(Context);
}
