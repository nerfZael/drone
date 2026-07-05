function cleanString(value: unknown, fallback = ''): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function cleanIsoTimestamp(value: unknown): string | null {
  const text = cleanString(value);
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function droneStatusSummary(drone: any): string | null {
  const hubPhase = cleanString(drone?.hubPhase);
  const hubMessage = cleanString(drone?.hubMessage);
  if (hubPhase) return hubMessage ? `${hubPhase}: ${hubMessage}` : hubPhase;
  const statusError = cleanString(drone?.statusError);
  if (statusError) return `offline: ${statusError}`;
  if (drone?.busy === true || (Array.isArray(drone?.busyChats) && drone.busyChats.length > 0)) return 'busy';
  const phase = cleanString(drone?.phase);
  if (phase) return phase;
  if (typeof drone?.status === 'string') return cleanString(drone.status) || null;
  if (typeof drone?.statusOk === 'boolean') return drone.statusOk ? 'ready' : 'offline';
  return null;
}

export function droneSummary(drone: any) {
  return {
    id: cleanString(drone?.id),
    name: cleanString(drone?.name),
    group: cleanString(drone?.group) || null,
    runtime: cleanString(drone?.runtime, 'container'),
    repoPath: cleanString(drone?.repoPath) || null,
    cwd: cleanString(drone?.cwd) || null,
    status: droneStatusSummary(drone),
    createdAt: cleanIsoTimestamp(drone?.createdAt),
    lastActivityAt: cleanIsoTimestamp(drone?.lastActivityAt),
    lastMessageAt: cleanIsoTimestamp(drone?.lastMessageAt),
    lastActivityChat: cleanString(drone?.lastActivityChat) || null,
  };
}