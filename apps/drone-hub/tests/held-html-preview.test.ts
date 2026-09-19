import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  heldHtmlPreviewIsStale,
  initialHeldHtmlPreview,
  stepHeldHtmlPreview,
} from '../src/droneHub/files/use-held-html-preview';

const file = 'drone:/site/index.html';

describe('held HTML preview', () => {
  test('takes the file when the page finishes loading, then holds it through live reloads', () => {
    let state = initialHeldHtmlPreview(file, '');
    state = stepHeldHtmlPreview(state, { fileKey: file, showing: true, loading: true, source: '' });
    state = stepHeldHtmlPreview(state, { fileKey: file, showing: true, loading: false, source: '<h1>one</h1>' });
    expect(state.source).toBe('<h1>one</h1>');
    expect(heldHtmlPreviewIsStale(state, '<h1>one</h1>')).toBe(false);

    const held = stepHeldHtmlPreview(state, { fileKey: file, showing: true, loading: false, source: '<h1>two</h1>' });
    expect(held).toBe(state);
    expect(held.source).toBe('<h1>one</h1>');
    expect(heldHtmlPreviewIsStale(held, '<h1>two</h1>')).toBe(true);
  });

  test('an ignored version stays quiet until the file changes again', () => {
    let state = stepHeldHtmlPreview(initialHeldHtmlPreview(file, 'a'), { fileKey: file, showing: true, loading: false, source: 'a' });
    state = { ...state, ignoredSource: 'b' };
    expect(heldHtmlPreviewIsStale(state, 'b')).toBe(false);
    expect(heldHtmlPreviewIsStale(state, 'c')).toBe(true);
  });

  test('follows the file while editing, reloading from disk, or after switching files', () => {
    const shown = stepHeldHtmlPreview(initialHeldHtmlPreview(file, 'a'), { fileKey: file, showing: true, loading: false, source: 'a' });
    // Editing the source and coming back to the preview renders the edited page.
    const editing = stepHeldHtmlPreview(shown, { fileKey: file, showing: false, loading: false, source: 'edited' });
    const back = stepHeldHtmlPreview(editing, { fileKey: file, showing: true, loading: false, source: 'edited' });
    expect(back.source).toBe('edited');
    expect(heldHtmlPreviewIsStale(back, 'edited')).toBe(false);
    // An explicit reload from disk goes through a loading state.
    const reloading = stepHeldHtmlPreview(back, { fileKey: file, showing: true, loading: true, source: 'edited' });
    expect(stepHeldHtmlPreview(reloading, { fileKey: file, showing: true, loading: false, source: 'disk' }).source).toBe('disk');
    // Another file never shows the previous file's page.
    expect(stepHeldHtmlPreview(back, { fileKey: 'drone:/other.html', showing: true, loading: false, source: 'other' }).source).toBe('other');
  });

  test('settles, so stepping during render cannot loop', () => {
    const input = { fileKey: file, showing: false, loading: false, source: 'a' };
    const once = stepHeldHtmlPreview(initialHeldHtmlPreview(file, 'a'), input);
    expect(stepHeldHtmlPreview(once, input)).toBe(once);
    const shownInput = { ...input, showing: true };
    const shown = stepHeldHtmlPreview(once, shownInput);
    expect(stepHeldHtmlPreview(shown, shownInput)).toBe(shown);
  });
});

test('the editor asks before dropping unsaved edits and only HTML previews get a refresh control', () => {
  const panel = readFileSync(new URL('../src/droneHub/files/OpenedDroneFilePanel.tsx', import.meta.url), 'utf8');
  expect(panel).toContain('if (fileDirty) setReloadPromptOpen(true);');
  expect(panel).toContain('Discard my edits and reload');
  expect(panel).toContain('Save my edits');
  expect(panel).not.toContain('window.confirm');
  expect(panel).toContain('source={heldHtmlPreview.source}');
  expect(panel.match(/aria-label="Reload preview"/g)?.length).toBe(1);
  expect(panel.indexOf('{openedFileShowsHtmlPreview ? (')).toBeLessThan(panel.indexOf('aria-label="Reload preview"'));
});
