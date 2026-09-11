import { describe, expect, test } from 'bun:test';
import {
  FILE_TAB_DRAG_TYPE,
  filePanelId,
  filePanelPositionForDrop,
  fileTabIdFromPanelId,
  hasFileTabDragPayload,
  readFileTabDragPayload,
  setFileTabDragPayload,
} from '../src/droneHub/app/file-tab-drag';

class FakeDataTransfer {
  private readonly data = new Map<string, string>();
  get types(): string[] { return [...this.data.keys()]; }
  setData(type: string, value: string) { this.data.set(type, value); }
  getData(type: string) { return this.data.get(type) ?? ''; }
}

describe('file tab drag payload', () => {
  test('round-trips through the drag data transfer', () => {
    const dataTransfer = new FakeDataTransfer();
    setFileTabDragPayload(dataTransfer, { droneId: 'd1', tabId: 'file:d1:src%2Fa.ts', path: 'src/a.ts', name: 'a.ts' });
    expect(dataTransfer.types).toEqual([FILE_TAB_DRAG_TYPE]);
    expect(hasFileTabDragPayload({ dataTransfer })).toBe(true);
    expect(readFileTabDragPayload({ dataTransfer })).toEqual({ droneId: 'd1', tabId: 'file:d1:src%2Fa.ts', path: 'src/a.ts', name: 'a.ts' });
  });

  test('ignores drags that are not file tabs and rejects incomplete payloads', () => {
    const plain = new FakeDataTransfer();
    plain.setData('text/plain', 'file:d1:x');
    expect(hasFileTabDragPayload({ dataTransfer: plain })).toBe(false);
    expect(readFileTabDragPayload({ dataTransfer: plain })).toBeNull();
    expect(readFileTabDragPayload(null)).toBeNull();

    const broken = new FakeDataTransfer();
    broken.setData(FILE_TAB_DRAG_TYPE, '{"droneId":"d1"}');
    expect(readFileTabDragPayload({ dataTransfer: broken })).toBeNull();
    broken.setData(FILE_TAB_DRAG_TYPE, 'not json');
    expect(readFileTabDragPayload({ dataTransfer: broken })).toBeNull();
  });

  test('derives a file name from the path when the payload has none', () => {
    const dataTransfer = new FakeDataTransfer();
    dataTransfer.setData(FILE_TAB_DRAG_TYPE, JSON.stringify({ droneId: 'd1', tabId: 't', path: 'src/lib/b.ts', name: '' }));
    expect(readFileTabDragPayload({ dataTransfer })?.name).toBe('b.ts');
  });

  test('panel ids embed the tab id', () => {
    expect(filePanelId('file:d1:a')).toBe('file-tab:file:d1:a');
    expect(fileTabIdFromPanelId('file-tab:file:d1:a')).toBe('file:d1:a');
    expect(fileTabIdFromPanelId('tool:editor')).toBeNull();
  });

  test('maps drop positions to Dockview placements', () => {
    expect(filePanelPositionForDrop('center', 'g1')).toEqual({ direction: 'within', referenceGroup: 'g1' });
    expect(filePanelPositionForDrop('bottom', 'g1')).toEqual({ direction: 'below', referenceGroup: 'g1' });
    expect(filePanelPositionForDrop('top', 'g1')).toEqual({ direction: 'above', referenceGroup: 'g1' });
    expect(filePanelPositionForDrop('left', 'g1')).toEqual({ direction: 'left', referenceGroup: 'g1' });
    // Workspace-edge drops have no reference pane and span the whole edge.
    expect(filePanelPositionForDrop('right', null)).toEqual({ direction: 'right' });
    expect(filePanelPositionForDrop('center', undefined)).toEqual({ direction: 'right' });
  });
});
