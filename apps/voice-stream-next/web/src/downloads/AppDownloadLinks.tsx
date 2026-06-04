import type { AndroidApkInfo, DesktopAppInfo } from '../dashboardTypes.js';
import { formatBytes } from '../utils/format.js';

export function appDownloadMeta(info: AndroidApkInfo | DesktopAppInfo | null): string {
  if (!info?.available) return 'Not built yet';
  const parts = [
    info.variant,
    'versionName' in info ? info.versionName ?? info.versionCode : null,
    info.size ? formatBytes(info.size) : null,
  ].filter(Boolean);
  return parts.join(' / ') || 'Ready';
}

function DownloadPlatformIcon({ platform }: { platform: 'desktop' | 'android' }) {
  if (platform === 'android') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="download-link-icon">
        <rect x="7" y="3" width="10" height="18" rx="2.2" />
        <path d="M10 18h4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="download-link-icon">
      <rect x="4" y="5" width="16" height="11" rx="1.8" />
      <path d="M9 20h6" />
      <path d="M12 16v4" />
    </svg>
  );
}

export function AppDownloadLinks({
  androidInfo,
  desktopInfo,
  loading = false,
}: {
  androidInfo: AndroidApkInfo | null;
  desktopInfo: DesktopAppInfo | null;
  loading?: boolean;
}) {
  const entries = [
    {
      platform: 'desktop' as const,
      label: 'Desktop app',
      action: 'Download for Linux',
      info: desktopInfo,
      href: desktopInfo?.available ? desktopInfo.downloadUrl : null,
    },
    {
      platform: 'android' as const,
      label: 'Android app',
      action: 'Download APK',
      info: androidInfo,
      href: androidInfo?.available ? androidInfo.downloadUrl : null,
    },
  ];
  return (
    <div className="download-links" aria-label="App downloads">
      {entries.map((entry) => {
        const meta = loading && !entry.info ? 'Checking...' : appDownloadMeta(entry.info);
        const content = (
          <>
            <DownloadPlatformIcon platform={entry.platform} />
            <span className="download-link-copy">
              <span className="download-link-label">{entry.label}</span>
              <strong>{entry.href ? entry.action : 'Unavailable'}</strong>
              <small>{meta}</small>
            </span>
          </>
        );
        return entry.href ? (
          <a key={entry.label} className="download-link" href={entry.href} aria-label={`${entry.action}: ${meta}`}>
            {content}
          </a>
        ) : (
          <span key={entry.label} className="download-link is-disabled" aria-disabled="true">
            {content}
          </span>
        );
      })}
    </div>
  );
}
