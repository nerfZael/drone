import React from 'react';

const MOBILE_VIEWPORT_QUERY = '(max-width: 767px)';

export function useMobileViewport(): boolean {
  const [isMobileViewport, setIsMobileViewport] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(MOBILE_VIEWPORT_QUERY).matches;
  });

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = window.matchMedia(MOBILE_VIEWPORT_QUERY);
    const update = () => setIsMobileViewport(query.matches);
    update();
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return isMobileViewport;
}
