import { expect, test } from 'bun:test';
import { desktopNotificationPayload } from '../src/droneHub/app/desktop-notification-presentation';

const settings = { enabled: true, finished: true, failed: true, messages: false, eventNames: 'chat_message\nreview.ready', sound: false };
const event = { id: 'event', droneId: 'id', droneName: 'Reviewer', chatName: 'checks', kind: 'finished' };

test('consistent completion and failure titles, exact navigation target, no transcript leakage', () => {
  for (const kind of ['finished', 'failed']) {
    expect(desktopNotificationPayload({ ...event, kind, body: 'private run output' }, settings)).toEqual({
      name: 'Reviewer', kind, durationSeconds: 8,
      title: `Reviewer ${kind}`, body: 'Chat: checks\nClick to open in Drone Hub.', silent: true,
      target: { droneId: 'id', chatName: 'checks' },
    });
  }
});
test('respects each preference and matches only selected custom names', () => {
  expect(desktopNotificationPayload(event, { ...settings, enabled: false })).toBeNull();
  expect(desktopNotificationPayload(event, { ...settings, finished: false })).toBeNull();
  expect(desktopNotificationPayload({ ...event, kind: 'failed' }, { ...settings, failed: false })).toBeNull();
  const message = { ...event, kind: 'message', eventName: 'chat_message', body: 'Ready for review' };
  expect(desktopNotificationPayload(message, settings)).toBeNull();
  expect(desktopNotificationPayload(message, { ...settings, messages: true, sound: true })).toMatchObject({ title: 'Reviewer sent a message', body: 'Ready for review', silent: false });
  expect(desktopNotificationPayload({ ...message, eventName: 'chat_message.other' }, { ...settings, messages: true })).toBeNull();
  expect(desktopNotificationPayload(message, { ...settings, messages: true, eventNames: '' })).toBeNull();
});
test('rejects invalid events and bounds native notification text', () => {
  expect(desktopNotificationPayload(null, settings)).toBeNull();
  expect(desktopNotificationPayload({ ...event, kind: 'unknown' }, settings)).toBeNull();
  expect(desktopNotificationPayload({ ...event, droneId: 7 }, settings)).toBeNull();
  expect(desktopNotificationPayload({ ...event, droneName: 'x'.repeat(1000) }, settings)?.title.length).toBeLessThan(250);
});
