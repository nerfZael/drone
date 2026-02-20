import React from 'react';

export function IconDrone({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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

export function IconChat({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 2A1.5 1.5 0 000 3.5v8A1.5 1.5 0 001.5 13H3v2.5l4-2.5h7.5A1.5 1.5 0 0016 11.5v-8A1.5 1.5 0 0014.5 2h-13z" />
    </svg>
  );
}

export function IconChevron({ down, className }: { down?: boolean; className?: string }) {
  return (
    <svg
      className={`transition-transform duration-150 ${down ? 'rotate-0' : '-rotate-90'} ${className ?? ''}`}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z" />
    </svg>
  );
}

export function IconFolder({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5a.25.25 0 01-.2-.1l-.9-1.2c-.33-.44-.85-.7-1.4-.7h-3.25z" />
    </svg>
  );
}

export function IconList({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3 4.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM4.5 3.5a.5.5 0 000 1h9a.5.5 0 000-1h-9zM3 8a.75.75 0 11-1.5 0A.75.75 0 013 8zm1.5-.5a.5.5 0 000 1h9a.5.5 0 000-1h-9zM3 11.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM4.5 11a.5.5 0 000 1h9a.5.5 0 000-1h-9z" />
    </svg>
  );
}

export function IconSettings({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M6.8 1.03a1.2 1.2 0 012.4 0l.1.81a5.9 5.9 0 011.36.57l.68-.46a1.2 1.2 0 011.53.15l1.4 1.4a1.2 1.2 0 01.15 1.53l-.46.68c.23.43.42.89.56 1.36l.81.1a1.2 1.2 0 010 2.4l-.81.1a5.9 5.9 0 01-.56 1.36l.46.68a1.2 1.2 0 01-.15 1.53l-1.4 1.4a1.2 1.2 0 01-1.53.15l-.68-.46c-.43.23-.89.42-1.36.56l-.1.81a1.2 1.2 0 01-2.4 0l-.1-.81a5.9 5.9 0 01-1.36-.56l-.68.46a1.2 1.2 0 01-1.53-.15l-1.4-1.4a1.2 1.2 0 01-.15-1.53l.46-.68a5.9 5.9 0 01-.56-1.36l-.81-.1a1.2 1.2 0 010-2.4l.81-.1a5.9 5.9 0 01.56-1.36l-.46-.68a1.2 1.2 0 01.15-1.53l1.4-1.4a1.2 1.2 0 011.53-.15l.68.46c.43-.23.89-.42 1.36-.57l.1-.81zM8 5.75a2.25 2.25 0 100 4.5 2.25 2.25 0 000-4.5z" />
    </svg>
  );
}

export function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.75a.75.75 0 01.75.75v4.75h4.75a.75.75 0 010 1.5H8.75v4.75a.75.75 0 01-1.5 0V8.75H2.5a.75.75 0 010-1.5h4.75V2.5A.75.75 0 018 1.75z" />
    </svg>
  );
}

export function IconPlusDouble({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5 2.25a.75.75 0 01.75.75v2.5h2.5a.75.75 0 010 1.5h-2.5v2.5a.75.75 0 01-1.5 0V7h-2.5a.75.75 0 010-1.5h2.5V3A.75.75 0 015 2.25z" />
      <path d="M11 6.25a.75.75 0 01.75.75v2h2a.75.75 0 010 1.5h-2v2a.75.75 0 01-1.5 0v-2h-2a.75.75 0 010-1.5h2V7A.75.75 0 0111 6.25z" />
    </svg>
  );
}

export function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M6.5 1.5a.5.5 0 00-.5.5v1H3a.5.5 0 000 1h.5v9.25c0 .966.784 1.75 1.75 1.75h5.5A1.75 1.75 0 0012.5 13.25V4H13a.5.5 0 000-1h-3V2a.5.5 0 00-.5-.5h-3zM7 3V2.5h2V3H7zM5 4h6v9.25a.75.75 0 01-.75.75h-4.5a.75.75 0 01-.75-.75V4z" />
    </svg>
  );
}

export function IconColumns({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
      <rect x="1.5" y="2.5" width="4.5" height="11" rx="1" />
      <rect x="5.75" y="2.5" width="4.5" height="11" rx="1" />
      <rect x="10" y="2.5" width="4.5" height="11" rx="1" />
    </svg>
  );
}

export function IconAutoMinimize({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.5" y="2.25" width="13" height="11.5" rx="1.25" />
      <line x1="5.5" y1="2.25" x2="5.5" y2="13.75" />
      <path d="M10.75 6L8 8l2.75 2" />
    </svg>
  );
}

export function IconPencil({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.94 8.94a.75.75 0 01-.318.19l-3.5 1a.75.75 0 01-.927-.927l1-3.5a.75.75 0 01.19-.318l8.935-8.945zM12.073 2.487L3.5 11.06l-.64 2.24 2.24-.64 8.573-8.573-1.6-1.6z" />
    </svg>
  );
}

export function IconCopy({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5 1.75A1.75 1.75 0 016.75 0h6.5C14.216 0 15 .784 15 1.75v6.5A1.75 1.75 0 0113.25 10h-6.5A1.75 1.75 0 015 8.25v-6.5zm1.75-.75a.75.75 0 00-.75.75v6.5c0 .414.336.75.75.75h6.5a.75.75 0 00.75-.75v-6.5a.75.75 0 00-.75-.75h-6.5z" />
      <path d="M1 5.75C1 4.784 1.784 4 2.75 4h1a.5.5 0 010 1h-1a.75.75 0 00-.75.75v6.5c0 .414.336.75.75.75h6.5a.75.75 0 00.75-.75v-1a.5.5 0 011 0v1A1.75 1.75 0 019.25 14.5h-6.5A1.75 1.75 0 011 12.75v-7z" />
    </svg>
  );
}

export function IconSpinner({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className ?? ''}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-75"
        d="M21 12a9 9 0 00-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconVsCode({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M11.8 1.6a1 1 0 011.2.2l1.2 1.2a1 1 0 01.3.7v8.6a1 1 0 01-.3.7l-1.2 1.2a1 1 0 01-1.2.2L6.4 11.7 3.9 14.2a1 1 0 01-1.4 0l-1-1a1 1 0 010-1.4L3.6 9.7 1.5 7.6a1 1 0 010-1.4l1-1a1 1 0 011.4 0L6.4 7.3 11.8 1.6zM6.4 8.7L4.9 10.2l1.5 1.5 4.2 2.8V2.9L6.4 8.7z" />
    </svg>
  );
}

export function IconCursorApp({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3.2 1.4a.75.75 0 011.02-.24l9.6 5.6a.75.75 0 01-.05 1.33l-3.63 1.66 1.67 3.62a.75.75 0 01-1.02.98l-1.73-.79-1.6-.72-1.66 3.63a.75.75 0 01-1.33.05L1.16 4.22a.75.75 0 01.24-1.02L3.2 1.4zm.12 1.93l2.67 9.9 1.14-2.5a.75.75 0 011.01-.36l2.5 1.14-.9-1.95a.75.75 0 01.36-1.01l2.5-1.14-9.9-2.67z" />
    </svg>
  );
}

export function SkeletonLine({ w }: { w: string }) {
  return <div className="h-2.5 rounded bg-[var(--border-subtle)] animate-pulse" style={{ width: w }} />;
}
