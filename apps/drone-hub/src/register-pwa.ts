export function registerPwa(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext) return;

  if (import.meta.env.DEV) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(
            registrations
              .filter((registration) => {
                try {
                  const scriptUrl = new URL(registration.active?.scriptURL || registration.installing?.scriptURL || registration.waiting?.scriptURL || '');
                  return scriptUrl.origin === window.location.origin && scriptUrl.pathname.endsWith('/pwa-sw.js');
                } catch {
                  return false;
                }
              })
              .map((registration) => registration.unregister()),
          ),
        )
        .catch(() => {});
      if ('caches' in window) {
        window.caches
          .keys()
          .then((keys) => Promise.all(keys.filter((key) => key.startsWith('drone-hub-')).map((key) => window.caches.delete(key))))
          .catch(() => {});
      }
    });
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/pwa-sw.js').catch((error) => {
      console.warn('[DroneHub] PWA registration failed', error);
    });
  });
}
