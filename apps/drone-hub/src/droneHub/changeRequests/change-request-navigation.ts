export const OPEN_CHANGE_REQUEST_EVENT = 'droneHub:changeRequests:open';

export type OpenChangeRequestDetail = {
  droneId: string;
  requestNumber: number;
};

const pendingRequestByDrone = new Map<string, number>();

export function requestOpenChangeRequest(detail: OpenChangeRequestDetail): void {
  const droneId = String(detail.droneId ?? '').trim();
  const requestNumber = Math.floor(Number(detail.requestNumber));
  if (!droneId || !Number.isSafeInteger(requestNumber) || requestNumber <= 0) return;

  const normalized = { droneId, requestNumber };
  pendingRequestByDrone.set(droneId, requestNumber);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<OpenChangeRequestDetail>(OPEN_CHANGE_REQUEST_EVENT, {
      detail: normalized,
    }),
  );
}

export function consumeRequestedChangeRequest(droneIdRaw: string): number | null {
  const droneId = String(droneIdRaw ?? '').trim();
  const requestNumber = pendingRequestByDrone.get(droneId) ?? null;
  pendingRequestByDrone.delete(droneId);
  return requestNumber;
}
