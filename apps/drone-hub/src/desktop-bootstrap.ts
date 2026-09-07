export async function prepareDesktopProfile(): Promise<void> {
  if (!window.__DRONE_HUB_RUNTIME_CONFIG__?.desktop) return;
  try {
    const response = await fetch('/api/settings/profiles', { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return;
    const data = await response.json();
    if (!Object.prototype.hasOwnProperty.call(data, 'activeProfile')) return;
    const profile = String(data.activeProfile ?? '').trim().toLowerCase();
    if (profile && !/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(profile)) return;
    if (profile) localStorage.setItem('droneHub.activeProfileOverride', profile);
    else localStorage.removeItem('droneHub.activeProfileOverride');
  } catch {
    // Let the app surface connection errors and retry profile synchronization.
  }
}
