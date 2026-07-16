import React from 'react';

export {
  IconChat,
  IconChevron,
  IconCopy,
  IconDrone,
  IconFolder,
  IconList,
  IconSpinner,
  IconTrash,
} from '../icons';

export function IconSettings({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6.8 1.03a1.2 1.2 0 012.4 0l.1.81a5.9 5.9 0 011.36.57l.68-.46a1.2 1.2 0 011.53.15l1.4 1.4a1.2 1.2 0 01.15 1.53l-.46.68c.23.43.42.89.56 1.36l.81.1a1.2 1.2 0 010 2.4l-.81.1a5.9 5.9 0 01-.56 1.36l.46.68a1.2 1.2 0 01-.15 1.53l-1.4 1.4a1.2 1.2 0 01-1.53.15l-.68-.46c-.43.23-.89.42-1.36.56l-.1.81a1.2 1.2 0 01-2.4 0l-.1-.81a5.9 5.9 0 01-1.36-.56l-.68.46a1.2 1.2 0 01-1.53-.15l-1.4-1.4a1.2 1.2 0 01-.15-1.53l.46-.68a5.9 5.9 0 01-.56-1.36l-.81-.1a1.2 1.2 0 010-2.4l.81-.1a5.9 5.9 0 01.56-1.36l-.46-.68a1.2 1.2 0 01.15-1.53l1.4-1.4a1.2 1.2 0 011.53-.15l.68.46c.43-.23.89-.42 1.36-.57l.1-.81zM8 5.75a2.25 2.25 0 100 4.5 2.25 2.25 0 000-4.5z" />
    </svg>
  );
}

export function IconDevices({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="2" width="9" height="8" rx="1.25" />
      <path d="M4 13h4M6 10v3" />
      <rect x="11.5" y="5" width="3" height="8" rx="0.75" />
    </svg>
  );
}

