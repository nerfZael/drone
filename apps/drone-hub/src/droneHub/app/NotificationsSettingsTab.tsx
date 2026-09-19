import { desktopNotificationSupport } from './desktop-notification-support';
import React from 'react';
import { UiToolbarButton } from '../../ui/components';
import { useDesktopNotificationSettings } from './desktop-notification-settings';
import { SettingsSection } from './SettingsSurface';

export function NotificationsSettingsTab() {
  const settings = useDesktopNotificationSettings();
  const [supported, setSupported] = React.useState<'cards' | 'outdated' | 'browser' | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [tested, setTested] = React.useState(false);
  React.useEffect(() => {
    let disposed = false;
    void desktopNotificationSupport().then((value) => { if (!disposed) setSupported(value); });
    return () => { disposed = true; };
  }, [settings.setError]);
  const disabled = supported !== 'cards';
  return (
    <SettingsSection title="Desktop notifications" description="Show notifications outside Drone Hub, including while minimized. Preferences apply to this app and profile. Drone Hub must remain running and connected; past events are not replayed on startup or reconnect.">
      {supported === null && <p role="status">Checking desktop notification support…</p>}
      {supported === 'browser' && <p role="status">Desktop notifications require the Drone Hub desktop app.</p>}
      {supported === 'outdated' && <p role="alert">This desktop process cannot show the new notification cards. Update Drone Hub, then fully quit and reopen the desktop app. Reloading the page or restarting only the Hub server is not enough. Notifications are paused to prevent the old OS alerts.</p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={disabled} checked={settings.enabled} onChange={(e) => settings.update({ enabled: e.target.checked })} />
        Enable desktop notifications
      </label>
      <p className="text-sm text-[var(--muted)]">Turning notifications off stops new alerts and clears visible and queued cards. Dismiss any card with its × button, or click it to open the chat.</p>
      <fieldset disabled={disabled || !settings.enabled} className="flex flex-col gap-3 text-sm disabled:opacity-50">
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.finished} onChange={(e) => settings.update({ finished: e.target.checked })} />Drone finished</label>
        <p className="text-[var(--muted)]">When a chat finishes its work. Clicking opens that drone and chat.</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.failed} onChange={(e) => settings.update({ failed: e.target.checked })} />Drone failed</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.messages} onChange={(e) => settings.update({ messages: e.target.checked })} />Chat messages from custom events</label>
        <p className="text-[var(--muted)]">Let agents or custom subscriptions announce selected messages by emitting one of the event names below with a text field named message. This does not notify for every assistant reply or start another agent run.</p>
        <label className="flex flex-col gap-1">Custom event names (canonical names, one per line)
          <textarea disabled={!settings.messages} rows={3} value={settings.eventNames} onChange={(e) => settings.update({ eventNames: e.target.value })} className="rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[var(--fg)] disabled:opacity-50" />
        </label>
        {settings.messages && !settings.eventNames.trim() && <p role="status">Add an event name to receive chat message notifications.</p>}
        <p className="text-[var(--muted)]">Example: emit chat_message with data {`{"message":"Ready for your review"}`}. Clicking opens the emitting chat. Message previews are visible to anyone viewing your desktop.</p>
        <label className="flex flex-col gap-1">Keep notifications visible
          <select value={settings.durationSeconds ?? 8} onChange={(e) => settings.update({ durationSeconds: Number(e.target.value) })} className="rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--panel)] px-3 py-2">
            <option value={5}>5 seconds</option><option value={8}>8 seconds</option><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={0}>Until dismissed</option>
          </select>
        </label>
        <p className="text-[var(--muted)]">Timers pause while hovering over or focusing a card. Duration changes apply to new notifications. Up to three cards appear at once; up to 50 more wait in a queue, with the oldest queued card dropped if it fills.</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.sound} onChange={(e) => settings.update({ sound: e.target.checked })} />Play notification sound</label>
      </fieldset>
      <p className="text-sm text-[var(--muted)]">These are Drone Hub windows, not OS notifications. They do not appear in the system notification center or automatically follow Do Not Disturb. Use the switch above when you want quiet.</p>
      <div><UiToolbarButton disabled={disabled || testing || !settings.enabled} onClick={async () => {
        settings.setError(null);
        setTesting(true);
        setTested(false);
        try {
          await window.droneHubDesktop?.showNotification?.({ title: 'Drone Hub notifications', body: 'This is a test notification from Drone Hub.', silent: !settings.sound, durationSeconds: settings.durationSeconds ?? 8 });
          setTested(true);
        } catch (error: any) { settings.setError(String(error?.message || error)); }
        finally { setTesting(false); }
      }}>{testing ? 'Sending…' : 'Send test notification'}</UiToolbarButton></div>
      {tested && !settings.error && <p role="status">Test card sent to the desktop notification stack. If three cards are already visible, dismiss one to see it.</p>}
      {settings.error && <p role="alert" className="text-sm text-[var(--red)]">{settings.error}</p>}
    </SettingsSection>
  );
}
