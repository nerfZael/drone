import React from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { colors } from '../theme';
import type { MobileSidebarDropPlacement } from '../drones/mobile-sidebar-reorder';
import {
  resolveMobileSidebarDropTarget,
  type MobileSidebarDragTargetData,
  type MobileSidebarMeasuredDropTarget,
} from '../drones/mobile-sidebar-drop-target';

type RegisteredDragTarget = MobileSidebarMeasuredDropTarget & {
  refresh(): void;
};

export type { MobileSidebarDragTargetData } from '../drones/mobile-sidebar-drop-target';

type ActiveDrag = {
  scope: string;
  treeScope?: string;
  itemId: string;
  overTargetKey: string;
  overItemId: string;
  placement: MobileSidebarDropPlacement;
  overData?: MobileSidebarDragTargetData;
  onDrop(
    overItemId: string,
    placement: MobileSidebarDropPlacement,
    data?: MobileSidebarDragTargetData,
  ): void;
};

type MobileSidebarDragDropContextValue = {
  active: ActiveDrag | null;
  registerTarget(key: string, target: RegisteredDragTarget): void;
  unregisterTarget(key: string): void;
  beginDrag(
    scope: string,
    treeScope: string | undefined,
    itemId: string,
    absoluteY: number,
    onDrop: ActiveDrag['onDrop'],
  ): void;
  updateDrag(absoluteY: number): void;
  finishDrag(): void;
  cancelDrag(): void;
};

const MobileSidebarDragDropContext = React.createContext<MobileSidebarDragDropContextValue | null>(
  null,
);

export function MobileSidebarDragDropProvider({ children }: { children: React.ReactNode }) {
  const targetsRef = React.useRef(new Map<string, RegisteredDragTarget>());
  const activeRef = React.useRef<ActiveDrag | null>(null);
  const [active, setActive] = React.useState<ActiveDrag | null>(null);

  const commitActive = React.useCallback((next: ActiveDrag | null) => {
    activeRef.current = next;
    setActive(next);
  }, []);
  const registerTarget = React.useCallback((key: string, target: RegisteredDragTarget) => {
    targetsRef.current.set(key, target);
  }, []);
  const unregisterTarget = React.useCallback((key: string) => {
    targetsRef.current.delete(key);
  }, []);
  const beginDrag = React.useCallback(
    (
      scope: string,
      treeScope: string | undefined,
      itemId: string,
      _absoluteY: number,
      onDrop: ActiveDrag['onDrop'],
    ) => {
      for (const target of targetsRef.current.values()) target.refresh();
      const source = [...targetsRef.current.values()].find(
        (target) => target.scope === scope && target.itemId === itemId,
      );
      commitActive({
        scope,
        treeScope,
        itemId,
        overTargetKey: source?.key ?? `${scope}\u0000${itemId}`,
        overItemId: itemId,
        placement: 'after',
        overData: source?.data,
        onDrop,
      });
    },
    [commitActive],
  );
  const updateDrag = React.useCallback(
    (absoluteY: number) => {
      const current = activeRef.current;
      if (!current) return;
      const target = resolveMobileSidebarDropTarget(
        targetsRef.current.values(),
        current.scope,
        current.treeScope,
        current.itemId,
        absoluteY,
      );
      const nextTarget =
        target ??
        ({
          overTargetKey: `${current.scope}\u0000${current.itemId}`,
          overItemId: current.itemId,
          placement: 'after',
          overData: undefined,
        } satisfies Pick<ActiveDrag, 'overTargetKey' | 'overItemId' | 'placement' | 'overData'>);
      if (
        nextTarget.overTargetKey === current.overTargetKey &&
        nextTarget.placement === current.placement &&
        nextTarget.overData?.insidePosition === current.overData?.insidePosition
      ) {
        return;
      }
      commitActive({ ...current, ...nextTarget });
    },
    [commitActive],
  );
  const cancelDrag = React.useCallback(() => commitActive(null), [commitActive]);
  const finishDrag = React.useCallback(() => {
    const current = activeRef.current;
    commitActive(null);
    if (!current || current.overItemId === current.itemId) return;
    current.onDrop(current.overItemId, current.placement, current.overData);
  }, [commitActive]);
  const value = React.useMemo<MobileSidebarDragDropContextValue>(
    () => ({
      active,
      registerTarget,
      unregisterTarget,
      beginDrag,
      updateDrag,
      finishDrag,
      cancelDrag,
    }),
    [active, beginDrag, cancelDrag, finishDrag, registerTarget, unregisterTarget, updateDrag],
  );
  return (
    <MobileSidebarDragDropContext.Provider value={value}>
      {children}
    </MobileSidebarDragDropContext.Provider>
  );
}

