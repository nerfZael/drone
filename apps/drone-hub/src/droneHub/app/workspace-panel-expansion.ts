import React from 'react';
import { create } from 'zustand';
import type { DockviewApi, DockviewGroupPanel } from 'dockview';
import { profileStorageKey } from '../../profile-storage';
import { FILE_PANEL_PREFIX } from './file-tab-drag';
import { SIDE_CHAT_PANEL_PREFIX } from './align-floating-chats';

/**
 * "Expand on focus": a docked window that grows over its neighbours while you
 * work in it and shrinks back when you click elsewhere. The grid underneath
 * never moves, so nothing else re-wraps. Double-clicking a tab pins the same
 * expansion until the next double-click.
 */

const STORAGE_KEY = profileStorageKey('droneHub.workspaceExpandOnFocus');
export const TOGGLE_PANEL_EXPANSION_EVENT = 'drone-hub:toggle-panel-expansion';
/** Windows whose content keeps its expanded size while collapsed, showing only the part nearest the cursor. */
const KEEP_SIZE_KEYS = new Set(['tool:terminal']);

/** How much of the workspace a window without a content measure grows to, along its thin side. */
export const EXPANSION_DEFAULT_FRACTION = 0.4;
/** Always leave this much of the neighbours in view, so it reads as an overlay with somewhere to click. */
export const EXPANSION_NEIGHBOUR_STRIP_PX = 48;
/** Formatted code rarely goes past this on purpose; longer lines scroll or wrap as before. */
export const EXPANSION_MAX_CODE_COLUMNS = 160;
/** Share of lines a content-fit width shows unwrapped; the rest are outliers. */
const CODE_LINE_PERCENTILE = 0.95;
const MIN_USEFUL_GROWTH_PX = 8;
/** A window with expand on focus can be dragged down to its tab bar and a sliver of content. */
const COMPACT_GROUP_CONSTRAINTS = { minimumWidth: 40, minimumHeight: 40 };
export const OCCUPIED_GROUP_CONSTRAINTS = { minimumWidth: 100, minimumHeight: 100 };
/** Focus that follows a key press this recently is the user's; other focus changes are programmatic. */
const KEYBOARD_FOCUS_WINDOW_MS = 800;

export function expansionKeyForPanel(panelId: string): string {
  if (panelId.startsWith(FILE_PANEL_PREFIX)) return 'file';
  if (panelId.startsWith(SIDE_CHAT_PANEL_PREFIX)) return 'side-chat';
  return panelId;
}

function readEnabled(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

export const usePanelExpansionPreferences = create<{
  enabled: Record<string, boolean>;
  toggle: (key: string) => void;
}>((set, get) => ({
  enabled: readEnabled(),
  toggle: (key) => {
    const enabled = { ...get().enabled };
    if (enabled[key]) delete enabled[key];
    else enabled[key] = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(enabled));
    } catch {
      // The setting still applies for this session.
    }
    set({ enabled });
  },
}));

export function requestPanelExpansionToggle(groupId: string) {
  window.dispatchEvent(new CustomEvent(TOGGLE_PANEL_EXPANSION_EVENT, { detail: { groupId } }));
}

// Content that knows how much wider it wants to be registers here. A measure
// returns the extra width in pixels (0 for none), or null when it cannot tell.
type ContentMeasure = () => number | null;
const contentMeasures = new Map<HTMLElement, ContentMeasure>();

export function usePanelExpansionMeasure(ref: React.RefObject<HTMLElement | null>, measure: ContentMeasure) {
  const latest = React.useRef(measure);
  latest.current = measure;
  const measureLatest = React.useCallback(() => latest.current(), []);
  // No dependencies: a component may render a different root element into the same ref.
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    contentMeasures.set(element, measureLatest);
    return () => {
      contentMeasures.delete(element);
    };
  });
}

function measureContentOverflow(groupElement: HTMLElement): number | null {
  let result: number | null = null;
  for (const [element, measure] of contentMeasures) {
    if (!groupElement.contains(element) || element.getClientRects().length === 0) continue;
    const extra = measure();
    if (extra != null && Number.isFinite(extra)) result = Math.max(result ?? 0, extra);
  }
  return result;
}

