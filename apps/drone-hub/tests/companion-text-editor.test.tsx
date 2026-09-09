import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompanionTextEditor } from '../src/droneHub/companion/CompanionTextEditor';

const props = {
  id: 'companion-instructions-editor', title: 'Companion instructions', content: '', maxChars: 50_000,
  loading: false, saving: false, error: '', dirty: false,
  onChange() {}, onClose() {}, save: async () => true, load: async () => {},
};

test('an initially empty instructions document opens an editable dialog with Save and Discard', () => {
  const html = renderToStaticMarkup(<CompanionTextEditor {...props} />);
  expect(html).toContain('role="dialog"');
  expect(html).toContain('aria-label="Edit Companion instructions"');
  expect(html).toContain('>Save</button>');
  expect(html).toContain('>Discard</button>');
  expect(html).not.toMatch(/<button[^>]* disabled=""[^>]*>Save<\/button>/);
});

test('conflicting saves preserve the draft and offer loading the latest version', () => {
  const html = renderToStaticMarkup(<CompanionTextEditor {...props} content="Keep my draft" dirty conflict error="Instructions changed." />);
  expect(html).toContain('Keep my draft');
  expect(html).toContain('Instructions changed.');
  expect(html).toContain('Discard draft and load latest');
  expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Save<\/button>/);
});

test('oversized text cannot be saved, including in the shared system-prompt editor', () => {
  const html = renderToStaticMarkup(<CompanionTextEditor {...props} title="Companion system prompt" content="Too long" maxChars={3} dirty />);
  expect(html).toContain('Companion system prompt exceeds 3 characters.');
  expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Save<\/button>/);
});
