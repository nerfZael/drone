export const SIDEBAR_GROUP_DRAFT_REQUEST_EVENT = 'drone-hub:sidebar-group-draft-request';

type SidebarGroupDraftRequestDetail = {
  handled: boolean;
};

export function requestSidebarGroupDraft(): boolean {
  if (typeof window === 'undefined') return false;
  const detail: SidebarGroupDraftRequestDetail = { handled: false };
  window.dispatchEvent(
    new CustomEvent<SidebarGroupDraftRequestDetail>(SIDEBAR_GROUP_DRAFT_REQUEST_EVENT, {
      detail,
      cancelable: true,
    }),
  );
  return detail.handled;
}

export function markSidebarGroupDraftRequestHandled(event: Event): void {
  const detail = (event as CustomEvent<SidebarGroupDraftRequestDetail>).detail;
  if (detail) detail.handled = true;
  event.preventDefault();
}
