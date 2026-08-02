import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MOBILE_SIDEBAR_COLLAPSED_DRONE_IDS_STORAGE_KEY,
  parseMobileSidebarCollapsedDroneIds,
  serializeMobileSidebarCollapsedDroneIds,
} from './mobile-sidebar-expansion-state';

export function useMobileSidebarCollapsedDroneIds(): {
  collapsedDroneIds: ReadonlySet<string>;
  toggleDrone(droneId: string): void;
} {
  const [collapsedDroneIds, setCollapsedDroneIds] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const collapsedDroneIdsRef = React.useRef<ReadonlySet<string>>(collapsedDroneIds);
  const loadedRef = React.useRef(false);
  const droneIdsTouchedBeforeLoadRef = React.useRef(new Set<string>());
  const persist = React.useCallback((droneIds: ReadonlySet<string>) => {
    void AsyncStorage.setItem(
      MOBILE_SIDEBAR_COLLAPSED_DRONE_IDS_STORAGE_KEY,
      serializeMobileSidebarCollapsedDroneIds(droneIds),
    ).catch(() => undefined);
  }, []);

  React.useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(MOBILE_SIDEBAR_COLLAPSED_DRONE_IDS_STORAGE_KEY)
      .then((stored) => {
        if (!active) return;
        const next = parseMobileSidebarCollapsedDroneIds(stored);
        for (const droneId of droneIdsTouchedBeforeLoadRef.current) {
          if (collapsedDroneIdsRef.current.has(droneId)) next.add(droneId);
          else next.delete(droneId);
        }
        collapsedDroneIdsRef.current = next;
        loadedRef.current = true;
        setCollapsedDroneIds(next);
        if (droneIdsTouchedBeforeLoadRef.current.size > 0) {
          persist(next);
          droneIdsTouchedBeforeLoadRef.current.clear();
        }
      })
      .catch(() => {
        if (!active) return;
        loadedRef.current = true;
        if (droneIdsTouchedBeforeLoadRef.current.size > 0) {
          persist(collapsedDroneIdsRef.current);
          droneIdsTouchedBeforeLoadRef.current.clear();
        }
      });
    return () => {
      active = false;
    };
  }, [persist]);

  const toggleDrone = React.useCallback(
    (droneId: string) => {
      const normalizedDroneId = String(droneId ?? '').trim();
      if (!normalizedDroneId) return;
      const next = new Set(collapsedDroneIdsRef.current);
      if (next.has(normalizedDroneId)) next.delete(normalizedDroneId);
      else next.add(normalizedDroneId);
      collapsedDroneIdsRef.current = next;
      setCollapsedDroneIds(next);
      if (loadedRef.current) persist(next);
      else droneIdsTouchedBeforeLoadRef.current.add(normalizedDroneId);
    },
    [persist],
  );

  return { collapsedDroneIds, toggleDrone };
}
