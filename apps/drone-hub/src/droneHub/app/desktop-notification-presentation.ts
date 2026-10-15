export type DesktopNotificationPreferences = {
  enabled: boolean;
  finished: boolean;
  failed: boolean;
  messages: boolean;
  /** An agent chat @mentioned the user, or replied to the user, in a channel. */
  channelMentions?: boolean;
  eventNames: string;
  sound: boolean;
  durationSeconds?: number;
};

export function desktopNotificationPayload(data: unknown, settings: DesktopNotificationPreferences) {
  if (!settings.enabled || !data || typeof data !== 'object') return null;
  const event = data as Record<string, unknown>;
  if (typeof event.id !== 'string' || !event.id || typeof event.droneId !== 'string' || !event.droneId ||
      typeof event.chatName !== 'string' || !event.chatName) return null;
  if (event.kind === 'finished') {
    if (!settings.finished) return null;
  } else if (event.kind === 'failed') {
    if (!settings.failed) return null;
  } else if (event.kind === 'message') {
    const names = settings.eventNames.split(/[\n,]/).map((name) => name.trim()).filter(Boolean);
    if (!settings.messages || typeof event.eventName !== 'string' || !names.includes(event.eventName)) return null;
  } else if (event.kind === 'channel_mention') {
    if (settings.channelMentions === false || typeof event.channelId !== 'string' || !event.channelId) return null;
    const chat = (event.chatName === 'default' ? String(event.droneName || event.droneId) : String(event.chatName)).slice(0, 120);
    return {
      name: chat,
      kind: event.kind,
      durationSeconds: settings.durationSeconds ?? 8,
      title: `${chat} mentioned you in #${String(event.channelName || 'channel').slice(0, 80)}`,
      body: String(event.body || '').slice(0, 500),
      silent: !settings.sound,
      target: { droneId: event.droneId, chatName: event.chatName, channelId: event.channelId },
    };
  } else return null;
  const name = String(event.droneName || event.droneId).slice(0, 180);
  return {
    name,
    kind: event.kind,
    durationSeconds: settings.durationSeconds ?? 8,
    title: `${name} ${event.kind === 'message' ? 'sent a message' : event.kind}`,
    body: (event.kind === 'message' ? String(event.body || event.eventName) : `Chat: ${event.chatName}\nClick to open in Drone Hub.`).slice(0, 500),
    silent: !settings.sound,
    target: { droneId: event.droneId, chatName: event.chatName },
  };
}