export function IconWrench({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.7 2.1a3.7 3.7 0 0 0-4.55 4.55l-3.7 3.7a1.65 1.65 0 0 0 2.33 2.33l3.7-3.7a3.7 3.7 0 0 0 4.55-4.55L9.9 6.56 8.15 4.81 9.7 2.1Z" />
      <circle cx="2.75" cy="11.38" r=".55" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconShieldCheck({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1.5l5 2v3.6c0 3.35-1.95 5.95-5 7.4-3.05-1.45-5-4.05-5-7.4V3.5l5-2z" />
      <path d="M5.6 7.8l1.55 1.55 3.35-3.5" />
    </svg>
  );
}

export function IconPlus({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 1.75a.75.75 0 01.75.75v4.75h4.75a.75.75 0 010 1.5H8.75v4.75a.75.75 0 01-1.5 0V8.75H2.5a.75.75 0 010-1.5h4.75V2.5A.75.75 0 018 1.75z" />
    </svg>
  );
}

export function IconPlusDouble({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M5 2.25a.75.75 0 01.75.75v2.5h2.5a.75.75 0 010 1.5h-2.5v2.5a.75.75 0 01-1.5 0V7h-2.5a.75.75 0 010-1.5h2.5V3A.75.75 0 015 2.25z" />
      <path d="M11 6.25a.75.75 0 01.75.75v2h2a.75.75 0 010 1.5h-2v2a.75.75 0 01-1.5 0v-2h-2a.75.75 0 010-1.5h2V7A.75.75 0 0111 6.25z" />
    </svg>
  );
}

export function IconColumns({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="4.5" height="11" rx="1" />
      <rect x="5.75" y="2.5" width="4.5" height="11" rx="1" />
      <rect x="10" y="2.5" width="4.5" height="11" rx="1" />
    </svg>
  );
}

export function IconChatThread({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="3" cy="4" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="3" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="3" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <path d="M5.5 4h6.5" />
      <path d="M5.5 8h5" />
      <path d="M5.5 12h7.5" />
    </svg>
  );
}

export function IconTable({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <line x1="1.5" y1="6" x2="14.5" y2="6" />
      <line x1="1.5" y1="9.5" x2="14.5" y2="9.5" />
      <line x1="6" y1="6" x2="6" y2="13.5" />
    </svg>
  );
}

export function IconBoard({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="4" height="11" rx="1" />
      <rect x="6" y="2.5" width="4" height="11" rx="1" />
      <rect x="10.5" y="2.5" width="4" height="11" rx="1" />
      <path d="M2.7 5h1.6" />
      <path d="M7.2 5h1.6" />
      <path d="M11.7 5h1.6" />
      <path d="M2.7 7.7h1" />
      <path d="M7.2 7.7h1" />
      <path d="M11.7 7.7h1" />
    </svg>
  );
}

export function IconTreeView({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 2.5v11" />
      <path d="M4 5h2.5" />
      <path d="M6.5 5h5" />
      <path d="M4 11h2.5" />
      <path d="M6.5 11h5" />
      <circle cx="10.75" cy="5" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="10.75" cy="11" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconAutoMinimize({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.25" width="13" height="11.5" rx="1.25" />
      <line x1="5.5" y1="2.25" x2="5.5" y2="13.75" />
      <path d="M10.75 6L8 8l2.75 2" />
    </svg>
  );
}

export function IconClock({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 4.75V8l2.25 1.4" />
    </svg>
  );
}

export function IconSidebarCollapse({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 3L6 8l5 5" />
      <line x1="3" y1="3" x2="3" y2="13" />
    </svg>
  );
}

export function IconSidebarExpand({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 3l5 5-5 5" />
      <line x1="13" y1="3" x2="13" y2="13" />
    </svg>
  );
}

export function IconPencil({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.94 8.94a.75.75 0 01-.318.19l-3.5 1a.75.75 0 01-.927-.927l1-3.5a.75.75 0 01.19-.318l8.935-8.945zM12.073 2.487L3.5 11.06l-.64 2.24 2.24-.64 8.573-8.573-1.6-1.6z" />
    </svg>
  );
}

export function IconGrip({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="5" cy="4" r="1" />
      <circle cx="11" cy="4" r="1" />
      <circle cx="5" cy="8" r="1" />
      <circle cx="11" cy="8" r="1" />
      <circle cx="5" cy="12" r="1" />
      <circle cx="11" cy="12" r="1" />
    </svg>
  );
}

export function IconTune({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 4h3" />
      <path d="M8 4h6" />
      <circle cx="6.5" cy="4" r="1.5" />
      <path d="M2 8h7" />
      <path d="M12 8h2" />
      <circle cx="10.5" cy="8" r="1.5" />
      <path d="M2 12h2" />
      <path d="M7 12h7" />
      <circle cx="5.5" cy="12" r="1.5" />
    </svg>
  );
}

export function IconEye({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.3 8c1.5-2.5 3.8-4 6.7-4s5.2 1.5 6.7 4c-1.5 2.5-3.8 4-6.7 4S2.8 10.5 1.3 8z" />
      <circle cx="8" cy="8" r="2.2" />
    </svg>
  );
}

export function IconEyeOff({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.3 8c1.5-2.5 3.8-4 6.7-4 1.2 0 2.3.25 3.3.74" />
      <path d="M14.7 8c-.58.97-1.28 1.8-2.09 2.43A7.2 7.2 0 018 12c-2.9 0-5.2-1.5-6.7-4 .56-.94 1.22-1.74 1.99-2.37" />
      <circle cx="8" cy="8" r="2.2" />
      <path d="M2 2l12 12" />
    </svg>
  );
}

export function IconMore({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="4" cy="8" r="1.35" />
      <circle cx="8" cy="8" r="1.35" />
      <circle cx="12" cy="8" r="1.35" />
    </svg>
  );
}

export function IconVsCode({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M11.8 1.6a1 1 0 011.2.2l1.2 1.2a1 1 0 01.3.7v8.6a1 1 0 01-.3.7l-1.2 1.2a1 1 0 01-1.2.2L6.4 11.7 3.9 14.2a1 1 0 01-1.4 0l-1-1a1 1 0 010-1.4L3.6 9.7 1.5 7.6a1 1 0 010-1.4l1-1a1 1 0 011.4 0L6.4 7.3 11.8 1.6zM6.4 8.7L4.9 10.2l1.5 1.5 4.2 2.8V2.9L6.4 8.7z" />
    </svg>
  );
}

export function IconCursorApp({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3.2 1.4a.75.75 0 011.02-.24l9.6 5.6a.75.75 0 01-.05 1.33l-3.63 1.66 1.67 3.62a.75.75 0 01-1.02.98l-1.73-.79-1.6-.72-1.66 3.63a.75.75 0 01-1.33.05L1.16 4.22a.75.75 0 01.24-1.02L3.2 1.4zm.12 1.93l2.67 9.9 1.14-2.5a.75.75 0 011.01-.36l2.5 1.14-.9-1.95a.75.75 0 01.36-1.01l2.5-1.14-9.9-2.67z" />
    </svg>
  );
}

export function SkeletonLine({ w }: { w: string }) {
  return (
    <div className="h-2.5 rounded bg-[var(--border-subtle)] animate-pulse" style={{ width: w }} />
  );
}