export function MobileSidebarDragTarget({
  children,
  scope,
  treeScope,
  itemId,
  data,
  canDropInside = false,
}: {
  children: React.ReactNode;
  scope: string;
  treeScope?: string;
  itemId: string;
  data?: MobileSidebarDragTargetData;
  canDropInside?: boolean | ((activeItemId: string) => boolean);
}) {
  const context = React.useContext(MobileSidebarDragDropContext);
  const registerTarget = context?.registerTarget;
  const unregisterTarget = context?.unregisterTarget;
  const targetRef = React.useRef<View>(null);
  const key = `${scope}\u0000${itemId}`;
  const propsRef = React.useRef({ treeScope, data, canDropInside });
  propsRef.current = { treeScope, data, canDropInside };
  const measure = React.useCallback(() => {
    targetRef.current?.measureInWindow((_x, top, _width, height) => {
      registerTarget?.(key, {
        key,
        scope,
        itemId,
        get treeScope() {
          return propsRef.current.treeScope;
        },
        get data() {
          return propsRef.current.data;
        },
        acceptsInside: (activeItemId) => {
          const accepts = propsRef.current.canDropInside;
          return typeof accepts === 'function' ? accepts(activeItemId) : accepts;
        },
        rect: { top, bottom: top + height },
        refresh: measure,
      });
    });
  }, [itemId, key, registerTarget, scope]);
  React.useEffect(() => {
    measure();
    return () => unregisterTarget?.(key);
  }, [key, measure, unregisterTarget]);
  const isSource = context?.active?.scope === scope && context.active.itemId === itemId;
  const isTarget = context?.active?.overTargetKey === key && context.active.itemId !== itemId;
  const isInsideTarget = isTarget && context.active?.placement === 'inside';
  const indicatorStyle: ViewStyle | undefined = isTarget
    ? context.active?.placement === 'before'
      ? styles.dropBefore
      : context.active?.placement === 'after'
        ? styles.dropAfter
        : undefined
    : undefined;
  const viewChildren = children as React.ComponentProps<typeof View>['children'];
  return (
    <View
      ref={targetRef}
      collapsable={false}
      onLayout={measure}
      style={[styles.target, isSource && styles.dragSource]}
    >
      {viewChildren}
      {isInsideTarget ? (
        <>
          <View pointerEvents="none" style={styles.dropInside} />
          <View
            pointerEvents="none"
            style={[
              styles.dropInsideIndicator,
              context.active?.overData?.insidePosition === 'start'
                ? styles.dropInsideStart
                : styles.dropInsideEnd,
            ]}
          />
        </>
      ) : indicatorStyle ? (
        <View pointerEvents="none" style={[styles.dropIndicator, indicatorStyle]} />
      ) : null}
    </View>
  );
}

export function MobileSidebarDragArea({
  children,
  scope,
  treeScope,
  itemId,
  label,
  disabled = false,
  onDrop,
  onMoveAccessibility,
}: {
  children: React.ReactNode;
  scope: string;
  treeScope?: string;
  itemId: string;
  label: string;
  disabled?: boolean;
  onDrop(
    overItemId: string,
    placement: MobileSidebarDropPlacement,
    data?: MobileSidebarDragTargetData,
  ): void;
  onMoveAccessibility?(direction: 'up' | 'down'): void;
}) {
  const context = React.useContext(MobileSidebarDragDropContext);
  const beginDrag = context?.beginDrag;
  const updateDrag = context?.updateDrag;
  const finishDrag = context?.finishDrag;
  const cancelDrag = context?.cancelDrag;
  const gesture = React.useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled && Boolean(beginDrag))
        .activateAfterLongPress(450)
        .shouldCancelWhenOutside(false)
        .runOnJS(true)
        .onStart((event) => beginDrag?.(scope, treeScope, itemId, event.absoluteY, onDrop))
        .onUpdate((event) => updateDrag?.(event.absoluteY))
        .onEnd(() => finishDrag?.())
        .onFinalize((_event, success) => {
          if (!success) cancelDrag?.();
        }),
    [beginDrag, cancelDrag, disabled, finishDrag, itemId, onDrop, scope, treeScope, updateDrag],
  );
  const areaChildren = children as React.ComponentProps<typeof View>['children'];
  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible={!disabled}
        accessibilityRole="adjustable"
        accessibilityLabel={`Reorder ${label}`}
        accessibilityHint="Long press and drag, or use the move actions"
        accessibilityState={{ disabled }}
        accessibilityActions={[
          { name: 'moveUp', label: `Move ${label} up` },
          { name: 'moveDown', label: `Move ${label} down` },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'moveUp') onMoveAccessibility?.('up');
          if (event.nativeEvent.actionName === 'moveDown') onMoveAccessibility?.('down');
        }}
        collapsable={false}
        style={styles.dragArea}
      >
        {areaChildren}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  target: { position: 'relative' },
  dragSource: { opacity: 0.52 },
  dropIndicator: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: 2,
    zIndex: 20,
    backgroundColor: colors.accent,
  },
  dropBefore: {
    top: -1,
  },
  dropAfter: {
    bottom: -1,
  },
  dropInside: {
    position: 'absolute',
    left: 8,
    right: 8,
    top: 2,
    bottom: 2,
    zIndex: 20,
    borderWidth: 1,
    borderRadius: 5,
    borderColor: colors.accent,
    backgroundColor: 'transparent',
  },
  dropInsideIndicator: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: 2,
    zIndex: 21,
    backgroundColor: colors.accent,
  },
  dropInsideStart: { top: 2 },
  dropInsideEnd: { bottom: 2 },
  dragArea: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
});
