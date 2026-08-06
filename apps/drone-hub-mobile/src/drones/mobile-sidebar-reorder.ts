export {
  applyOptimisticSidebarMove as applyOptimisticMobileSidebarMove,
  applySidebarMoveIntoFolder as applyMobileSidebarMoveIntoFolder,
  applySidebarReorder as applyMobileSidebarReorder,
  firstSidebarInsertionTarget as firstMobileSidebarInsertionTarget,
  reorderSidebarEntries as reorderMobileSidebarEntries,
  sidebarMoveDestination as mobileSidebarMoveDestination,
} from '@drone/hub-model/sidebar';

import type { SidebarMoveIntent, SidebarSetPinnedIntent } from '@drone/hub-model/sidebar';

export type {
  SidebarDropPlacement as MobileSidebarDropPlacement,
  SidebarMoveIntoFolderIntent as MobileSidebarMoveIntoFolderRequest,
  SidebarReorderIntent as MobileSidebarReorderRequest,
} from '@drone/hub-model/sidebar';

export type MobileSidebarMutationRequest = Exclude<
  SidebarMoveIntent,
  SidebarSetPinnedIntent
>;
