import React from 'react';
import { SelectionHistory, type SelectionHistoryEntry } from './selection-history';

type Args = {
  droneId: string | null;
  chatName: string;
  ready: boolean;
  available: (entry: SelectionHistoryEntry) => boolean;
  select: (entry: SelectionHistoryEntry) => void;
};

export function useSelectionHistory({ droneId, chatName, ready, available, select }: Args) {
  const history = React.useRef(new SelectionHistory());
  React.useEffect(() => {
    if (!ready) return;
    history.current.record(droneId ? { droneId, chatName: chatName || 'default' } : null);
  }, [droneId, chatName, ready]);

  const navigate = React.useCallback((direction: -1 | 1) => {
    if (!ready) return false;
    const entry = history.current.move(direction, available);
    if (!entry) return false;
    select(entry);
    return true;
  }, [available, ready, select]);
  const navigateBack = React.useCallback(() => navigate(-1), [navigate]);
  const navigateForward = React.useCallback(() => navigate(1), [navigate]);
  return { navigateBack, navigateForward };
}
