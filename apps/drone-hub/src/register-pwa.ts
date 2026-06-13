export function registerPwa(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/pwa-sw.js').catch((error) => {
      console.warn('[DroneHub] PWA registration failed', error);
    });
  });
}
