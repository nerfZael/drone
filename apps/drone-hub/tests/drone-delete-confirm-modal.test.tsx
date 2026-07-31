import React from 'react';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DroneDeleteConfirmModal } from '../src/droneHub/app/DroneDeleteConfirmModal';

describe('drone delete confirmation modal', () => {
  test('presents archive targets as a compact name-only list', () => {
    const html = renderToStaticMarkup(
      <DroneDeleteConfirmModal
        deleteMode="archive"
        drones={[
          { id: 'drone-alpha-id', label: 'Alpha' },
          { id: 'drone-beta-id', label: 'Beta' },
        ]}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(html).toContain('<span>Archive</span>');
    expect(html).toContain('2 drones');
    expect(html).not.toContain('Confirm Archive');
    expect(html).toContain('Alpha');
    expect(html).toContain('Beta');
    expect(html).not.toContain('drone-alpha-id');
    expect(html).not.toContain('drone-beta-id');
    expect(html).toContain('role="list"');
    expect(html).toContain('text-[var(--muted-dim)]">Archive</span>');
  });

  test('uses native form submission so Enter confirms the action', () => {
    const html = renderToStaticMarkup(
      <DroneDeleteConfirmModal
        deleteMode="permanent"
        drones={[{ id: 'drone-alpha-id', label: 'Alpha' }]}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(html).toContain('<form');
    expect(html).toContain('type="submit"');
    expect(html).toContain('aria-keyshortcuts="Enter"');
    expect(html).toContain('<span>Delete</span>');
    expect(html).toContain('1 drone');
  });
});
