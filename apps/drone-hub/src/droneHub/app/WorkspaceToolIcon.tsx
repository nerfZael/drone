import React from 'react';
import type { RightPanelTab } from './app-config';

function ActivityIcon({
  tab,
  className,
  children,
}: {
  tab: RightPanelTab;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      data-workspace-tool-icon={tab}
      className={className}
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function WorkspaceToolIcon({
  tab,
  className,
}: {
  tab: RightPanelTab;
  className?: string;
}) {
  switch (tab) {
    case 'terminal':
      return (
        <ActivityIcon tab={tab} className={className}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="m7 9 3 3-3 3M13 15h4" />
        </ActivityIcon>
      );
    case 'env':
      return (
        <ActivityIcon tab={tab} className={className}>
          <path d="M4 7h4M12 7h8M4 17h8M16 17h4" />
          <circle cx="10" cy="7" r="2" />
          <circle cx="14" cy="17" r="2" />
        </ActivityIcon>
      );
    case 'files':
    case 'editor':
      return (
        <ActivityIcon tab={tab} className={className}>
          <path d="M7 3h7l4 4v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
          <path d="M14 3v4h4M5 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7" />
        </ActivityIcon>
      );
    case 'preview':
      return (
        <ActivityIcon tab={tab} className={className}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18" />
          <path d="M7 6.5h.01M10 6.5h.01" strokeWidth="2.25" />
        </ActivityIcon>
      );
    case 'links':
      return (
        <ActivityIcon tab={tab} className={className}>
          <path d="m10 13.5 4-4" />
          <path d="M7.5 16H6a4 4 0 0 1 0-8h3M16.5 8H18a4 4 0 0 1 0 8h-3" />
        </ActivityIcon>
      );
    case 'changes':
      return (
        <ActivityIcon tab={tab} className={className}>
          <circle cx="6" cy="5" r="2" />
          <circle cx="6" cy="19" r="2" />
          <circle cx="18" cy="19" r="2" />
          <path d="M6 7v10M8 7h3a7 7 0 0 1 7 7v3" />
        </ActivityIcon>
      );
    case 'prs':
      return (
        <ActivityIcon tab={tab} className={className}>
          <circle cx="6" cy="5" r="2" />
          <circle cx="6" cy="19" r="2" />
          <circle cx="18" cy="19" r="2" />
          <path d="M6 7v10M13 5h2a3 3 0 0 1 3 3v9M13 2l-3 3 3 3" />
        </ActivityIcon>
      );
    case 'canvas':
      return (
        <ActivityIcon tab={tab} className={className}>
          <circle cx="12" cy="5" r="2.25" />
          <circle cx="5" cy="18" r="2.25" />
          <circle cx="19" cy="18" r="2.25" />
          <path d="m10.9 7-4.8 9M13.1 7l4.8 9M7.25 18h9.5" />
        </ActivityIcon>
      );
    case 'whiteboard':
      return (
        <ActivityIcon tab={tab} className={className}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="m7 16 3.1-6 3.2 4 3.7-5M16 17h2" />
        </ActivityIcon>
      );
    case 'workflows':
      return (
        <ActivityIcon tab={tab} className={className}>
          <rect x="3" y="3" width="6" height="6" rx="1.25" />
          <rect x="15" y="3" width="6" height="6" rx="1.25" />
          <rect x="15" y="15" width="6" height="6" rx="1.25" />
          <path d="M9 6h6M12 6v12h3" />
        </ActivityIcon>
      );
  }
}
