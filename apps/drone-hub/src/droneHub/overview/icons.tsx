import React from 'react';

export { IconChat, IconChevron, IconDrone, IconFolder, IconMessageCircle, IconSpinner, IconTrash } from '../icons';

export function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.75a.75.75 0 01.75.75v4.75h4.75a.75.75 0 010 1.5H8.75v4.75a.75.75 0 01-1.5 0V8.75H2.5a.75.75 0 010-1.5h4.75V2.5A.75.75 0 018 1.75z" />
    </svg>
  );
}

export function IconMore({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="4" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="12" cy="8" r="1.25" />
    </svg>
  );
}

export function IconPin({ className, filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill={filled ? 'currentColor' : 'none'} aria-hidden="true">
      <path d="M5.1 1.5h5.8l-.8 4.1 2.15 2.15v1.1H8.7V14.5H7.3V8.85H3.75v-1.1L5.9 5.6l-.8-4.1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
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

export function IconBaseImage({ className }: { className?: string }) {
  // "Base image" / "set as base" icon: star inside a frame.
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M3.25 2A1.75 1.75 0 001.5 3.75v8.5c0 .966.784 1.75 1.75 1.75h9.5A1.75 1.75 0 0014.5 12.25v-8.5A1.75 1.75 0 0012.75 2h-9.5zM2.5 3.75a.75.75 0 01.75-.75h9.5a.75.75 0 01.75.75v8.5a.75.75 0 01-.75.75h-9.5a.75.75 0 01-.75-.75v-8.5z" />
      <path d="M8 4.3l1.02 2.07 2.28.33-1.65 1.61.39 2.27L8 9.52 5.96 10.58l.39-2.27L4.7 6.7l2.28-.33L8 4.3z" />
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
