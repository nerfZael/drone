import React from 'react';
import { dropdownPanelBaseClass, useDropdownDismiss } from '../../ui/dropdown';
import { IconChevronDown } from './icons';
import { desktopDeviceRouteAvailable, useDesktopDevice } from './DesktopDeviceProvider';
import { DeviceConnectionIndicator } from './DeviceConnectionIndicator';

function platformLabel(platform: string): string {
  if (platform === 'android') return 'Android';
  if (platform === 'server' || platform === 'desktop') return 'Desktop';
  return 'Device';
}

export function DesktopDevicePicker() {
  const {
    devices,
    status,
    selectedDevice,
    selfDeviceId,
    loading,
    error,
    selectDevice,
  } = useDesktopDevice();
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  useDropdownDismiss(menuRef, open, setOpen);

  const name = selectedDevice?.name || (loading ? 'Loading device…' : 'This device');
  const selectedHasRoute = desktopDeviceRouteAvailable(status, selectedDevice);

  return (
    <div
      ref={menuRef}
      className="relative min-w-0"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="flex h-8 min-w-0 items-center rounded-[var(--radius-medium)] pl-1.5 pr-0.5 text-left text-[var(--text-11)] font-semibold text-[var(--fg)] transition-colors hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--focus-ring)]"
        title={`Switch device. Current device: ${name}`}
        aria-label={`Current device: ${name}, ${selectedHasRoute ? 'online' : 'offline'}. Choose another device.`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <DeviceConnectionIndicator online={selectedHasRoute} className="mr-1.5" />
        <span className="min-w-0 truncate">{name}</span>
        <IconChevronDown className="ml-2 h-3.5 w-3.5 flex-shrink-0 text-[var(--muted)]" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Drone Hub device"
          className={`absolute right-0 top-full z-50 mt-1 w-[232px] !bg-[var(--sidebar-bg)] ${dropdownPanelBaseClass}`}
        >
          <div className="max-h-[min(360px,60vh)] overflow-y-auto">
            {devices.map((device) => {
              const local = device.id === selfDeviceId;
              const hasRoute = desktopDeviceRouteAvailable(status, device);
              const selected = device.id === selectedDevice?.id;
              return (
                <button
                  key={device.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  aria-label={`${device.name}, ${hasRoute ? 'online' : 'offline'}, ${platformLabel(device.platform)}${local ? ', this device' : ''}`}
                  className={`relative flex min-h-10 w-full items-center gap-2 border-b border-[var(--border-subtle)] px-2.5 py-1.5 text-left transition-colors last:border-b-0 hover:bg-[var(--hover)] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] ${
                    selected
                      ? 'bg-[var(--sidebar-row-selected-bg)] text-[var(--sidebar-fg-active)]'
                      : 'text-[var(--sidebar-fg)]'
                  }`}
                  onClick={() => {
                    selectDevice(device.id);
                    setOpen(false);
                  }}
                >
                  {selected ? (
                    <span
                      className="absolute inset-y-1.5 left-0 w-0.5 rounded-r bg-[var(--sidebar-row-selected-edge)]"
                      aria-hidden="true"
                    />
                  ) : null}
                  <DeviceConnectionIndicator online={hasRoute} />
                  <span className="flex min-w-0 flex-1 flex-col justify-center">
                    <span className="block truncate text-[var(--text-10-5)] font-semibold">
                      {device.name}
                    </span>
                    {local ? (
                      <span className="mt-px block truncate text-[7px] font-semibold uppercase tracking-[0.09em] text-[var(--sidebar-meta-fg)]">
                        This device
                      </span>
                    ) : null}
                  </span>
                  <span className="w-[3.25rem] flex-shrink-0 text-right text-[var(--text-9)] font-medium text-[var(--sidebar-meta-fg)]">
                    {platformLabel(device.platform)}
                  </span>
                </button>
              );
            })}
            {!loading && devices.length === 0 ? (
              <div className="px-3 py-4 text-[var(--text-10)] text-[var(--muted)]">
                No other devices are available.
              </div>
            ) : null}
          </div>
          {error ? (
            <div className="border-t border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-9)] text-[var(--red)]">
              Device status could not be refreshed.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
