import React from 'react';
import { IconChevron, IconSidebarExpand } from '../droneHub/app/icons';
import type { DroneSummary } from '../droneHub/types';
import { UiMenuSelect } from '../ui/menuSelect';
import { RemoteRepoPanel } from './RemoteRepoPanels';
import type { RemoteRepoPanelKey } from './remote-repo-panel-config';

type RemoteMobileToolDrawerProps = {
  open: boolean;
  drone: DroneSummary | null;
  onOpenChange: (open: boolean) => void;
  onOpenFile: (target: { path: string; name: string }) => void;
  openedFilePath?: string | null;
  editorOpenNonce: number;
  editor: React.ReactNode;
};

type RemoteMobilePanelKey = RemoteRepoPanelKey | 'editor';

const REMOTE_MOBILE_PANEL_ENTRIES: Array<{ value: RemoteMobilePanelKey; label: string }> = [
  { value: 'files', label: 'Files' },
  { value: 'editor', label: 'Editor' },
  { value: 'changes', label: 'Changes' },
  { value: 'prs', label: 'PRs' },
  { value: 'assistant', label: 'Assistant' },
];

type TouchPoint = {
  x: number;
  y: number;
};

const SWIPE_DISTANCE_PX = 56;
const SWIPE_VERTICAL_TOLERANCE_PX = 72;

function pointerPoint(event: React.PointerEvent): TouchPoint {
  return { x: event.clientX, y: event.clientY };
}

function isSwipeRight(start: TouchPoint | null, end: TouchPoint): boolean {
  if (!start) return false;
  const deltaX = end.x - start.x;
  const deltaY = Math.abs(end.y - start.y);
  return deltaX >= SWIPE_DISTANCE_PX && deltaY <= SWIPE_VERTICAL_TOLERANCE_PX;
}

function RemoteMobileToolDrawerComponent({ open, drone, onOpenChange, onOpenFile, openedFilePath, editorOpenNonce, editor }: RemoteMobileToolDrawerProps) {
  const [activePanel, setActivePanel] = React.useState<RemoteMobilePanelKey>('changes');
  const drawerSwipeStartRef = React.useRef<TouchPoint | null>(null);

  const beginDrawerPointerSwipe = React.useCallback((event: React.PointerEvent) => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') {
      drawerSwipeStartRef.current = null;
      return;
    }
    drawerSwipeStartRef.current = pointerPoint(event);
  }, []);

  const endDrawerPointerSwipe = React.useCallback(
    (event: React.PointerEvent) => {
      if ((event.pointerType === 'touch' || event.pointerType === 'pen') && isSwipeRight(drawerSwipeStartRef.current, pointerPoint(event))) {
        onOpenChange(false);
      }
      drawerSwipeStartRef.current = null;
    },
    [onOpenChange],
  );

  React.useEffect(() => {
    if (open && !drone) onOpenChange(false);
  }, [drone, onOpenChange, open]);

  React.useEffect(() => {
    if (editorOpenNonce > 0) setActivePanel('editor');
  }, [editorOpenNonce]);

  return (
    <div className="md:hidden">
      <div
        className={`fixed inset-0 z-50 transition-opacity duration-200 ${
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/45"
          aria-label="Close tools"
          onClick={() => onOpenChange(false)}
        />
        <div
          className="absolute inset-y-0 right-0 flex min-w-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--panel-alt)] shadow-[-18px_0_60px_rgba(0,0,0,.36)] transition-transform duration-200 ease-out"
          style={{
            width: '100vw',
            maxWidth: '100vw',
            touchAction: 'pan-y',
            overscrollBehavior: 'contain',
            transform: open ? 'none' : 'translate3d(100%, 0, 0)',
          }}
          onPointerDown={beginDrawerPointerSwipe}
          onPointerUp={endDrawerPointerSwipe}
          onPointerCancel={() => {
            drawerSwipeStartRef.current = null;
          }}
        >
          <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--panel)] px-3">
            <div className="min-w-0 flex-1">
              <UiMenuSelect
                value={activePanel}
                onValueChange={(next) => {
                  if (next === 'files' || next === 'editor' || next === 'changes' || next === 'prs' || next === 'assistant') {
                    setActivePanel(next);
                  }
                }}
                entries={REMOTE_MOBILE_PANEL_ENTRIES}
                variant="toolbar"
                triggerClassName="h-8 w-full justify-between bg-[rgba(255,255,255,.03)] text-[12px] text-[var(--fg-secondary)]"
                panelClassName="left-0 right-0"
                chevron={(menuOpen) => <IconChevron down={!menuOpen} className="flex-shrink-0 text-[var(--muted-dim)] opacity-70" />}
              />
            </div>
            <button
              type="button"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted)] transition-colors hover:border-[var(--border)] hover:text-[var(--fg-secondary)]"
              aria-label="Close tools"
              title="Close tools"
              onClick={() => onOpenChange(false)}
            >
              <IconSidebarExpand className="h-3.5 w-3.5" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-hidden">
            {open && drone ? (
              <React.Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    Loading {activePanel === 'prs' ? 'PRs' : activePanel}...
                  </div>
                }
              >
                {activePanel === 'editor' ? editor : (
                  <RemoteRepoPanel
                    drone={drone}
                    panel={activePanel}
                    compactChanges
                    onOpenFile={onOpenFile}
                    openedFilePath={openedFilePath}
                  />
                )}
              </React.Suspense>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export const RemoteMobileToolDrawer = React.memo(RemoteMobileToolDrawerComponent);