/** Columns that fit most non-blank lines, capped so a few very long lines cannot take over the screen. */
export function targetCodeColumns(lineLengths: readonly number[]): number {
  const lengths = lineLengths.filter((length) => length > 0).sort((a, b) => a - b);
  if (!lengths.length) return 0;
  const index = Math.min(lengths.length - 1, Math.max(0, Math.ceil(lengths.length * CODE_LINE_PERCENTILE) - 1));
  return Math.min(lengths[index], EXPANSION_MAX_CODE_COLUMNS);
}

export function visualLineLength(line: string, tabSize: number): number {
  if (!line.includes('\t')) return line.trimEnd().length;
  let column = 0;
  for (const char of line.trimEnd()) column += char === '\t' ? tabSize - (column % tabSize) : 1;
  return column;
}

let measureCanvas: HTMLCanvasElement | null = null;
function characterWidth(element: HTMLElement): number {
  const style = getComputedStyle(element);
  measureCanvas ??= document.createElement('canvas');
  const context = measureCanvas.getContext('2d');
  if (!context) return parseFloat(style.fontSize) * 0.6 || 7;
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return context.measureText('0'.repeat(100)).width / 100;
}

/**
 * Extra width a wrapped diff (react-diff-view) needs so its changed lines stop
 * wrapping. Split diffs have two code columns, so they need it twice.
 */
export function measureDiffOverflowPx(root: HTMLElement): number | null {
  const cells = Array.from(root.querySelectorAll<HTMLElement>('td.diff-code-insert, td.diff-code-delete'))
    .filter((cell) => cell.clientWidth > 0)
    .slice(0, 5000);
  if (!cells.length) return null;
  const sample = cells[0];
  const tabSize = Number(getComputedStyle(sample).tabSize) || 8;
  const columns = targetCodeColumns(cells.map((cell) => visualLineLength(cell.textContent ?? '', tabSize)));
  if (!columns) return 0;
  const style = getComputedStyle(sample);
  const needed = columns * characterWidth(sample) + parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0') + 4;
  const codeColumns = sample.closest('table')?.classList.contains('diff-split') ? 2 : 1;
  return Math.max(0, Math.ceil((needed - sample.clientWidth) * codeColumns));
}

export type ExpansionRect = { left: number; top: number; width: number; height: number };
export type ExpansionPlan = { axis: 'x' | 'y'; rect: ExpansionRect };

/**
 * Where an expanded window goes. With a content measure it only widens, by
 * what the content asked for; otherwise it grows along its thin side to a
 * share of the workspace. It grows toward the side with more room, so the
 * edge nearest the screen edge stays put, and never covers the whole workspace.
 */
export function planPanelExpansion({ slot, workspace, extraWidth }: {
  slot: ExpansionRect;
  workspace: ExpansionRect;
  extraWidth: number | null;
}): ExpansionPlan | null {
  if (slot.width <= 0 || slot.height <= 0 || workspace.width <= 0 || workspace.height <= 0) return null;
  let axis: 'x' | 'y';
  let size: number;
  if (extraWidth != null) {
    axis = 'x';
    size = slot.width + extraWidth;
  } else {
    axis = slot.height / workspace.height < slot.width / workspace.width ? 'y' : 'x';
    const full = axis === 'x' ? workspace.width : workspace.height;
    size = Math.max(axis === 'x' ? slot.width : slot.height, full * EXPANSION_DEFAULT_FRACTION);
  }
  const workspaceStart = axis === 'x' ? workspace.left : workspace.top;
  const workspaceSize = axis === 'x' ? workspace.width : workspace.height;
  const slotStart = axis === 'x' ? slot.left : slot.top;
  const slotSize = axis === 'x' ? slot.width : slot.height;
  size = Math.min(size, workspaceSize - EXPANSION_NEIGHBOUR_STRIP_PX);
  if (size < slotSize + MIN_USEFUL_GROWTH_PX) return null;
  const roomBefore = slotStart - workspaceStart;
  const roomAfter = workspaceStart + workspaceSize - (slotStart + slotSize);
  let start = roomAfter >= roomBefore ? slotStart : slotStart + slotSize - size;
  start = Math.min(Math.max(start, workspaceStart), workspaceStart + workspaceSize - size);
  const rect = axis === 'x'
    ? { left: start, top: slot.top, width: size, height: slot.height }
    : { left: slot.left, top: start, width: slot.width, height: size };
  return { axis, rect: roundRect(rect) };
}

