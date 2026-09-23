import React from 'react';
import type { DroneSummary } from '../types';
import type { RightPanelTab } from './app-config';
import { desktopPaneKey, type PaneKey } from './pane-key';
import type { DroneChatsPaneOptions } from './DroneChatsDock';
import { DesktopChatWindow } from './DesktopChatWindow';
import { DetachedChatContent, type DetachedChatWindowsProps } from './DetachedChatWindows';
import { DesktopEditorPane } from './DesktopEditorPane';
import { useDesktopToolWindows, type DesktopToolWindow } from './desktop-tool-windows';
import { desktopToolWindowLabel } from './DockTabShell';
import { dispatchAssistantOpenDroneChat } from '../assistant/open-drone-chat-event';
import { IconPin } from '../overview/icons';
import { UiPaneState } from '../../ui/components';

export type DesktopToolWindowsProps = {
  droneById: Record<string, DroneSummary>;
  currentDrone: DroneSummary | null;
  renderToolPane: (drone: DroneSummary, tab: RightPanelTab, paneKey: PaneKey, chatsPaneOptions?: DroneChatsPaneOptions) => React.ReactNode;
  chatContext: Omit<DetachedChatWindowsProps, 'visible' | 'currentDroneId'>;
};

/** The OS title bar names the tool and, once pinned, says so. */
export function desktopToolWindowTitle(label: string, droneName: string | null, pinned: boolean): string {
  if (!droneName) return label;
  return pinned ? `${label} (${droneName}) · pinned` : `${droneName} · ${label}`;
}

export function desktopToolPinTooltip(droneName: string, pinned: boolean): string {
  return pinned
    ? `Pinned to ${droneName}. This window keeps showing ${droneName} while you work in other drones; unpin to follow the selected drone again.`
    : `Pin to ${droneName}. The window then keeps showing ${droneName} when you select another drone in the Hub.`;
}

function DesktopToolWindowBar({ label, drone, pinned, onTogglePin }: {
  label: string; drone: DroneSummary | null; pinned: boolean; onTogglePin: () => void;
}) {
  // A pinned drone that was deleted still needs the pin, or the window could never follow the selection again.
  const droneName = drone?.name ?? (pinned ? 'a deleted drone' : '');
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--panel-alt)] px-2 text-12" data-desktop-tool-bar="">
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-[var(--fg)]">{label}</span>
        {drone ? (
          <span className="text-[var(--muted)]" data-desktop-tool-drone={drone.id}>
            {pinned ? ` (${droneName})` : ` · ${droneName}`}
          </span>
        ) : null}
      </span>
      {drone || pinned ? (
        <button
          type="button"
          className="dh-dock-tab-button"
          data-desktop-tool-pin=""
          aria-pressed={pinned}
          title={desktopToolPinTooltip(droneName, pinned)}
          aria-label={pinned ? `Unpin from ${droneName}` : `Pin to ${droneName}`}
          onClick={onTogglePin}
        >
          <IconPin filled={pinned} />
        </button>
      ) : null}
    </div>
  );
}

function DesktopToolWindowView({ window: item, props }: { window: DesktopToolWindow; props: DesktopToolWindowsProps }) {
  const { droneById, currentDrone, renderToolPane, chatContext } = props;
  const pinned = Boolean(item.pinnedDroneId);
  // A pinned window shows its drone even after the Hub selects another one;
  // a pinned drone that disappears leaves the window empty rather than jumping.
  const drone = pinned ? (droneById[item.pinnedDroneId!] ?? null) : currentDrone;
  const label = desktopToolWindowLabel(item.tab);
  const paneKey = desktopPaneKey(item.id);
  const currentDroneId = currentDrone?.id ?? null;
  const togglePin = () => {
    useDesktopToolWindows.getState().setPinnedDrone(item.id, pinned ? null : (drone?.id ?? null));
  };
  let content: React.ReactNode;
  if (!drone) {
    content = <UiPaneState kind="empty" title={pinned ? 'The pinned drone is gone.' : `Select a drone to show its ${label.toLowerCase()} here.`} />;
  } else if (item.tab === 'editor') {
    content = <DesktopEditorPane key={drone.id} drone={drone} currentDroneId={currentDroneId} paneKey={paneKey} />;
  } else {
    const chatsPaneOptions: DroneChatsPaneOptions | undefined = item.tab === 'chats' ? {
      sideChatNames: (drone.sideChats ?? []).map((chat) => chat.name),
      onSelectChat: (chatName) => dispatchAssistantOpenDroneChat(drone.id, chatName),
      renderChat: (chatName) => (
        <DetachedChatContent key={chatName} desktop chat={{ droneId: drone.id, chatName, open: true }} drone={drone}
          context={{ ...chatContext, currentDroneId, visible: true }} />
      ),
    } : undefined;
    content = <React.Fragment key={drone.id}>{renderToolPane(drone, item.tab, paneKey, chatsPaneOptions)}</React.Fragment>;
  }
  return (
    <DesktopChatWindow kind="tool" chatKey={item.id} title={desktopToolWindowTitle(label, drone?.name ?? null, pinned)}
      request={item.request} onClose={() => useDesktopToolWindows.getState().close(item.id)}>
      <DesktopToolWindowBar label={label} drone={drone} pinned={pinned} onTogglePin={togglePin} />
      <div className="relative min-h-0 flex-1" data-desktop-tool-content={item.tab}>{content}</div>
    </DesktopChatWindow>
  );
}

/** Tool panes (editor, changes, terminal, ...) that live in desktop windows of their own. */
export function DesktopToolWindows(props: DesktopToolWindowsProps) {
  const windows = useDesktopToolWindows((state) => state.windows);
  return <>{Object.values(windows).map((item) => <DesktopToolWindowView key={item.id} window={item} props={props} />)}</>;
}
