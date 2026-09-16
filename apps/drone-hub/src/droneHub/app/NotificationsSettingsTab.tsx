import React from 'react';
import { UiToolbarButton } from '../../ui/components';
import { useDesktopNotificationSettings } from './desktop-notification-settings';
import { SettingsSection } from './SettingsSurface';

export function NotificationsSettingsTab() {
  const settings = useDesktopNotificationSettings();
  const [supported, setSupported] = React.useState<boolean | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [tested, setTested] = React.useState(false);
  React.useEffect(() => {
    let disposed = false;
    const desktop = window.droneHubDesktop;
    void (desktop?.notificationsSupported?.() ?? Promise.resolve(false)).then(
      (value) => { if (!disposed) setSupported(value); },
      (error) => { if (!disposed) { setSupported(false); settings.setError(String(error?.message || error)); } },
    );
    return () => { disposed = true; };
  }, [settings.setError]);
  const disabled = supported !== true;
  return (
    <SettingsSection title="System notifications" description="Show notifications outside Drone Hub, including while minimized. Preferences apply to this app and profile. Drone Hub must remain running and connected; past events are not replayed on startup or reconnect.">
      {supported === null && <p role="status">Checking system notification support…</p>}
      {supported === false && <p role="status">System notifications require the Drone Hub desktop app and a supported operating system.</p>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={disabled} checked={settings.enabled} onChange={(e) => settings.update({ enabled: e.target.checked })} />
        Enable system notifications
      </label>
      <p className="text-sm text-[var(--muted)]">Turning notifications off stops new alerts. Already delivered notifications can be dismissed individually using your operating system’s close or dismiss control.</p>
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
        <p className="text-[var(--muted)]">Example: emit chat_message with data {`{"message":"Ready for your review"}`}. Clicking opens the emitting chat. Message text can appear on your lock screen.</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.sound} onChange={(e) => settings.update({ sound: e.target.checked })} />Play notification sound</label>
      </fieldset>
      <p className="text-sm text-[var(--muted)]">Banner duration and notification-center history are controlled by your operating system; Drone Hub does not set a fixed number of seconds. Appearance, sounds, and delivery also follow your system’s notification and Do Not Disturb settings.</p>
      <div><UiToolbarButton disabled={disabled || testing || !settings.enabled} onClick={async () => {
        settings.setError(null);
        setTesting(true);
        setTested(false);
        try {
          await window.droneHubDesktop?.showNotification?.({ title: 'Drone Hub notifications', body: 'This is a test notification from Drone Hub.', silent: !settings.sound });
          setTested(true);
        } catch (error: any) { settings.setError(String(error?.message || error)); }
        finally { setTesting(false); }
      }}>{testing ? 'Sending…' : 'Send test notification'}</UiToolbarButton></div>
      {tested && !settings.error && <p role="status">Test sent to the operating system. If it did not appear, check notification permissions and Do Not Disturb.</p>}
      {settings.error && <p role="alert" className="text-sm text-[var(--red)]">{settings.error}</p>}
    </SettingsSection>
  );
}