function roundRect(rect: ExpansionRect): ExpansionRect {
  return { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
}

function toRect(rect: DOMRect): ExpansionRect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/** Menus, dialogs and editor popups live outside the window but belong to what you are doing in it. */
function isTransientLayer(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    '[role="menu"], [role="dialog"], [role="listbox"], [data-radix-popper-content-wrapper], .context-view, .monaco-menu-container',
  ));
}

function setOverlay(element: HTMLElement, plan: ExpansionPlan | null) {
  if (!plan) {
    if (!element.hasAttribute('data-dh-expanded')) return;
    element.removeAttribute('data-dh-expanded');
    for (const property of ['position', 'left', 'top', 'width', 'height', 'z-index'] as const) element.style.removeProperty(property);
    return;
  }
  element.setAttribute('data-dh-expanded', plan.axis);
  element.style.position = 'fixed';
  element.style.left = `${plan.rect.left}px`;
  element.style.top = `${plan.rect.top}px`;
  element.style.width = `${plan.rect.width}px`;
  element.style.height = `${plan.rect.height}px`;
  element.style.zIndex = '60';
}

function setKeepSize(element: HTMLElement, plan: ExpansionPlan | null) {
  if (!plan) {
    element.removeAttribute('data-dh-expand-keep');
    element.style.removeProperty('--dh-expand-keep-size');
    return;
  }
  element.setAttribute('data-dh-expand-keep', plan.axis);
  element.style.setProperty('--dh-expand-keep-size', `${plan.axis === 'x' ? plan.rect.width : plan.rect.height}px`);
}

/**
 * Runs expand on focus for one Dockview workspace: expands on a click (on
 * release, so a selection in progress is not pulled out from under the
 * pointer) or keyboard focus, collapses on a click or keyboard focus
 * elsewhere, and keeps the overlay aligned with its slot as the grid changes.
 */
