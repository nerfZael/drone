import React from 'react';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { CompanionMenuItem, CompanionMenuSection } from '../src/droneHub/companion/CompanionOptionsMenu';

describe('Companion options menu rows', () => {
  test('a switch row exposes its state and keeps the label separate from the meta', () => {
    const html = renderToStaticMarkup(
      <CompanionMenuSection label="Voice">
        <CompanionMenuItem label="Live voice" description="Live voice on; remembered" meta="Saving…" checked onSelect={() => {}} />
      </CompanionMenuSection>,
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Voice"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('>Live voice</span>');
    expect(html).toContain('>Saving…</span>');
    expect(html).toContain('bg-[var(--accent)]');
  });

  test('an opener row renders a chevron and a danger row uses the red tone', () => {
    const opener = renderToStaticMarkup(
      <CompanionMenuItem label="Workspaces" expanded={false} controls="companion-workspace-picker" onSelect={() => {}} />,
    );
    expect(opener).toContain('aria-expanded="false"');
    expect(opener).toContain('aria-controls="companion-workspace-picker"');
    expect(opener).not.toContain('role="switch"');
    expect(opener).toContain('<svg');
    const danger = renderToStaticMarkup(<CompanionMenuItem label="Stop turn" tone="danger" onSelect={() => {}} />);
    expect(danger).toContain('text-[var(--red)]');
    expect(danger).not.toContain('aria-expanded');
  });
  test('the model section is three select rows and never opens the composer picker dialog inside the menu', () => {
    const source = readFileSync(new URL('../src/droneHub/companion/CompanionModelPicker.tsx', import.meta.url), 'utf8');
    expect(source).toContain('aria-label="Companion provider"');
    expect(source).toContain('aria-label="Companion model"');
    expect(source).toContain('aria-label="Companion reasoning"');
    expect(source).not.toContain('ChatComposerModelPicker');
    expect(source).not.toContain('menuPlacement');
  });

});
