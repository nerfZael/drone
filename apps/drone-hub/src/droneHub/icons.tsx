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

function FileBase({ className, size = 14, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.75 0A1.75 1.75 0 002 1.75v12.5C2 15.216 2.784 16 3.75 16h8.5A1.75 1.75 0 0014 14.25V5.5a.75.75 0 00-.22-.53L9.03.22A.75.75 0 008.5 0H3.75zm4 .75v3A1.75 1.75 0 009.5 5.5h3v8.75a.25.25 0 01-.25.25h-8.5a.25.25 0 01-.25-.25V1.75a.25.25 0 01.25-.25h4zm1.5 1.06L11.94 4H9.5a.25.25 0 01-.25-.25V1.81z"
        fill="currentColor"
        opacity="0.36"
      />
      <path d="M9.25 1.81L11.94 4H9.5a.25.25 0 01-.25-.25V1.81z" fill="currentColor" opacity="0.7" />
      {children}
    </svg>
  );
}

function IconFileCode({ className, size = 14 }: IconProps) {
  return (
    <FileBase className={className} size={size}>
      <path d="M6.15 10.25L4.55 8.6l1.6-1.65" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.85 6.95l1.6 1.65-1.6 1.65" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.85 6.2l-1.7 4.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </FileBase>
  );
}

function IconFileData({ className, size = 14 }: IconProps) {
  return (
    <FileBase className={className} size={size}>
      <path d="M4.9 7.05h6.2" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
      <circle cx="6.5" cy="7.05" r="1.1" fill="currentColor" />
      <path d="M4.9 9.35h6.2" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
      <circle cx="9.2" cy="9.35" r="1.1" fill="currentColor" />
    </FileBase>
  );
}

function IconFileDoc({ className, size = 14 }: IconProps) {
  return (
    <FileBase className={className} size={size}>
      <path d="M5.1 6.55h5.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5.1 8.55h5.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5.1 10.55h3.25" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </FileBase>
  );
}

function IconFileImage({ className, size = 14 }: IconProps) {
  return (
    <FileBase className={className} size={size}>
      <circle cx="6.05" cy="6.85" r="1.05" fill="currentColor" />
      <path d="M4.85 10.55l1.75-1.85a.7.7 0 011.02 0l1.02 1.07 1.03-1.26a.72.72 0 011.11 0l1.02 1.24" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" />
    </FileBase>
  );
}

function IconFileTest({ className, size = 14 }: IconProps) {
  return (
    <FileBase className={className} size={size}>
      <circle cx="8" cy="8.4" r="3.05" stroke="currentColor" strokeWidth="1.15" />
      <path d="M6.65 8.4l.95.95 1.85-2.05" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </FileBase>
  );
}

function IconFilePackage({ className, size = 14 }: IconProps) {
  return (
    <FileBase className={className} size={size}>
      <path d="M5.25 7.55L8 6.1l2.75 1.45v3.2L8 12.2l-2.75-1.45v-3.2z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M5.25 7.55L8 9l2.75-1.45M8 9v3.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </FileBase>
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