export function useWorkspacePanelExpansion({ apiRef, workspaceRef, readyVersion }: {
  apiRef: React.RefObject<DockviewApi | null>;
  workspaceRef: React.RefObject<HTMLElement | null>;
  readyVersion: number;
}) {
  React.useEffect(() => {
    const api = apiRef.current;
    const root = workspaceRef.current;
    if (!api || !root) return;
    const doc = root.ownerDocument;
    const win = doc.defaultView ?? window;
    let enabled = usePanelExpansionPreferences.getState().enabled;
    let expanded: { group: DockviewGroupPanel; pinned: boolean; extraWidth: number | null } | null = null;
    let pending: DockviewGroupPanel | null = null;
    let pointerDown = false;
    let lastKeyAt = -Infinity;
    const compacted = new Set<DockviewGroupPanel>();
    const styled = new Set<DockviewGroupPanel>();

    const gridGroups = () => api.groups.filter((group) => group.api.location.type === 'grid' && group.panels.length > 0);
    const groupOf = (target: EventTarget | null) =>
      target instanceof Node ? gridGroups().find((group) => group.element.contains(target)) ?? null : null;
    const keyOf = (group: DockviewGroupPanel) => {
      const id = group.activePanel?.id;
      return id ? expansionKeyForPanel(id) : null;
    };
    const enabledFor = (group: DockviewGroupPanel) => {
      const key = keyOf(group);
      return Boolean(key && enabled[key]);
    };
    const plan = (group: DockviewGroupPanel, extraWidth: number | null) => planPanelExpansion({
      // The group's parent is its slot in the grid, which keeps its size while the group floats over it.
      slot: toRect((group.element.parentElement ?? group.element).getBoundingClientRect()),
      workspace: toRect(root.getBoundingClientRect()),
      extraWidth,
    });

    const apply = () => {
      const groups = gridGroups();
      if (expanded && !groups.includes(expanded.group)) expanded = null;
      if (expanded && !expanded.pinned && !enabledFor(expanded.group)) expanded = null;
      for (const group of styled) {
        if (groups.includes(group)) continue;
        setOverlay(group.element, null);
        setKeepSize(group.element, null);
        styled.delete(group);
      }
      for (const group of groups) {
        const isExpanded = expanded?.group === group;
        const on = enabledFor(group);
        const overlay = isExpanded ? plan(group, expanded!.extraWidth) : null;
        const keep = !isExpanded && on && KEEP_SIZE_KEYS.has(keyOf(group) ?? '') ? plan(group, null) : null;
        setOverlay(group.element, overlay);
        setKeepSize(group.element, keep);
        if (overlay || keep) styled.add(group);
        else styled.delete(group);
        if (on && !compacted.has(group)) {
          compacted.add(group);
          group.api.setConstraints(COMPACT_GROUP_CONSTRAINTS);
        } else if (!on && compacted.has(group)) {
          compacted.delete(group);
          group.api.setConstraints(OCCUPIED_GROUP_CONSTRAINTS);
        }
      }
    };

    const expand = (group: DockviewGroupPanel, pinned: boolean) => {
      // Measured once from the docked size; once wider, the content no longer asks for more.
      const extraWidth = measureContentOverflow(group.element);
      if (!plan(group, extraWidth)) return;
      expanded = { group, pinned, extraWidth };
      apply();
    };
    const collapse = () => {
      if (!expanded) return;
      expanded = null;
      apply();
    };
    const collapseFor = (target: EventTarget | null, group: DockviewGroupPanel | null) => {
      if (expanded && !expanded.pinned && group !== expanded.group && !isTransientLayer(target)) collapse();
    };

    const onPointerDown = (event: PointerEvent) => {
      pointerDown = true;
      const group = groupOf(event.target);
      collapseFor(event.target, group);
      pending = group && group !== expanded?.group ? group : null;
    };
    const onPointerUp = () => {
      pointerDown = false;
      const group = pending;
      pending = null;
      if (group && gridGroups().includes(group) && enabledFor(group)) expand(group, false);
    };
    const onDragStart = () => {
      pending = null;
      collapse();
    };
    const onKeyDown = () => {
      lastKeyAt = performance.now();
    };
    const onFocusIn = (event: FocusEvent) => {
      // Windows focus themselves on mount (a terminal does on every drone switch); only the user's focus counts.
      if (pointerDown || performance.now() - lastKeyAt > KEYBOARD_FOCUS_WINDOW_MS) return;
      const group = groupOf(event.target);
      collapseFor(event.target, group);
      if (group && group !== expanded?.group && enabledFor(group)) expand(group, false);
    };
    const onToggle = (event: Event) => {
      const groupId = (event as CustomEvent<{ groupId?: string }>).detail?.groupId;
      const group = gridGroups().find((item) => item.id === groupId);
      if (!group) return;
      if (expanded?.group === group && expanded.pinned) collapse();
      else expand(group, true);
    };

    doc.addEventListener('pointerdown', onPointerDown, true);
    win.addEventListener('pointerup', onPointerUp, true);
    win.addEventListener('pointercancel', onPointerUp, true);
    doc.addEventListener('dragstart', onDragStart, true);
    doc.addEventListener('keydown', onKeyDown, true);
    doc.addEventListener('focusin', onFocusIn, true);
    win.addEventListener('resize', apply);
    win.addEventListener(TOGGLE_PANEL_EXPANSION_EVENT, onToggle);
    const layout = api.onDidLayoutChange(apply);
    const active = api.onDidActivePanelChange(apply);
    const unsubscribe = usePanelExpansionPreferences.subscribe((state) => {
      enabled = state.enabled;
      apply();
    });
    apply();
    return () => {
      doc.removeEventListener('pointerdown', onPointerDown, true);
      win.removeEventListener('pointerup', onPointerUp, true);
      win.removeEventListener('pointercancel', onPointerUp, true);
      doc.removeEventListener('dragstart', onDragStart, true);
      doc.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('focusin', onFocusIn, true);
      win.removeEventListener('resize', apply);
      win.removeEventListener(TOGGLE_PANEL_EXPANSION_EVENT, onToggle);
      layout.dispose();
      active.dispose();
      unsubscribe();
      for (const group of styled) {
        setOverlay(group.element, null);
        setKeepSize(group.element, null);
      }
      for (const group of compacted) {
        if (api.groups.includes(group)) group.api.setConstraints(OCCUPIED_GROUP_CONSTRAINTS);
      }
    };
  }, [apiRef, workspaceRef, readyVersion]);
}
