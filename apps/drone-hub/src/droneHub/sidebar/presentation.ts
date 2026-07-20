import { cn } from '../../ui/cn';
import type { SidebarDensityMode } from '../app/settings-types';

export type SidebarDensityClasses = {
  icon: string;
  emptyHint: string;
  chatRow: string;
  chatDeleteWidth: string;
  chatPlaceholderWidth: string;
  chatIndent: string;
  chatBlockIndent: string;
  childIndent: string;
  nestedDroneIndent: string;
  nestedDroneRail: string;
  draftRow: string;
  draftText: string;
  folderRow: string;
  folderPaddingX: string;
  folderLabel: string;
  folderInput: string;
  folderActionButton: string;
  folderBody: string;
  folderCreateBody: string;
  folderDepthPaddingPx: number;
};

const SIDEBAR_DENSITY_CLASSES: Record<SidebarDensityMode, SidebarDensityClasses> = {
  compact: {
    icon: 'h-3 w-3 text-[var(--muted-dim)] opacity-72',
    emptyHint:
      'flex items-center gap-2 rounded-[var(--radius-medium)] border border-dashed border-[var(--border)] bg-[var(--surface-softest)] px-2 py-1 text-[9.5px] text-[var(--muted-dim)] transition-colors hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]',
    chatRow: 'h-6 px-1.5 text-[var(--text-10)]',
    chatDeleteWidth: 'w-6',
    chatPlaceholderWidth: 'w-6',
    chatIndent: 'ml-3 mr-1',
    chatBlockIndent: 'ml-3 mr-1',
    childIndent: 'ml-4',
    nestedDroneIndent: 'ml-2',
    nestedDroneRail: 'ml-1 mr-1 pl-1',
    draftRow: 'h-7 px-2.5',
    draftText: 'text-[var(--text-11)]',
    folderRow: 'min-h-6',
    folderPaddingX: 'px-1 py-0.5',
    folderLabel: 'text-[var(--text-10)]',
    folderInput: 'px-1.5 py-0.5 text-[var(--text-10)]',
    folderActionButton: 'h-[18px] w-[18px]',
    folderBody: 'ml-0.5 flex flex-col gap-0.5 border-l pl-1',
    folderCreateBody: 'px-2 py-1',
    folderDepthPaddingPx: 4,
  },
  default: {
    icon: 'h-3.5 w-3.5 text-[var(--muted-dim)] opacity-72',
    emptyHint:
      'flex items-center gap-2 rounded-[var(--radius-medium)] border border-dashed border-[var(--border)] bg-[var(--surface-softest)] px-2 py-1.5 text-[var(--text-10)] text-[var(--muted-dim)] transition-colors hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]',
    chatRow: 'h-[25px] px-1.5 text-[var(--text-10-5)]',
    chatDeleteWidth: 'w-6',
    chatPlaceholderWidth: 'w-6',
    chatIndent: 'ml-[14px] mr-1',
    chatBlockIndent: 'ml-[14px] mr-1',
    childIndent: 'ml-5',
    nestedDroneIndent: 'ml-2.5',
    nestedDroneRail: 'ml-1 mr-1 pl-1',
    draftRow: 'h-8 px-3',
    draftText: 'text-[var(--text-11-5)]',
    folderRow: 'min-h-7',
    folderPaddingX: 'px-1 py-0.5',
    folderLabel: 'text-[var(--text-10-5)]',
    folderInput: 'px-2 py-1 text-[var(--text-10-5)]',
    folderActionButton: 'h-5 w-5',
    folderBody: 'ml-1 flex flex-col gap-0.5 border-l pl-1.5',
    folderCreateBody: 'px-2 py-1.5',
    folderDepthPaddingPx: 5,
  },
  comfortable: {
    icon: 'h-[15px] w-[15px] text-[var(--muted-dim)] opacity-72',
    emptyHint:
      'flex items-center gap-2 rounded-[var(--radius-medium)] border border-dashed border-[var(--border)] bg-[var(--surface-softest)] px-2.5 py-2 text-[var(--text-10-5)] text-[var(--muted-dim)] transition-colors hover:border-[var(--accent-muted)] hover:bg-[var(--accent-subtle)] hover:text-[var(--accent)]',
    chatRow: 'h-7 px-2 text-[var(--text-11)]',
    chatDeleteWidth: 'w-7',
    chatPlaceholderWidth: 'w-7',
    chatIndent: 'ml-[18px] mr-1',
    chatBlockIndent: 'ml-[18px] mr-1',
    childIndent: 'ml-6',
    nestedDroneIndent: 'ml-3.5',
    nestedDroneRail: 'ml-1.5 mr-1 pl-1.5',
    draftRow: 'h-9 px-3',
    draftText: 'text-[var(--text-12)]',
    folderRow: 'min-h-8',
    folderPaddingX: 'px-1.5 py-1',
    folderLabel: 'text-[var(--text-11)]',
    folderInput: 'px-2 py-1 text-[var(--text-11)]',
    folderActionButton: 'h-5 w-5',
    folderBody: 'ml-1.5 flex flex-col gap-0.5 border-l pl-2',
    folderCreateBody: 'px-2.5 py-2',
    folderDepthPaddingPx: 6,
  },
};

export function sidebarDensityClasses(mode: SidebarDensityMode): SidebarDensityClasses {
  return SIDEBAR_DENSITY_CLASSES[mode];
}

export function sidebarChatRowTone(args: {
  selected?: boolean;
  active?: boolean;
  disabled?: boolean;
}): string {
  if (args.disabled) {
    return 'cursor-not-allowed border-transparent text-[var(--muted-dim)] opacity-60';
  }
  if (args.selected) {
    return 'border-transparent bg-[var(--sidebar-row-selected-bg)] text-[var(--sidebar-fg-active)]';
  }
  if (args.active) {
    return 'border-transparent bg-[var(--surface-soft)] text-[var(--sidebar-fg)]';
  }
  return 'border-transparent text-[var(--sidebar-subitem-fg)] hover:bg-[var(--surface-soft)] hover:text-[var(--sidebar-fg)]';
}

export const sidebarFolderLabelClass =
  'min-w-0 flex-1 truncate font-normal dh-type-sidebar-heading';

export const sidebarCountClass = 'flex-shrink-0 dh-type-count';

export const sidebarChatStateClass =
  'grid w-[4.75rem] flex-shrink-0 grid-cols-[.75rem_minmax(0,1fr)] items-center gap-1 font-mono text-[.5625rem] font-medium leading-none';

export function sidebarItemTypeClass(active: boolean): string {
  return cn(active ? 'dh-type-sidebar-item-active' : 'dh-type-sidebar-item');
}
