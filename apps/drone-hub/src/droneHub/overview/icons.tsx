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

export function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M6.5 1.5a.5.5 0 00-.5.5v1H3a.5.5 0 000 1h.5v9.25c0 .966.784 1.75 1.75 1.75h5.5A1.75 1.75 0 0012.5 13.25V4H13a.5.5 0 000-1h-3V2a.5.5 0 00-.5-.5h-3zM7 3V2.5h2V3H7zM5 4h6v9.25a.75.75 0 01-.75.75h-4.5a.75.75 0 01-.75-.75V4z" />
    </svg>
  );
}

export function IconClone({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2.5 2A1.5 1.5 0 014 0.5h6A1.5 1.5 0 0111.5 2v1H12A1.5 1.5 0 0113.5 4.5v8A1.5 1.5 0 0112 14H6a1.5 1.5 0 01-1.5-1.5V11H4A1.5 1.5 0 012.5 9.5V2zm3 9v1.5a.5.5 0 00.5.5h6a.5.5 0 00.5-.5v-8a.5.5 0 00-.5-.5H6a.5.5 0 00-.5.5V11zm-2-9a.5.5 0 00.5.5h6a.5.5 0 00.5-.5v-.5a.5.5 0 00-.5-.5H4a.5.5 0 00-.5.5V2zm0 2.915V9.5A.5.5 0 004 10h.5V4.5A1.5 1.5 0 016 3h4.585A.5.5 0 0010.5 3.5V3H4a1.498 1.498 0 00-.5.085z" />
    </svg>
  );
}

export function IconRename({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M11.85 1.15a.5.5 0 01.707 0l2.293 2.293a.5.5 0 010 .707l-7.5 7.5a.5.5 0 01-.223.131l-3 1a.5.5 0 01-.632-.632l1-3a.5.5 0 01.131-.223l7.5-7.5zM12.204 2.21L5.03 9.384l-.646 1.94 1.94-.647 7.173-7.173-1.293-1.293z" />
      <path d="M2.5 3A1.5 1.5 0 014 1.5h4a.5.5 0 010 1H4a.5.5 0 00-.5.5v9A1.5 1.5 0 005 13.5h9a.5.5 0 00.5-.5V8a.5.5 0 011 0v5a1.5 1.5 0 01-1.5 1.5H5A2.5 2.5 0 012.5 12V3z" />
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

export function TypingDots({ color = 'var(--muted)' }: { color?: string }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label="typing" title="typing">
      <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: color, animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: color, animationDelay: '160ms' }} />
      <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: color, animationDelay: '320ms' }} />
    </span>
  );
}
