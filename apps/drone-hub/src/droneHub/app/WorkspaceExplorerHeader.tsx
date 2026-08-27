import React from 'react';
import { UiToolbarButton, UiToolbarGroup } from '../../ui/components';
import {
  WORKSPACE_EXPLORER_ZOOM_MAX,
  WORKSPACE_EXPLORER_ZOOM_MIN,
} from './workspace-explorer-preferences';

type WorkspaceExplorerHeaderProps = {
  zoom: number;
  onDecreaseZoom: () => void;
  onIncreaseZoom: () => void;
  onResetZoom: () => void;
  dragHandle?: {
    onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
    onDragEnd: (event: React.DragEvent<HTMLDivElement>) => void;
    title: string;
  };
};

export function WorkspaceExplorerHeader({
  zoom,
  onDecreaseZoom,
  onIncreaseZoom,
  onResetZoom,
  dragHandle,
}: WorkspaceExplorerHeaderProps) {
  return (
    <div className="dh-utility-panel-chrome flex h-8 shrink-0 items-center justify-between gap-1 border-b border-[var(--border-subtle)] px-2">
      <div
        draggable={Boolean(dragHandle)}
        onDragStart={dragHandle?.onDragStart}
        onDragEnd={dragHandle?.onDragEnd}
        title={dragHandle?.title}
        className={`flex h-full min-w-0 flex-1 items-center ${
          dragHandle ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
      >
        <span className="dh-changes-toolbar-label">Files</span>
      </div>
      <UiToolbarGroup label="Explorer zoom">
        <UiToolbarButton
          size="xsmall"
          onClick={onDecreaseZoom}
          disabled={zoom <= WORKSPACE_EXPLORER_ZOOM_MIN}
          className="w-5 px-0"
          title="Decrease explorer zoom"
        >
          −
        </UiToolbarButton>
        <UiToolbarButton
          size="xsmall"
          onClick={onResetZoom}
          className="min-w-9 px-1 font-mono"
          title="Reset explorer zoom"
        >
          {Math.round(zoom * 100)}%
        </UiToolbarButton>
        <UiToolbarButton
          size="xsmall"
          onClick={onIncreaseZoom}
          disabled={zoom >= WORKSPACE_EXPLORER_ZOOM_MAX}
          className="w-5 px-0"
          title="Increase explorer zoom"
        >
          +
        </UiToolbarButton>
      </UiToolbarGroup>
    </div>
  );
}
