import React from 'react';
import { useDroneHubUiStore } from '../droneHub/app/use-drone-hub-ui-store';
import type { DroneSummary } from '../droneHub/types';
import { RemoteHubSidebar } from './RemoteHubSidebar';

type RemoteMobileSidebarDrawerProps = {
  open: boolean;
  drones: DroneSummary[];
  selectedDroneId: string | null;
  activeChatName: string;
  onOpenChange: (open: boolean) => void;
  onSelectDrone: (droneId: string) => void;
  onSelectChat: (chatName: string) => void;
};

type TouchPoint = {
  x: number;
  y: number;
};

const SWIPE_DISTANCE_PX = 56;
const SWIPE_VERTICAL_TOLERANCE_PX = 72;

function touchPoint(touch: React.Touch): TouchPoint {
  return { x: touch.clientX, y: touch.clientY };
}

function isHorizontalSwipe(start: TouchPoint | null, end: TouchPoint, direction: 'left' | 'right'): boolean {
  if (!start) return false;
  const deltaX = end.x - start.x;
  const deltaY = Math.abs(end.y - start.y);
  if (deltaY > SWIPE_VERTICAL_TOLERANCE_PX) return false;
  return direction === 'right' ? deltaX >= SWIPE_DISTANCE_PX : deltaX <= -SWIPE_DISTANCE_PX;
}

export function RemoteMobileSidebarDrawer({
  open,
  drones,
  selectedDroneId,
  activeChatName,
  onOpenChange,
  onSelectDrone,
  onSelectChat,
}: RemoteMobileSidebarDrawerProps) {
  const setSidebarCollapsed = useDroneHubUiStore((state) => state.setSidebarCollapsed);
  const drawerSwipeStartRef = React.useRef<TouchPoint | null>(null);

  React.useEffect(() => {
    if (open) setSidebarCollapsed(false);
  }, [open, setSidebarCollapsed]);

  const beginDrawerSwipe = React.useCallback((event: React.TouchEvent) => {
    const touch = event.touches[0];
    drawerSwipeStartRef.current = touch ? touchPoint(touch) : null;
  }, []);

  const endDrawerSwipe = React.useCallback(
    (event: React.TouchEvent) => {
      const touch = event.changedTouches[0];
      if (touch && isHorizontalSwipe(drawerSwipeStartRef.current, touchPoint(touch), 'left')) {
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
          className={`absolute inset-y-0 left-0 flex overflow-hidden shadow-[18px_0_60px_rgba(0,0,0,.36)] transition-transform duration-200 ease-out ${
            open ? 'translate-x-0' : '-translate-x-full'
          }`}
          style={{
            width: 'min(88vw, 320px)',
            maxWidth: 'calc(100vw - 44px)',
            touchAction: 'pan-y',
            overscrollBehavior: 'contain',
          }}
          onTouchStart={beginDrawerSwipe}
          onTouchEnd={endDrawerSwipe}
          onTouchCancel={() => {
            drawerSwipeStartRef.current = null;
          }}
        >
          <RemoteHubSidebar
            drones={drones}
            selectedDroneId={selectedDroneId}
            activeChatName={activeChatName}
            onSelectDrone={selectDrone}
            onSelectChat={selectChat}
          />
        </div>
      </div>
    </div>
  );
}
