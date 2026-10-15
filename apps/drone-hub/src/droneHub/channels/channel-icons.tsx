import React from 'react';

function Stroke({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg
      className={className ?? 'h-3.5 w-3.5'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconHash = ({ className }: { className?: string }) => (
  <Stroke className={className}><path d="M5 9h14M4 15h14M10 3 8 21M16 3l-2 18" /></Stroke>
);

export const IconBell = ({ className }: { className?: string }) => (
  <Stroke className={className}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </Stroke>
);

export const IconBellOff = ({ className }: { className?: string }) => (
  <Stroke className={className}>
    <path d="M8.7 3A6 6 0 0 1 18 8c0 2.7.4 4.6 1 6M17 17H3s3-2 3-9a5.7 5.7 0 0 1 .3-1.9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0M2 2l20 20" />
  </Stroke>
);

export const IconAt = ({ className }: { className?: string }) => (
  <Stroke className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
  </Stroke>
);

export const IconReply = ({ className }: { className?: string }) => (
  <Stroke className={className}><path d="m9 17-5-5 5-5" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></Stroke>
);

export const IconUsers = ({ className }: { className?: string }) => (
  <Stroke className={className}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </Stroke>
);

export const IconSend = ({ className }: { className?: string }) => (
  <Stroke className={className}><path d="M5 12h13M12 5l7 7-7 7" /></Stroke>
);

export const IconClose = ({ className }: { className?: string }) => (
  <Stroke className={className}><path d="M18 6 6 18M6 6l12 12" /></Stroke>
);

export const IconPlusSmall = ({ className }: { className?: string }) => (
  <Stroke className={className}><path d="M12 5v14M5 12h14" /></Stroke>
);

export const IconList = ({ className }: { className?: string }) => (
  <Stroke className={className}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></Stroke>
);

export const IconNoRead = ({ className }: { className?: string }) => (
  <Stroke className={className}>
    <path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
    <path d="M2 2l20 20" />
  </Stroke>
);

export const IconNoSend = ({ className }: { className?: string }) => (
  <Stroke className={className}><path d="M5 12h8M12 5l3 3M2 2l20 20M19 12l-3 3" /></Stroke>
);

export const IconCheckSmall = ({ className }: { className?: string }) => (
  <Stroke className={className}><path d="M20 6 9 17l-5-5" /></Stroke>
);
