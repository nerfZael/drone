import React from 'react';

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

export function IconJobs({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2.5 2A1.5 1.5 0 014 0.5h8A1.5 1.5 0 0113.5 2v12A1.5 1.5 0 0112 15.5H4A1.5 1.5 0 012.5 14V2zm1.5-.5a.5.5 0 00-.5.5v12a.5.5 0 00.5.5h8a.5.5 0 00.5-.5V2a.5.5 0 00-.5-.5H4z" />
      <path d="M6.35 5.1a.6.6 0 01.85.85L5.6 7.55a.6.6 0 01-.85 0l-.8-.8a.6.6 0 11.85-.85l.375.375L6.35 5.1z" />
      <path d="M7.75 6.5a.5.5 0 01.5-.5h3.25a.5.5 0 010 1H8.25a.5.5 0 01-.5-.5z" />
      <path d="M6.35 8.6a.6.6 0 01.85.85L5.6 11.05a.6.6 0 01-.85 0l-.8-.8a.6.6 0 11.85-.85l.375.375L6.35 8.6z" />
      <path d="M7.75 10a.5.5 0 01.5-.5h3.25a.5.5 0 010 1H8.25a.5.5 0 01-.5-.5z" />
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
