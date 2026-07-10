import React from 'react';
import { useDroneHubUiStore } from '../droneHub/app/use-drone-hub-ui-store';
import type { DroneSummary } from '../droneHub/types';
import { RemoteHubSidebar } from './RemoteHubSidebar';

type RemoteMobileSidebarDrawerProps = {
  open: boolean;
  drones: DroneSummary[];
  selectedDroneId: string | null;
  activeChatName: string;
  unreadAgentMessageByChatNodeId: Record<string, boolean>;
  onOpenChange: (open: boolean) => void;
  onSelectDrone: (droneId: string) => void;
  onSelectChat: (chatName: string) => void;
  onOpenCreateDrone: () => void;
};

type TouchPoint = {
  x: number;
  y: number;
};

const SWIPE_DISTANCE_PX = 56;
const SWIPE_VERTICAL_TOLERANCE_PX = 72;

function pointerPoint(event: React.PointerEvent): TouchPoint {
  return { x: event.clientX, y: event.clientY };
}

function isHorizontalSwipe(start: TouchPoint | null, end: TouchPoint, direction: 'left' | 'right'): boolean {
  if (!start) return false;
  const deltaX = end.x - start.x;
  const deltaY = Math.abs(end.y - start.y);
  if (deltaY > SWIPE_VERTICAL_TOLERANCE_PX) return false;
  return direction === 'right' ? deltaX >= SWIPE_DISTANCE_PX : deltaX <= -SWIPE_DISTANCE_PX;
}

function RemoteMobileSidebarDrawerComponent({
  open,
  drones,
  selectedDroneId,
  activeChatName,
  unreadAgentMessageByChatNodeId,
  onOpenChange,
  onSelectDrone,
  onSelectChat,
  onOpenCreateDrone,
}: RemoteMobileSidebarDrawerProps) {
  const setSidebarCollapsed = useDroneHubUiStore((state) => state.setSidebarCollapsed);
  const drawerSwipeStartRef = React.useRef<TouchPoint | null>(null);

  React.useEffect(() => {
    if (open) setSidebarCollapsed(false);
  }, [open, setSidebarCollapsed]);

  const beginDrawerPointerSwipe = React.useCallback((event: React.PointerEvent) => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') {
      drawerSwipeStartRef.current = null;
      return;
    }
    drawerSwipeStartRef.current = pointerPoint(event);
  }, []);

  const endDrawerPointerSwipe = React.useCallback(
    (event: React.PointerEvent) => {
      if ((event.pointerType === 'touch' || event.pointerType === 'pen') && isHorizontalSwipe(drawerSwipeStartRef.current, pointerPoint(event), 'left')) {
        onOpenChange(false);
      }
      drawerSwipeStartRef.current = null;
    },
    [onOpenChange],
  );

  const selectDrone = React.useCallback(
    (droneId: string) => {
      onSelectDrone(droneId);
      const drone = drones.find((item) => item.id === droneId);
      const chats = Array.isArray(drone?.chats) && drone.chats.length > 0 ? drone.chats : ['default'];
      if (chats.length <= 1) onOpenChange(false);
    },
    [drones, onOpenChange, onSelectDrone],
  );

  const selectChat = React.useCallback(
    (chatName: string) => {
      onSelectChat(chatName);
      onOpenChange(false);
    },
    [onOpenChange, onSelectChat],
  );

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
          aria-label="Close sidebar"
          onClick={() => onOpenChange(false)}
        />
        <div
          className="absolute inset-y-0 left-0 flex overflow-hidden shadow-[18px_0_60px_rgba(0,0,0,.36)] transition-transform duration-200 ease-out"
          style={{
            width: '100vw',
            maxWidth: '100vw',
            touchAction: 'pan-y',
            overscrollBehavior: 'contain',
            transform: open ? 'none' : 'translate3d(-100%, 0, 0)',
          }}
          onPointerDown={beginDrawerPointerSwipe}
          onPointerUp={endDrawerPointerSwipe}
          onPointerCancel={() => {
            drawerSwipeStartRef.current = null;
          }}
        >
          <RemoteHubSidebar
            drones={drones}
            selectedDroneId={selectedDroneId}
            activeChatName={activeChatName}
            unreadAgentMessageByChatNodeId={unreadAgentMessageByChatNodeId}
            onSelectDrone={selectDrone}
            onSelectChat={selectChat}
            onOpenCreateDrone={onOpenCreateDrone}
            fillContainer={true}
          />
        </div>
      </div>
    </div>
  );
}

export const RemoteMobileSidebarDrawer = React.memo(RemoteMobileSidebarDrawerComponent);
