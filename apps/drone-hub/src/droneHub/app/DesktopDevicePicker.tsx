import React from 'react';
import { dropdownPanelBaseClass, useDropdownDismiss } from '../../ui/dropdown';
import { IconChevronDown } from './icons';
import { useDesktopDevice } from './DesktopDeviceProvider';

function platformLabel(platform: string): string {
  if (platform === 'android') return 'Android';
  if (platform === 'server') return 'Server';
  if (platform === 'desktop') return 'Desktop';
  return 'Device';
}

export function DesktopDevicePicker() {
  const {
    devices,
    selectedDevice,
    selfDeviceId,
    loading,
    error,
    remoteRouteAvailable,
    selectDevice,
  } = useDesktopDevice();
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  useDropdownDismiss(menuRef, open, setOpen);

  const name = selectedDevice?.name || (loading ? 'Loading device…' : 'This device');
  const selectedIsLocal = selectedDevice?.id === selfDeviceId;
  const selectedHasRoute = selectedIsLocal || remoteRouteAvailable;

  return (
    <div
      ref={menuRef}
      className="relative min-w-0"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="flex h-8 min-w-0 items-center rounded-[var(--radius-medium)] pl-1.5 pr-0.5 text-left text-[var(--text-11)] font-semibold text-[var(--fg-secondary)] transition-colors hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--focus-ring)]"
        title={`Switch device. Current device: ${name}`}
        aria-label={`Current device: ${name}. Choose another device.`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span
          className={`mr-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${
            selectedHasRoute ? 'bg-[var(--green)]' : 'bg-[var(--muted-dim)]'
          }`}
        />
        <span className="min-w-0 truncate">{name}</span>
        <IconChevronDown className="ml-2 h-3.5 w-3.5 flex-shrink-0 text-[var(--muted)]" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Drone Hub device"
          className={`absolute right-0 top-full z-50 mt-1 w-[260px] ${dropdownPanelBaseClass}`}
        >
          <div className="border-b border-[var(--border-subtle)] px-3 py-2">
            <div className="text-[var(--text-9)] font-semibold uppercase tracking-[0.1em] text-[var(--muted-dim)]">
              Drone Hubs
            </div>
          </div>
          <div className="max-h-[min(360px,60vh)] overflow-y-auto p-1">
            {devices.map((device) => {
              const local = device.id === selfDeviceId;
              const hasRoute = local || remoteRouteAvailable;
              const selected = device.id === selectedDevice?.id;
              return (
                <button
                  key={device.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={`flex w-full items-center gap-2.5 rounded-[var(--radius-medium)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--focus-ring)] ${
                    selected ? 'bg-[var(--selected)] text-[var(--fg)]' : 'text-[var(--fg-secondary)]'
                  }`}
                  onClick={() => {
                    selectDevice(device.id);
                    setOpen(false);
                  }}
                >
                  <span
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${
                      hasRoute ? 'bg-[var(--green)]' : 'bg-[var(--muted-dim)]'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[var(--text-11)] font-semibold">
                      {device.name}
                    </span>
                    <span className="block truncate text-[var(--text-9)] text-[var(--muted-dim)]">
                      {local
                        ? 'This device'
                        : `${platformLabel(device.platform)} · ${hasRoute ? 'Mesh route available' : 'No mesh route'}`}
                    </span>
                  </span>
                  {selected ? (
                    <span className="text-[var(--text-10)] text-[var(--accent)]" aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </button>
              );
            })}
            {!loading && devices.length === 0 ? (
              <div className="px-3 py-4 text-[var(--text-10)] text-[var(--muted)]">
                No mesh devices are available.
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
