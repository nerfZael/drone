import { cn } from '../../ui/cn';
import type { SidebarDensityMode } from '../app/settings-types';

export type SidebarDensityClasses = {
  icon: string;
  folderChevron: string;
  chatRow: string;
  chatIndent: string;
  childIndent: string;
  nestedDroneIndent: string;
  nestedDroneRail: string;
  draftRow: string;
  draftText: string;
  folderRow: string;
  folderPaddingX: string;
  folderLabel: string;
  folderInput: string;
  folderBody: string;
  folderDepthPaddingPx: number;
};

const SIDEBAR_DENSITY_CLASSES: Record<SidebarDensityMode, SidebarDensityClasses> = {
  compact: {
    icon: 'h-3 w-3 text-[var(--muted-dim)] opacity-72',
    folderChevron: 'h-3.5 w-3.5 translate-x-px text-[var(--muted-dim)] opacity-72',
    chatRow: 'h-6 pl-1 pr-1.5 text-[var(--sidebar-item-compact-size)]',
    chatIndent: 'ml-[11px] mr-1',
    childIndent: 'ml-4',
    nestedDroneIndent: '',
    nestedDroneRail: 'ml-[11px] mr-1 pl-0',
    draftRow: 'h-7 px-2.5',
    draftText: 'text-[var(--text-11)]',
    folderRow: 'min-h-6',
    folderPaddingX: 'px-1 py-0.5',
    folderLabel: 'text-[var(--sidebar-item-compact-size)]',
    folderInput: 'text-[var(--sidebar-item-compact-size)]',
    folderBody: 'ml-[11px] flex flex-col gap-0 border-l pl-0',
    folderDepthPaddingPx: 4,
  },
  default: {
    icon: 'h-3.5 w-3.5 text-[var(--muted-dim)] opacity-72',
    folderChevron: 'h-4 w-4 translate-x-px text-[var(--muted-dim)] opacity-72',
    chatRow: 'h-[25px] pl-1 pr-1.5 text-[var(--sidebar-item-size)]',
    chatIndent: 'ml-3 mr-1',
    childIndent: 'ml-5',
    nestedDroneIndent: '',
    nestedDroneRail: 'ml-3 mr-1 pl-0',
    draftRow: 'h-8 px-3',
    draftText: 'text-[var(--text-11-5)]',
    folderRow: 'min-h-7',
    folderPaddingX: 'px-1 py-0.5',
    folderLabel: 'text-[var(--sidebar-item-size)]',
    folderInput: 'text-[var(--sidebar-item-size)]',
    folderBody: 'ml-3 flex flex-col gap-0 border-l pl-0',
    folderDepthPaddingPx: 5,
  },
  comfortable: {
    icon: 'h-[15px] w-[15px] text-[var(--muted-dim)] opacity-72',
    folderChevron: 'h-[17px] w-[17px] translate-x-px text-[var(--muted-dim)] opacity-72',
    chatRow: 'h-7 pl-1 pr-2 text-[var(--sidebar-item-comfortable-size)]',
    chatIndent: 'ml-[15px] mr-1',
    childIndent: 'ml-6',
    nestedDroneIndent: '',
    nestedDroneRail: 'ml-[15px] mr-1 pl-0',
    draftRow: 'h-9 px-3',
    draftText: 'text-[var(--text-12)]',
    folderRow: 'min-h-8',
    folderPaddingX: 'px-1.5 py-1',
    folderLabel: 'text-[var(--sidebar-item-comfortable-size)]',
    folderInput: 'text-[var(--sidebar-item-comfortable-size)]',
    folderBody: 'ml-[15px] flex flex-col gap-0 border-l pl-0',
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
  const focusClass = 'focus-visible:outline-none';
  if (args.disabled) {
    return 'cursor-not-allowed border-transparent text-[var(--muted-dim)] opacity-60';
  }
  if (args.selected) {
    return `dh-sidebar-row-interactive dh-sidebar-row-selected border-transparent text-[var(--sidebar-drone-fg)] ${focusClass}`;
  }
  if (args.active) {
    return `dh-sidebar-row-interactive border-transparent text-[var(--sidebar-drone-fg)] ${focusClass}`;
  }
  return `dh-sidebar-row-interactive border-transparent text-[var(--sidebar-subitem-fg)] hover:text-[var(--sidebar-fg)] ${focusClass}`;
}

export const sidebarSelectionEdgeClass =
  'dh-sidebar-selection-edge pointer-events-none absolute top-1 bottom-1 w-[2px] rounded-r-full bg-[var(--sidebar-row-selected-edge)]';

export const sidebarFolderLabelClass =
  'min-w-0 flex-1 truncate font-normal dh-type-sidebar-heading';

export const sidebarRepositoryLabelClass =
  'min-w-0 flex-1 truncate dh-type-sidebar-repository';

export const sidebarRepositoryRowClass = 'dh-sidebar-repository-row';

export const sidebarCountClass = 'flex-shrink-0 dh-type-count';

export const sidebarChatStateClass =
  'inline-flex h-3 w-3 flex-shrink-0 items-center justify-center leading-none';

export const sidebarChatLabelClass =
  'min-w-0 flex-1 truncate [font-family:var(--sidebar-font)] font-normal';

export function sidebarItemTypeClass(active: boolean): string {
  return cn(active ? 'dh-type-sidebar-item-active' : 'dh-type-sidebar-item');
}
