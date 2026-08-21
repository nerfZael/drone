export const SIDEBAR_ROOT_DRONE_DRAFT_REQUEST_EVENT =
  'drone-hub:sidebar-root-drone-draft-request';

type SidebarRootDroneDraftRequestDetail = {
  handled: boolean;
};

export function requestSidebarRootDroneDraft(): boolean {
  if (typeof window === 'undefined') return false;
  const detail: SidebarRootDroneDraftRequestDetail = { handled: false };
  window.dispatchEvent(
    new CustomEvent<SidebarRootDroneDraftRequestDetail>(
      SIDEBAR_ROOT_DRONE_DRAFT_REQUEST_EVENT,
      { detail, cancelable: true },
    ),
  );
  return detail.handled;
}

export function markSidebarRootDroneDraftRequestHandled(event: Event): void {
  const detail = (event as CustomEvent<SidebarRootDroneDraftRequestDetail>).detail;
  if (detail) detail.handled = true;
  event.preventDefault();
}
