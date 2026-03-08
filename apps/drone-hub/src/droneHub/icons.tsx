import React from 'react';

type IconProps = {
  className?: string;
  size?: number;
};

type FileIconComponent = (props: IconProps) => React.JSX.Element;

export function IconDrone({ className, size = 16 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="5" width="6" height="6" rx="1" />
      <line x1="2" y1="2" x2="5" y2="5" />
      <line x1="14" y1="2" x2="11" y2="5" />
      <line x1="2" y1="14" x2="5" y2="11" />
      <line x1="14" y1="14" x2="11" y2="11" />
      <circle cx="2" cy="2" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="2" r="1" fill="currentColor" stroke="none" />
      <circle cx="2" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconChat({ className, size = 14 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1.5 2A1.5 1.5 0 000 3.5v8A1.5 1.5 0 001.5 13H3v2.5l4-2.5h7.5A1.5 1.5 0 0016 11.5v-8A1.5 1.5 0 0014.5 2h-13z" />
    </svg>
  );
}

export function IconChevron({ down, className, size = 12 }: IconProps & { down?: boolean }) {
  return (
    <svg
      className={`transition-transform duration-150 ${down ? 'rotate-0' : '-rotate-90'} ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z" />
    </svg>
  );
}

export function IconFolder({ className, size = 14 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5a.25.25 0 01-.2-.1l-.9-1.2c-.33-.44-.85-.7-1.4-.7h-3.25z" />
    </svg>
  );
}

export function IconFile({ className, size = 14 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3.75 0A1.75 1.75 0 002 1.75v12.5C2 15.216 2.784 16 3.75 16h8.5A1.75 1.75 0 0014 14.25V5.5a.75.75 0 00-.22-.53L9.03.22A.75.75 0 008.5 0H3.75zm4 .75v3A1.75 1.75 0 009.5 5.5h3v8.75a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25V1.75a.25.25 0 01.25-.25h4zm1.5 1.06L11.94 4H9.5a.25.25 0 01-.25-.25V1.81z" />
    </svg>
  );
}

function IconFileCode({ className, size = 14 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3.75 0A1.75 1.75 0 002 1.75v12.5C2 15.216 2.784 16 3.75 16h8.5A1.75 1.75 0 0014 14.25V5.5a.75.75 0 00-.22-.53L9.03.22A.75.75 0 008.5 0H3.75zm4 .75v3A1.75 1.75 0 009.5 5.5h3v8.75a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25V1.75a.25.25 0 01.25-.25h4zm1.5 1.06L11.94 4H9.5a.25.25 0 01-.25-.25V1.81z" />
      <path d="M5.6 9.45L4.1 8.2l1.5-1.25.64.77-.57.48.57.48-.64.77zm4.8 0l-.64-.77.57-.48-.57-.48.64-.77 1.5 1.25-1.5 1.25zm-2.57 1.05H6.8l1.37-4.9H9.2l-1.37 4.9z" />
    </svg>
  );
}

function IconFileData({ className, size = 14 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3.75 0A1.75 1.75 0 002 1.75v12.5C2 15.216 2.784 16 3.75 16h8.5A1.75 1.75 0 0014 14.25V5.5a.75.75 0 00-.22-.53L9.03.22A.75.75 0 008.5 0H3.75zm4 .75v3A1.75 1.75 0 009.5 5.5h3v8.75a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25V1.75a.25.25 0 01.25-.25h4zm1.5 1.06L11.94 4H9.5a.25.25 0 01-.25-.25V1.81z" />
      <path d="M5.55 10.9v-.87h-.8v-.9h.8V6.87h1.31l-.2.9h.95v.9h-1.15v1.36h1.02v.87H5.55zm3.15-.14c-.9 0-1.43-.59-1.43-1.5 0-.96.59-1.64 1.56-1.64.28 0 .56.05.72.12l-.12.91a1.12 1.12 0 00-.51-.12c-.36 0-.58.28-.58.66 0 .42.23.66.61.66.18 0 .38-.04.52-.11l.1.88a2.1 2.1 0 01-.87.14zm2.17.02c-.88 0-1.47-.51-1.47-1.54 0-.91.58-1.62 1.63-1.62.19 0 .4.03.55.07v.92a1.02 1.02 0 00-.43-.1c-.42 0-.66.29-.66.69 0 .42.23.66.64.66.16 0 .32-.03.45-.08l.09.87a2.32 2.32 0 01-.8.13z" />
    </svg>
  );
}

function IconFileDoc({ className, size = 14 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3.75 0A1.75 1.75 0 002 1.75v12.5C2 15.216 2.784 16 3.75 16h8.5A1.75 1.75 0 0014 14.25V5.5a.75.75 0 00-.22-.53L9.03.22A.75.75 0 008.5 0H3.75zm4 .75v3A1.75 1.75 0 009.5 5.5h3v8.75a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25V1.75a.25.25 0 01.25-.25h4zm1.5 1.06L11.94 4H9.5a.25.25 0 01-.25-.25V1.81z" />
      <path d="M5 6.8h5.4v.85H5zm0 1.8h5.4v.85H5zm0 1.8h3.5v.85H5z" />
    </svg>
  );
}

function IconFileImage({ className, size = 14 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3.75 0A1.75 1.75 0 002 1.75v12.5C2 15.216 2.784 16 3.75 16h8.5A1.75 1.75 0 0014 14.25V5.5a.75.75 0 00-.22-.53L9.03.22A.75.75 0 008.5 0H3.75zm4 .75v3A1.75 1.75 0 009.5 5.5h3v8.75a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25V1.75a.25.25 0 01.25-.25h4zm1.5 1.06L11.94 4H9.5a.25.25 0 01-.25-.25V1.81z" />
      <path d="M4.8 10.9v-.98l1.35-1.3a.7.7 0 011 0l.82.78 1.32-1.48a.7.7 0 011.05 0l1.06 1.22v1H4.8zm1.15-3.4a.8.8 0 101.6 0 .8.8 0 00-1.6 0z" />
    </svg>
  );
}

function IconFileTest({ className, size = 14 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3.75 0A1.75 1.75 0 002 1.75v12.5C2 15.216 2.784 16 3.75 16h8.5A1.75 1.75 0 0014 14.25V5.5a.75.75 0 00-.22-.53L9.03.22A.75.75 0 008.5 0H3.75zm4 .75v3A1.75 1.75 0 009.5 5.5h3v8.75a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25V1.75a.25.25 0 01.25-.25h4zm1.5 1.06L11.94 4H9.5a.25.25 0 01-.25-.25V1.81z" />
      <path d="M6.9 10.55L5.15 8.8l.7-.7 1.05 1.04 2.3-2.3.7.7-3 3.01z" />
    </svg>
  );
}

function IconFilePackage({ className, size = 14 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3.75 0A1.75 1.75 0 002 1.75v12.5C2 15.216 2.784 16 3.75 16h8.5A1.75 1.75 0 0014 14.25V5.5a.75.75 0 00-.22-.53L9.03.22A.75.75 0 008.5 0H3.75zm4 .75v3A1.75 1.75 0 009.5 5.5h3v8.75a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25V1.75a.25.25 0 01.25-.25h4zm1.5 1.06L11.94 4H9.5a.25.25 0 01-.25-.25V1.81z" />
      <path d="M5.25 8.95V7.6l2.6-1.3 2.9 1.3v1.35L7.85 10.4l-2.6-1.45zm1-.73l1.6.9 1.9-.93-1.92-.87-1.58.9zm1.1 2.98v-1.18l1 .56v1.15l-1-.53z" />
    </svg>
  );
}

export function IconList({ className, size = 14 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3 4.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM4.5 3.5a.5.5 0 000 1h9a.5.5 0 000-1h-9zM3 8a.75.75 0 11-1.5 0A.75.75 0 013 8zm1.5-.5a.5.5 0 000 1h9a.5.5 0 000-1h-9zM3 11.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM4.5 11a.5.5 0 000 1h9a.5.5 0 000-1h-9z" />
    </svg>
  );
}

export function IconTrash({ className, size = 14 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M6.5 1.5a.5.5 0 00-.5.5v1H3a.5.5 0 000 1h.5v9.25c0 .966.784 1.75 1.75 1.75h5.5A1.75 1.75 0 0012.5 13.25V4H13a.5.5 0 000-1h-3V2a.5.5 0 00-.5-.5h-3zM7 3V2.5h2V3H7zM5 4h6v9.25a.75.75 0 01-.75.75h-4.5a.75.75 0 01-.75-.75V4z" />
    </svg>
  );
}

export function IconCopy({ className, size = 14 }: IconProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5 1.75A1.75 1.75 0 016.75 0h6.5C14.216 0 15 .784 15 1.75v6.5A1.75 1.75 0 0113.25 10h-6.5A1.75 1.75 0 015 8.25v-6.5zm1.75-.75a.75.75 0 00-.75.75v6.5c0 .414.336.75.75.75h6.5a.75.75 0 00.75-.75v-6.5a.75.75 0 00-.75-.75h-6.5z" />
      <path d="M1 5.75C1 4.784 1.784 4 2.75 4h1a.5.5 0 010 1h-1a.75.75 0 00-.75.75v6.5c0 .414.336.75.75.75h6.5a.75.75 0 00.75-.75v-1a.5.5 0 011 0v1A1.75 1.75 0 019.25 14.5h-6.5A1.75 1.75 0 011 12.75v-7z" />
    </svg>
  );
}

export function IconSpinner({ className, size = 14 }: IconProps) {
  return (
    <svg
      className={`animate-spin ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function fileNameFromPath(path: string | null | undefined): string {
  const value = String(path ?? '').trim().toLowerCase();
  if (!value) return '';
  const segs = value.split('/').filter(Boolean);
  return segs.length > 0 ? segs[segs.length - 1] : value;
}

export function iconForFilePath(path: string | null | undefined): FileIconComponent {
  const name = fileNameFromPath(path);
  if (!name) return IconFile;

  if (
    name === 'package.json' ||
    name === 'package-lock.json' ||
    name === 'bun.lock' ||
    name === 'pnpm-lock.yaml' ||
    name === 'yarn.lock' ||
    name === 'cargo.lock'
  ) {
    return IconFilePackage;
  }

  if (name.includes('.test.') || name.includes('.spec.')) return IconFileTest;
  if (name.startsWith('.env')) return IconFileData;

  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1) : '';

  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)) return IconFileImage;
  if (['md', 'mdx', 'txt', 'rst'].includes(ext)) return IconFileDoc;
  if (['json', 'yaml', 'yml', 'toml', 'ini', 'xml', 'csv'].includes(ext)) return IconFileData;
  if (['ts', 'tsx', 'js', 'jsx', 'cjs', 'mjs', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cc', 'cpp', 'h', 'hpp', 'sh', 'bash', 'zsh', 'css', 'scss', 'sass', 'less', 'sql'].includes(ext)) {
    return IconFileCode;
  }

  return IconFile;
}
