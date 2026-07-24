import React from 'react';

export { IconChevron, IconCopy, IconSpinner } from '../icons';

export function IconUser({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M10.561 8.073a6.005 6.005 0 013.432 5.142.75.75 0 11-1.498.07 4.5 4.5 0 00-8.99 0 .75.75 0 01-1.498-.07 6.004 6.004 0 013.431-5.142 3.999 3.999 0 115.123 0zM10.5 5a2.5 2.5 0 10-5 0 2.5 2.5 0 005 0z" />
    </svg>
  );
}

export function IconBot({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M9.828.722a.5.5 0 01.312.644l-.413 1.217A4.5 4.5 0 0113.5 7v.5h.5a.5.5 0 01.5.5v3a.5.5 0 01-.5.5h-.5v.5A2.5 2.5 0 0111 14.5H5A2.5 2.5 0 012.5 12v-.5H2a.5.5 0 01-.5-.5V8a.5.5 0 01.5-.5h.5V7a4.5 4.5 0 013.773-4.417L5.86 1.366a.5.5 0 11.956-.312L7.36 2.61a4.571 4.571 0 011.28 0l.544-1.575a.5.5 0 01.644-.312zM6 8.5a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2z" />
    </svg>
  );
}

export function IconImage({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2.5 1A1.5 1.5 0 001 2.5v11A1.5 1.5 0 002.5 15h11a1.5 1.5 0 001.5-1.5v-11A1.5 1.5 0 0013.5 1h-11zM2 2.5a.5.5 0 01.5-.5h11a.5.5 0 01.5.5v7.1l-2.36-2.36a1 1 0 00-1.41 0L7.5 9.97 6.28 8.75a1 1 0 00-1.41 0L2 11.62V2.5zm0 10.53l3.57-3.57 1.22 1.22a1 1 0 001.41 0l2.73-2.73a.01.01 0 01.01 0L14 11.01v2.49a.5.5 0 01-.5.5h-11a.5.5 0 01-.5-.5v-.47z" />
      <path d="M5.75 4.5a1.25 1.25 0 100 2.5 1.25 1.25 0 000-2.5z" />
    </svg>
  );
}

export function IconOpen({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5 3.5H3.75A1.75 1.75 0 002 5.25v7A1.75 1.75 0 003.75 14h7A1.75 1.75 0 0012.5 12.25V11"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 2H14v5.5M7.75 8.25L13.5 2.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconSnapshot({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.25 4.25A1.75 1.75 0 015 2.5h6a1.75 1.75 0 011.75 1.75v1.5h-1.2v-1.5A.55.55 0 0011 3.7H5a.55.55 0 00-.55.55v7.5c0 .3.25.55.55.55h6a.55.55 0 00.55-.55v-1.5h1.2v1.5A1.75 1.75 0 0111 13.5H5a1.75 1.75 0 01-1.75-1.75v-7.5z"
        fill="currentColor"
      />
      <path
        d="M9.6 6.2L7.8 8l1.8 1.8M8 8h5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.75 8.35l2.55 2.55 5.95-5.95"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconAlert({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.5a6.5 6.5 0 110 13 6.5 6.5 0 010-13zm0 3a.75.75 0 00-.75.75v4.1a.75.75 0 001.5 0v-4.1A.75.75 0 008 4.5zm0 7.2a1 1 0 100-2 1 1 0 000 2z" />
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
