import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  clampEditorZoomLevel,
  editorZoomedPixels,
  editorZoomLevelFromLegacyDiffZoom,
} from '../src/droneHub/files/editor-zoom';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('shared editor zoom', () => {
  test('uses bounded integer levels and proportional editor sizes', () => {
    expect(clampEditorZoomLevel(-20)).toBe(-4);
    expect(clampEditorZoomLevel(20)).toBe(8);
    expect(clampEditorZoomLevel(1.6)).toBe(2);
    expect(editorZoomedPixels(12, 0)).toBe(12);
    expect(editorZoomedPixels(12, 1)).toBe(13.2);
  });

  test('migrates the former diff scale without changing its apparent size', () => {
    expect(editorZoomLevelFromLegacyDiffZoom(1.1)).toBe(0);
    expect(editorZoomLevelFromLegacyDiffZoom(0.9)).toBe(-2);
    expect(editorZoomLevelFromLegacyDiffZoom(1.5)).toBe(3);
  });

  test('suppresses browser modifier-wheel zoom and marks every editor surface', () => {
    const zoom = source('../src/droneHub/files/editor-zoom.tsx');
    const app = source('../src/DroneHubApp.tsx');
    const changes = source('../src/droneHub/changes/DroneChangesDock.tsx');
    const historical = source('../src/droneHub/changes/AgentRunHistoricalChangesView.tsx');
    const fileEditor = source('../src/droneHub/files/OpenedDroneFilePanel.tsx');
    const composer = source('../src/droneHub/chat/ChatComposerEditor.tsx');
    const compactComposer = source('../src/droneHub/chat/ChatInput.tsx');

    expect(zoom).toContain('event.preventDefault()');
    expect(zoom).toContain("window.addEventListener('wheel', onWheel, { capture: true, passive: false })");
    expect(app).toContain('<EditorZoomController />');
    expect(changes).toContain('data-editor-zoom-surface="changes"');
    expect(historical).toContain('data-editor-zoom-surface="historical-changes"');
    expect(fileEditor).toContain('data-editor-zoom-surface="file-editor"');
    expect(composer).toContain('data-editor-zoom-surface="chat-composer-editor"');
    expect(compactComposer).not.toContain('data-editor-zoom-surface="chat-composer"');
    expect(compactComposer).not.toContain('useEditorZoomLevel');
  });

  test('resets full editor zoom with Control or Command plus zero', () => {
    const zoom = source('../src/droneHub/files/editor-zoom.tsx');

    expect(zoom).toContain("event.key !== '0'");
    expect(zoom).toContain('resetEditorZoomLevel()');
    expect(zoom).toContain("window.addEventListener('keydown', onKeyDown, { capture: true })");
  });

  test('does not retain visible diff zoom controls', () => {
    const changes = source('../src/droneHub/changes/DroneChangesDock.tsx');
    const historical = source('../src/droneHub/changes/AgentRunHistoricalChangesView.tsx');

    expect(changes).not.toContain('DiffZoomControl');
    expect(historical).not.toContain('DiffZoomControl');
    expect(changes).not.toContain('Code zoom');
    expect(historical).not.toContain('Code zoom');
  });
});
