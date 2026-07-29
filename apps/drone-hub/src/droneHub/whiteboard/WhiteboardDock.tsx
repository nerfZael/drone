import React from 'react';
import {
  UiMenuSelect,
  UiPaneState,
  UiPanel,
  UiPanelBody,
  UiPanelHeader,
  UiPanelStatusStrip,
  UiPanelToolbar,
  UiStatusChip,
  UiToolbarButton,
} from '../../ui/components';
import type { WhiteboardSummary } from './whiteboard-types';
import { useWhiteboardState } from './use-whiteboard-state';
import { WhiteboardCanvas } from './WhiteboardCanvas';

function whiteboardLabel(item: WhiteboardSummary): string {
  const title = String(item.title ?? '').trim() || item.id;
  return item.id === 'main' ? `${title} - main` : title;
}

export function WhiteboardDock({ droneId }: { droneId: string }) {
  const {
    whiteboards,
    activeId,
    document,
    editorKey,
    loading,
    saving,
    dirty,
    error,
    notice,
    activeInitialData,
    loadDocument,
    handleChange,
    handleCreate,
  } = useWhiteboardState(droneId);
  const status = saving
    ? { label: 'Saving…', tone: 'info' as const }
    : dirty
      ? { label: 'Unsaved', tone: 'warning' as const }
      : loading
        ? { label: 'Loading…', tone: 'neutral' as const }
        : document
          ? { label: `v${document.version}`, tone: 'success' as const }
          : { label: 'No board', tone: 'neutral' as const };

  return (
    <UiPanel flush surface="alternate" className="h-full w-full">
      <UiPanelHeader
        title="Whiteboard"
        density="compact"
        meta={
          <UiStatusChip tone={status.tone} aria-live="polite">
            {status.label}
          </UiStatusChip>
        }
        actions={
          <UiToolbarButton
            size="xsmall"
            tone="accent"
            onClick={() => void handleCreate()}
            disabled={loading}
          >
            New
          </UiToolbarButton>
        }
      />
      <UiPanelToolbar aria-label="Whiteboard controls" className="overflow-visible">
        <UiMenuSelect
          variant="toolbar"
          value={activeId}
          disabled={loading || whiteboards.length === 0}
          onValueChange={(value) => void loadDocument(value)}
          entries={whiteboards.map((item) => ({
            value: item.id,
            label: whiteboardLabel(item),
          }))}
          title="Select whiteboard"
          containerClassName="min-w-0 flex-1"
          triggerClassName="w-full"
          panelClassName="w-[min(22rem,calc(100vw-3rem))]"
        />
      </UiPanelToolbar>
      {error || notice ? (
        <UiPanelStatusStrip tone={error ? 'danger' : 'neutral'}>
          {error ?? notice}
        </UiPanelStatusStrip>
      ) : null}
      <UiPanelBody className="relative">
        {loading && !document ? (
          <UiPaneState kind="loading" title="Loading whiteboard…" />
        ) : document ? (
          <WhiteboardCanvas
            key={`${document.id}:${editorKey}`}
            initialData={activeInitialData}
            onChange={handleChange}
          />
        ) : (
          <UiPaneState
            kind="empty"
            title="No whiteboard available"
            description="Create a whiteboard to start sketching."
            action={
              <UiToolbarButton tone="accent" active onClick={() => void handleCreate()}>
                New whiteboard
              </UiToolbarButton>
            }
          />
        )}
      </UiPanelBody>
    </UiPanel>
  );
}
